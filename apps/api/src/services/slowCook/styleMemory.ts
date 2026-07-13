/**
 * Wallet Style Memory V1 — a deterministic, evidence-based description of how
 * a wallet has historically traded.
 *
 * This is NOT a trained model. It re-surfaces exact fields already computed
 * by the existing quality-analysis and strategy-fingerprint calculations
 * (Phase 2B / Phase 2C-A) — no new metric is invented here, and no
 * synchronization, reconstruction, or analysis is triggered. A wallet with no
 * current fingerprint simply has insufficient evidence; it is never guessed.
 */
import type { PrismaClient } from '@prisma/client';
import {
  isFingerprintCurrent,
  isQualityCurrent,
  isReconstructionCurrent,
  latestCompletedFingerprintForWallet,
  latestCompletedQualityForWallet,
  latestCompletedReconstructionForWallet,
  reconstructionCoverage,
} from '../walletResearch/currentness.js';
import { SMALL_CYCLE_THRESHOLD, VERY_SMALL_CYCLE_THRESHOLD } from '../walletStrategies/warnings.js';

export type EvidenceState = 'SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT';

export interface WalletStyleMemory {
  walletId: string;
  address: string;
  label: string | null;
  evidenceState: EvidenceState;
  /** Plain-language sentences describing the wallet's observed style. */
  summarySentences: string[];
  /** The fingerprint's own descriptor codes, reused as-is (never re-derived here). */
  styleTags: string[];
  metrics: {
    eligibleCycleCount: number | null;
    eligibleClosedCount: number | null;
    medianHoldingSeconds: string | null;
    medianBuysPerCycle: string | null;
    medianSellsPerCycle: string | null;
    fullyClosedCycleCount: number | null;
    openCycleCount: number | null;
    medianFirstSellInventoryPct: string | null;
    medianRemainingAfterFirstSellPct: string | null;
    medianPositionSizeSol: string | null;
    observedMaxConcurrentPositions: number | null;
    rawPositiveRatePct: string | null;
    medianRawRoiPct: string | null;
    largestGainContributionPct: string | null;
    transferAffectedCount: number | null;
    unmatchedSellCount: number | null;
    completeHistory: boolean | null;
  };
  ids: {
    reconstructionRunId: string | null;
    qualityMetricSetId: string | null;
    fingerprintId: string | null;
    fingerprintRunId: string | null;
    fingerprintCalculationVersion: number | null;
  };
}

function evidenceStateFor(eligibleCycleCount: number | null): EvidenceState {
  if (eligibleCycleCount === null) return 'INSUFFICIENT';
  if (eligibleCycleCount >= SMALL_CYCLE_THRESHOLD) return 'SUFFICIENT';
  if (eligibleCycleCount >= VERY_SMALL_CYCLE_THRESHOLD) return 'LIMITED';
  return 'INSUFFICIENT';
}

/** Builds plain-language sentences from the fingerprint's own descriptor codes and counts. */
function summarize(
  evidenceState: EvidenceState,
  descriptorCodes: string[],
  eligibleCycleCount: number,
): string[] {
  if (evidenceState === 'INSUFFICIENT') {
    return ['Not enough clean completed trades are available to describe this wallet reliably.'];
  }
  const sentences: string[] = [];
  const has = (code: string) => descriptorCodes.includes(code);

  if (has('MOSTLY_SHORT_OBSERVED_HOLDS')) sentences.push('Usually exits within a short time of entering.');
  else if (has('MOSTLY_LONGER_OBSERVED_HOLDS')) sentences.push('Usually holds for an extended time before exiting.');
  else if (has('MIXED_HOLDING_DURATIONS')) sentences.push('Holding duration varies from one position to the next.');

  if (has('FREQUENTLY_SCALES_IN')) sentences.push('Often adds to a position after the first buy.');
  else if (has('MOSTLY_SINGLE_ENTRY')) sentences.push('Usually enters in a single buy.');

  if (has('FREQUENTLY_SCALES_OUT')) sentences.push('Often exits in more than one sell.');
  else if (has('MOSTLY_SINGLE_EXIT')) sentences.push('Usually exits in a single sell.');

  if (has('OFTEN_LEAVES_INVENTORY_OPEN')) sentences.push('Often leaves part of the position open after the first sell.');

  if (!sentences.length) sentences.push('No single dominant pattern was observed in the eligible sample.');
  sentences.push(`Evidence is based on ${eligibleCycleCount} eligible completed position cycle(s).`);
  return sentences;
}

