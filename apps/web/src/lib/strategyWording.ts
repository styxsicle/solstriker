/**
 * Phase 2C-A — readable, neutral wording for strategy evidence.
 *
 * Every string here describes OBSERVED BEHAVIOR and the limits of the evidence.
 * None of them claims ownership, insider status, profitability or that a
 * strategy can be copied, and none recommends following, copying or trading.
 */
export const STRATEGY_WARNING_TEXT: Record<string, string> = {
  INCOMPLETE_WALLET_HISTORY:
    'Only part of this wallet’s history has been synchronized. Earlier entries or later exits may be missing, so this is not lifetime behavior.',
  NO_COMPLETED_RECONSTRUCTION:
    'This wallet has no completed position reconstruction, so no strategy fingerprint can be calculated.',
  NO_QUALITY_ANALYSIS:
    'No completed quality analysis exists for this wallet. The fingerprint was calculated without it.',
  VERY_SMALL_CYCLE_SAMPLE:
    'Very few eligible position cycles were available. The observed structure is not established by this sample.',
  SMALL_CYCLE_SAMPLE: 'The eligible cycle sample is still small.',
  LOW_ELIGIBLE_COVERAGE:
    'Less than half of the reconstructed cycles had a known buy cost, so most cycles were excluded.',
  TRANSFER_AFFECTED_CYCLES:
    'Token transfers moved inventory without a visible price in some cycles, so entry and exit sizes there are uncertain.',
  UNMATCHED_SELLS_PRESENT:
    'Some sells have no earlier known buy in the synchronized history.',
  UNKNOWN_BASIS: 'Some observed inventory has no known acquisition cost.',
  MISSING_FEES:
    'Attributable fees are missing for some events, so the fee burden shown covers only part of the sample.',
  MIXED_EVENT_CONFIDENCE:
    'The sample mixes confirmed and likely decoded events.',
  MULTI_LEG_FEE_SENSITIVITY:
    'Observed cycles typically use several entries and exits, so per-transaction costs repeat within a single cycle.',
  PORTABILITY_SAMPLE_TOO_SMALL:
    'Too few eligible cycles are available to illustrate the observed structure against a reference bankroll.',
  CURRENT_BALANCE_NOT_HISTORICAL:
    'The app does not know this wallet’s historical total bankroll at the time of each trade. Any current balance would be current only, would not prove trading profit, and could be affected by deposits and transfers.',
  POSSIBLE_SHARED_LABEL_ONLY:
    'Some wallets in this cohort have similar labels. Similar labels do not prove that wallets share an owner.',
  OWNERSHIP_NOT_ESTABLISHED:
    'This is a user-selected wallet group. Observed behavior does not prove ownership, insider status, lifetime profitability or that the strategy can be copied successfully.',
};

export const DESCRIPTOR_TEXT: Record<string, string> = {
  MOSTLY_SINGLE_ENTRY: 'Mostly single-entry observed',
  FREQUENTLY_SCALES_IN: 'Frequently scales in',
  INSUFFICIENT_ENTRY_SAMPLE: 'Insufficient entry sample',
  MOSTLY_SINGLE_EXIT: 'Mostly single-exit observed',
  FREQUENTLY_SCALES_OUT: 'Frequently scales out',
  OFTEN_LEAVES_INVENTORY_OPEN: 'Often leaves observed inventory open',
  MOSTLY_SHORT_OBSERVED_HOLDS: 'Mostly short observed holds',
  MIXED_HOLDING_DURATIONS: 'Mixed holding durations',
  MOSTLY_LONGER_OBSERVED_HOLDS: 'Mostly longer observed holds',
  VENUE_CONCENTRATED: 'Venue concentrated',
  VENUE_DIVERSIFIED: 'Venue diversified',
  POSITION_SIZES_CONCENTRATED: 'Position sizes concentrated',
  POSITION_SIZES_VARIED: 'Position sizes varied',
  FEE_SENSITIVE_AT_SMALLER_BANKROLL: 'Fee-sensitive at smaller bankroll',
  INCOMPLETE_HISTORY_SAMPLE: 'Incomplete-history sample',
  TRANSFER_AFFECTED_SAMPLE: 'Transfer-affected sample',
};

export const READINESS_TEXT: Record<string, string> = {
  NOT_SYNCHRONIZED:
    'This wallet has no synchronized activity yet. It must be synchronized and reconstructed before a strategy fingerprint can be calculated.',
  PARTIAL_HISTORY:
    'Only part of this wallet’s history is synchronized. Observed cycles may be missing earlier entries or later exits.',
  NO_COMPLETED_RECONSTRUCTION:
    'This wallet must be synchronized and reconstructed before a strategy fingerprint can be calculated.',
  NO_QUALITY_ANALYSIS:
    'No quality analysis exists for this wallet. A fingerprint can still be calculated without it.',
  NO_STRATEGY_FINGERPRINT:
    'No strategy fingerprint has been calculated for this wallet yet.',
};

export const warningText = (code: string) => STRATEGY_WARNING_TEXT[code] ?? code;
export const descriptorText = (code: string) => DESCRIPTOR_TEXT[code] ?? code;
export const readinessText = (code: string) => READINESS_TEXT[code] ?? code;

/**
 * Plain-language duration for Simple Mode; Quant Mode keeps exact seconds.
 * Short delays stay in seconds — a 74-second gap between two buys is more
 * useful, and more honest, than rounding it to "1 minute".
 */
export function durationText(seconds: string | null): string {
  if (seconds === null) return 'Not enough reliable synchronized data.';
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 'Not enough reliable synchronized data.';
  const plural = (amount: number, unit: string) => `${amount} ${unit}${amount === 1 ? '' : 's'}`;
  if (value < 120) return plural(Math.round(value), 'second');
  if (value < 7200) return plural(Math.round(value / 60), 'minute');
  if (value < 172800) return `${(value / 3600).toFixed(1)} hours`;
  return `${(value / 86400).toFixed(1)} days`;
}
