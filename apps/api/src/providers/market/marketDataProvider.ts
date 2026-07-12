import type { MarketLookupResult } from './types.js';

/**
 * Read-only source of CURRENT token market data (Phase 1D-B1: snapshots only —
 * no historical candles). Implementations must:
 *  - return provider-neutral candidates (see types.ts),
 *  - throw only MarketProviderError with sanitized messages,
 *  - support fetch injection so tests never touch the network.
 */
export interface MarketDataProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Looks up 1..N Solana mints. Missing mints map to empty candidate lists. */
  lookupTokens(mints: string[]): Promise<MarketLookupResult>;
}
