/**
 * FOMO Simulator V1 — pure deterministic units: the fomo-sim-v1 call mapping,
 * cohort identity, dedupe keys, and the paper-trade math. No database.
 */
import { describe, expect, it } from 'vitest';
import {
  cohortKeyFor,
  convictionFor,
  dedupeKeyFor,
  derivePaperAction,
  FOMO_METHODOLOGY_VERSION,
} from '../../src/services/fomoSimulator/mapping.js';
import { computeEntry, computeExitValue, computePl } from '../../src/services/fomoSimulator/math.js';

describe('fomo-sim-v1 call mapping — no open paper position', () => {
  it('derives BUY from BUILDING + HIGHER', () => {
    expect(derivePaperAction('BUILDING', 'HIGHER', false)).toBe('BUY');
  });
  it('derives BUY from HOLDING + HIGHER', () => {
    expect(derivePaperAction('HOLDING', 'HIGHER', false)).toBe('BUY');
  });
  it('MODERATE or LOW confidence never opens a new BUY', () => {
    expect(derivePaperAction('BUILDING', 'MODERATE', false)).toBe('NO_TRADE');
    expect(derivePaperAction('HOLDING', 'MODERATE', false)).toBe('NO_TRADE');
    expect(derivePaperAction('BUILDING', 'LOW', false)).toBe('NO_TRADE');
    expect(derivePaperAction('HOLDING', 'LOW', false)).toBe('NO_TRADE');
  });
  it('derives AVOID from COOLING and DISTRIBUTION_RISK', () => {
    expect(derivePaperAction('COOLING', 'HIGHER', false)).toBe('AVOID');
    expect(derivePaperAction('DISTRIBUTION_RISK', 'LOW', false)).toBe('AVOID');
  });
  it('MIXED and INSUFFICIENT_EVIDENCE always return NO_TRADE', () => {
    expect(derivePaperAction('MIXED', 'HIGHER', false)).toBe('NO_TRADE');
    expect(derivePaperAction('INSUFFICIENT_EVIDENCE', 'HIGHER', false)).toBe('NO_TRADE');
  });
});

describe('fomo-sim-v1 call mapping — with an open paper position', () => {
  it('derives HOLD from BUILDING/HOLDING with HIGHER or MODERATE confidence', () => {
    expect(derivePaperAction('BUILDING', 'HIGHER', true)).toBe('HOLD');
    expect(derivePaperAction('HOLDING', 'HIGHER', true)).toBe('HOLD');
    expect(derivePaperAction('BUILDING', 'MODERATE', true)).toBe('HOLD');
    expect(derivePaperAction('HOLDING', 'MODERATE', true)).toBe('HOLD');
  });
  it('derives EXIT from COOLING and DISTRIBUTION_RISK', () => {
    expect(derivePaperAction('COOLING', 'HIGHER', true)).toBe('EXIT');
    expect(derivePaperAction('DISTRIBUTION_RISK', 'MODERATE', true)).toBe('EXIT');
  });
  it('LOW confidence never forces an exit — the position is left unchanged', () => {
    expect(derivePaperAction('BUILDING', 'LOW', true)).toBe('NO_TRADE');
    expect(derivePaperAction('HOLDING', 'LOW', true)).toBe('NO_TRADE');
  });
  it('MIXED and INSUFFICIENT_EVIDENCE leave the position unchanged as NO_TRADE', () => {
    expect(derivePaperAction('MIXED', 'LOW', true)).toBe('NO_TRADE');
    expect(derivePaperAction('INSUFFICIENT_EVIDENCE', 'MODERATE', true)).toBe('NO_TRADE');
  });
});

describe('conviction wording', () => {
  it('maps Slow Cook confidence to user-facing conviction', () => {
    expect(convictionFor('HIGHER')).toBe('HIGH');
    expect(convictionFor('MODERATE')).toBe('MEDIUM');
    expect(convictionFor('LOW')).toBe('LOW');
  });
});

