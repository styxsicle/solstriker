/**
 * Strategy-fingerprint calculation — pure, deterministic, offline.
 * All wallets, tokens and events here are synthetic.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculateFingerprint,
  feeBucket,
  knownEventFees,
  maxConcurrent,
  shapeCycle,
  sizeBucket,
  timeBucket,
} from '../../src/services/walletStrategies/fingerprint.js';
import { STRATEGY_DESCRIPTORS as DESC } from '../../src/services/walletStrategies/descriptors.js';
import { STRATEGY_WARNINGS as W } from '../../src/services/walletStrategies/warnings.js';
import { D } from '../../src/services/walletPositions/math.js';
import { makeCycle, makeEvent, resetIds, simpleCycles } from './fixtures.js';

const options = { completeHistory: true, hasQualityMetrics: true };
const field = (result: ReturnType<typeof calculateFingerprint>, key: string) => result.fields[key];
const pattern = (result: ReturnType<typeof calculateFingerprint>, type: string, value: string) =>
  result.patterns.find((p) => p.patternType === type && p.patternValue === value);
const evidence = (result: ReturnType<typeof calculateFingerprint>, code: string) =>
  result.evidence.find((e) => e.code === code);

beforeEach(() => resetIds());

describe('entry structure', () => {
  it('separates one-buy, two-buy and scale-in cycles and reports exact shares', () => {
    const cycles = [
      makeCycle({ tokenId: 't1', buys: [{ at: 0, sol: 0.2, tokens: 100 }] }, 1),
      makeCycle({ tokenId: 't2', buys: [{ at: 0, sol: 0.2, tokens: 100 }] }, 2),
      makeCycle({ tokenId: 't3', buys: [{ at: 0, sol: 0.2, tokens: 100 }] }, 3),
      makeCycle(
        { tokenId: 't4', buys: [{ at: 0, sol: 0.2, tokens: 100 }, { at: 74, sol: 0.1, tokens: 50 }] },
        4,
      ),
      makeCycle(
        {
          tokenId: 't5',
          buys: [
            { at: 0, sol: 0.2, tokens: 100 },
            { at: 100, sol: 0.1, tokens: 50 },
            { at: 300, sol: 0.1, tokens: 50 },
          ],
        },
        5,
      ),
    ];
    const result = calculateFingerprint(cycles, options);

    expect(field(result, 'eligibleCycleCount')).toBe(5);
    expect(field(result, 'eligibleBuyCount')).toBe(8); // 1 + 1 + 1 + 2 + 3
    expect(field(result, 'singleBuyCycleCount')).toBe(3);
    expect(field(result, 'twoBuyCycleCount')).toBe(1);
    expect(field(result, 'multiBuyCycleCount')).toBe(1);
    expect(field(result, 'medianBuysPerCycle')).toBe('1');
    expect(field(result, 'meanBuysPerCycle')).toBe('1.6'); // 8 buys ÷ 5 cycles
    expect(field(result, 'p75BuysPerCycle')).toBe('2');
    expect(pattern(result, 'ENTRY_COUNT', '1 buy')?.percentage).toBe('60');
    expect(pattern(result, 'ENTRY_COUNT', '2 buys')?.percentage).toBe('20');
    expect(pattern(result, 'ENTRY_COUNT', '3 or more buys')?.percentage).toBe('20');
  });

  it('measures first-to-second buy delay and later scale-in gaps in seconds', () => {
    const result = calculateFingerprint(
      [
        makeCycle(
          { tokenId: 't1', buys: [{ at: 0, sol: 0.2, tokens: 100 }, { at: 74, sol: 0.1, tokens: 50 }] },
          1,
        ),
        makeCycle(
          {
            tokenId: 't2',
            buys: [
              { at: 0, sol: 0.2, tokens: 100 },
              { at: 120, sol: 0.1, tokens: 50 },
              { at: 320, sol: 0.1, tokens: 50 },
            ],
          },
          2,
        ),
      ],
      options,
    );
    expect(field(result, 'medianFirstToSecondBuySeconds')).toBe('97'); // (74 + 120) / 2
    expect(field(result, 'medianLaterBuyGapSeconds')).toBe('200');
    expect(pattern(result, 'ENTRY_TIMING', '1–5 minutes')?.eligibleCount).toBe(2);
  });

  it('computes first-buy and largest-buy cost shares with exact decimals', () => {
    const result = calculateFingerprint(
      [
        makeCycle(
          { tokenId: 't1', buys: [{ at: 0, sol: '0.1', tokens: 100 }, { at: 60, sol: '0.3', tokens: 300 }] },
          1,
        ),
      ],
      options,
    );
    // 0.1 + 0.3 = exactly 0.4 — no binary-float drift.
    expect(field(result, 'medianCycleCostSol')).toBe('0.4');
    expect(field(result, 'medianFirstBuySharePct')).toBe('25');
    expect(field(result, 'medianLargestBuySharePct')).toBe('75');
    expect(field(result, 'largestBuyFirstCycleCount')).toBe(0);
    expect(field(result, 'increasingSizeCycleCount')).toBe(1);
  });

  it('records when the largest buy was the first one', () => {
    const result = calculateFingerprint(
      [
        makeCycle(
          { tokenId: 't1', buys: [{ at: 0, sol: 1, tokens: 100 }, { at: 60, sol: 0.25, tokens: 20 }] },
          1,
        ),
      ],
      options,
    );
    expect(field(result, 'largestBuyFirstCycleCount')).toBe(1);
    expect(field(result, 'increasingSizeCycleCount')).toBe(0);
    expect(field(result, 'medianFirstBuySharePct')).toBe('80');
  });
});

describe('exit structure', () => {
  it('distinguishes single exits, scale-outs and partial first exits', () => {
    const cycles = [
      makeCycle(
        { tokenId: 't1', buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] },
        1,
      ),
      makeCycle(
        {
          tokenId: 't2',
          buys: [{ at: 0, sol: 0.2, tokens: 100 }],
          sells: [
            { at: 600, sol: 0.15, tokens: 58 },
            { at: 900, sol: 0.1, tokens: 42 },
          ],
        },
        2,
      ),
    ];
    const result = calculateFingerprint(cycles, options);
    expect(field(result, 'cyclesWithSellCount')).toBe(2);
    expect(field(result, 'singleSellCycleCount')).toBe(1);
    expect(field(result, 'twoSellCycleCount')).toBe(1);
    expect(field(result, 'medianSellsPerCycle')).toBe('1.5');
    expect(field(result, 'partialFirstExitCycleCount')).toBe(1);
    expect(field(result, 'fullyClosedCycleCount')).toBe(2);
    // The first sell of cycle 2 removed 58 of 100 observed tokens.
    expect(field(result, 'medianFirstSellInventoryPct')).toBe('79'); // (100 + 58) / 2
    expect(field(result, 'medianRemainingAfterFirstSellPct')).toBe('21');
    // Only cycles with two or more sells have a first-to-final-sell span; a
    // single-sell cycle is omitted rather than counted as zero seconds.
    expect(field(result, 'medianFirstSellToFinalSellSeconds')).toBe('300');
  });

  it('reports observed inventory left open without calling it a deliberate moonbag', () => {
    const result = calculateFingerprint(
      [
        makeCycle(
          {
            tokenId: 't1',
            buys: [{ at: 0, sol: 0.2, tokens: 100 }],
            sells: [{ at: 600, sol: 0.2, tokens: 60 }],
            openTokens: 40,
            status: 'PARTIAL',
          },
          1,
        ),
      ],
      options,
    );
    expect(field(result, 'openCycleCount')).toBe(1);
    expect(field(result, 'fullyClosedCycleCount')).toBe(0);
    expect(field(result, 'medianFirstSellInventoryPct')).toBe('60');
    expect(field(result, 'medianRemainingAfterFirstSellPct')).toBe('40');
    expect(field(result, 'partialFirstExitCycleCount')).toBe(1);
  });

  it('judges closure by observed inventory, not by the INCOMPLETE_HISTORY status label', () => {
    // A wallet with an incomplete backfill has every position stamped
    // INCOMPLETE_HISTORY, even when the cycle's inventory was entirely sold.
    // Those cycles must not be reported as inventory the wallet "left open".
    const soldOut = (n: number) =>
      makeCycle(
        {
          tokenId: `t${n}`,
          buys: [{ at: n * 1000, sol: 0.2, tokens: 100 }],
          sells: [{ at: n * 1000 + 600, sol: 0.3, tokens: 100 }],
          status: 'INCOMPLETE_HISTORY',
          openTokens: 0,
        },
        n,
      );
    const result = calculateFingerprint([1, 2, 3, 4, 5].map(soldOut), {
      completeHistory: false,
      hasQualityMetrics: true,
    });
    expect(field(result, 'fullyClosedCycleCount')).toBe(5);
    expect(field(result, 'openCycleCount')).toBe(0);
    expect(result.descriptors).not.toContain(DESC.OFTEN_LEAVES_INVENTORY_OPEN);
    expect(pattern(result, 'COMPLETENESS', 'Fully closed')?.eligibleCount).toBe(5);
  });

  it('measures first-buy-to-first-sell and last-buy-to-first-sell separately', () => {
    const result = calculateFingerprint(
      [
        makeCycle(
          {
            tokenId: 't1',
            buys: [{ at: 0, sol: 0.2, tokens: 100 }, { at: 300, sol: 0.2, tokens: 100 }],
            sells: [{ at: 900, sol: 0.5, tokens: 200 }],
          },
          1,
        ),
      ],
      options,
    );
    expect(field(result, 'medianFirstBuyToFirstSellSeconds')).toBe('900');
    expect(field(result, 'medianLastBuyToFirstSellSeconds')).toBe('600');
    expect(pattern(result, 'EXIT_TIMING', '15–30 minutes')?.eligibleCount).toBe(1); // 900s = 15 min
  });
});

describe('venue, router, size and holding patterns', () => {
  it('counts venues and routers factually without ranking them', () => {
    const result = calculateFingerprint(
      [
        makeCycle({ tokenId: 't1', buys: [{ at: 0, sol: 0.2, tokens: 100, venue: 'PUMP_AMM', router: 'AXIOM' }] }, 1),
        makeCycle({ tokenId: 't2', buys: [{ at: 10, sol: 0.4, tokens: 100, venue: 'PUMP_AMM', router: 'AXIOM' }] }, 2),
        makeCycle({ tokenId: 't3', buys: [{ at: 20, sol: 0.6, tokens: 100, venue: 'RAYDIUM', router: 'JUPITER' }] }, 3),
      ],
      options,
    );
    const pump = pattern(result, 'VENUE', 'PUMP_AMM');
    expect(pump?.eligibleCount).toBe(2);
    expect(pump?.percentage).toBe(D(2).div(3).mul(100).toFixed());
    expect(pump?.medianSizeSol).toBe('0.3');
    expect(pattern(result, 'VENUE', 'RAYDIUM')?.eligibleCount).toBe(1);
    expect(pattern(result, 'ROUTER', 'JUPITER')?.eligibleCount).toBe(1);
    expect(pattern(result, 'POSITION_SIZE', '0.10–0.25 SOL')?.eligibleCount).toBe(1);
    expect(pattern(result, 'POSITION_SIZE', '0.50–1.00 SOL')?.eligibleCount).toBe(1);
  });

  it('buckets durations neutrally and records observed concurrency', () => {
    expect(timeBucket(null)).toBe('Unknown/open');
    expect(timeBucket(59)).toBe('Under 1 minute');
    expect(timeBucket(60)).toBe('1–5 minutes');
    expect(timeBucket(1800)).toBe('30–60 minutes');
    expect(timeBucket(86400)).toBe('Over 24 hours');
    expect(sizeBucket(D('0.05'))).toBe('0.05–0.10 SOL');
    expect(sizeBucket(null)).toBe('Unknown');

    const overlapping = [
      makeCycle({ tokenId: 't1', buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 3600, sol: 0.3, tokens: 100 }] }, 1),
      makeCycle({ tokenId: 't2', buys: [{ at: 600, sol: 0.2, tokens: 100 }], sells: [{ at: 4000, sol: 0.3, tokens: 100 }] }, 2),
      makeCycle({ tokenId: 't3', buys: [{ at: 900, sol: 0.2, tokens: 100 }], sells: [{ at: 5000, sol: 0.3, tokens: 100 }] }, 3),
    ];
    const result = calculateFingerprint(overlapping, options);
    expect(maxConcurrent(overlapping.map(shapeCycle))).toBe(3);
    expect(field(result, 'observedMaxConcurrentPositions')).toBe(3);
    expect(field(result, 'medianConcurrentPositions')).toBe('2');
    expect(pattern(result, 'HOLDING_DURATION', '1–4 hours')?.eligibleCount).toBe(2);
  });
});

describe('fees', () => {
  it('excludes rent and the double-counted priority fee, and never assumes zero', () => {
    const event = makeEvent('BUY', { at: 0, sol: 0.2, tokens: 100, fees: 0.001 });
    // networkFee 0.001 + platform 0 + tip 0; rent 0.002 and priority are excluded.
    expect(knownEventFees(event)?.toFixed()).toBe('0.001');
    expect(knownEventFees({ ...event, networkFeeSol: null })).toBeNull();
  });

  it('computes fee burden, thresholds and coverage from known fees only', () => {
    const result = calculateFingerprint(
      [
        makeCycle(
          { tokenId: 't1', buys: [{ at: 0, sol: 1, tokens: 100, fees: 0.002 }], sells: [{ at: 600, sol: 1.2, tokens: 100, fees: 0.003 }] },
          1,
        ),
        makeCycle(
          { tokenId: 't2', buys: [{ at: 0, sol: 0.1, tokens: 100, fees: 0.004 }], sells: [{ at: 600, sol: 0.12, tokens: 100, fees: 0.004 }] },
          2,
        ),
      ],
      options,
    );
    expect(field(result, 'medianFeePerBuySol')).toBe('0.003');
    expect(field(result, 'medianFeePerCycleSol')).toBe('0.0065'); // (0.005 + 0.008) / 2
    // Cycle 1: 0.005/1 = 0.5%. Cycle 2: 0.008/0.1 = 8%.
    expect(field(result, 'medianFeeBurdenPct')).toBe('4.25');
    expect(field(result, 'feeBurdenOver1PctCount')).toBe(1);
    expect(field(result, 'feeBurdenOver5PctCount')).toBe(1);
    expect(field(result, 'feeBurdenOver10PctCount')).toBe(0);
    expect(field(result, 'feeCoveragePct')).toBe('100');
    expect(pattern(result, 'FEE_BURDEN', 'Under 1%')?.eligibleCount).toBe(1);
    expect(pattern(result, 'FEE_BURDEN', '5–10%')?.eligibleCount).toBe(1);
    expect(feeBucket(null)).toBe('Unknown');
  });

  it('keeps missing fees unknown rather than zero and warns', () => {
    const result = calculateFingerprint(
      [
        makeCycle({ tokenId: 't1', buys: [{ at: 0, sol: 1, tokens: 100, fees: null }] }, 1),
        makeCycle({ tokenId: 't2', buys: [{ at: 0, sol: 1, tokens: 100, fees: 0.002 }] }, 2),
      ],
      options,
    );
    expect(field(result, 'missingFeeCycleCount')).toBe(1);
    expect(field(result, 'feeCoveragePct')).toBe('50');
    expect(field(result, 'medianFeePerCycleSol')).toBe('0.002'); // the unknown cycle is omitted, not zeroed
    expect(result.warnings).toContain(W.MISSING_FEES);
    expect(pattern(result, 'FEE_BURDEN', 'Unknown')?.eligibleCount).toBe(1);
  });

  it('flags multi-leg fee sensitivity from the median number of legs per cycle', () => {
    const result = calculateFingerprint(
      simpleCycles(5, {
        buys: [
          { at: 0, sol: 0.2, tokens: 100 },
          { at: 60, sol: 0.2, tokens: 100 },
        ],
        sells: [
          { at: 600, sol: 0.25, tokens: 100 },
          { at: 900, sol: 0.25, tokens: 100 },
        ],
      }),
      options,
    );
    expect(field(result, 'medianLegsPerCycle')).toBe('4');
    expect(result.warnings).toContain(W.MULTI_LEG_FEE_SENSITIVITY);
  });
});

describe('token repetition and evidence limits', () => {
  it('counts returns to the same token without implying they succeeded', () => {
    const result = calculateFingerprint(
      [
        makeCycle({ tokenId: 't1', buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] }, 1),
        makeCycle({ tokenId: 't1', buys: [{ at: 7200, sol: 0.2, tokens: 100 }], sells: [{ at: 8000, sol: 0.1, tokens: 100 }] }, 2),
        makeCycle({ tokenId: 't2', buys: [{ at: 20, sol: 0.2, tokens: 100 }] }, 3),
      ],
      options,
    );
    expect(field(result, 'distinctTokenCount')).toBe(2);
    expect(field(result, 'repeatedTokenCount')).toBe(1);
    expect(field(result, 'repeatedTokenCycleCount')).toBe(2);
    expect(field(result, 'maxCyclesPerToken')).toBe(2);
    expect(field(result, 'medianSecondsBetweenTokenCycles')).toBe('7200');
    expect(pattern(result, 'TOKEN_REPETITION', 'Token traded again')?.eligibleCount).toBe(2);
  });

  it('warns about transfers, unmatched sells, unknown basis and mixed confidence', () => {
    const result = calculateFingerprint(
      [
        makeCycle({ tokenId: 't1', buys: [{ at: 0, sol: 0.2, tokens: 100 }], transferIn: 50, unknownBasis: 50 }, 1),
        makeCycle({ tokenId: 't2', buys: [{ at: 0, sol: 0.2, tokens: 100, confidence: 'LIKELY' }], sells: [{ at: 600, sol: 0.3, tokens: 100, confidence: 'CONFIRMED' }], unmatchedSell: 10 }, 2),
      ],
      { completeHistory: false, hasQualityMetrics: false },
    );
    expect(field(result, 'transferAffectedCycleCount')).toBe(1);
    expect(field(result, 'unmatchedSellCount')).toBe(1);
    expect(field(result, 'unknownBasisCycleCount')).toBe(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        W.TRANSFER_AFFECTED_CYCLES,
        W.UNMATCHED_SELLS_PRESENT,
        W.UNKNOWN_BASIS,
        W.MIXED_EVENT_CONFIDENCE,
        W.INCOMPLETE_WALLET_HISTORY,
        W.NO_QUALITY_ANALYSIS,
      ]),
    );
    expect(result.descriptors).toContain(DESC.INCOMPLETE_HISTORY_SAMPLE);
    expect(result.descriptors).toContain(DESC.TRANSFER_AFFECTED_SAMPLE);
  });

  it('excludes cycles with no known buy cost and reports coverage', () => {
    const noBuy = (n: number) =>
      makeCycle({ tokenId: `t${n}`, buys: [], sells: [{ at: 600, sol: 0.3, tokens: 100 }], unmatchedSell: 100 }, n);
    const result = calculateFingerprint(
      [noBuy(1), noBuy(2), makeCycle({ tokenId: 't3', buys: [{ at: 0, sol: 0.2, tokens: 100 }] }, 3)],
      options,
    );
    expect(field(result, 'eligibleCycleCount')).toBe(1);
    expect(field(result, 'excludedCycleCount')).toBe(2);
    expect(field(result, 'eligibleCoveragePct')).toBe(D(1).div(3).mul(100).toFixed());
    expect(result.warnings).toContain(W.LOW_ELIGIBLE_COVERAGE); // fewer than half of the cycles were eligible
  });
});

describe('descriptors', () => {
  it('withholds structural descriptors below the minimum sample', () => {
    const result = calculateFingerprint(simpleCycles(4), options);
    expect(field(result, 'eligibleCycleCount')).toBe(4);
    expect(result.descriptors).toContain(DESC.INSUFFICIENT_ENTRY_SAMPLE);
    expect(result.descriptors).not.toContain(DESC.MOSTLY_SINGLE_ENTRY);
    expect(result.warnings).toContain(W.VERY_SMALL_CYCLE_SAMPLE);
    expect(field(result, 'confidence')).toBe('LOW');
    expect(evidence(result, DESC.INSUFFICIENT_ENTRY_SAMPLE)?.threshold).toBe('5');
  });

  it('emits MOSTLY_SINGLE_ENTRY exactly at the 60% threshold with its evidence', () => {
    const cycles = [
      ...simpleCycles(3),
      makeCycle({ tokenId: 'x1', buys: [{ at: 0, sol: 0.2, tokens: 100 }, { at: 60, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.5, tokens: 200 }] }, 4),
      makeCycle({ tokenId: 'x2', buys: [{ at: 0, sol: 0.2, tokens: 100 }, { at: 60, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.5, tokens: 200 }] }, 5),
    ];
    const result = calculateFingerprint(cycles, options);
    expect(result.descriptors).toContain(DESC.MOSTLY_SINGLE_ENTRY);
    expect(result.descriptors).toContain(DESC.FREQUENTLY_SCALES_IN); // 40% also reaches its own threshold
    const single = evidence(result, DESC.MOSTLY_SINGLE_ENTRY);
    expect(single).toMatchObject({ numerator: 3, denominator: 5, observed: '60', threshold: '60', sampleCount: 5 });
    expect(single?.formula).toContain('÷ eligible cycles');
    expect(evidence(result, DESC.FREQUENTLY_SCALES_IN)?.formula).toContain('observed scale-in behavior');
  });

  it('describes holds, venue concentration and fee sensitivity from thresholds', () => {
    const result = calculateFingerprint(
      simpleCycles(5, { buys: [{ at: 0, sol: 0.1, tokens: 100, fees: 0.002 }], sells: [{ at: 600, sol: 0.12, tokens: 100, fees: 0.002 }] }),
      options,
    );
    expect(result.descriptors).toContain(DESC.MOSTLY_SHORT_OBSERVED_HOLDS);
    expect(result.descriptors).toContain(DESC.VENUE_CONCENTRATED);
    expect(result.descriptors).toContain(DESC.MOSTLY_SINGLE_EXIT);
    expect(result.descriptors).toContain(DESC.POSITION_SIZES_CONCENTRATED);
    // 0.004 fees on a 0.1 SOL cycle = 4% burden, above the 1% sensitivity threshold.
    expect(result.descriptors).toContain(DESC.FEE_SENSITIVE_AT_SMALLER_BANKROLL);
    expect(evidence(result, DESC.FEE_SENSITIVE_AT_SMALLER_BANKROLL)?.observed).toBe('4');
    expect(evidence(result, DESC.VENUE_CONCENTRATED)).toMatchObject({ numerator: 5, denominator: 5, observed: '100' });
    expect(field(result, 'confidence')).toBe('MEDIUM');
    // No descriptor may ever be evaluative.
    const banned = /genius|elite|insider|sniper|whale|best|profitable|conviction/i;
    for (const item of result.evidence) {
      expect(item.code).not.toMatch(banned);
      expect(item.formula).not.toMatch(banned);
    }
  });

  it('describes longer holds and scale-outs when the evidence shows them', () => {
    const result = calculateFingerprint(
      simpleCycles(5, {
        buys: [{ at: 0, sol: 0.2, tokens: 100 }],
        sells: [
          { at: 20_000, sol: 0.2, tokens: 50 },
          { at: 30_000, sol: 0.2, tokens: 50 },
        ],
      }),
      options,
    );
    expect(result.descriptors).toContain(DESC.MOSTLY_LONGER_OBSERVED_HOLDS);
    expect(result.descriptors).toContain(DESC.FREQUENTLY_SCALES_OUT);
    expect(result.descriptors).not.toContain(DESC.MOSTLY_SHORT_OBSERVED_HOLDS);
    expect(field(result, 'medianFirstSellInventoryPct')).toBe('50');
  });

  it('reaches HIGH confidence only with a complete history and a large sample', () => {
    expect(field(calculateFingerprint(simpleCycles(20), options), 'confidence')).toBe('HIGH');
    expect(
      field(calculateFingerprint(simpleCycles(20), { completeHistory: false, hasQualityMetrics: true }), 'confidence'),
    ).toBe('MEDIUM');
  });

  it('marks an empty sample as insufficient evidence', () => {
    const result = calculateFingerprint([], options);
    expect(field(result, 'status')).toBe('INSUFFICIENT_EVIDENCE');
    expect(field(result, 'medianBuysPerCycle')).toBeNull();
    expect(result.patterns).toHaveLength(0);
  });
});
