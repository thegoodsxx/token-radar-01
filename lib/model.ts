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

// ---------------------------------------------------------------- Farm Playbooks v2

interface CapitalTierInfo {
  sizeText: string;
  reason: string;
}

function getCapitalTierV2(tvl: number): CapitalTierInfo {
  if (tvl >= 500_000_000) {
    return {
      sizeText: '$5,000-$25,000',
      reason: 'institutional-tier TVL (over $500M) to unlock top-tier reward brackets across deep liquidity without moving daily pool depth',
    };
  }
  if (tvl >= 50_000_000) {
    return {
      sizeText: '$1,000-$5,000',
      reason: 'meaningful share of daily flow without disturbing pool equilibrium across $50M-$500M TVL',
    };
  }
  return {
    sizeText: '$250-$1,000',
    reason: 'meaningful entry for sub-$50M TVL depth without causing adverse price impact or slippage',
  };
}

/** Accurately quotes gas cost estimates based on the specific chain class. */
export function gasCostFor(chain: string): string {
  const c = (chain || '').toLowerCase();
  if (c.includes('ethereum') || c.includes('mainnet')) return '$5-$25 in ETH gas';
  if (/arbitrum|base|optimism|ink|blast|linea|scroll|zksync|polygon|boba|mantle/.test(c)) return '$0.05-$0.50 in L2 gas';
  return '$0.10-$2.00 in network fees';
}

/**
 * Builds concrete, costed, and timed farm steps customized for the protocol (Farm Plans v2).
 * Strictly anchored to this protocol's own facts:
 * - Primary chain (chains[0]) and secondary chain rotation (chains[1] if 2+ chains) vs single-chain depth.
 * - Explicit TVL-tier dollar position sizing and market depth reasoning.
 * - Exact gas cost quotes per chain class.
 * - Weekly time budget line (e.g. "Budget 20 minutes a week...") and recurring cadence action.
 * - Momentum-aware caution (surge >= +10% or contraction <= -10%).
 * Conforms strictly to 5..6 steps and 20..600 characters each.
 */
