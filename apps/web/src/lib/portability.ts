/**
 * Phase 2C-A — reference-bankroll portability illustrations.
 *
 * The reference bankroll is a LOCAL comparison setting (default 2.2 SOL). It is
 * never stored in the database, no wallet is connected, and no balance is ever
 * fetched.
 *
 * These are illustrations of what the OBSERVED STRUCTURE would cost at the
 * user's own reference bankroll. They are deliberately NOT:
 *   - a recommended or "safe" position size,
 *   - a verdict that a strategy is copyable or not copyable,
 *   - an instruction to follow, copy, buy, sell, scalp or hold anything.
 *
 * Whale trade sizes are never scaled by raw SOL, and the app never infers a
 * wallet's historical bankroll: it does not know what share of that wallet's
 * capital any trade represented.
 */
import type { StrategyFingerprint } from '../api';

export const DEFAULT_REFERENCE_BANKROLL_SOL = '2.2';
export const BANKROLL_STORAGE_KEY = 'memecoin-lab.reference-bankroll-sol';

/** Minimum eligible cycles before any illustration is shown at all. */
export const PORTABILITY_MIN_CYCLES = 3;
/** At or above this many eligible cycles the sample is called sufficient. */
export const PORTABILITY_SUFFICIENT_CYCLES = 5;
/** Fee burden (% of position cost) at or above which cost sensitivity is flagged. */
export const COST_SENSITIVE_PCT = 2;
/** Median legs per cycle at or above which repeated per-transaction costs are flagged. */
export const MULTI_LEG_LEGS = 4;
/** One median position taking at or above this share of the bankroll is capital intensive. */
export const CAPITAL_INTENSIVE_PCT = 25;

/** The illustration shares of the reference bankroll used for the fee table. */
export const ILLUSTRATION_SHARES = [0.05, 0.1, 0.25] as const;

export type PortabilityState =
  | 'SUFFICIENT_SAMPLE'
  | 'LIMITED_SAMPLE'
  | 'COST_SENSITIVE'
  | 'MULTI_LEG_COST_SENSITIVE'
  | 'CAPITAL_INTENSIVE'
  | 'STRUCTURALLY_SIMPLE'
  | 'INCOMPLETE_EVIDENCE'
  | 'UNAVAILABLE';

export interface FeeIllustration {
  /** Share of the reference bankroll used for the illustrated position. */
  share: number;
  positionSol: number;
  /** Median known cycle fees ÷ illustrated position size × 100. */
  feeBurdenPct: number;
}

export interface Portability {
  states: PortabilityState[];
  warningCodes: string[];
  bankroll: number | null;
  eligibleCycleCount: number;
  /** Absolute-size comparison: their observed SOL sizes vs the reference bankroll. */
  medianFirstBuySol: number | null;
  medianCycleCostSol: number | null;
  p75CycleCostSol: number | null;
  medianFirstBuyPctOfBankroll: number | null;
  medianCyclePctOfBankroll: number | null;
  p75CyclePctOfBankroll: number | null;
  medianEntriesPerCycle: number | null;
  medianExitsPerCycle: number | null;
  medianFeesPerCycleSol: number | null;
  /** Fee burden if the same transaction count were used at a proportionally scaled position. */
  feeIllustrations: FeeIllustration[];
  onePositionPctOfBankroll: number | null;
  twoPositionsPctOfBankroll: number | null;
  maxConcurrencyPctOfBankroll: number | null;
  medianConcurrentCapitalSol: number | null;
  observedMaxConcurrentPositions: number;
}

const num = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const empty = (bankroll: number | null): Portability => ({
  states: ['UNAVAILABLE'],
  warningCodes: [],
  bankroll,
  eligibleCycleCount: 0,
  medianFirstBuySol: null,
  medianCycleCostSol: null,
  p75CycleCostSol: null,
  medianFirstBuyPctOfBankroll: null,
  medianCyclePctOfBankroll: null,
  p75CyclePctOfBankroll: null,
  medianEntriesPerCycle: null,
  medianExitsPerCycle: null,
  medianFeesPerCycleSol: null,
  feeIllustrations: [],
  onePositionPctOfBankroll: null,
  twoPositionsPctOfBankroll: null,
  maxConcurrencyPctOfBankroll: null,
  medianConcurrentCapitalSol: null,
  observedMaxConcurrentPositions: 0,
});