describe('cohort identity', () => {
  it('is independent of wallet selection order', () => {
    expect(cohortKeyFor(['b', 'a', 'c'])).toBe(cohortKeyFor(['c', 'a', 'b']));
  });
  it('deduplicates repeated IDs and never uses labels', () => {
    expect(cohortKeyFor(['a', 'a', 'b'])).toBe(cohortKeyFor(['a', 'b']));
  });
});

describe('dedupe key', () => {
  const base = {
    tokenId: 'token-1',
    walletIds: ['w1', 'w2'],
    action: 'BUY' as const,
    latestEvidenceAt: '2026-07-12T00:00:00.000Z',
    entrySnapshotId: 'snap-1',
    methodologyVersion: FOMO_METHODOLOGY_VERSION,
  };
  it('is deterministic for identical real inputs regardless of wallet order', () => {
    expect(dedupeKeyFor(base)).toBe(dedupeKeyFor({ ...base, walletIds: ['w2', 'w1'] }));
  });
  it('changes when the underlying evidence changes', () => {
    expect(dedupeKeyFor(base)).not.toBe(dedupeKeyFor({ ...base, latestEvidenceAt: '2026-07-12T01:00:00.000Z' }));
    expect(dedupeKeyFor(base)).not.toBe(dedupeKeyFor({ ...base, entrySnapshotId: 'snap-2' }));
    expect(dedupeKeyFor(base)).not.toBe(dedupeKeyFor({ ...base, action: 'HOLD' }));
  });
});

describe('paper-trade math (exact decimal strings, never floats)', () => {
  it('computes the entry fee and token quantity correctly', () => {
    // notional 100, fee 1%, no slippage, raw price 0.01:
    // fee = 1, quote available = 99, effective price = 0.01, quantity = 9900
    const entry = computeEntry('100', '0.01', { feeRatePct: '1', entrySlippagePct: '0', exitSlippagePct: '0' });
    expect(entry.entryFeeUsd).toBe('1');
    expect(entry.quoteAvailableUsd).toBe('99');
    expect(entry.effectiveEntryPriceUsd).toBe('0.01');
    expect(entry.tokenQuantity).toBe('9900');
  });

  it('applies entry slippage to the effective price', () => {
    // notional 100, no fee, 25% entry slippage, raw price 0.01:
    // effective price = 0.0125, quantity = 8000
    const entry = computeEntry('100', '0.01', { feeRatePct: '0', entrySlippagePct: '25', exitSlippagePct: '0' });
    expect(entry.effectiveEntryPriceUsd).toBe('0.0125');
    expect(entry.tokenQuantity).toBe('8000');
  });

  it('computes exit fee, slippage and net exit value correctly', () => {
    // 9900 tokens at raw 0.02, no slippage, 1% fee:
    // gross = 198, exit fee = 1.98, net = 196.02
    const exit = computeExitValue('9900', '0.02', { feeRatePct: '1', entrySlippagePct: '0', exitSlippagePct: '0' });
    expect(exit.grossExitValueUsd).toBe('198');
    expect(exit.exitFeeUsd).toBe('1.98');
    expect(exit.netExitValueUsd).toBe('196.02');
  });

  it('applies exit slippage before the exit fee', () => {
    // 8000 tokens at raw 0.02 with 25% exit slippage, no fee: 8000×0.02×0.75 = 120
    const exit = computeExitValue('8000', '0.02', { feeRatePct: '0', entrySlippagePct: '0', exitSlippagePct: '25' });
    expect(exit.grossExitValueUsd).toBe('120');
    expect(exit.netExitValueUsd).toBe('120');
  });

  it('computes simulated P/L and return percent from the original notional', () => {
    const { plUsd, returnPct } = computePl('196.02', '100');
    expect(plUsd).toBe('96.02');
    expect(returnPct).toBe('96.02');
  });

  it('computes losses exactly, including negative return percent', () => {
    const { plUsd, returnPct } = computePl('83.3', '100');
    expect(plUsd).toBe('-16.7');
    expect(returnPct).toBe('-16.7');
  });
});
