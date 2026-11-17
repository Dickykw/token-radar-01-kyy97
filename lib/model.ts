// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling)
// and adds the 160 largest pre-token protocols below the floor, by TVL: the early rows
// the radar exists to find. A protocol is pre-token when its record carries no token
// (no market cap, no CoinGecko id, no symbol); protocols whose token already trades
// are kept apart and shown with the market's own values, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures. The calibration comes
// from the snapshot itself: m0 is the MEDIAN market-cap/TVL of the trading-token
// protocols in this same snapshot (mcap_usd is the closest the snapshot carries to a
// traded value; it carries no FDV). No protocol name is ever special-cased.
//
//   growth  = winsorize(change_7d, -50, +200) per cent, then its percentile rank
//             inside the ranked set -> g in [0, 1] (null change_7d: g = 0.5, flagged)
//   age     = days from listed_at to as_of, capped at 730 (null listed_at: a = 0, flagged)
//   implied = tvl_usd x m0 x (1 + g) x (1 + 0.5 x age/730), rounded, at least $1
//
// The two multipliers are at most 2 and 1.5, so the implied value is at most 3 x m0
// times TVL: the clamp is inherent, not a second rule. Ties break on TVL, then slug,
// so the board is deterministic.

import { farmPlan, stepString } from '../dashboard/plan.js';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The calibration, read off the snapshot's own trading-token protocols. */
export interface Calibration {
  /** Median market-cap/TVL of the trading-token protocols with a market cap. */
  m0: number;
  /** How many protocols the median is taken over. */
  n: number;
  p25: number;
  p75: number;
}

export const MODEL_VERSION = 'radar-2';
/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;
/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;
/** The maturity cap, in days: age counts up to two years. */
export const MATURITY_DAYS = 730;
/** The growth winsorisation window, in per cent. */
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 200;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_percentile: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted array, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * The calibration: the median market-cap/TVL of the snapshot's own trading-token
 * protocols (those with a market cap and a TVL above zero). The snapshot carries no
 * FDV, so market cap is the traded-value proxy, and the dashboard says so.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const ratios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .sort((a, b) => a - b);
  const m0 = median(ratios);
  return {
    m0: m0 === null ? 0.5 : Math.round(m0 * 1e4) / 1e4,
    n: ratios.length,
    p25: Math.round(quantile(ratios, 0.25) * 1e4) / 1e4,
    p75: Math.round(quantile(ratios, 0.75) * 1e4) / 1e4,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Winsorised 7-day growth, in per cent. */
export function winsorisedGrowth(change7d: number | null): number {
  return Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(change7d, 0)));
}

/**
 * Percentile ranks of the winsorised growths, in [0, 1], ties averaged: the i-th
 * smallest of n distinct values gets i/(n-1). One value only: 0.5.
 */
