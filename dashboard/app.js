// Token Radar's page: renders the board from window.RADAR (dashboard/data.js),
// with filters, sorting, hash routing and a detail view per protocol. No network:
// the data ships with the page, and the farm plans are generated here from the
// same plan.js main.ts uses for board.json, so the page and the board agree.
//
// Compact row layout (see lib/model.ts): [rank, slug, name, category, chains
// ("|"-joined), tvl_usd, change_7d, age_days, implied_value_usd, watchlist, flags]
// flags: 1 = change_7d null, 2 = listed_at null. Live rows: [slug, name, category,
// chains, tvl_usd, mcap_usd, change_7d].

import { farmPlan, riskLines, GAS_TABLE_DATE } from './plan.js';

const D = window.RADAR;
const META = D.meta;
const ROWS = D.rows;
const LIVE = D.live;
const M0 = META.m0;

// ---- row accessors (index into the compact arrays) ----
const rRank = (r) => r[0];
const rSlug = (r) => r[1];
const rName = (r) => r[2];
const rCat = (r) => r[3];
const rChains = (r) => (r[4] ? r[4].split('|') : []);
const rTvl = (r) => r[5];
const rCh7 = (r) => r[6];
const rAge = (r) => r[7];
const rFdv = (r) => r[8];
const rWl = (r) => r[9] === 1;
const rFlags = (r) => r[10];
const lSlug = (r) => r[0];
const lName = (r) => r[1];
const lCat = (r) => r[2];
const lChains = (r) => (r[3] ? r[3].split('|') : []);
const lTvl = (r) => r[4];
const lMcap = (r) => r[5];
const lCh7 = (r) => r[6];

// ---- formatting ----
const fmtUsd = (n) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
};
const fmtUsdFull = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtPct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ---- the model, re-derived in the page from the same figures ----
const winsor = (ch7) => Math.min(200, Math.max(-50, ch7 === null ? 0 : ch7));
function percentiles(values) {
  const n = values.length;
  if (n <= 1) return values.map(() => 0.5);
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const out = new Array(n);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && order[j + 1].v === order[k].v) j++;
    const avg = (k + j) / 2 / (n - 1);
    for (let t = k; t <= j; t++) out[order[t].i] = avg;
    k = j + 1;
  }
  return out;
}
const GROWTH_PCTILE = percentiles(ROWS.map((r) => winsor(rCh7(r))));
const pctileOf = (row) => (rCh7(row) === null ? 0.5 : GROWTH_PCTILE[ROWS.indexOf(row)]);
const maturityMult = (row) => 1 + 0.5 * (rAge(row) === null ? 0 : Math.min(rAge(row), 730) / 730);

// ---- header, method, footer ----
const $ = (id) => document.getElementById(id);
$('stats').innerHTML = [
  ['Protocols in snapshot', META.totalProtocols],
  ['Pre-token', META.preTokenCount],
  ['On the watchlist', META.watchlistSize],
  ['Board rows', META.boardSize],
  ['Calibration m₀', `${META.m0} (n=${META.m0n})`],
]
  .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
  .join('');
$('model-note').textContent =
  `Implied FDV = TVL × m₀ × (1 + g) × (1 + 0.5·a). m₀ is the median market-cap/TVL of the ${META.m0n} trading-token protocols in this same snapshot (p25 ${META.m0p25}, p75 ${META.m0p75}); the snapshot carries no FDV, so market cap is the traded-value proxy. g is the winsorised 7-day growth's percentile rank inside the board; a is the protocol's age in days (listed_at to ${META.asOf}), capped at 730.`;
$('method-text').textContent =
  `The board ranks the ${META.watchlistSize} watchlist protocols plus the ${META.earlySize} largest pre-token protocols below the $50M watchlist floor, by implied FDV. Trading-token protocols are kept apart in the Trading view and shown at their market's own value, never the model's. A protocol is "pre-token" when the snapshot records no token for it — no market cap, no CoinGecko id, no symbol. Watchlist membership earns no score boost: coverage and ranking are separate.`;
$('gas-text').textContent =
  `Farm-plan fees use assumed average gas per transaction (Ethereum $4.00, Arbitrum $0.30, Base $0.10, Solana $0.05, Binance $0.25, Polygon $0.10, Optimism $0.15, Avalanche $0.30, other chains $1.00), plus a $2.00 bridge fee and 0.1% slippage where a bridge is used. Table dated ${GAS_TABLE_DATE}: an assumption, not a quote.`;
$('asof').textContent = META.asOf;
$('mver').textContent = META.modelVersion;

// ---- filter controls ----
const chains = [...new Set(ROWS.flatMap(rChains).concat(LIVE.flatMap(lChains)))].sort();
const cats = [...new Set(ROWS.map(rCat).concat(LIVE.map(lCat)).filter(Boolean))].sort();
for (const c of chains) $('chain').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
for (const c of cats) $('cat').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);

