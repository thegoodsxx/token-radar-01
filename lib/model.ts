// The token radar's implied-value model and farm playbook generator.
//
// Intellectual core:
// Derives implied protocol valuations dynamically from DefiLlama snapshot data at runtime:
// 1. Peer multiple M(P): category median mcap/TVL shrunk toward global median with prior weight 6,
//    capped at 3.0x to avoid thin-cohort over-crediting.
// 2. Base value B = tvl_usd * M(P).
// 3. Momentum factor: f_mom = clamp(1 + change_7d / 100, 0.5, 2.0).
// 4. Seasoning factor: f_age = 1 + 0.25 * min(age_days, 1460) / 1460 (up to +25% at 4 years).
// 5. Chain-breadth factor: f_chain = 1 + 0.05 * min(len(chains) - 1, 6) (up to +30% at 7+ chains).
// 6. Launch-plausibility factor: f_plaus = 0.10 for wrapped, bridged, or exchange products with
//    existing token lineage; 1.0 for genuine pre-token protocol primitives.
// 7. Implied value = round(B * f_mom * f_age * f_chain * f_plaus), minimum 1 whole dollar.
//
// Farm playbooks:
// Concrete, costed, timed multi-step strategies instantiated from each protocol's own category,
// chains, TVL capital tier, and protocol age.

/** The snapshot protocol entry: exactly the ten fields the sealed input carries. */
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

/** The snapshot document root. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Model configuration constants. */
export interface ModelConstants {
  shrinkage_prior_weight: number;
  peer_multiple_cap: number;
  momentum_floor: number;
  momentum_cap: number;
  seasoning_max_days: number;
  seasoning_max_bonus: number;
  breadth_max_chains: number;
  breadth_per_chain: number;
  plausibility_discount: number;
}

export const MODEL: ModelConstants = {
  shrinkage_prior_weight: 6,
  peer_multiple_cap: 3.0,
  momentum_floor: 0.5,
  momentum_cap: 2.0,
  seasoning_max_days: 1460,
  seasoning_max_bonus: 0.25,
  breadth_max_chains: 6,
  breadth_per_chain: 0.05,
  plausibility_discount: 0.10,
};

export const MODEL_VERSION = 'radar-2.1-implied-value';

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
  token_status: 'records no token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    category_median: number;
    category_peers_count: number;
    momentum_factor: number;
    seasoning_factor: number;
    breadth_factor: number;
    launch_plausibility_factor: number;
    model_note: string;
  };
  farm_steps: string[];
}

/** Dashboard row data for data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  category_median: number;
  category_peers_count: number;
  momentum_factor: number;
  seasoning_factor: number;
  breadth_factor: number;
  launch_plausibility_factor: number;
  model_note: string;
  is_watchlist: boolean;
  farm_steps: string[];
}

/** Live-token protocol set aside for reference comparison. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_tvl_ratio: number | null;
  change_7d: number | null;
}

/** Complete dataset provided to the dashboard via data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_median_multiple: number;
  peer_multiple_cap: number;
  category_multiples: Record<string, { median: number; n: number; multiple: number }>;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Computes the median of an array of numbers. Empty array returns 0. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Whole day count from `from` to `to`, clamped at 0; null if absent or invalid. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Formats whole dollars into readable short strings ($1.25B, $182.4M, $50.0k). */
