/**
 * Phase 2C-A — bounded, explicit strategy-fingerprint analysis.
 *
 * Reads only already-stored evidence: the wallet's LATEST COMPLETED FIFO
 * reconstruction, its behavior profile, and (when it exists) its latest
 * completed quality metric set. It never synchronizes a wallet, never
 * re-decodes activity, never reconstructs positions, never runs quality
 * analysis and never fetches market data. Wallets are processed in isolation,
 * so one failure cannot abort the others.
 */
import type { PrismaClient, TrackedWallet } from '@prisma/client';
import { latestCompletedRunByWallet } from '../walletPositions/latestRuns.js';
import { latestQualityMetricSetByWallet } from '../walletQuality/latestRuns.js';
import { calculateFingerprint, STRATEGY_CALCULATION_VERSION, type CycleInput } from './fingerprint.js';
import { STRATEGY_WARNINGS as W } from './warnings.js';

export const MAX_STRATEGY_WALLETS = 10;
/** Bounded work: one analysis at a time, in-process. */
let locked = false;
export const tryAcquireStrategyLock = () => (locked ? false : (locked = true));
export const releaseStrategyLock = () => {
  locked = false;
};

function parseIds(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function analyzeStrategies(prisma: PrismaClient, wallets: TrackedWallet[]) {
  const run = await prisma.walletStrategyFingerprintRun.create({
    data: {
      calculationVersion: STRATEGY_CALCULATION_VERSION,
      requestedWalletCount: wallets.length,
    },
  });
  const [latestReconstruction, latestQuality] = await Promise.all([
    latestCompletedRunByWallet(prisma),
    latestQualityMetricSetByWallet(prisma),
  ]);

  let processed = 0;
  let fingerprintCount = 0;
  let patternCount = 0;
  let eligibleTotal = 0;
  let excludedTotal = 0;
  let warningTotal = 0;
  let failures = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const wallet of wallets) {
    try {
      const reconstructionRunId = latestReconstruction.get(wallet.id);
      if (!reconstructionRunId) {
        failures += 1;
        results.push({
          walletId: wallet.id,
          status: 'error',
          error: 'reconstruction_required',
          warningCodes: [W.NO_COMPLETED_RECONSTRUCTION],
        });
        continue;
      }

      const [positions, profile] = await Promise.all([
        prisma.walletPosition.findMany({
          where: { trackedWalletId: wallet.id, reconstructionRunId },
          orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
        }),
        prisma.walletBehaviorProfile.findFirst({
          where: { trackedWalletId: wallet.id, reconstructionRunId },
        }),
      ]);

      const eventIds = [...new Set(positions.flatMap((p) => parseIds(p.includedEventIdsJson)))];
      const events = await prisma.walletEvent.findMany({ where: { id: { in: eventIds } } });
      const eventById = new Map(events.map((event) => [event.id, event]));
      const inputs: CycleInput[] = positions.map((position) => ({
        position,
        events: parseIds(position.includedEventIdsJson).flatMap((id) => {
          const event = eventById.get(id);
          return event ? [event] : [];
        }),
      }));

      const qualityMetricSetId = latestQuality.get(wallet.id) ?? null;
      const result = calculateFingerprint(inputs, {
        completeHistory: profile?.completeHistory ?? false,
        hasQualityMetrics: qualityMetricSetId !== null,
      });
      const { status, confidence, ...metrics } = result.fields;

      const fingerprint = await prisma.walletStrategyFingerprint.create({
        data: {
          runId: run.id,
          trackedWalletId: wallet.id,
          reconstructionRunId,
          qualityMetricSetId,
          calculationVersion: STRATEGY_CALCULATION_VERSION,
          status: status as string,
          confidence: confidence as string,
          ...(metrics as Record<string, never>),
          descriptorCodes: JSON.stringify(result.descriptors),
          descriptorEvidenceJson: JSON.stringify(result.evidence),
          warningCodes: JSON.stringify(result.warnings),
        },
      });

      for (const pattern of result.patterns) {
        await prisma.walletStrategyPatternMetric.create({
          data: {
            fingerprintId: fingerprint.id,
            patternType: pattern.patternType,
            patternValue: pattern.patternValue,
            sortOrder: pattern.sortOrder,
            totalCount: pattern.totalCount,
            eligibleCount: pattern.eligibleCount,
            excludedCount: pattern.excludedCount,
            percentage: pattern.percentage,
            medianSizeSol: pattern.medianSizeSol,
            medianDurationSeconds: pattern.medianDurationSeconds,
            medianRawResultSol: pattern.medianRawResultSol,
            confidence: pattern.confidence,
            warningCodes: JSON.stringify(pattern.warningCodes),
          },
        });
      }

      processed += 1;
      fingerprintCount += 1;
      patternCount += result.patterns.length;
      eligibleTotal += result.eligibleCycleCount;
      excludedTotal += result.excludedCycleCount;
      warningTotal += result.warnings.length;
      results.push({
        walletId: wallet.id,
        status: 'ok',
        fingerprintId: fingerprint.id,
        reconstructionRunId,
        qualityMetricSetId,
        eligibleCycles: result.eligibleCycleCount,
        excludedCycles: result.excludedCycleCount,
        patternsCreated: result.patterns.length,
        descriptorCodes: result.descriptors,
        warningCodes: result.warnings,
      });
    } catch {
      // Sanitized: internal errors never leak paths, keys or provider details.
      failures += 1;
      results.push({
        walletId: wallet.id,
        status: 'error',
        error: 'fingerprint_failed',
        warningCodes: [],
      });
    }
  }

  const status = failures === 0 ? 'COMPLETED' : processed ? 'PARTIAL' : 'FAILED';
  await prisma.walletStrategyFingerprintRun.update({
    where: { id: run.id },
    data: {
      status,
      completedAt: new Date(),
      processedWalletCount: processed,
      fingerprintCount,
      patternCount,
      eligibleCycleCount: eligibleTotal,
      excludedCycleCount: excludedTotal,
      warningCount: warningTotal,
      errorCount: failures,
      sanitizedErrorSummary: failures ? 'strategy_fingerprint_failed' : null,
    },
  });

  return {
    runId: run.id,
    calculationVersion: STRATEGY_CALCULATION_VERSION,
    status,
    requestedWallets: wallets.length,
    processedWallets: processed,
    fingerprintsCreated: fingerprintCount,
    patternsCreated: patternCount,
    eligibleCycles: eligibleTotal,
    excludedCycles: excludedTotal,
    warnings: warningTotal,
    failures,
    results,
  };
}
