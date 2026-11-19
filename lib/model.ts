// The token radar's implied-value model and farm playbook generator (v3).
//
// Intellectual core:
// Derives implied protocol valuations dynamically from DefiLlama snapshot data at runtime:
// 1. Similarity-weighted peer multiples M(P): peers in the same category weighted by TVL proximity
//    (log-scale distance) and chain overlap Jaccard coefficient, shrunk toward the category median
//    via Empirical Bayes shrinkage, and capped at 3.0x ceiling.
// 2. Peer dispersion: per-protocol peer count and cohort dispersion measured via Interquartile Range (IQR).
// 3. Base value B = tvl_usd * M(P).
// 4. Momentum factor: f_mom = clamp(1 + change_7d / 100, 0.5, 2.0).
// 5. Seasoning factor: f_age = 1 + 0.25 * min(age_days, 1460) / 1460 (up to +25% at 4 years).
// 6. Chain-breadth factor: f_chain = 1 + 0.05 * min(len(chains) - 1, 6) (up to +30% at 7+ chains).
// 7. Launch-plausibility factor: f_plaus = 0.10 for wrapped, bridged, or exchange products with
//    existing token lineage; 1.0 for genuine pre-token protocol primitives.
// 8. Implied value = round(B * f_mom * f_age * f_chain * f_plaus), minimum 1 whole dollar.
// 9. Conviction score: explicit 0-100 score synthesizing implied upside, peer agreement (inverse dispersion),
//    7d momentum, and protocol seasoning. Disciplines LONG SHOT designations to require stated reasons.
// 10. Sanity layer: cross-checks implied FDVs against category total implied value, flagging outliers.
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