export function formatUsdShort(usd: number): string {
  if (usd >= 1e9) return `${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `${(usd / 1e3).toFixed(1)}k`;
  return usd.toLocaleString();
}

/** Deterministic hash of string for varying templates and openers. */
export function slugHash(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h);
}

// ---------------------------------------------------------------- Value Model

/**
 * Peer multiple M(P): the median mcap/TVL of tokenized protocols in P's category.
 * Shrinks small category samples toward the global median using Empirical Bayes shrinkage:
 * M_raw = (n * M_cat + 6 * M_global) / (n + 6).
 * Hard capped at 3.0x: no launch multiple above 3x TVL is credited because beyond that
 * the peer set is too thin to believe.
 */
export function peerMultiple(
  category: string | null,
  catMedians: Map<string, { median: number; n: number }>,
  globalMedian: number,
  priorWeight: number = MODEL.shrinkage_prior_weight,
  cap: number = MODEL.peer_multiple_cap
): { multiple: number; catMedian: number; n: number; rawMultiple: number } {
  if (!category || !catMedians.has(category)) {
    const raw = globalMedian;
    return { multiple: Math.min(cap, raw), catMedian: globalMedian, n: 0, rawMultiple: raw };
  }
  const entry = catMedians.get(category)!;
  if (entry.n === 0) {
    const raw = globalMedian;
    return { multiple: Math.min(cap, raw), catMedian: globalMedian, n: 0, rawMultiple: raw };
  }
  const rawMultiple = (entry.n * entry.median + priorWeight * globalMedian) / (entry.n + priorWeight);
  const multiple = Math.min(cap, rawMultiple);
  return { multiple, catMedian: entry.median, n: entry.n, rawMultiple };
}

/**
 * Momentum factor: derived from 7-day TVL change percent.
 * Clamped between 0.5 and 2.0 so wild short-term swings cannot dominate.
 * Null change_7d defaults to neutral 1.0.
 */
export function momentumFactor(change_7d: number | null): number {
  if (change_7d === null || !Number.isFinite(change_7d)) return 1.0;
  return Math.min(MODEL.momentum_cap, Math.max(MODEL.momentum_floor, 1 + change_7d / 100));
}

/**
 * Seasoning factor: age in days from listed_at to as_of.
 * Protocols surviving long without a token receive a modest longevity premium:
 * f_age = 1 + 0.25 * min(age_days, 1460) / 1460 (up to +25% at 4 years).
 * Null listed_at defaults to 1.0.
 */
export function seasoningFactor(age_days: number | null): number {
  if (age_days === null || !Number.isFinite(age_days)) return 1.0;
  const clampedAge = Math.max(0, Math.min(age_days, MODEL.seasoning_max_days));
  return 1 + MODEL.seasoning_max_bonus * (clampedAge / MODEL.seasoning_max_days);
}

/**
 * Chain-breadth factor: rewards multi-chain liquidity infrastructure.
 * f_chain = 1 + 0.05 * min(len(chains) - 1, 6) (up to +30% at 7+ chains).
 */
export function breadthFactor(chains: string[]): number {
  const len = Array.isArray(chains) ? chains.length : 0;
  const countAboveOne = Math.max(0, len - 1);
  return 1 + MODEL.breadth_per_chain * Math.min(countAboveOne, MODEL.breadth_max_chains);
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORDS = /\b(wrapped|staked|staking)\b/i;
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Structural launch-plausibility factor mirroring house watchlist logic:
 * A protocol receives factor 0.10 when:
 * - its category is Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, or CEX;
 * - OR its name begins with an exchange name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini);
 * - OR its name carries the whole word wrapped, staked, or staking;
 * - OR its name ends in a version marker (space + V2/v2/2.0).
 * Otherwise 1.0 for genuine pre-token protocol primitives.
 */
export function launchPlausibility(p: SnapshotProtocol): { factor: number; reason: string | null } {
  const cat = p.category ?? '';
  if (EXCLUDED_CATEGORIES.has(cat)) {
    return {
      factor: MODEL.plausibility_discount,
      reason: 'a wrapped or bridged product of a token that already trades — scored as a long shot',
    };
  }
  for (const ex of EXCHANGES) {
    if (p.name.toLowerCase().startsWith(ex.toLowerCase())) {
      return {
        factor: MODEL.plausibility_discount,
        reason: 'exchange-affiliated product with existing token lineage — scored as a long shot',
      };
    }
  }
  if (WRAPPED_WORDS.test(p.name)) {
    return {
      factor: MODEL.plausibility_discount,
      reason: 'a wrapped or staked product of a token that already trades — scored as a long shot',
    };
  }
  if (VERSION_MARKER.test(p.name)) {
    return {
      factor: MODEL.plausibility_discount,
      reason: 'versioned pool of an existing protocol — scored as a long shot',
    };
  }
  return { factor: 1.0, reason: null };
}

/**
 * Evaluates the implied valuation of a pre-token protocol.
 * Combines base peer multiple (capped at 3.0x) with momentum, seasoning, chain breadth,
 * and structural launch plausibility factors.
 */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  catMedians: Map<string, { median: number; n: number }>,
  globalMedian: number
): {
  implied: number;
  base: number;
  peerMultiple: number;
  catMedian: number;
  peerCount: number;
  f_mom: number;
  f_age: number;
  f_chain: number;
  f_plaus: number;
  ageDays: number | null;
  modelNote: string;
} {
  const { multiple: M, catMedian, n } = peerMultiple(p.category, catMedians, globalMedian);
  const base = p.tvl_usd * M;
  const f_mom = momentumFactor(p.change_7d);
  const age = ageDays(asOf, p.listed_at);
  const f_age = seasoningFactor(age);
  const f_chain = breadthFactor(p.chains);
  const { factor: f_plaus, reason: plausReason } = launchPlausibility(p);
  const implied = Math.max(1, Math.round(base * f_mom * f_age * f_chain * f_plaus));

  const catLabel = p.category ?? 'Uncategorized';
  const multText = `${M.toFixed(2)}x`;
  const tvlText = formatUsdShort(p.tvl_usd);
  const momPct = p.change_7d !== null ? `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}%` : '0.0%';
  let modelNote = `${catLabel} peer multiple ${multText} on $${tvlText} TVL, ${momPct} 7d momentum`;
  if (plausReason) {
    modelNote += `; ${plausReason}`;
  }

  return {
    implied,
    base,
    peerMultiple: M,
    catMedian,
    peerCount: n,
    f_mom,
    f_age,
    f_chain,
    f_plaus,
    ageDays: age,
    modelNote,
  };
}

// ---------------------------------------------------------------- Farm Playbooks

interface CapitalTierInfo {
  tierName: string;
  suggestedShare: string;
  positionUsd: string;
  depositAmount: number;
  gasTier: 'high' | 'mid' | 'low';
}

function getCapitalTier(tvl: number): CapitalTierInfo {
  if (tvl >= 1_000_000_000) {
    return {
      tierName: '$100k farm portfolio tier',
      suggestedShare: '2.5% - 5.0% wallet share',
      positionUsd: '$2,500 - $5,000',
      depositAmount: 3500,
      gasTier: 'high',
    };
  }
  if (tvl >= 100_000_000) {
    return {
      tierName: '$10k farm portfolio tier',
      suggestedShare: '5.0% - 10.0% wallet share',
      positionUsd: '$500 - $1,000',
      depositAmount: 750,
      gasTier: 'mid',
    };
  }
  return {
    tierName: '$1k farm portfolio tier',
    suggestedShare: '5.0% - 10.0% wallet share',
    positionUsd: '$50 - $100',
    depositAmount: 75,
    gasTier: 'low',
  };
}

function chainSurface(chains: string[]): string {
  if (!chains || chains.length === 0) return 'its primary deployment chain';
  if (chains.length === 1) return chains[0]!;
  if (chains.length === 2) return `${chains[0]} or ${chains[1]}`;
  return `${chains[0]}, ${chains[1]}, or ${chains[2]}`;
}

function gasCostEstimate(chains: string[], gasTier: 'high' | 'mid' | 'low'): string {
  const c = chains.join(' ').toLowerCase();
  if (c.includes('ethereum')) {
    return gasTier === 'high' ? '$20 - $45 in ETH gas' : gasTier === 'mid' ? '$12 - $25 in ETH gas' : '$6 - $14 in ETH gas';
  }
  if (c.includes('solana')) {
    return '<$0.02 in SOL network fees';
  }
  if (c.includes('arbitrum') || c.includes('base') || c.includes('optimism') || c.includes('polygon') || c.includes('avalanche') || c.includes('bsc') || c.includes('blast')) {
    return '$0.15 - $0.85 in native gas';
  }
  return '$1 - $5 in network gas';
}

/**
 * Builds concrete, costed, and timed farm steps customized for the protocol.
 * Conforms strictly to 3..12 steps and 20..600 characters each.
 */
export function generateFarmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const hash = slugHash(p.slug);
  const chainsText = chainSurface(p.chains);
  const tier = getCapitalTier(p.tvl_usd);
  const gas = gasCostEstimate(p.chains, tier.gasTier);
  const holdDays = age === null ? 35 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const cat = (p.category ?? '').toLowerCase();

  const openers = [
    'Work the protocol core product directly on',
    'Deploy capital directly via verified contracts on',
    'Establish an active on-chain presence on',
    'Execute structured interactions through',
  ];
  const opener = openers[hash % openers.length]!;

  let steps: string[] = [];

  if (cat.includes('dex')) {
    steps = [
      `Fund a dedicated farming wallet on ${chainsText} with ${tier.positionUsd} (${tier.suggestedShare} for ${tier.tierName}). Cost: ${gas}. Time: 10 minutes setup.`,
      `${opener} ${chainsText}: deposit ${tier.positionUsd} into ${p.name}'s highest-volume pools (such as native token / USDC) to establish an authentic liquidity record. Cost: capital lock plus ${gas}. Time: 15 minutes.`,
      `Maintain regular volume routing: execute 2 to 3 organic swaps ($25 - $75 volume) each week through ${p.name} on ${chainsText} to ensure continuous user activity. Cost: under $2 gas weekly. Time: 5 minutes weekly.`,
      `Keep liquidity committed for at least ${holdDays} days to ensure qualification across multiple snapshot cycles. Cost: capital lock of ${tier.positionUsd}. Time: ${holdDays} days seasoning.`,
      `Monitor official points dashboards and volume stats weekly; avoid unauthorized claiming links, then unwind positions gradually to avoid price impact. Cost: ${gas} to unwind. Time: 10 minutes.`,
    ];
  } else if (cat.includes('lend') || cat.includes('borrow')) {
    steps = [
      `Allocate ${tier.positionUsd} from ${tier.tierName} (${tier.suggestedShare}) to ${p.name} on ${chainsText}. Cost: ${gas}. Time: 10 minutes wallet preparation.`,
      `${opener} ${chainsText}: supply ${tier.positionUsd} of stable collateral (USDC/USDT) into ${p.name}'s core money market. Cost: capital locked plus ${gas}. Time: 15 minutes execution.`,
      `Borrow a conservative 25% to 35% against your supplied collateral on ${chainsText} to activate borrower reward tiers while keeping a safe health factor above 2.0x. Cost: borrow APY plus ${gas}. Time: 10 minutes.`,
      `Maintain active supply and borrow positions for at least ${holdDays} days, checking liquidation buffers and utilization rates weekly. Cost: net interest spread. Time: ${holdDays} days hold.`,
      `Repay outstanding loans, claim accrued protocol rewards from official interfaces, and withdraw supplied principal safely. Cost: ${gas} settlement. Time: 10 minutes.`,
    ];
  } else if (cat.includes('liquid staking') || cat.includes('restak') || cat.includes('staking pool')) {
    steps = [
      `Prepare ${tier.positionUsd} (${tier.suggestedShare} of ${tier.tierName}) in native assets on ${chainsText}. Cost: ${gas}. Time: 10 minutes setup.`,
      `${opener} ${chainsText}: stake native assets via ${p.name}'s protocol contracts to mint liquid staking receipt tokens. Cost: capital committed plus ${gas}. Time: 15 minutes.`,
      `Deploy minted liquid staking tokens into secondary DeFi integrations on ${chainsText} (such as liquidity pools or money markets) to compound protocol loyalty score. Cost: ${gas}. Time: 15 minutes.`,
      `Retain the staked receipt balance for at least ${holdDays} days without unstaking, ensuring eligibility across snapshot windows. Cost: capital locked in receipt token. Time: ${holdDays} days duration.`,
      `Review unstaking queue times and redemption fees; unstake through ${p.name}'s official portal or swap receipt tokens on market. Cost: ${gas} unstaking fee. Time: 15 minutes.`,
    ];
  } else if (cat.includes('bridge')) {
    steps = [
      `Designate ${tier.positionUsd} (${tier.suggestedShare} for ${tier.tierName}) on ${chainsText} for cross-chain activity. Cost: ${gas}. Time: 10 minutes wallet preparation.`,
      `${opener} ${chainsText}: bridge ${tier.positionUsd} across ${chainsText} using ${p.name}'s cross-chain routing contracts to log initial transaction hashes. Cost: bridge fee plus ${gas}. Time: 15 minutes.`,
      `Conduct bi-weekly bridging transactions of $30 - $70 between supported chains to accumulate consistent volume and diverse network interactions. Cost: standard bridge fee and gas. Time: 10 minutes bi-weekly.`,
      `Retain bridged funds on the destination chain for at least ${holdDays} days to demonstrate genuine liquidity migration rather than immediate round-trip laundering. Cost: funds active on destination. Time: ${holdDays} days.`,
      `Log transaction IDs in a farm journal and monitor official verification portals for qualifying score updates before unwinding funds. Cost: ${gas} exit fee. Time: 10 minutes.`,
    ];
  } else if (cat.includes('yield') || cat.includes('farm') || cat.includes('aggregator')) {
    steps = [
      `Commit ${tier.positionUsd} (${tier.suggestedShare} from ${tier.tierName}) to ${p.name} on ${chainsText}. Cost: ${gas}. Time: 10 minutes setup.`,
      `${opener} ${chainsText}: deposit ${tier.positionUsd} into ${p.name}'s automated compounding vaults or risk-adjusted yield strategies. Cost: capital lock plus ${gas}. Time: 15 minutes deposit.`,
      `Trigger weekly contract interactions by rebalancing vault allocations or compounding strategy rewards on ${chainsText}. Cost: negligible gas. Time: 5 minutes weekly.`,
      `Keep vault positions staked continuously for ${holdDays} days to satisfy long-term retention requirements across yield epochs. Cost: strategy performance fee. Time: ${holdDays} days hold.`,
      `Check withdrawal cooldown schedules, initiate orderly vault exit via ${p.name}, and repatriate funds to your primary wallet. Cost: ${gas}. Time: 10 minutes.`,
    ];
  } else if (cat.includes('rwa')) {
    steps = [
      `Prepare ${tier.positionUsd} (${tier.suggestedShare} in ${tier.tierName}) on ${chainsText}. Complete necessary wallet accreditation or KYC requirements if applicable. Cost: ${gas}. Time: 15 minutes setup.`,
      `${opener} ${chainsText}: mint or purchase tokenized real-world assets (treasuries or institutional yield instruments) via ${p.name}. Cost: capital lock plus ${gas}. Time: 20 minutes execution.`,
      `Utilize tokenized RWA shares across approved on-chain secondary integrations or collateral vaults on ${chainsText} to maximize capital efficiency. Cost: ${gas}. Time: 15 minutes.`,
      `Hold the tokenized asset position for a minimum of ${holdDays} days to log continuous time-weighted participation on-chain. Cost: custody fee if applicable. Time: ${holdDays} days duration.`,
      `Redeem tokenized assets through ${p.name}'s settlement contracts or secondary liquidity, archiving all transaction receipts. Cost: redemption fee and ${gas}. Time: 15 minutes.`,
    ];
  } else if (cat.includes('cex')) {
    steps = [
      `Allocate ${tier.positionUsd} (${tier.tierName}) to interact with ${p.name}'s Web3 on-chain infrastructure on ${chainsText}. Cost: ${gas}. Time: 10 minutes setup.`,
      `${opener} ${chainsText}: execute on-chain smart contract interactions and verify wallet link with ${p.name}'s decentralized ecosystem. Cost: ${gas}. Time: 15 minutes.`,
      `Route regular weekly trading and swap flow ($25 - $50) through ${p.name}'s on-chain decentralized router across ${chainsText}. Cost: trading fee plus ${gas}. Time: 10 minutes weekly.`,
      `Maintain positive asset balances inside ${p.name}'s on-chain smart contracts for ${holdDays} days to meet continuous user thresholds. Cost: asset lock. Time: ${holdDays} days hold.`,
      `Review eligibility status on ${p.name}'s official analytics portal; unwind positions and transfer balances to cold storage. Cost: ${gas}. Time: 10 minutes.`,
    ];
  } else if (cat.includes('curator')) {
    steps = [
      `Allocate ${tier.positionUsd} (${tier.suggestedShare} of ${tier.tierName}) to vaults curated by ${p.name} on ${chainsText}. Cost: ${gas}. Time: 10 minutes preparation.`,
      `${opener} ${chainsText}: supply capital into risk-managed vaults curated by ${p.name} to earn curated base yield and loyalty credit. Cost: capital lock plus ${gas}. Time: 15 minutes.`,
      `Review curator risk reports and periodic rebalancing updates weekly, adjusting vault selections on ${chainsText} if market parameters change. Cost: minimal gas. Time: 10 minutes weekly.`,
      `Commit funds to the curated vault for at least ${holdDays} days to accrue time-weighted curator score across lending cycles. Cost: vault management fee. Time: ${holdDays} days hold.`,
      `Initiate vault share redemption via ${p.name}, verify accrued interest payout, and return capital to safe storage. Cost: ${gas} exit fee. Time: 10 minutes.`,
    ];
  } else if (cat.includes('allocator')) {
    steps = [
      `Commit ${tier.positionUsd} (${tier.suggestedShare} from ${tier.tierName}) to ${p.name} on ${chainsText}. Cost: ${gas}. Time: 10 minutes onboarding.`,
      `${opener} ${chainsText}: deposit ${tier.positionUsd} into ${p.name}'s programmatic allocation strategies across integrated protocols. Cost: capital lock plus ${gas}. Time: 15 minutes execution.`,
      `Monitor automated allocation rebalances weekly on ${chainsText}; participate in strategy governance or parameter polls where supported. Cost: negligible gas. Time: 5 minutes weekly.`,
      `Maintain allocated capital for at least ${holdDays} days to qualify across epoch distribution snapshots. Cost: allocation performance fee. Time: ${holdDays} days hold.`,
      `Submit orderly withdrawal request, allow allocation rebalance cycle to complete, and claim underlying assets on ${chainsText}. Cost: ${gas}. Time: 10 minutes.`,
    ];
  } else if (cat.includes('basis') || cat.includes('derivative') || cat.includes('perpetual')) {
    steps = [
      `Allocate ${tier.positionUsd} (${tier.tierName}) to ${p.name} on ${chainsText} for delta-neutral basis farming. Cost: ${gas}. Time: 10 minutes setup.`,
      `${opener} ${chainsText}: deposit margin and establish a delta-neutral basis trade (spot long combined with short perpetual hedge) on ${p.name}. Cost: trading fee plus ${gas}. Time: 20 minutes.`,
      `Check funding rate spreads weekly; rebalance hedge ratios on ${chainsText} to maintain zero net directional market risk. Cost: small rebalancing fee. Time: 10 minutes weekly.`,
      `Keep the basis position open for at least ${holdDays} days to capture continuous funding cash flows and trading volume credentials. Cost: margin capital lock. Time: ${holdDays} days hold.`,
      `Close the derivative hedge and spot position simultaneously on ${chainsText}, locking in funding returns and reclaiming margin. Cost: closing fee plus ${gas}. Time: 15 minutes.`,
    ];
  } else {
    // Generic fallback playbook
    steps = [
      `Allocate ${tier.positionUsd} (${tier.suggestedShare} of ${tier.tierName}) to ${p.name} on ${chainsText}. Cost: ${gas}. Time: 10 minutes preparation.`,
      `${opener} ${chainsText}: deposit ${tier.positionUsd} into ${p.name}'s primary smart contracts to establish early qualifying activity. Cost: capital lock plus ${gas}. Time: 15 minutes.`,
      `Execute 1 to 2 qualifying protocol actions weekly on ${chainsText} (such as balance check, micro-transaction, or community vote). Cost: under $1 gas weekly. Time: 5 minutes weekly.`,
      `Maintain the active protocol balance for ${holdDays} days to satisfy long-term retention rules across multiple snapshot dates. Cost: capital committed. Time: ${holdDays} days hold.`,
      `Audit points balance on ${p.name}'s official interface, submit standard withdrawal transaction, and reclaim capital safely. Cost: ${gas}. Time: 10 minutes.`,
    ];
  }

  // Validate every step meets gate constraints: 20..600 characters trimmed
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!.trim();
    if (s.length < 20 || s.length > 600) {
      throw new Error(`Protocol ${p.slug} step ${i + 1} length ${s.length} violates 20..600 cap`);
    }
  }

  return steps;
}

