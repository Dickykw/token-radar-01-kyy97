# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Dickykw/token-radar-01-kyy97/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Dickykw/token-radar-01-kyy97/reward.svg)](https://make.fun/bounty/token-radar-01)

The best token launch radar: a program that reads a sealed DefiLlama snapshot of
758 protocols and writes a ranked board of the pre-token protocols worth farming
next, with the steps to farm each one, plus a static dashboard that shows it.

Entry for [make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01)
($1,325; 1st place $1,000). No network, no framework, no external fonts: the
dashboard ships its data with it.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`, writes
`/output/board.json` (200 rows), `/output/dashboard/data.js`,
`/output/dashboard/` (the page) and `/output/screenshots/`, then
`/output/dossier.json` via `vendor/makefun-board.ts`. Two runs write the same
bytes. The dashboard is served from `dashboard/` (or `/output/dashboard/`) and
needs no server-side code: open `index.html` from any static server.

## The model (radar-2)

A protocol is **pre-token** when the snapshot records no token for it: no market
cap, no CoinGecko id, no symbol. Protocols whose token already trades are kept
apart in the Trading view and shown at the market's own value, never the model's.

```
ImpliedFDV = TVL × m₀ × (1 + g) × (1 + 0.5·a)
```

| Component | From the snapshot | Transform |
| --- | --- | --- |
| TVL | `tvl_usd` | Direct; every protocol in the snapshot has one |
| m₀ | `mcap_usd` / `tvl_usd` | **Median of the 128 trading-token protocols in this same snapshot: 0.2138** (p25 0.0468, p75 1.0467). The snapshot carries no FDV, so market cap is the traded-value proxy, and the page says so |
| g | `change_7d` | Winsorised to [−50%, +200%], then its percentile rank inside the 200-row board, so g ∈ [0, 1]. Null change (4 rows): g = 0.5, flagged on the row |
| a | `listed_at` → `as_of` | Age in days, capped at 730. The snapshot carries no token-launch date, so age is the protocol's age on DefiLlama. Null listed_at (113 rows): a = 0, flagged on the row |

The multipliers are at most 2 and 1.5, so an implied value is at most 3 × m₀ × TVL:
the clamp is inherent. Ties break on TVL, then slug, so the board is deterministic.
Watchlist membership earns no score boost: coverage and ranking are separate.

The board holds the 40 watchlist protocols plus the 160 largest pre-token
protocols below the $50M watchlist floor, by TVL. A separate Live view carries
the 24 largest trading-token protocols by market cap.

### Worked example — rank 1, Steakhouse Financial

- TVL $2,753,981,495 · 7d −2.2% (percentile g = 0.643) · age 543 days (a = 543/730)
- Base = 2,753,981,495 × 0.2138 = $588,801,244 (44.4%)
- Growth boost = base × 0.643 = $378,599,200 (28.5%)
- Maturity boost = base × 1.643 × 0.3719 = $359,968,000 (27.1%)
- Implied FDV = **$1,327,368,443** — the same arithmetic the detail view shows.

## Farm plans

Eight archetypes chosen from the protocol's own fields (category, chain count,
TVL tier, growth sign): lending, DEX, perps, bridge, liquid staking, vault
(RWA / risk curators / allocators), stable, generic. Each plan has 6 steps with
a fee in USD and a time in days per step; the totals are the **sum of the steps**,
never typed. Gas is a labelled assumption dated 2026-11-14 (Ethereum $4.00,
Arbitrum $0.30, Base $0.10, Solana $0.05, Binance $0.25, Polygon $0.10,
Optimism $0.15, Avalanche $0.30, other chains $1.00), plus a $2.00 bridge fee
and 0.1% slippage where a bridge is used. Every plan is labelled speculative,
carries a verification step, a risk line from the snapshot data, and a 5%
exposure cap. The plan generator (`dashboard/plan.js`) is one module imported
by both `main.ts` and the page, so the board and the dashboard always agree.

## The dashboard

- Header: 758 protocols · 342 pre-token · 40 watchlist · 200 board rows · m₀ 0.2138 (n=128)
- Filters: search, chain, category, status (All / Pre-token / Trading / Watchlist),
  minimum 7-day growth slider — all kept in the URL hash, so a filtered view
  reproduces exactly (`#/board?status=pre&ming=10`, `#/p/<slug>`)
- Sortable table with `aria-sort`, a "why ranked" line per row, watchlist markers,
  data-quality flags (`growth n/a`, `age n/a`)
- Detail view per protocol: KPI row, the implied value's three components as a
  stacked bar, the formula inputs with their values, the farm plan as a timeline
  with per-step cost and time, computed totals, and the risk list
- Dark slate palette (`#0F1419` / `#171E26` / `#26303B`, mint `#3DDC97` for
  pre-token, amber `#F5B942` for watchlist, coral `#FF6B6B` for negative growth),
  system font stack, tabular numbers

## Size

The dossier's text cap is 65,536 bytes and it shows every dashboard file, so the
board's rows ship as compact arrays in `dashboard/data.js` (layout: `[rank, slug,
name, category, chains ("|"-joined), tvl_usd, change_7d, age_days,
implied_value_usd, watchlist, flags]`; flags: 1 = `change_7d` null, 2 =
`listed_at` null; live rows: `[slug, name, category, chains, tvl_usd, mcap_usd,
change_7d]`). Dossier text is **59,011 bytes** of the 65,536 allowed; the
dashboard is 5 files, 58,530 bytes; the dossier is 81 KB of the 1.5 MiB allowed.

## Screenshots

`screenshots/` holds the board (default sort), the detail view of the #1
watchlist protocol (Steakhouse Financial), and the filtered view (Pre-token,
growth over +10%: 13 of 200 rows). All three are 1280×800 PNGs rendered from
this dashboard's final code — regenerated after every code change.

## What the snapshot does not carry

The snapshot has no ranking, no implied value, no farm plan and no airdrop flag,
and it carries no FDV and no token-launch date. The calibration, the ages and the
plans above are this entry's derivations from its ten fields, stated as such;
"no token" means the snapshot records none, never that the protocol has none.
Implied FDV is this radar's own ranking claim, not a price prediction and not
investment advice.

## License

MIT. See [LICENSE](LICENSE).
