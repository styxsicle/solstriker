// Provider-agnostic Solana activity types.
// Everything downstream of the provider (normalization, sync, routes) works
// only with these shapes — no Helius specifics leak past the provider.

export interface SolanaTokenTransfer {
  mint: string;
  fromUserAccount: string | null;
  toUserAccount: string | null;
  /** Decimal-adjusted (UI) amount. */
  tokenAmount: number;
}

export interface SolanaNativeTransfer {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  lamports: number;
}

export interface SolanaTransaction {
  signature: string;
  slot: number | null;
  /** Unix seconds. */
  timestamp: number | null;
  /** Provider transaction classification, e.g. "SWAP", "TRANSFER". */
  type: string | null;
  /** Originating program/platform label, e.g. "JUPITER", "PUMP_FUN". */
  source: string | null;
  failed: boolean;
  tokenTransfers: SolanaTokenTransfer[];
  nativeTransfers: SolanaNativeTransfer[];
}

export type ProviderErrorCode = 'not_configured' | 'rate_limited' | 'provider_error';

/**
 * The only error type providers may throw. Messages are generic by design —
 * they must never contain request URLs or API keys.
 */
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ProviderError';
  }
}
