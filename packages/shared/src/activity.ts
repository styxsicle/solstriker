// Shared constants/types for Phase 1B wallet-activity ingestion.

export const WALLET_EVENT_TYPES = [
  'BUY',
  'SELL',
  'TOKEN_TRANSFER_IN',
  'TOKEN_TRANSFER_OUT',
] as const;

export type WalletEventType = (typeof WALLET_EVENT_TYPES)[number];

/** Hard cap on wallets per sync request — Phase 1B is deliberately conservative. */
export const MAX_WALLETS_PER_SYNC = 10;

/** Transactions fetched per wallet per sync request. */
export const DEFAULT_TX_PER_SYNC = 200;
export const MAX_TX_PER_SYNC = 500;

/** Wrapped SOL mint — folded into the native SOL delta during normalization. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Stablecoins treated as quote currencies (not tracked as meme tokens). */
export const STABLE_MINTS: readonly string[] = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];