/**
 * Builds one Wallet Style Memory per requested wallet, strictly from already
 * stored, completed research. Never synchronizes, reconstructs, or analyzes;
 * never fetches provider data.
 */
export async function buildWalletStyleMemories(
  prisma: PrismaClient,
  walletIds: string[],
): Promise<WalletStyleMemory[]> {
  const memories: WalletStyleMemory[] = [];

  for (const walletId of walletIds) {
    const wallet = await prisma.trackedWallet.findUnique({ where: { id: walletId } });
    if (!wallet) continue;

    const [completedReconstruction, storedEventCount] = await Promise.all([
      latestCompletedReconstructionForWallet(prisma, walletId),
      prisma.walletEvent.count({ where: { walletId } }),
    ]);
    const coveredEventCount = completedReconstruction
      ? await reconstructionCoverage(prisma, walletId, completedReconstruction.reconstructionRunId)
      : null;
    const reconstructionCurrentRunId =
      completedReconstruction && coveredEventCount !== null && isReconstructionCurrent(coveredEventCount, storedEventCount)
        ? completedReconstruction.reconstructionRunId
        : null;

    const completedQuality = await latestCompletedQualityForWallet(prisma, walletId);
    const qualityCurrent = isQualityCurrent(completedQuality, reconstructionCurrentRunId);
    const currentQualityMetricSetId = qualityCurrent ? completedQuality!.id : null;

    const completedFingerprint = await latestCompletedFingerprintForWallet(prisma, walletId);
    const fingerprintCurrent = isFingerprintCurrent(
      completedFingerprint,
      reconstructionCurrentRunId,
      currentQualityMetricSetId,
    );

    const fp = fingerprintCurrent ? completedFingerprint : null;
    const quality = qualityCurrent ? completedQuality : null;
    const descriptorCodes: string[] = fp ? safeParseArray(fp.descriptorCodes) : [];
    const evidenceState = evidenceStateFor(fp?.eligibleCycleCount ?? null);

    memories.push({
      walletId: wallet.id,
      address: wallet.address,
      label: wallet.label,
      evidenceState,
      summarySentences: summarize(evidenceState, descriptorCodes, fp?.eligibleCycleCount ?? 0),
      styleTags: descriptorCodes,
      metrics: {
        eligibleCycleCount: fp?.eligibleCycleCount ?? null,
        eligibleClosedCount: quality?.eligibleClosedCount ?? null,
        medianHoldingSeconds: quality?.medianHoldingSeconds ?? null,
        medianBuysPerCycle: fp?.medianBuysPerCycle ?? null,
        medianSellsPerCycle: fp?.medianSellsPerCycle ?? null,
        fullyClosedCycleCount: fp?.fullyClosedCycleCount ?? null,
        openCycleCount: fp?.openCycleCount ?? null,
        medianFirstSellInventoryPct: fp?.medianFirstSellInventoryPct ?? null,
        medianRemainingAfterFirstSellPct: fp?.medianRemainingAfterFirstSellPct ?? null,
        medianPositionSizeSol: quality?.medianPositionSizeSol ?? null,
        observedMaxConcurrentPositions: fp?.observedMaxConcurrentPositions ?? null,
        rawPositiveRatePct: quality?.rawPositiveRatePct ?? null,
        medianRawRoiPct: quality?.medianRawRoiPct ?? null,
        largestGainContributionPct: quality?.largestGainContributionPct ?? null,
        transferAffectedCount: quality?.transferAffectedCount ?? null,
        unmatchedSellCount: quality?.unmatchedSellCount ?? null,
        completeHistory: fp?.completeHistory ?? quality?.completeHistory ?? null,
      },
      ids: {
        reconstructionRunId: reconstructionCurrentRunId,
        qualityMetricSetId: currentQualityMetricSetId,
        fingerprintId: fp?.id ?? null,
        fingerprintRunId: fp?.runId ?? null,
        fingerprintCalculationVersion: fp?.calculationVersion ?? null,
      },
    });
  }

  return memories;
}

function safeParseArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
