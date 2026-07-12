// Provider-neutral historical OHLCV types. Downstream code (normalization,
// backfill, outcome calculation, routes) depends only on these shapes — never
// on a specific provider's response structure.
//
// OHLC values are EXACT DECIMAL STRINGS as observed from the provider.
// Volume is a string or null (never zero when unknown). Timestamps are UTC.

/** Supported candle intervals (app-level identifiers). */
export type CandleInterval = '1m' | '5m' | '15m' | '1h';

export interface HistoricalCandle {
  /** Unix seconds (UTC) of the candle's open. */
  openTimeSec: number;
  open: string;
  high: string;
  low: string;
  close: string;
  /** USD volume during the candle, or null when the provider omits it. */
  volumeUsd: string | null;
}

export interface HistoricalLookupParams {
  chainId: string;
  pairAddress: string;
  interval: CandleInterval;
  /** Inclusive UTC range (unix seconds). */
  startSec: number;
  endSec: number;
}

export interface HistoricalLookupResult {
  provider: string;
  chainId: string;
  pairAddress: string;
  interval: CandleInterval;
  /** Unix ms when the lookup completed. */
  fetchedAt: number;
  /** Raw provider candles (unsorted, possibly with duplicates). */
  candles: HistoricalCandle[];
}
