import { describe, expect, it } from 'vitest';
import {
  AGING_MAX_AGE_SECONDS,
  FRESH_MAX_AGE_SECONDS,
  freshnessOf,
} from '../../src/services/tokenMetrics/freshness.js';

describe('freshness classification', () => {
  const now = new Date('2026-07-12T00:00:00.000Z');
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it('is FRESH within the fresh window', () => {
    const r = freshnessOf(ago(60), now);
    expect(r.freshness).toBe('FRESH');
    expect(r.ageSeconds).toBe(60);
  });

  it('is FRESH exactly at the fresh boundary', () => {
    expect(freshnessOf(ago(FRESH_MAX_AGE_SECONDS), now).freshness).toBe('FRESH');
  });

  it('is AGING just past the fresh window', () => {
    expect(freshnessOf(ago(FRESH_MAX_AGE_SECONDS + 1), now).freshness).toBe('AGING');
    expect(freshnessOf(ago(AGING_MAX_AGE_SECONDS), now).freshness).toBe('AGING');
  });

  it('is STALE past the aging window', () => {
    expect(freshnessOf(ago(AGING_MAX_AGE_SECONDS + 1), now).freshness).toBe('STALE');
  });

  it('is NEVER_FETCHED when no observation time exists', () => {
    expect(freshnessOf(null, now)).toEqual({ freshness: 'NEVER_FETCHED', ageSeconds: null });
    expect(freshnessOf(undefined, now).freshness).toBe('NEVER_FETCHED');
  });

  it('is UNKNOWN for a future observation time (clock skew)', () => {
    expect(freshnessOf(new Date(now.getTime() + 5000), now)).toEqual({
      freshness: 'UNKNOWN',
      ageSeconds: null,
    });
  });
});