export const MODEL_VERSION = 'radar-3.0-similarity-weighted';

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
  conviction_score: number;
  is_long_shot: boolean;
  long_shot_reason: string | null;
  is_outlier: boolean;
  outlier_reason: string | null;
  model: {
    peer_multiple: number;
    category_median: number;
    category_peers_count: number;
    peer_dispersion: number;
    conviction_score: number;
    is_long_shot: boolean;
    long_shot_reason: string | null;
    is_outlier: boolean;
    outlier_reason: string | null;
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
  conviction_score: number;
  is_long_shot: boolean;
  long_shot_reason: string | null;
  is_outlier: boolean;
  outlier_reason: string | null;
  peer_multiple: number;
  category_median: number;
  category_peers_count: number;
  peer_dispersion: number;
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
  category_multiples: Record<string, { median: number; n: number; multiple: number; dispersion: number }>;
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

// ---------------------------------------------------------------- Value Model v3

/** Computes quantile q (0..1) of values. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base]! + rest * (sorted[base + 1]! - sorted[base]!);
  }
  return sorted[base]!;
}

export interface CategoryCohort {
  peers: SnapshotProtocol[];
  median: number;
  shrunkMedian: number;
  q1: number;
  q3: number;
  iqr: number;
  n: number;
}

/** Computes similarity weight between protocol p and peer q. */
export function peerWeight(p: SnapshotProtocol, q: SnapshotProtocol): number {
  const dLog = Math.abs(Math.log10(Math.max(1, p.tvl_usd)) - Math.log10(Math.max(1, q.tvl_usd)));
  const wTvl = 1 / (1 + 0.5 * dLog);
  const pChains = new Set(p.chains || []);
  const qChains = new Set(q.chains || []);
  let inter = 0;
  for (const c of pChains) {
    if (qChains.has(c)) inter++;
  }
  const unionSize = new Set([...pChains, ...qChains]).size;
  const jaccard = unionSize > 0 ? inter / unionSize : 0;
  const wChain = 1.0 + jaccard;
  return wTvl * wChain;
}

/**
 * Similarity-weighted peer multiple M(P):
 * Computes a weighted estimate of peer ratios (mcap/tvl) weighted by TVL proximity
 * and chain overlap, capped at 3.0x ceiling to avoid wild outliers.
 * Shrunk toward category median via Empirical Bayes shrinkage.
 */
export function similarityPeerMultiple(
  p: SnapshotProtocol,
  cohort: CategoryCohort | undefined,
  globalMedian: number,
  priorWeight: number = 4,
  cap: number = MODEL.peer_multiple_cap
): { multiple: number; catMedian: number; peerCount: number; iqr: number; rawMultiple: number } {
  if (!cohort || cohort.n === 0) {
    const raw = globalMedian;
    return { multiple: Math.min(cap, raw), catMedian: globalMedian, peerCount: 0, iqr: 0, rawMultiple: raw };
  }
  let sumW = 0;
  let sumWM = 0;
  for (const q of cohort.peers) {
    const w = peerWeight(p, q);
    const m = Math.min(cap, q.mcap_usd! / q.tvl_usd);
    sumW += w;
    sumWM += w * m;
  }
  const simMultiple = sumW > 0 ? sumWM / sumW : cohort.shrunkMedian;
  const rawMultiple = (cohort.n * simMultiple + priorWeight * cohort.shrunkMedian) / (cohort.n + priorWeight);
  const multiple = Math.min(cap, rawMultiple);
  return { multiple, catMedian: cohort.median, peerCount: cohort.n, iqr: cohort.iqr, rawMultiple };
}

/** Backwards-compatible peer multiple fallback. */
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
 * Conviction score (0..100):
 * Synthesizes implied upside (multiple strength), peer agreement (inverse dispersion),
 * 7d momentum, and protocol seasoning into one explicit conviction score.
 */
export function convictionScore(
  multiple: number,
  iqr: number,
  change_7d: number | null,
  age_days: number | null,
  f_plaus: number
): number {
  const upPart = 30 * Math.min(1.0, multiple / MODEL.peer_multiple_cap);
  const agreePart = 30 / (1 + iqr);
  const momClamp = change_7d !== null ? Math.max(-1, Math.min(1, change_7d / 30)) : 0;
  const momPart = 10 + 10 * momClamp;
  const agePart = 20 * Math.min(1.0, (age_days ?? 0) / MODEL.seasoning_max_days);
  const raw = upPart + agreePart + momPart + agePart;
  const adjusted = raw * (0.35 + 0.65 * f_plaus);
  return Math.max(5, Math.min(99, Math.round(adjusted)));
}

/**
 * Reasoned LONG SHOT discipline:
 * A protocol carries a LONG SHOT chip only with a concrete stated reason:
 * - Lineage / plausibility discount (wrapped, bridged, exchange-affiliated)
 * - Momentum contraction (severe weekly outflow)
 * - Peer valuation gap (wide cohort dispersion with low conviction)
 */
export function classifyLongShot(
  f_plaus: number,
  plausReason: string | null,
  f_mom: number,
  change_7d: number | null,
  iqr: number,
  conviction: number
): { isLongShot: boolean; reason: string | null } {
  if (f_plaus < 1.0) {
    return {
      isLongShot: true,
      reason: plausReason ?? 'Structural lineage: derivative of token that already trades',
    };
  }
  if (f_mom <= 0.8 && conviction <= 45) {
    const chg = change_7d !== null ? `${change_7d.toFixed(1)}%` : 'negative';
    return {
      isLongShot: true,
      reason: `Momentum contraction: severe weekly TVL outflow (${chg}) indicates active capital flight`,
    };
  }
  if (iqr >= 1.5 && conviction <= 40) {
    return {
      isLongShot: true,
      reason: `Peer valuation gap: wide cohort dispersion (IQR ${iqr.toFixed(2)}x) creates elevated valuation uncertainty`,
    };
  }
  return { isLongShot: false, reason: null };
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
  if (cat === 'Bridge' || cat === 'Canonical Bridge') {
    return {
      factor: MODEL.plausibility_discount,
      reason: 'Bridge infrastructure rails with existing ecosystem token lineage — scored as a long shot',
    };
  }
  if (cat === 'Liquid Staking' || cat === 'Liquid Restaking' || cat === 'Restaked BTC') {
    return {
      factor: MODEL.plausibility_discount,
      reason: 'Liquid staking derivative backed by an existing trading asset — scored as a long shot',
    };
  }
  if (cat === 'CEX') {
    return {
      factor: MODEL.plausibility_discount,
      reason: 'Centralized exchange platform with distinct corporate equity — scored as a long shot',
    };
  }
  for (const ex of EXCHANGES) {
    if (p.name.toLowerCase().startsWith(ex.toLowerCase())) {
      return {
        factor: MODEL.plausibility_discount,
        reason: 'Exchange-affiliated lineage with centralized entity — scored as a long shot',
      };
    }
  }
  if (WRAPPED_WORDS.test(p.name)) {
    return {
      factor: MODEL.plausibility_discount,
      reason: 'Wrapped or staked asset derivative of a token that already trades — scored as a long shot',
    };
  }
  if (VERSION_MARKER.test(p.name)) {
    return {
      factor: MODEL.plausibility_discount,
      reason: 'Versioned contract pool of an existing protocol — scored as a long shot',
    };
  }
  return { factor: 1.0, reason: null };
}

/**
 * Evaluates the implied valuation of a pre-token protocol (Model v3).
 * Combines similarity-weighted peer multiple (capped at 3.0x) with momentum, seasoning, chain breadth,
 * and structural launch plausibility factors. Calculates explicit conviction score and reasoned long shot.
 */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  catCohorts: Map<string, CategoryCohort>,
  globalMedian: number
): {
  implied: number;
  base: number;
  peerMultiple: number;
  catMedian: number;
  peerCount: number;
  iqr: number;
  f_mom: number;
  f_age: number;
  f_chain: number;
  f_plaus: number;
  ageDays: number | null;
  conviction: number;
  isLongShot: boolean;
  longShotReason: string | null;
  modelNote: string;
} {
  const cat = p.category ?? 'Uncategorized';
  const cohort = catCohorts.get(cat);
  const { multiple: M, catMedian, peerCount, iqr } = similarityPeerMultiple(p, cohort, globalMedian);
  const base = p.tvl_usd * M;
  const f_mom = momentumFactor(p.change_7d);
  const age = ageDays(asOf, p.listed_at);
  const f_age = seasoningFactor(age);
  const f_chain = breadthFactor(p.chains);
  const { factor: f_plaus, reason: plausReason } = launchPlausibility(p);
  const implied = Math.max(1, Math.round(base * f_mom * f_age * f_chain * f_plaus));

  const conviction = convictionScore(M, iqr, p.change_7d, age, f_plaus);
  const { isLongShot, reason: longShotReason } = classifyLongShot(
    f_plaus,
    plausReason,
    f_mom,
    p.change_7d,
    iqr,
    conviction
  );

  const catLabel = p.category ?? 'Uncategorized';
  const multText = `${M.toFixed(2)}x`;
  const tvlText = formatUsdShort(p.tvl_usd);
  const momPct = p.change_7d !== null ? `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}%` : '0.0%';
  const iqrText = iqr > 0 ? `, IQR ${iqr.toFixed(2)}x` : '';
  let modelNote = `${catLabel} similarity multiple ${multText} on $${tvlText} TVL, ${momPct} 7d mom${iqrText}, conv ${conviction}/100`;
  if (longShotReason) {
    modelNote += `; LONG SHOT: ${longShotReason}`;
  }

  return {
    implied,
    base,
    peerMultiple: M,
    catMedian,
    peerCount,
    iqr,
    f_mom,
    f_age,
    f_chain,
    f_plaus,
    ageDays: age,
    conviction,
    isLongShot,
    longShotReason,
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
  catCohorts: Map<string, CategoryCohort>;
} {
  const tokenizedPeers = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalMedian = median(tokenizedPeers.map((p) => p.mcap_usd! / p.tvl_usd));

  const catMap = new Map<string, SnapshotProtocol[]>();
  for (const p of tokenizedPeers) {
    const cat = p.category ?? 'Uncategorized';
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat)!.push(p);
  }

  const catCohorts = new Map<string, CategoryCohort>();
  for (const [cat, peers] of catMap.entries()) {
    const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd);
    const med = median(ratios);
    const q1 = quantile(ratios, 0.25);
    const q3 = quantile(ratios, 0.75);
    const iqr = q3 - q1;
    const shrunkMedian =
      (peers.length * med + MODEL.shrinkage_prior_weight * globalMedian) /
      (peers.length + MODEL.shrinkage_prior_weight);
    catCohorts.set(cat, {
      peers,
      median: med,
      shrunkMedian,
      q1,
      q3,
      iqr,
      n: peers.length,
    });
  }

  return { tokenizedPeers, globalMedian, catCohorts };
}

