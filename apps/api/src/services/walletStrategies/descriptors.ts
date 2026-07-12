/**
 * Phase 2C-A — descriptive strategy-structure descriptors.
 *
 * A descriptor states WHAT THE EVIDENCE SHOWS about observed structure. It is
 * never a compliment, a rank, a classification of the person behind a wallet,
 * or an instruction. Words such as genius, elite, insider, sniper, whale, best,
 * profitable or high-conviction are deliberately absent, and multiple buys are
 * described as "observed scale-in behavior" rather than "conviction".
 *
 * Every descriptor carries its formula, sample count, threshold, confidence and
 * warning codes so the user can audit exactly why it was emitted.
 */
export const STRATEGY_DESCRIPTORS = {
  MOSTLY_SINGLE_ENTRY: 'MOSTLY_SINGLE_ENTRY',
  FREQUENTLY_SCALES_IN: 'FREQUENTLY_SCALES_IN',
  INSUFFICIENT_ENTRY_SAMPLE: 'INSUFFICIENT_ENTRY_SAMPLE',
  MOSTLY_SINGLE_EXIT: 'MOSTLY_SINGLE_EXIT',
  FREQUENTLY_SCALES_OUT: 'FREQUENTLY_SCALES_OUT',
  OFTEN_LEAVES_INVENTORY_OPEN: 'OFTEN_LEAVES_INVENTORY_OPEN',
  MOSTLY_SHORT_OBSERVED_HOLDS: 'MOSTLY_SHORT_OBSERVED_HOLDS',
  MIXED_HOLDING_DURATIONS: 'MIXED_HOLDING_DURATIONS',
  MOSTLY_LONGER_OBSERVED_HOLDS: 'MOSTLY_LONGER_OBSERVED_HOLDS',
  VENUE_CONCENTRATED: 'VENUE_CONCENTRATED',
  VENUE_DIVERSIFIED: 'VENUE_DIVERSIFIED',
  POSITION_SIZES_CONCENTRATED: 'POSITION_SIZES_CONCENTRATED',
  POSITION_SIZES_VARIED: 'POSITION_SIZES_VARIED',
  FEE_SENSITIVE_AT_SMALLER_BANKROLL: 'FEE_SENSITIVE_AT_SMALLER_BANKROLL',
  INCOMPLETE_HISTORY_SAMPLE: 'INCOMPLETE_HISTORY_SAMPLE',
  TRANSFER_AFFECTED_SAMPLE: 'TRANSFER_AFFECTED_SAMPLE',
} as const;

export type StrategyDescriptor = (typeof STRATEGY_DESCRIPTORS)[keyof typeof STRATEGY_DESCRIPTORS];

/** Descriptor thresholds. Documented, versioned with the calculation, never tuned per wallet. */
export const DESCRIPTOR_THRESHOLDS = {
  /** Minimum eligible cycles before any structural descriptor may be emitted. */
  MIN_SAMPLE: 5,
  /** Share of eligible cycles that must show the structure to call it "mostly". */
  MOSTLY_PCT: 60,
  /** Share of eligible cycles that must show the structure to call it "frequently". */
  FREQUENTLY_PCT: 40,
  /** Share of eligible cycles on one venue to call venue use concentrated. */
  VENUE_CONCENTRATED_PCT: 70,
  /** Below this top-venue share, venue use is called diversified. */
  VENUE_DIVERSIFIED_PCT: 50,
  /** P75 ÷ P25 known cycle cost at or below this ratio counts as concentrated sizing. */
  SIZE_CONCENTRATED_RATIO: 2,
  /** P75 ÷ P25 known cycle cost at or above this ratio counts as varied sizing. */
  SIZE_VARIED_RATIO: 4,
  /** Observed holds under this many seconds count as short. */
  SHORT_HOLD_SECONDS: 1800,
  /** Observed holds at or above this many seconds count as longer. */
  LONG_HOLD_SECONDS: 14400,
  /** Median known fee burden (% of known cycle cost) at or above which fee sensitivity is flagged. */
  FEE_BURDEN_PCT: 1,
} as const;

/** One audit record behind a single emitted descriptor. */
export interface DescriptorEvidence {
  code: StrategyDescriptor;
  /** Plain-language statement of exactly what was computed. */
  formula: string;
  /** Numerator of the supporting fraction (e.g. cycles showing the structure). */
  numerator: number | null;
  /** Denominator of the supporting fraction (e.g. eligible cycles). */
  denominator: number | null;
  /** Observed value, as an exact decimal string, in the unit named by `formula`. */
  observed: string | null;
  /** Threshold the observed value had to reach, as an exact decimal string. */
  threshold: string;
  /** Eligible observations supporting the descriptor. */
  sampleCount: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  warningCodes: string[];
}
