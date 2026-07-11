import { base58Decode, base58Encode } from './base58.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Validates that a string is a plausible Solana public key:
 * base58 alphabet, 32–44 characters, and decodes to exactly 32 bytes.
 */
export function isValidSolanaAddress(value: string): boolean {
  if (typeof value !== 'string' || !BASE58_RE.test(value)) return false;
  const bytes = base58Decode(value);
  return bytes !== null && bytes.length === 32;
}

/**
 * Deterministic, syntactically valid fake address for development seeds and tests.
 * NEVER used for real wallets — it simply base58-encodes 32 identical bytes.
 */
export function syntheticAddress(n: number): string {
  const byte = (Math.abs(Math.trunc(n)) % 255) + 1; // 1..255, avoids the all-zero address
  return base58Encode(new Uint8Array(32).fill(byte));
}

export const TOKEN_STAGES = ['UNCLASSIFIED', 'FINAL_STRETCH', 'MIGRATED'] as const;
export type TokenStage = (typeof TOKEN_STAGES)[number];