/** Builds the ranked board and all radar dashboard data from snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { tokenizedPeers, globalMedian, catCohorts } = computeTokenizedPeers(snapshot.protocols);

  // Filter all protocols that record no token (covers every watchlist protocol by definition)
  const tokenless = snapshot.protocols.filter(isTokenless);

  // Score every tokenless protocol with Model v3
  const scored = tokenless.map((p) => {
    const calc = impliedValue(p, snapshot.as_of, catCohorts, globalMedian);
    const steps = generateFarmSteps(p, calc.ageDays);
    const isWatchlist = snapshot.watchlist.includes(p.slug);
    return {
      p,
      calc,
      steps,
      isWatchlist,
      isOutlier: false,
      outlierReason: null as string | null,
    };
  });

  // Sanity layer: cross-check each implied FDV against its category's total implied value
  const catTotals = new Map<string, number>();
  const catCounts = new Map<string, number>();
  for (const s of scored) {
    const cat = s.p.category ?? 'Uncategorized';
    catTotals.set(cat, (catTotals.get(cat) ?? 0) + s.calc.implied);
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }

  for (const s of scored) {
    const cat = s.p.category ?? 'Uncategorized';
    const total = catTotals.get(cat) ?? 0;
    const count = catCounts.get(cat) ?? 0;
    const share = total > 0 ? s.calc.implied / total : 0;
    if (count >= 2 && share > 0.45) {
      s.isOutlier = true;
      s.outlierReason = `Category outlier: accounts for ${(share * 100).toFixed(1)}% of ${cat} category implied value ($${formatUsdShort(s.calc.implied)} of $${formatUsdShort(total)} across ${count} protocols)`;
    }
  }

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
    conviction_score: s.calc.conviction,
    is_long_shot: s.calc.isLongShot,
    long_shot_reason: s.calc.longShotReason,
    is_outlier: s.isOutlier,
    outlier_reason: s.outlierReason,
    model: {
      peer_multiple: Math.round(s.calc.peerMultiple * 1000) / 1000,
      category_median: Math.round(s.calc.catMedian * 1000) / 1000,
      category_peers_count: s.calc.peerCount,
      peer_dispersion: Math.round(s.calc.iqr * 1000) / 1000,
      conviction_score: s.calc.conviction,
      is_long_shot: s.calc.isLongShot,
      long_shot_reason: s.calc.longShotReason,
      is_outlier: s.isOutlier,
      outlier_reason: s.outlierReason,
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
    conviction_score: s.calc.conviction,
    is_long_shot: s.calc.isLongShot,
    long_shot_reason: s.calc.longShotReason,
    is_outlier: s.isOutlier,
    outlier_reason: s.outlierReason,
    peer_multiple: Math.round(s.calc.peerMultiple * 1000) / 1000,
    category_median: Math.round(s.calc.catMedian * 1000) / 1000,
    category_peers_count: s.calc.peerCount,
    peer_dispersion: Math.round(s.calc.iqr * 1000) / 1000,
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

  const categoryMultiples: Record<string, { median: number; n: number; multiple: number; dispersion: number }> = {};
  for (const [cat, cohort] of catCohorts.entries()) {
    categoryMultiples[cat] = {
      median: Math.round(cohort.median * 1000) / 1000,
      n: cohort.n,
      multiple: Math.round(cohort.shrunkMedian * 1000) / 1000,
      dispersion: Math.round(cohort.iqr * 1000) / 1000,
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