const state = { status: 'all', q: '', chain: '', cat: '', ming: -50, sort: 'rank', dir: 'asc' };

function readHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('p/')) return { view: 'detail', slug: decodeURIComponent(h.slice(2)) };
  const q = new URLSearchParams(h.replace(/^board\??/, ''));
  return {
    view: 'board',
    status: q.get('status') || 'all',
    q: q.get('q') || '',
    chain: q.get('chain') || '',
    cat: q.get('cat') || '',
    ming: Number(q.get('ming') ?? -50),
    sort: q.get('sort') || 'rank',
    dir: q.get('dir') || 'asc',
  };
}
function writeHash() {
  const q = new URLSearchParams();
  if (state.status !== 'all') q.set('status', state.status);
  if (state.q) q.set('q', state.q);
  if (state.chain) q.set('chain', state.chain);
  if (state.cat) q.set('cat', state.cat);
  if (state.ming > -50) q.set('ming', String(state.ming));
  if (state.sort !== 'rank') q.set('sort', state.sort);
  if (state.dir !== 'asc') q.set('dir', state.dir);
  const s = q.toString();
  history.replaceState(null, '', `#/board${s ? `?${s}` : ''}`);
}

// ---- filtering + sorting ----
function filteredRows() {
  const q = state.q.trim().toLowerCase();
  if (state.status === 'live') {
    return LIVE.filter(
      (r) =>
        (!q || lName(r).toLowerCase().includes(q) || lSlug(r).includes(q)) &&
        (!state.chain || lChains(r).includes(state.chain)) &&
        (!state.cat || lCat(r) === state.cat) &&
        (state.ming <= -50 || (lCh7(r) !== null && lCh7(r) >= state.ming)),
    );
  }
  return ROWS.filter((r) => {
    if (state.status === 'wl' && !rWl(r)) return false;
    if (q && !(rName(r).toLowerCase().includes(q) || rSlug(r).includes(q))) return false;
    if (state.chain && !rChains(r).includes(state.chain)) return false;
    if (state.cat && rCat(r) !== state.cat) return false;
    // The slider at its −50% stop means "no minimum": a row whose 7-day change is
    // below −50% still belongs on the board's default view.
    if (state.ming > -50 && (rCh7(r) === null || rCh7(r) < state.ming)) return false;
    return true;
  });
}
const SORTS = {
  rank: (a, b) => rRank(a) - rRank(b),
  name: (a, b) => rName(a).localeCompare(rName(b)),
  cat: (a, b) => (rCat(a) || '').localeCompare(rCat(b) || '') || rRank(a) - rRank(b),
  chains: (a, b) => rChains(a).length - rChains(b).length || rRank(a) - rRank(b),
  tvl: (a, b) => rTvl(b) - rTvl(a),
  ch7: (a, b) => (rCh7(b) ?? -999) - (rCh7(a) ?? -999),
  age: (a, b) => (rAge(b) ?? -1) - (rAge(a) ?? -1),
  fdv: (a, b) => rFdv(b) - rFdv(a),
};
const LIVE_SORTS = {
  rank: (a, b) => (lMcap(b) ?? 0) - (lMcap(a) ?? 0),
  name: (a, b) => lName(a).localeCompare(lName(b)),
  cat: (a, b) => (lCat(a) || '').localeCompare(lCat(b) || ''),
  chains: (a, b) => lChains(a).length - lChains(b).length,
  tvl: (a, b) => lTvl(b) - lTvl(a),
  ch7: (a, b) => (lCh7(b) ?? -999) - (lCh7(a) ?? -999),
  age: () => 0,
  fdv: (a, b) => (lMcap(b) ?? 0) - (lMcap(a) ?? 0),
};

function whyRanked(row) {
  const g = pctileOf(row);
  const parts = [
    `TVL ${fmtUsd(rTvl(row))}`,
    rCh7(row) === null ? '7d n/a' : `7d ${fmtPct(rCh7(row))} (top ${Math.round((1 - g) * 100)}%)`,
    rAge(row) === null ? 'age n/a' : `${rAge(row)}d, no token`,
  ];
  return parts.join(' · ');
}

