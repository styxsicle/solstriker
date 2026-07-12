// Post-entry outcome wording and formatting.
//
// These describe the SELECTED MARKET PAIR after a wallet's BUY event. They are
// NOT the wallet's realized profit, an achievable fill, fees, slippage, or an
// available exit. Exact decimal strings are preserved for Quant Mode.
import type { ActivityEvent, WalletEntryOutcome } from '../api';

export const OUTCOME_WARNING =
  'These values describe the selected market pair after the wallet event. They do not represent a guaranteed fill, your Axiom execution price, fees, slippage, or an available exit.';

export const NO_OUTCOME_TEXT = 'Historical price data has not been collected for this entry.';
export const PARTIAL_OUTCOME_TEXT = 'Only part of the requested outcome window is available.';

export const ENTRY_METHOD_TEXT: Record<string, string> = {
  CANDLE_OPEN:
    'Estimated from the first 1-minute candle at or after the wallet event. The wallet may have executed before this candle opened, so this is an approximation — not the wallet’s exact execution price.',
  CANDLE_CLOSE: 'Estimated from a candle close.',
  CANDLE_INTERPOLATED: 'Interpolated between candles (approximate, not exact).',
  EXACT_SNAPSHOT: 'Taken from an exact market snapshot at entry.',
  UNAVAILABLE: 'No candle was available to estimate the entry price.',
};

/** Only confirmed/likely BUY events are eligible for an outcome panel. */
export function isOutcomeEligible(event: ActivityEvent): boolean {
  return (
    event.eventType === 'BUY' &&
    (event.confidence === 'CONFIRMED' || event.confidence === 'LIKELY')
  );
}

/** Signed percentage from an exact decimal string (Simple Mode display). */
export function formatReturn(value: string | null): string {
  if (value === null) return 'not available';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'not available';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export function returnTone(value: string | null): 'good' | 'bad' | 'muted' {
  if (value === null) return 'muted';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'muted';
  return n > 0 ? 'good' : 'bad';
}

export function formatUsdPrice(value: string | null): string {
  if (value === null) return 'not available';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'not available';
  if (n === 0) return '$0';
  if (Math.abs(n) >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  return `$${n.toLocaleString(undefined, { maximumSignificantDigits: 4 })}`;
}

export function formatDelay(seconds: number | null): string {
  if (seconds === null) return 'not available';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function outcomeStatusText(o: WalletEntryOutcome): string | null {
  if (o.status === 'UNAVAILABLE') return NO_OUTCOME_TEXT;
  if (o.status === 'PARTIAL') return PARTIAL_OUTCOME_TEXT;
  return null;
}