export function calculatePortability(
  fingerprint: StrategyFingerprint | null,
  bankroll: number | null,
): Portability {
  if (!fingerprint || !bankroll || bankroll <= 0 || fingerprint.eligibleCycleCount === 0) {
    return empty(bankroll);
  }

  const n = fingerprint.eligibleCycleCount;
  const medianCost = num(fingerprint.medianCycleCostSol);
  const p75Cost = num(fingerprint.p75CycleCostSol);
  const medianFirstBuy = num(fingerprint.medianFirstBuySol);
  const medianFees = num(fingerprint.medianFeePerCycleSol);
  const legs = num(fingerprint.medianLegsPerCycle);
  const entries = num(fingerprint.medianBuysPerCycle);
  const exits = num(fingerprint.medianSellsPerCycle);
  const concurrency = fingerprint.observedMaxConcurrentPositions;
  const medianConcurrency = num(fingerprint.medianConcurrentPositions);

  const share = (value: number | null) => (value === null ? null : (value / bankroll) * 100);
  const feeIllustrations: FeeIllustration[] =
    medianFees === null
      ? []
      : ILLUSTRATION_SHARES.map((fraction) => ({
          share: fraction,
          positionSol: bankroll * fraction,
          feeBurdenPct: (medianFees / (bankroll * fraction)) * 100,
        }));

  const states: PortabilityState[] = [];
  const warningCodes: string[] = ['CURRENT_BALANCE_NOT_HISTORICAL'];

  if (n < PORTABILITY_MIN_CYCLES) {
    states.push('LIMITED_SAMPLE');
    warningCodes.push('PORTABILITY_SAMPLE_TOO_SMALL');
  } else if (n >= PORTABILITY_SUFFICIENT_CYCLES) {
    states.push('SUFFICIENT_SAMPLE');
  } else {
    states.push('LIMITED_SAMPLE');
  }

  if (!fingerprint.completeHistory) states.push('INCOMPLETE_EVIDENCE');

  // Per-transaction costs stay roughly constant in SOL, so the same structure
  // costs a larger share of a smaller position.
  const tenPercentBurden = feeIllustrations.find((f) => f.share === 0.1)?.feeBurdenPct ?? null;
  if (tenPercentBurden !== null && tenPercentBurden >= COST_SENSITIVE_PCT) states.push('COST_SENSITIVE');
  if (legs !== null && legs >= MULTI_LEG_LEGS) states.push('MULTI_LEG_COST_SENSITIVE');

  const onePositionPct = share(medianCost);
  const maxConcurrencyPct = medianCost === null ? null : ((medianCost * concurrency) / bankroll) * 100;
  if (
    (onePositionPct !== null && onePositionPct >= CAPITAL_INTENSIVE_PCT) ||
    (maxConcurrencyPct !== null && maxConcurrencyPct > 100)
  ) {
    states.push('CAPITAL_INTENSIVE');
  }
  if ((entries ?? 0) <= 1 && (exits ?? 0) <= 1) states.push('STRUCTURALLY_SIMPLE');

  return {
    states,
    warningCodes,
    bankroll,
    eligibleCycleCount: n,
    medianFirstBuySol: medianFirstBuy,
    medianCycleCostSol: medianCost,
    p75CycleCostSol: p75Cost,
    medianFirstBuyPctOfBankroll: share(medianFirstBuy),
    medianCyclePctOfBankroll: share(medianCost),
    p75CyclePctOfBankroll: share(p75Cost),
    medianEntriesPerCycle: entries,
    medianExitsPerCycle: exits,
    medianFeesPerCycleSol: medianFees,
    feeIllustrations,
    onePositionPctOfBankroll: onePositionPct,
    twoPositionsPctOfBankroll: medianCost === null ? null : ((medianCost * 2) / bankroll) * 100,
    maxConcurrencyPctOfBankroll: maxConcurrencyPct,
    medianConcurrentCapitalSol:
      medianCost === null || medianConcurrency === null ? null : medianCost * medianConcurrency,
    observedMaxConcurrentPositions: concurrency,
  };
}

/** Neutral descriptions. No state may imply an instruction or a verdict. */
export const PORTABILITY_STATE_TEXT: Record<PortabilityState, string> = {
  SUFFICIENT_SAMPLE: 'Enough eligible cycles were available to illustrate the observed structure.',
  LIMITED_SAMPLE: 'Few eligible cycles were available, so these illustrations rest on little evidence.',
  COST_SENSITIVE:
    'At the scaled position size, repeating several entries and exits may make fees a larger percentage of capital.',
  MULTI_LEG_COST_SENSITIVE:
    'Observed cycles typically use several entries and exits, so per-transaction costs repeat within one cycle.',
  CAPITAL_INTENSIVE:
    'A median-sized observed position, or the observed concurrency, would use a large share of the reference bankroll.',
  STRUCTURALLY_SIMPLE:
    'The observed structure is typically a single entry and a single exit per cycle.',
  INCOMPLETE_EVIDENCE:
    'Only part of this wallet’s history is synchronized, so the observed structure may be incomplete.',
  UNAVAILABLE:
    'No eligible cycles are available, so no reference-bankroll illustration can be shown.',
};
