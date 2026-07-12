import { describe, expect, it } from 'vitest';
import {
  calculatePortability,
  DEFAULT_REFERENCE_BANKROLL_SOL,
  PORTABILITY_STATE_TEXT,
} from '../src/lib/portability';
import { makeFingerprint } from './fixtures';

describe('reference-bankroll portability', () => {
  it('defaults to a 2.2 SOL reference bankroll', () => {
    expect(DEFAULT_REFERENCE_BANKROLL_SOL).toBe('2.2');
  });

  it('compares observed absolute sizes with the reference bankroll', () => {
    const p = calculatePortability(
      makeFingerprint({
        eligibleCycleCount: 6,
        medianFirstBuySol: '0.11',
        medianCycleCostSol: '0.18',
        p75CycleCostSol: '0.44',
        observedMaxConcurrentPositions: 3,
        medianConcurrentPositions: '2',
        completeHistory: true,
      }),
      2.2,
    );
    expect(p.medianFirstBuyPctOfBankroll).toBeCloseTo(5, 6); // 0.11 / 2.2
    expect(p.medianCyclePctOfBankroll).toBeCloseTo(8.181818, 4);
    expect(p.p75CyclePctOfBankroll).toBeCloseTo(20, 6);
    expect(p.onePositionPctOfBankroll).toBeCloseTo(8.181818, 4);
    expect(p.twoPositionsPctOfBankroll).toBeCloseTo(16.363636, 4);
    // Three median-sized simultaneous positions: 0.18 × 3 = 0.54 SOL of 2.2.
    expect(p.maxConcurrencyPctOfBankroll).toBeCloseTo(24.545454, 4);
    expect(p.medianConcurrentCapitalSol).toBeCloseTo(0.36, 6);
    expect(p.states).toContain('SUFFICIENT_SAMPLE');
  });

  it('illustrates that fixed per-transaction fees cost more at smaller positions', () => {
    const p = calculatePortability(
      makeFingerprint({ eligibleCycleCount: 8, medianFeePerCycleSol: '0.006', completeHistory: true }),
      2.2,
    );
    const atFivePct = p.feeIllustrations.find((f) => f.share === 0.05);
    const atTwentyFivePct = p.feeIllustrations.find((f) => f.share === 0.25);
    // 0.006 SOL of fees is 5.45% of a 0.11 SOL position but 1.09% of a 0.55 SOL one.
    expect(atFivePct?.positionSol).toBeCloseTo(0.11, 6);
    expect(atFivePct?.feeBurdenPct).toBeCloseTo(5.4545, 3);
    expect(atTwentyFivePct?.feeBurdenPct).toBeCloseTo(1.0909, 3);
    expect(p.states).toContain('COST_SENSITIVE');
  });

  it('flags multi-leg cost sensitivity and capital intensity', () => {
    const p = calculatePortability(
      makeFingerprint({
        eligibleCycleCount: 9,
        medianLegsPerCycle: '4',
        medianCycleCostSol: '0.9',
        observedMaxConcurrentPositions: 3,
        completeHistory: true,
      }),
      2.2,
    );
    expect(p.states).toContain('MULTI_LEG_COST_SENSITIVE');
    expect(p.states).toContain('CAPITAL_INTENSIVE'); // 0.9 × 3 = 2.7 SOL > 2.2 SOL
  });

  it('calls a single-entry, single-exit structure structurally simple', () => {
    const p = calculatePortability(
      makeFingerprint({
        eligibleCycleCount: 7,
        medianBuysPerCycle: '1',
        medianSellsPerCycle: '1',
        medianCycleCostSol: '0.05',
        completeHistory: true,
      }),
      2.2,
    );
    expect(p.states).toContain('STRUCTURALLY_SIMPLE');
    expect(p.states).not.toContain('CAPITAL_INTENSIVE');
  });

  it('reports a limited sample, incomplete evidence and the not-historical-bankroll warning', () => {
    const p = calculatePortability(
      makeFingerprint({ eligibleCycleCount: 2, completeHistory: false }),
      2.2,
    );
    expect(p.states).toContain('LIMITED_SAMPLE');
    expect(p.states).toContain('INCOMPLETE_EVIDENCE');
    expect(p.warningCodes).toContain('PORTABILITY_SAMPLE_TOO_SMALL');
    expect(p.warningCodes).toContain('CURRENT_BALANCE_NOT_HISTORICAL');
  });

  it('is unavailable without a fingerprint, cycles or a positive bankroll', () => {
    expect(calculatePortability(null, 2.2).states).toEqual(['UNAVAILABLE']);
    expect(calculatePortability(makeFingerprint({ eligibleCycleCount: 0 }), 2.2).states).toEqual(['UNAVAILABLE']);
    expect(calculatePortability(makeFingerprint({ eligibleCycleCount: 5 }), 0).states).toEqual(['UNAVAILABLE']);
    expect(calculatePortability(makeFingerprint({ eligibleCycleCount: 5 }), null).states).toEqual(['UNAVAILABLE']);
  });

  it('never recommends a size, a copy decision or a trade', () => {
    const banned = /recommend|safe size|use \d|copyable|not copyable|follow this|buy now|sell now|should/i;
    for (const text of Object.values(PORTABILITY_STATE_TEXT)) {
      expect(text).not.toMatch(banned);
    }
  });
});
