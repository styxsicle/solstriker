/**
 * Phase 2C-A — centralized strategy-evidence warning codes.
 *
 * Every code describes a limitation of the EVIDENCE, never a judgement about a
 * wallet, its owner, or the quality of its trading. Confidence derived from
 * these codes represents evidence completeness only — never profitability,
 * skill, or whether a strategy could be copied.
 */
export const STRATEGY_WARNINGS = {
  /** Only part of the wallet's history is synchronized; early entries or later exits may be missing. */
  INCOMPLETE_WALLET_HISTORY: 'INCOMPLETE_WALLET_HISTORY',
  /** No completed FIFO reconstruction exists for the wallet — nothing can be fingerprinted. */
  NO_COMPLETED_RECONSTRUCTION: 'NO_COMPLETED_RECONSTRUCTION',
  /** No completed quality analysis exists; the fingerprint is calculated without it. */
  NO_QUALITY_ANALYSIS: 'NO_QUALITY_ANALYSIS',
  /** Fewer than VERY_SMALL_CYCLE_THRESHOLD eligible cycles. */
  VERY_SMALL_CYCLE_SAMPLE: 'VERY_SMALL_CYCLE_SAMPLE',
  /** Fewer than SMALL_CYCLE_THRESHOLD eligible cycles. */
  SMALL_CYCLE_SAMPLE: 'SMALL_CYCLE_SAMPLE',
  /** Less than half of the reconstructed cycles met the entry-evidence rules. */
  LOW_ELIGIBLE_COVERAGE: 'LOW_ELIGIBLE_COVERAGE',
  /** Token transfers moved inventory without a visible price, affecting some cycles. */
  TRANSFER_AFFECTED_CYCLES: 'TRANSFER_AFFECTED_CYCLES',
  /** Sells were observed without an earlier known buy in the synchronized history. */
  UNMATCHED_SELLS_PRESENT: 'UNMATCHED_SELLS_PRESENT',
  /** Some observed inventory has no known acquisition cost. */
  UNKNOWN_BASIS: 'UNKNOWN_BASIS',
  /** Attributable fees are missing for some events, so fee burden is partial. */
  MISSING_FEES: 'MISSING_FEES',
  /** The sample mixes CONFIRMED and LIKELY decoded events. */
  MIXED_EVENT_CONFIDENCE: 'MIXED_EVENT_CONFIDENCE',
  /** Cycles typically use several entries and exits, so per-transaction costs repeat. */
  MULTI_LEG_FEE_SENSITIVITY: 'MULTI_LEG_FEE_SENSITIVITY',
  /** Too few eligible cycles to illustrate reference-bankroll portability. */
  PORTABILITY_SAMPLE_TOO_SMALL: 'PORTABILITY_SAMPLE_TOO_SMALL',
  /** Any current balance is current only — it is not the historical bankroll and does not prove profit. */
  CURRENT_BALANCE_NOT_HISTORICAL: 'CURRENT_BALANCE_NOT_HISTORICAL',
  /** Cohort members share a label prefix. Similar labels alone establish nothing. */
  POSSIBLE_SHARED_LABEL_ONLY: 'POSSIBLE_SHARED_LABEL_ONLY',
  /** Cohort membership is a user grouping. Common ownership is NOT established. */
  OWNERSHIP_NOT_ESTABLISHED: 'OWNERSHIP_NOT_ESTABLISHED',
} as const;

export type StrategyWarning = (typeof STRATEGY_WARNINGS)[keyof typeof STRATEGY_WARNINGS];

/** Eligible-cycle sample thresholds (evidence completeness only). */
export const VERY_SMALL_CYCLE_THRESHOLD = 5;
export const SMALL_CYCLE_THRESHOLD = 20;
/** Below this many eligible cycles, portability illustrations are withheld. */
export const PORTABILITY_MIN_CYCLES = 3;
/** At or above this median number of legs per cycle, repeated per-transaction costs are flagged. */
export const MULTI_LEG_THRESHOLD = 4;
