import type { HistoricalLookupParams, HistoricalLookupResult } from './types.js';

/**
 * Read-only source of historical OHLCV candles for a specific Solana pair
 * (Phase 1D-B2). Implementations must:
 *  - fetch by pair address + interval + bounded UTC window,
 *  - return provider-neutral candles (see types.ts),
 *  - throw only HistoricalProviderError with sanitized messages,
 *  - support fetch injection so tests never touch the network.
 */
export interface HistoricalMarketProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Supported candle intervals for this provider. */
  supportedIntervals(): readonly string[];
  fetchCandles(params: HistoricalLookupParams): Promise<HistoricalLookupResult>;
}
