// Provider-neutral market-data types. Everything downstream (pair selection,
// normalization, routes) depends only on these shapes — never on a specific
// provider's response structure.
//
// All financial values are EXACT DECIMAL STRINGS as observed from the
// provider. Unknown values are null — never zero, never invented.

export type WindowKey = 'm5' | 'h1' | 'h6' | 'h24';

export interface PairTxnCounts {
  buys: number | null;
  sells: number | null;
}

/** One candidate trading pair/pool for a requested mint. */
export interface MarketPairCandidate {
  chainId: string;
  pairAddress: string;
  dex: string | null;
  baseMint: string;
  baseName: string | null;
  baseSymbol: string | null;
  quoteMint: string | null;
  quoteSymbol: string | null;
  /** USD price of the BASE token (exact string). */
  priceUsd: string | null;
  /** Price of the BASE token in the QUOTE token's units (exact string). */
  priceNative: string | null;
  /** Circulating market cap — kept strictly separate from FDV. */
  marketCapUsd: string | null;
  fdvUsd: string | null;
  liquidityUsd: string | null;
  volumeUsd: Record<WindowKey, string | null>;
  txns: Record<WindowKey, PairTxnCounts>;
  priceChangePct: Record<WindowKey, string | null>;
  /** Unix ms of pair creation, when the provider reports it. */
  pairCreatedAt: number | null;
  /**
   * Provider observation time (unix ms) when genuinely reported.
   * Null means the provider exposes no observation timestamp.
   */
  observedAt: number | null;
}

/** Result of looking up a batch of mints: candidates per requested mint. */
export interface MarketLookupResult {
  provider: string;
  /** Unix ms when the lookup completed (fetch time). */
  fetchedAt: number;
  /** Keyed by requested mint. A mint with no pairs maps to an empty array. */
  candidatesByMint: Map<string, MarketPairCandidate[]>;
}