export function generateFarmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chains = p.chains && p.chains.length > 0 ? p.chains : ['its primary network'];
  const primaryChain = chains[0]!;
  const secondChain = chains.length >= 2 ? chains[1]! : null;
  const primaryGas = gasCostFor(primaryChain);
  const secondGas = secondChain ? gasCostFor(secondChain) : primaryGas;
  const tier = getCapitalTierV2(p.tvl_usd);
  const holdDays = age === null ? 35 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const cat = (p.category ?? '').toLowerCase();

  // Step 1: Capital sizing & momentum-aware entry strategy
  let step1 = '';
  if (p.change_7d !== null && p.change_7d >= 10) {
    step1 = `Target position size ${tier.sizeText} (${tier.reason}). Note 7d inflow surge (+${p.change_7d.toFixed(1)}%): enter in 2-3 tranches over 10 days rather than a single lump sum to avoid chasing transient market momentum. Cost: ${primaryGas} per tranche. Time: 15 minutes setup.`;
  } else if (p.change_7d !== null && p.change_7d <= -10) {
    step1 = `Target position size ${tier.sizeText} (${tier.reason}). Note 7d TVL contraction (${p.change_7d.toFixed(1)}%): audit protocol smart contract outflows, pool solvency, and recent security disclosures before committing capital. Cost: no fee to verify. Time: 25 minutes due diligence.`;
  } else {
    const deltaStr = p.change_7d !== null ? (p.change_7d >= 0 ? '+' : '') + p.change_7d.toFixed(1) + '%' : 'neutral';
    step1 = `Target position size ${tier.sizeText} (${tier.reason}). With steady 7d TVL momentum (${deltaStr}), deploy initial allocation directly onto ${primaryChain}. Cost: ${primaryGas}. Time: 15 minutes setup.`;
  }

  // Step 2: Core product execution on primaryChain anchored to category playbook
  let step2 = '';
  if (cat.includes('dex')) {
    step2 = `Work ${p.name}'s core AMM liquidity pools on ${primaryChain}: supply ${tier.sizeText} into dominant volume trading pairs (e.g. native gas token / USDC) with tight fee tiers to capture qualifying trade fee volume. Cost: capital lock plus ${primaryGas}. Time: 20 minutes execution.`;
  } else if (cat.includes('lend') || cat.includes('borrow')) {
    step2 = `Work ${p.name}'s lending markets on ${primaryChain}: supply ${tier.sizeText} of high-quality collateral (USDC or native token), then maintain a conservative borrow ratio under 35% to activate borrower reward multipliers safely above 2.0x health factor. Cost: ${primaryGas}. Time: 20 minutes execution.`;
  } else if (cat.includes('liquid staking') || cat.includes('restak') || cat.includes('staking pool')) {
    step2 = `Work ${p.name}'s staking infrastructure on ${primaryChain}: stake native assets to mint the protocol receipt token, logging non-custodial staking credentials on-chain. Cost: ${primaryGas}. Time: 15 minutes execution.`;
  } else if (cat.includes('bridge')) {
    step2 = `Work ${p.name}'s bridging contracts: bridge ${tier.sizeText} from ${primaryChain} to establish verifiable cross-chain messaging proofs and logging active source-destination addresses. Cost: bridge protocol fee plus ${primaryGas}. Time: 15 minutes execution.`;
  } else if (cat.includes('yield') || cat.includes('farm') || cat.includes('aggregator')) {
    step2 = `Work ${p.name}'s automated yield vaults on ${primaryChain}: deposit ${tier.sizeText} into verified auto-compounding strategies to start accruing time-weighted vault shares. Cost: ${primaryGas}. Time: 15 minutes execution.`;
  } else if (cat.includes('rwa')) {
    step2 = `Work ${p.name}'s asset portal on ${primaryChain}: mint or purchase ${tier.sizeText} in tokenized real-world yield assets, completing any required on-chain accreditation verification. Cost: ${primaryGas}. Time: 25 minutes execution.`;
  } else if (cat.includes('cex')) {
    step2 = `Work ${p.name}'s on-chain Web3 portal on ${primaryChain}: deposit ${tier.sizeText} and route transactions through its decentralized exchange or smart contract ecosystem. Cost: ${primaryGas}. Time: 15 minutes execution.`;
  } else if (cat.includes('curator')) {
    step2 = `Work curated vaults managed by ${p.name} on ${primaryChain}: allocate ${tier.sizeText} directly into curated risk facilities to earn curated base yield and time-weighted curator score. Cost: ${primaryGas}. Time: 20 minutes execution.`;
  } else if (cat.includes('allocator')) {
    step2 = `Work ${p.name}'s programmatic vaults on ${primaryChain}: allocate ${tier.sizeText} into autonomous strategy pools to participate in protocol yield allocation epochs. Cost: ${primaryGas}. Time: 20 minutes execution.`;
  } else if (cat.includes('basis') || cat.includes('derivative') || cat.includes('perpetual')) {
    step2 = `Work ${p.name}'s perpetual trading markets on ${primaryChain}: deposit ${tier.sizeText} margin and establish a delta-neutral basis position (spot long vs perpetual short) to harvest funding yield. Cost: trading fee plus ${primaryGas}. Time: 20 minutes execution.`;
  } else {
    step2 = `Work ${p.name}'s primary smart contracts on ${primaryChain}: deposit ${tier.sizeText} into core protocol modules to establish early on-chain participation records. Cost: capital lock plus ${primaryGas}. Time: 15 minutes execution.`;
  }

  // Step 3: Multi-chain rotation (2+ chains) OR single-chain concentration (1 chain)
  let step3 = '';
  if (secondChain) {
    step3 = `Cross-chain rotation: bridge and deploy a 25%-35% slice of your ${p.name} allocation over to ${secondChain} via official cross-chain routes to establish qualifying footprint on multiple networks. Cost: ${secondGas}. Time: 15 minutes.`;
  } else {
    step3 = `Single-chain concentration: because ${p.name} deploys solely on ${primaryChain}, concentrate participation depth by supplying secondary pool liquidity or staking your protocol receipt tokens into partner integrations. Cost: ${primaryGas}. Time: 15 minutes.`;
  }

  // Step 4: Weekly time budget and recurring cadence action
  const step4 = `Budget 20 minutes a week for active account hygiene: check collateral health factor, rebalance liquidity ranges, or cast governance votes on ${primaryChain}. Consistent weekly cadence signals genuine user retention rather than automated sybil farming. Cost: under $1 in routine gas. Time: 20 minutes weekly.`;

  // Step 5: Seasoning holding period across snapshot epochs
  const step5 = `Maintain active on-chain contract state for at least ${holdDays} days across multiple snapshot epochs. Younger protocols require extended observation to prove authentic retention before unwinding. Cost: capital remains committed in position. Time: ${holdDays} days holding period.`;

  // Step 6: Claim and safe exit verification
  const step6 = `Audit accumulated points, accrued yield, or airdrop eligibility metrics exclusively via ${p.name}'s official verified portal. Avoid phishing claims, then unwind liquidity and repay borrows in reverse order of entry. Cost: ${primaryGas} settlement fee. Time: 15 minutes orderly exit.`;

  const steps = [step1, step2, step3, step4, step5, step6];

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
