// The farm-plan generator: one source of truth for the board's farm steps and the
// dashboard's detail view. Pure ES module, no DOM and no Node APIs, so main.ts imports
// it to write board.json and the dashboard imports it to render the same plan.
//
// Every plan is derived from the protocol's own snapshot fields (category, chains,
// TVL, age) through 8 archetypes. No protocol name is ever special-cased: the same
// function plans every row, and the numbers come from the row itself.
//
// Money: every step carries a fee in USD and a time in days, and the totals are the
// SUM of the steps, never typed. Gas is a labelled assumption (table date below),
// not a quote: gas moves, so the plan states what it assumed and when.

/** Assumed average gas per transaction, USD, by chain. Labelled assumption, not a quote. */
export const GAS_USD = {
  Ethereum: 4.0,
  Arbitrum: 0.3,
  Base: 0.1,
  Solana: 0.05,
  Binance: 0.25,
  Polygon: 0.1,
  Optimism: 0.15,
  Avalanche: 0.3,
  'Hyperliquid L1': 0.05,
  Bitcoin: 2.0,
};
export const GAS_DEFAULT_USD = 1.0;
export const GAS_TABLE_DATE = '2026-11-14';
export const BRIDGE_FEE_USD = 2.0;
export const BRIDGE_SLIPPAGE_PCT = 0.1;

/** Gas for one transaction on a chain, USD (assumption, see GAS_TABLE_DATE). */
export function gasFor(chain) {
  if (typeof chain !== 'string' || chain.length === 0) return GAS_DEFAULT_USD;
  return GAS_USD[chain] ?? GAS_DEFAULT_USD;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(tvlUsd) {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age in days (null age: the neutral 30). */
export function holdDaysFor(ageDays) {
  if (ageDays === null || ageDays === undefined) return 30;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/** The plan's archetype, from the protocol's category alone. */
export function archetypeFor(category) {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('perpetual') || c.includes('derivative')) return 'perps';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'lst';
  if (c.includes('dex') || c.includes('yield') || c.includes('leverag')) return 'dex';
  if (c.includes('rwa') || c.includes('basis') || c.includes('cedefi') || c.includes('allocator') || c.includes('curator')) return 'vault';
  if (c.includes('stable') || c.includes('payment') || c.includes('insurance') || c.includes('governance') || c === 'chain') return 'stable';
  return 'generic';
}

/** The archetype's main action, in words a farmer can follow. */
function actionFor(archetype, name, chain, capital) {
  switch (archetype) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
    case 'dex':
      return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
    case 'bridge':
      return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
    case 'lst':
      return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
    case 'vault':
      return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** The archetype's weekly qualifying action. */
function weeklyFor(archetype) {
  switch (archetype) {
    case 'lending':
      return 'Make one qualifying action each week, such as a deposit, a borrow or a repayment.';
    case 'dex':
      return 'Make one qualifying action each week, such as a swap, a deposit or a vote.';
    case 'perps':
      return 'Make one qualifying action each week, such as a trade, a deposit or a close.';
    case 'bridge':
      return 'Make one qualifying action each week, such as a bridge, a swap or a deposit.';
    case 'lst':
      return 'Make one qualifying action each week, such as a stake, a restake or a vote.';
    case 'vault':
      return 'Make one qualifying action each week, such as a deposit, a rebalance or a vote.';
    case 'stable':
      return 'Make one qualifying action each week, such as a mint, a deposit or a transfer.';
    default:
      return 'Make one qualifying action each week, such as a deposit, a swap or a vote.';
  }
}

/** A plan's step: the action, its fee in USD, its capital in USD, its days. */
export function farmPlan(row) {
  const chain = row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain';
  const capital = capitalFor(row.tvl_usd);
  const hold = holdDaysFor(row.age_days);
  const gas = gasFor(chain);
  const arch = archetypeFor(row.category);
  const action = actionFor(arch, row.name, chain, capital);
  const weekly = weeklyFor(arch);
  const gasLabel = gas >= 1 ? `$${trimNum(gas)}` : `$${trimNum(gas)}`;
  const setupFee = arch === 'bridge' ? gas + BRIDGE_FEE_USD + (capital * BRIDGE_SLIPPAGE_PCT) / 100 : gas;

  const steps = [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Check the protocol address on the chain explorer before you send anything.',
      costUsd: gas,
      capitalUsd: 0,
      days: 0,
      costLabel: `about ${gasLabel} of gas`,
      timeLabel: '5 minutes',
    },
    {
      text: action,
      costUsd: round2(setupFee),
      capitalUsd: capital,
      days: 0,
      costLabel:
        arch === 'bridge'
          ? `$${capital} of capital plus about $${trimNum(round2(setupFee))} of gas, bridge fee and slippage`
          : `$${capital} of capital plus about ${gasLabel} of gas`,
      timeLabel: '15 minutes to set up',
    },
    {
      text: weekly,
      costUsd: gas,
      capitalUsd: 0,
      days: 0,
      costLabel: `about ${gasLabel} of gas a week`,
      timeLabel: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Do not move the funds to another wallet in that time.`,
      costUsd: 0,
      capitalUsd: capital,
      days: hold,
      costLabel: `the $${capital} stays in the position`,
      timeLabel: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Never pay a fee to claim, and never follow a claim link from a chat or an ad.`,
      costUsd: 0,
      capitalUsd: 0,
      days: 0,
      costLabel: 'no fee to check',
      timeLabel: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cap this position at 5% of your test budget: no token or airdrop is confirmed.`,
      costUsd: 0,
      capitalUsd: 0,
      days: 0,
      costLabel: 'nothing but the log',
      timeLabel: '5 minutes',
    },
  ];
  const totals = {
    feesUsd: round2(steps.reduce((n, s) => n + s.costUsd, 0)),
    capitalUsd: capital,
    days: hold,
  };
  return { archetype: arch, steps, totals };
}

/** One step as the board.json string: action, cost and time, 20 to 600 characters. */
export function stepString(step) {
  let s = `${step.text} Cost: ${step.costLabel}. Time: ${step.timeLabel}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A row's risk lines, from its own snapshot data. */
export function riskLines(row) {
  const out = [];
  if (row.age_days !== null && row.age_days !== undefined && row.age_days < 90) {
    out.push(`Young protocol: DefiLlama first tracked it ${row.age_days} days ago.`);
  }
  if (row.age_days === null || row.age_days === undefined) {
    out.push('Listing date not reported by DefiLlama, so the age used is 0.');
  }
  if (row.chains && row.chains.length === 1) {
    out.push(`TVL on a single chain (${row.chains[0]}).`);
  }
  if (row.change_7d === null || row.change_7d === undefined) {
    out.push('No 7-day TVL change reported, so growth counts as neutral.');
  } else if (row.change_7d < -20) {
    out.push(`TVL fell ${Math.abs(row.change_7d).toFixed(1)}% in 7 days.`);
  }
  out.push('Speculative: no token or airdrop is confirmed. Cap exposure at 5% of your test budget.');
  return out;
}

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Browser global for classic scripts that load this file without import.
if (typeof window !== 'undefined') {
  window.FARM_PLAN = { farmPlan, stepString, riskLines, gasFor, capitalFor, holdDaysFor, archetypeFor, GAS_TABLE_DATE };
}
