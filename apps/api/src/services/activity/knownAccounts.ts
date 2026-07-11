/**
 * Public, well-known Solana accounts used to attribute SOL outflows during
 * decoding. These are protocol constants published by the respective projects
 * (block-explorer-verifiable), not user data. Extend as new venues appear —
 * an unknown fee account degrades gracefully into the unattributed bucket,
 * it never corrupts swap amounts.
 */

/** Jito block-engine tip accounts (validator tips / MEV tips). */
export const TIP_ACCOUNTS: ReadonlySet<string> = new Set([
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
]);

/** Pump.fun / Pump AMM protocol fee recipients (publicly documented). */
export const PLATFORM_FEE_ACCOUNTS: ReadonlySet<string> = new Set([
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM',
  '62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV',
  '7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ',
  '7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX',
  '9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz',
  'AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY',
  'FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz',
  'G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP',
]);

/** Rent-exempt balance of an SPL token account (ATA creation cost), lamports. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;

/** Base network fee per signature, lamports. */
export const BASE_FEE_PER_SIGNATURE_LAMPORTS = 5_000;

/**
 * Execution-venue program IDs (public protocol constants). Transfers between
 * the wallet and accounts referenced by these programs' instructions ARE the
 * swap legs — this is how exact amounts are recovered when the provider ships
 * no decoded swap event (observed for router-mediated Pump.fun trades).
 * Helper programs (e.g. the Pump fee program) map to the same venue label.
 * An unknown venue simply falls back to heuristic decoding — never guessed.
 */
export const VENUE_PROGRAMS: ReadonlyMap<string, string> = new Map([
  ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'PUMP_FUN'], // bonding curve
  ['pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ', 'PUMP_FUN'], // pump fee program
  ['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'PUMP_AMM'],
  ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'RAYDIUM'], // AMM v4
  ['CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', 'RAYDIUM'], // CPMM
  ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'RAYDIUM'], // CLMM
  ['LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'METEORA'], // DLMM
]);

/**
 * Leftover wallet outflows during a decoded swap are classified as
 * platform/router fees only while small; anything larger is reported as an
 * unrelated transfer instead of being silently absorbed.
 */
export const ROUTER_FEE_MAX_SOL = 0.05;
export const ROUTER_FEE_MAX_FRACTION = 0.05;