export function growthPercentiles(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const out = new Array<number>(n);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && order[j + 1]!.v === order[k]!.v) j++;
    const avg = (k + j) / 2 / (n - 1);
    for (let t = k; t <= j; t++) out[order[t]!.i] = avg;
    k = j + 1;
  }
  return out;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, cal: Calibration): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries
  // (it cannot, but the board's coverage is the gate's row and is never gambled on a
  // missing record). No score boost for being on it: coverage and ranking are separate.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  // Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const rows = [...chosen.values()];
  const growths = rows.map((p) => winsorisedGrowth(p.change_7d));
  const pctiles = growthPercentiles(growths);
  const scored = rows.map((p, i) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const g = p.change_7d === null ? 0.5 : pctiles[i]!;
    const a = age === null ? 0 : Math.min(age, MATURITY_DAYS) / MATURITY_DAYS;
    const maturityMult = 1 + 0.5 * a;
    const implied = Math.max(1, Math.round(p.tvl_usd * cal.m0 * (1 + g) * maturityMult));
    return { p, implied, growthPct: growths[i]!, g, maturityMult, age };
  });
  scored.sort(
    (x, y) => y.implied - x.implied || y.p.tvl_usd - x.p.tvl_usd || (x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: cal.m0,
      growth_pct: Math.round(s.growthPct * 1e4) / 1e4,
      growth_percentile: Math.round(s.g * 1e4) / 1e4,
      maturity_multiplier: Math.round(s.maturityMult * 1e4) / 1e4,
      age_days: s.age,
    },
    farm_steps: farmPlan({ name: s.p.name, category: s.p.category, chains: s.p.chains, tvl_usd: s.p.tvl_usd, age_days: s.age }).steps.map(
      stepString,
    ),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/**
 * A board row's compact form for the dashboard's data.js: an array, in a fixed order
 * the page and the README both document, so 200 rows stay inside the dossier's text
 * cap. [rank, slug, name, category, chains (joined with |), tvl, change_7d, age_days,
 * implied_value_usd, watchlist (0/1), flags] where flags is 1 when change_7d is null
 * and 2 when listed_at is null.
 */
export function radarRow(row: BoardRow, watchlist: Set<string>): unknown[] {
  return [
    row.rank,
    row.slug,
    row.name,
    row.category ?? '',
    row.chains.join('|'),
    row.tvl_usd,
    row.change_7d,
    row.age_days,
    row.implied_value_usd,
    watchlist.has(row.slug) ? 1 : 0,
    (row.change_7d === null ? 1 : 0) | (row.age_days === null ? 2 : 0),
  ];
}

/** A live row's compact form: [slug, name, category, chains, tvl, mcap, change_7d]. */
export function liveRowCompact(row: LiveRow): unknown[] {
  return [row.slug, row.name, row.category ?? '', row.chains.join('|'), row.tvl_usd, row.mcap_usd, row.change_7d];
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  cal: Calibration,
): { board: BoardRow[]; live: LiveRow[]; meta: Record<string, unknown>; rows: unknown[][]; liveRows: unknown[][] } {
  const board = buildBoard(snapshot, cal);
  const live = liveRows(snapshot);
  const wl = new Set(snapshot.watchlist);
  const early = board.filter((r) => !wl.has(r.slug)).length;
  const meta = {
    asOf: snapshot.as_of,
    floorUsd: snapshot.floor_usd,
    m0: cal.m0,
    m0n: cal.n,
    m0p25: cal.p25,
    m0p75: cal.p75,
    modelVersion: MODEL_VERSION,
    watchlistSize: snapshot.watchlist.length,
    boardSize: board.length,
    earlySize: early,
    liveSize: live.length,
    totalProtocols: snapshot.protocols.length,
    preTokenCount: snapshot.protocols.filter(isPreToken).length,
  };
  return { board, live, meta, rows: board.map((r) => radarRow(r, wl)), liveRows: live.map(liveRowCompact) };
}

/** The leading YYYY-MM-DD of a date or datetime string, or null when it has none. */
function datePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m === null ? null : m[1]!;
}

/**
 * The snapshot out of a file's text, refused unless it is the shape the model scores.
 * Tolerant where the shape is the house's own transform: a datetime where the file
 * promises a date reads as its date, a whole-dollar figure that arrives untruncated
 * is truncated, and a protocol row the house itself drops from the file (no slug,
 * name or TVL) is dropped here instead of refusing the whole snapshot. Anything
 * else malformed — no JSON, no date, no floor, no arrays — still refuses: the run
 * cannot score what it cannot read.
 */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  const asOf = datePart(o.as_of);
  if (asOf === null) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isFinite(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  const floorUsd = Math.trunc(o.floor_usd);
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols: SnapshotProtocol[] = [];
  for (const v of o.protocols) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) continue;
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) continue;
    protocols.push({
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: Math.trunc(p.tvl_usd),
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? Math.trunc(p.mcap_usd) : null,
      listed_at: datePart(p.listed_at),
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    });
  }
  return {
    as_of: asOf,
    source: o.source,
    floor_usd: floorUsd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
    return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(meta: Record<string, unknown>, rows: unknown[][], liveRows: unknown[][]): string {
  return `window.RADAR=${JSON.stringify({ meta, rows, live: liveRows })};\n`;
}