// ---------------------------------------------------------------- Radar Construction

/** Whether a protocol records no token at all in DefiLlama's snapshot. */
export function isTokenless(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Computes category medians and peer counts among tokenized protocols. */
export function computeTokenizedPeers(protocols: SnapshotProtocol[]): {
  tokenizedPeers: SnapshotProtocol[];
  globalMedian: number;
  catMedians: Map<string, { median: number; n: number }>;
} {
  const tokenizedPeers = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalMedian = median(tokenizedPeers.map((p) => p.mcap_usd! / p.tvl_usd));

  const catMap = new Map<string, number[]>();
  for (const p of tokenizedPeers) {
    const cat = p.category ?? 'Uncategorized';
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat)!.push(p.mcap_usd! / p.tvl_usd);
  }

  const catMedians = new Map<string, { median: number; n: number }>();
  for (const [cat, ratios] of catMap.entries()) {
    catMedians.set(cat, { median: median(ratios), n: ratios.length });
  }

  return { tokenizedPeers, globalMedian, catMedians };
}

/** Builds the ranked board and all radar dashboard data from snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { tokenizedPeers, globalMedian, catMedians } = computeTokenizedPeers(snapshot.protocols);

  // Filter all protocols that record no token (covers every watchlist protocol by definition)
  const tokenless = snapshot.protocols.filter(isTokenless);

  // Score every tokenless protocol
  const scored = tokenless.map((p) => {
    const calc = impliedValue(p, snapshot.as_of, catMedians, globalMedian);
    const steps = generateFarmSteps(p, calc.ageDays);
    const isWatchlist = snapshot.watchlist.includes(p.slug);
    return {
      p,
      calc,
      steps,
      isWatchlist,
    };
  });

  // Rank by implied_value_usd desc; tie-break by tvl_usd desc, then slug asc (deterministic)
  scored.sort((a, b) => {
    if (b.calc.implied !== a.calc.implied) return b.calc.implied - a.calc.implied;
    if (b.p.tvl_usd !== a.p.tvl_usd) return b.p.tvl_usd - a.p.tvl_usd;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });

  // Build BoardRow array with rank 1..N
  const board: BoardRow[] = scored.map((s, idx) => ({
    rank: idx + 1,
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
    token_status: 'records no token',
    age_days: s.calc.ageDays,
    implied_value_usd: s.calc.implied,
    model: {
      peer_multiple: Math.round(s.calc.peerMultiple * 1000) / 1000,
      category_median: Math.round(s.calc.catMedian * 1000) / 1000,
      category_peers_count: s.calc.peerCount,
      momentum_factor: Math.round(s.calc.f_mom * 100) / 100,
      seasoning_factor: Math.round(s.calc.f_age * 100) / 100,
      breadth_factor: Math.round(s.calc.f_chain * 100) / 100,
      launch_plausibility_factor: Math.round(s.calc.f_plaus * 100) / 100,
      model_note: s.calc.modelNote,
    },
    farm_steps: s.steps,
  }));

  // Build RadarRow array for data.js
  const rows: RadarRow[] = scored.map((s, idx) => ({
    rank: idx + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    age_days: s.calc.ageDays,
    implied_value_usd: s.calc.implied,
    peer_multiple: Math.round(s.calc.peerMultiple * 1000) / 1000,
    category_median: Math.round(s.calc.catMedian * 1000) / 1000,
    category_peers_count: s.calc.peerCount,
    momentum_factor: Math.round(s.calc.f_mom * 100) / 100,
    seasoning_factor: Math.round(s.calc.f_age * 100) / 100,
    breadth_factor: Math.round(s.calc.f_chain * 100) / 100,
    launch_plausibility_factor: Math.round(s.calc.f_plaus * 100) / 100,
    model_note: s.calc.modelNote,
    is_watchlist: s.isWatchlist,
    farm_steps: s.steps,
  }));

  // Top live-token protocols for reference
  const live: LiveRow[] = tokenizedPeers
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      mcap_tvl_ratio: Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000,
      change_7d: p.change_7d,
    }));

  const categoryMultiples: Record<string, { median: number; n: number; multiple: number }> = {};
  for (const [cat, data] of catMedians.entries()) {
    const { multiple } = peerMultiple(cat, catMedians, globalMedian);
    categoryMultiples[cat] = {
      median: Math.round(data.median * 1000) / 1000,
      n: data.n,
      multiple: Math.round(multiple * 1000) / 1000,
    };
  }

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_median_multiple: Math.round(globalMedian * 1000) / 1000,
    peer_multiple_cap: MODEL.peer_multiple_cap,
    category_multiples: categoryMultiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows,
    live,
  };

  return { board, radar };
}

// ---------------------------------------------------------------- Parsing & Issues

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no valid as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no valid floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no valid watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks slug, name, or valid tvl_usd`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });

  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Gate verification helper asserting all gate rules on the produced board. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board row count ${board.length} outside gate limits [100, 4000]`;
  }

  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seenSlugs = new Set<string>();

  for (const r of board) {
    if (!snapshotSlugs.has(r.slug)) return `slug "${r.slug}" does not exist in snapshot protocols`;
    if (seenSlugs.has(r.slug)) return `duplicate slug "${r.slug}" found in board`;
    seenSlugs.add(r.slug);
    if (!r.name || r.name.trim().length === 0) return `slug "${r.slug}" has empty name`;
  }

  // Coverage check
  const missingWatchlist = snapshot.watchlist.filter((s) => !seenSlugs.has(s));
  if (missingWatchlist.length > 0) {
    return `board misses ${missingWatchlist.length} watchlist slugs: ${missingWatchlist.slice(0, 5).join(', ')}`;
  }

  // Rank check: exactly 1..N
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is missing or out of sequence (found ${ranks[i]})`;
  }

  // Non-increasing implied value
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row rank ${board[i]!.rank} implied value ($${board[i]!.implied_value_usd}) exceeds rank ${board[i - 1]!.rank} ($${board[i - 1]!.implied_value_usd})`;
    }
  }

  // Not all equal
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all rows share the identical implied value $${board[0]!.implied_value_usd}`;
  }

  // Value bounds & farm steps checks
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `row "${r.slug}" has invalid implied value ${r.implied_value_usd}`;
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row "${r.slug}" has ${r.farm_steps?.length} farm steps (requires 3..12)`;
    }
    for (let j = 0; j < r.farm_steps.length; j++) {
      const step = r.farm_steps[j]!.trim();
      if (step.length < 20 || step.length > 600) {
        return `row "${r.slug}" step ${j + 1} has ${step.length} chars (requires 20..600)`;
      }
      // Language discipline check
      const lower = step.toLowerCase();
      if (lower.includes('has no token') || lower.includes('has none')) {
        return `row "${r.slug}" step ${j + 1} violates language discipline ("has no token" or "has none")`;
      }
    }
  }

  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
