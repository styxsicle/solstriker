// Provider-agnostic Solana activity types.
// Everything downstream of the provider (normalization, sync, routes) works
// only with these shapes — no Helius specifics leak past the provider.

export interface SolanaTokenTransfer {
  mint: string;
  fromUserAccount: string | null;
  toUserAccount: string | null;
  /** SPL token accounts involved (needed to identify the wallet's own ATAs). */
  fromTokenAccount?: string | null;
  toTokenAccount?: string | null;
  /** Decimal-adjusted (UI) amount. */
  tokenAmount: number;
}

export interface SolanaNativeTransfer {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  lamports: number;
}

/** Exact per-account lamport balance change (includes rent, fees, everything). */
export interface SolanaAccountBalanceChange {
  account: string;
  lamportsChange: number;
}

export interface SolanaSwapNativeLeg {
  account: string;
  lamports: number;
}

export interface SolanaSwapTokenLeg {
  /** Owner wallet of the leg, when the provider decoded it. */
  userAccount: string | null;
  mint: string;
  /** Decimal-adjusted (UI) amount. */
  tokenAmount: number;
}

/**
 * A swap decoded by the provider from the transaction's instructions/events.
 * Amounts here are the EXACT swap legs — not wallet balance aggregates.
 */
export interface SolanaSwapEvent {
  nativeInput: SolanaSwapNativeLeg | null;
  nativeOutput: SolanaSwapNativeLeg | null;
  tokenInputs: SolanaSwapTokenLeg[];
  tokenOutputs: SolanaSwapTokenLeg[];
  /** Fee legs charged inside the swap (platform/protocol fees), in lamports. */
  nativeFees: SolanaSwapNativeLeg[];
  tokenFees: SolanaSwapTokenLeg[];
  /** Execution venues of inner swap legs, e.g. ["PUMP_AMM"], deduplicated. */
  innerVenues: string[];
}

/** One program invocation (top-level or inner) with its account list. */
export interface SolanaProgramInvocation {
  programId: string;
  accounts: string[];
}

export interface SolanaTransaction {
  signature: string;
  slot: number | null;
  /** Unix seconds. */
  timestamp: number | null;
  /** Provider transaction classification, e.g. "SWAP", "TRANSFER". */
  type: string | null;
  /** Originating program/app label (router), e.g. "JUPITER", "PUMP_FUN". */
  source: string | null;
  failed: boolean;
  /** Total network fee in lamports (base + priority), paid by feePayer. */
  feeLamports: number | null;
  feePayer: string | null;
  tokenTransfers: SolanaTokenTransfer[];
  nativeTransfers: SolanaNativeTransfer[];
  accountBalanceChanges: SolanaAccountBalanceChange[];
  swap: SolanaSwapEvent | null;
  /** Flattened top-level + inner invocations, in execution order. */
  programInvocations: SolanaProgramInvocation[];
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
