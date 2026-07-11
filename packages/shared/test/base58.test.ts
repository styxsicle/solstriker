import { describe, expect, it } from 'vitest';
import { base58Decode, base58Encode, isValidSolanaAddress, syntheticAddress } from '../src/index.js';

describe('base58', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 0, 7, 255, 42, 1, 99, 200, 13]);
    const encoded = base58Encode(bytes);
    expect(base58Decode(encoded)).toEqual(bytes);
  });

  it('round-trips 32-byte buffers (Solana key size)', () => {
    for (const fill of [1, 77, 254]) {
      const bytes = new Uint8Array(32).fill(fill);
      const decoded = base58Decode(base58Encode(bytes));
      expect(decoded).toEqual(bytes);
    }
  });

  it('rejects characters outside the base58 alphabet', () => {
    expect(base58Decode('0OIl')).toBeNull();
  });
});

describe('isValidSolanaAddress', () => {
  it('accepts a well-formed synthetic address', () => {
    expect(isValidSolanaAddress(syntheticAddress(1))).toBe(true);
    expect(isValidSolanaAddress(syntheticAddress(200))).toBe(true);
  });

  it('accepts the all-ones system-style address', () => {
    expect(isValidSolanaAddress('1'.repeat(32))).toBe(true);
  });

  it('rejects strings that are too short or too long', () => {
    expect(isValidSolanaAddress('abc')).toBe(false);
    expect(isValidSolanaAddress('2'.repeat(64))).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(isValidSolanaAddress('O'.repeat(40))).toBe(false);
    expect(isValidSolanaAddress('not a wallet address at all!!')).toBe(false);
  });

  it('rejects base58 strings that do not decode to 32 bytes', () => {
    // 33 bytes encoded — passes the regex length window but fails the byte check.
    const tooLong = base58Encode(new Uint8Array(33).fill(9));
    expect(isValidSolanaAddress(tooLong)).toBe(false);
  });
});