// ---- rendering ----
function renderBoard() {
  const live = state.status === 'live';
  const rows = filteredRows();
  const sorts = live ? LIVE_SORTS : SORTS;
  const fn = sorts[state.sort] || sorts.rank;
  rows.sort((a, b) => (state.dir === 'asc' ? fn(a, b) : -fn(a, b)));
  $('count').textContent = live
    ? `${rows.length} of ${LIVE.length} trading-token protocols (top ${META.liveSize} by market cap)`
    : `${rows.length} of ${ROWS.length} board rows · ${META.watchlistSize} watchlist · ${META.earlySize} early`;
  document.querySelectorAll('thead th[data-sort]').forEach((th) => {
    th.setAttribute('aria-sort', th.dataset.sort === state.sort ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
  document.querySelectorAll('thead th')[7].textContent = live ? 'Market cap' : 'Implied FDV';
  $('rows').innerHTML = rows
    .map((r) => {
      if (live) {
        const ratio = lMcap(r) !== null && lTvl(r) > 0 ? (lMcap(r) / lTvl(r)).toFixed(2) : '—';
        return `<tr><td>${LIVE.indexOf(r) + 1}</td><td class="name"><a href="#/p/${lSlug(r)}">${esc(lName(r))}</a></td><td>${esc(lCat(r) || '—')}</td><td>${lChains(r).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</td><td class="num">${fmtUsd(lTvl(r))}</td><td class="num ${lCh7(r) !== null && lCh7(r) < 0 ? 'down' : 'up'}">${fmtPct(lCh7(r))}</td><td class="num">—</td><td class="num">${fmtUsd(lMcap(r))}</td><td class="why">Trades at ${fmtUsd(lMcap(r))} mcap · mcap/TVL ${ratio}</td></tr>`;
      }
      const flags = [];
      if (rFlags(r) & 1) flags.push('growth n/a');
      if (rFlags(r) & 2) flags.push('age n/a');
      return `<tr><td>${rRank(r)}</td><td class="name"><a href="#/p/${rSlug(r)}">${esc(rName(r))}</a>${rWl(r) ? '<span class="wl">Watchlist</span>' : ''}${flags.length ? ` <span class="flag">${flags.join(' · ')}</span>` : ''}</td><td>${esc(rCat(r) || '—')}</td><td>${rChains(r).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</td><td class="num">${fmtUsd(rTvl(r))}</td><td class="num ${rCh7(r) !== null && rCh7(r) < 0 ? 'down' : 'up'}">${fmtPct(rCh7(r))}</td><td class="num">${rAge(r) === null ? '—' : `${rAge(r)}d`}</td><td class="num">${fmtUsd(rFdv(r))}</td><td class="why">${whyRanked(r)}</td></tr>`;
    })
    .join('');
  $('empty').hidden = rows.length > 0;
  $('board-view').hidden = false;
  $('detail-view').hidden = true;
}

function renderDetail(slug) {
  const row = ROWS.find((r) => rSlug(r) === slug);
  const live = !row && LIVE.find((r) => lSlug(r) === slug);
  const el = $('detail-view');
  if (!row && !live) {
    el.innerHTML = `<p><a class="back" href="#/board">← Back to the board</a></p><p class="empty">No protocol with slug “${esc(slug)}” is on this board.</p>`;
  } else if (live) {
    const ratio = lMcap(live) !== null && lTvl(live) > 0 ? (lMcap(live) / lTvl(live)).toFixed(2) : '—';
    el.innerHTML = `<p><a class="back" href="#/board">← Back to the board</a></p><h2>${esc(lName(live))}</h2>
      <dl class="kpis"><div><dt>Market cap</dt><dd>${fmtUsd(lMcap(live))}</dd></div><div><dt>TVL</dt><dd>${fmtUsd(lTvl(live))}</dd></div><div><dt>Market-cap / TVL</dt><dd>${ratio}</dd></div><div><dt>7d change</dt><dd>${fmtPct(lCh7(live))}</dd></div></dl>
      <p>${esc(lName(live))} already trades: the radar shows it at the market's own value, never the model's. It is not ranked on the board, which is for protocols that record no token.</p>
      <p class="why">Category ${esc(lCat(live) || '—')} · Chains ${lChains(live).map(esc).join(', ') || '—'}</p>`;
  } else {
    const g = pctileOf(row);
    const mm = maturityMult(row);
    const base = rTvl(row) * M0;
    const boostG = base * g;
    const boostA = base * (1 + g) * (mm - 1);
    const imp = rFdv(row);
    const pct = (x) => `${((x / imp) * 100).toFixed(1)}%`;
    const plan = farmPlan({ name: rName(row), category: rCat(row), chains: rChains(row), tvl_usd: rTvl(row), age_days: rAge(row) });
    const risks = riskLines({ name: rName(row), chains: rChains(row), tvl_usd: rTvl(row), age_days: rAge(row), change_7d: rCh7(row) });
    el.innerHTML = `<p><a class="back" href="#/board">← Back to the board</a></p>
      <h2>${esc(rName(row))} ${rWl(row) ? '<span class="wl">Watchlist</span>' : ''}</h2>
      <p class="why">Rank ${rRank(row)} of ${ROWS.length} · ${esc(rCat(row) || '—')} · ${rChains(row).map(esc).join(', ')}</p>
      <dl class="kpis">
        <div><dt>Implied FDV</dt><dd>${fmtUsdFull(imp)}</dd></div>
        <div><dt>TVL</dt><dd>${fmtUsdFull(rTvl(row))}</dd></div>
        <div><dt>7d change</dt><dd>${fmtPct(rCh7(row))}</dd></div>
        <div><dt>Age, no token</dt><dd>${rAge(row) === null ? 'n/a' : `${rAge(row)} days`}</dd></div>
      </dl>
      <h3>What the implied value is made of</h3>
      <div class="bar" role="img" aria-label="Implied value components: base ${pct(base)}, growth ${pct(boostG)}, maturity ${pct(boostA)}">
        <i class="b1" style="width:${pct(base)}"></i><i class="b2" style="width:${pct(boostG)}"></i><i class="b3" style="width:${pct(boostA)}"></i>
      </div>
      <p class="legend"><b>■ Base ${pct(base)}</b> TVL × m₀ &nbsp; <b>■ Growth ${pct(boostG)}</b> × (1 + g) &nbsp; <b>■ Maturity ${pct(boostA)}</b> × (1 + 0.5·a)</p>
      <table class="plain"><thead><tr><th>Input</th><th class="num">Value</th></tr></thead><tbody>
        <tr><td>TVL</td><td class="num">${fmtUsdFull(rTvl(row))}</td></tr>
        <tr><td>Calibration m₀ (median mcap/TVL, n=${META.m0n})</td><td class="num">${META.m0}</td></tr>
        <tr><td>7-day growth, winsorised to [−50%, +200%]</td><td class="num">${fmtPct(rCh7(row) === null ? 0 : Math.min(200, Math.max(-50, rCh7(row))))}</td></tr>
        <tr><td>Growth percentile g (in the board)</td><td class="num">${g.toFixed(3)}</td></tr>
        <tr><td>Age a (days, capped at 730)</td><td class="num">${rAge(row) === null ? '0 (unreported)' : Math.min(rAge(row), 730)}</td></tr>
        <tr><td>Maturity multiplier (1 + 0.5·a)</td><td class="num">${mm.toFixed(3)}</td></tr>
        <tr><td>Implied FDV</td><td class="num">${fmtUsdFull(imp)}</td></tr>
      </tbody></table>
      <h3>Farm plan — ${esc(plan.archetype)}</h3>
      <ol class="steps">${plan.steps.map((s) => `<li>${esc(s.text)}<div class="meta">Cost: ${esc(s.costLabel)} · Time: ${esc(s.timeLabel)}</div></li>`).join('')}</ol>
      <div class="totals"><span>Fees <b>≈ $${plan.totals.feesUsd.toFixed(2)}</b></span><span>Capital <b>$${plan.totals.capitalUsd}</b></span><span>Time <b>${plan.totals.days} days</b></span></div>
      <h3>Risks</h3>
      <ul class="risks">${risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
  }
  $('board-view').hidden = true;
  el.hidden = false;
}

// ---- wiring ----
function syncControls() {
  $('q').value = state.q;
  $('chain').value = state.chain;
  $('cat').value = state.cat;
  $('ming').value = String(state.ming);
  $('ming-out').textContent = `${state.ming > 0 ? '+' : ''}${state.ming}%`;
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === state.status)));
}
function applyHash() {
  const h = readHash();
  if (h.view === 'detail') {
    renderDetail(h.slug);
    return;
  }
  Object.assign(state, { status: h.status, q: h.q, chain: h.chain, cat: h.cat, ming: h.ming, sort: h.sort, dir: h.dir });
  syncControls();
  renderBoard();
}
$('q').addEventListener('input', (e) => {
  state.q = e.target.value;
  writeHash();
  renderBoard();
});
$('chain').addEventListener('change', (e) => {
  state.chain = e.target.value;
  writeHash();
  renderBoard();
});
$('cat').addEventListener('change', (e) => {
  state.cat = e.target.value;
  writeHash();
  renderBoard();
});
$('ming').addEventListener('input', (e) => {
  state.ming = Number(e.target.value);
  $('ming-out').textContent = `${state.ming > 0 ? '+' : ''}${state.ming}%`;
  writeHash();
  renderBoard();
});
document.querySelectorAll('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    state.status = b.dataset.status;
    writeHash();
    renderBoard();
    syncControls();
  }),
);
document.querySelectorAll('thead th[data-sort]').forEach((th) =>
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    else {
      state.sort = k;
      state.dir = k === 'rank' || k === 'name' ? 'asc' : 'desc';
    }
    writeHash();
    renderBoard();
  }),
);
window.addEventListener('hashchange', applyHash);
applyHash();
