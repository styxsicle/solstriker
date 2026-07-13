/**
 * One-click Focus Wallet Preparation.
 *
 * A user-triggered orchestration that runs the existing research pipeline, in
 * order, for 1–5 explicitly selected wallets: synchronize activity, reconstruct
 * positions, analyze quality, generate a strategy fingerprint. It is a manual
 * preparation workflow, not background monitoring — it never runs on its own,
 * never touches wallets the user did not select, and never fabricates a result
 * for a stage that has no eligible evidence.
 *
 * Every stage reuses the existing service function (`syncWallet`,
 * `reconstructWallets`, `analyzeWallets`, `analyzeStrategies`) rather than
 * duplicating their financial calculations or calling their HTTP routes.
 */
import type { PrismaClient, TrackedWallet } from '@prisma/client';
import type { SolanaActivityProvider } from '../../providers/solana/provider.js';
import { syncWallet, type SyncWalletOptions } from '../activity/syncWallet.js';
import {
  reconstructWallets,
  releaseReconstructionLock,
  tryAcquireReconstructionLock,
} from '../walletPositions/reconstructWallets.js';
import { analyzeWallets, releaseQualityLock, tryAcquireQualityLock } from '../walletQuality/analyzeWallets.js';
import {
  analyzeStrategies,
  releaseStrategyLock,
  tryAcquireStrategyLock,
} from '../walletStrategies/analyzeStrategies.js';
import {
  latestCompletedFingerprintForWallet,
  latestCompletedQualityForWallet,
  latestCompletedReconstructionForWallet,
  reconstructionCoverage,
} from '../walletResearch/currentness.js';

export const MAX_FOCUS_PREPARE_WALLETS = 5;
export const DEFAULT_SYNC_TRANSACTION_LIMIT = 500;

export type PrepareStageStatus = 'NOT_STARTED' | 'RUNNING' | 'COMPLETED' | 'SKIPPED' | 'FAILED';

export interface SyncStageResult {
  status: PrepareStageStatus;
  reason: string | null;
  error: string | null;
  transactionsProcessed: number | null;
  eventsCreated: number | null;
  duplicateEvents: number | null;
  tokensDiscovered: number | null;
  backfillComplete: boolean | null;
}
export interface ReconstructionStageResult {
  status: PrepareStageStatus;
  reason: string | null;
  error: string | null;
  reconstructionRunId: string | null;
  positionsCreated: number | null;
  matchesCreated: number | null;
  warningCodes: string[];
}
export interface QualityStageResult {
  status: PrepareStageStatus;
  reason: string | null;
  error: string | null;
  qualityMetricSetId: string | null;
  eligiblePositions: number | null;
  excludedPositions: number | null;
  warningCodes: string[];
}
export interface FingerprintStageResult {
  status: PrepareStageStatus;
  reason: string | null;
  error: string | null;
  fingerprintId: string | null;
  eligibleCycleCount: number | null;
  excludedCycleCount: number | null;
  descriptorCodes: string[];
  warningCodes: string[];
}
export interface PrepareWalletResult {
  walletId: string;
  address: string;
  label: string | null;
  storedEventCountBefore: number;
  storedEventCountAfter: number;
  backfillComplete: boolean;
  sync: SyncStageResult;
  reconstruction: ReconstructionStageResult;
  quality: QualityStageResult;
  fingerprint: FingerprintStageResult;
  warningCodes: string[];
  sanitizedError: string | null;
}
export interface PrepareBatchResult {
  requestedWallets: number;
  processedWallets: number;
  failures: number;
  results: PrepareWalletResult[];
}

export interface PrepareOptions {
  syncTransactionLimit: number;
  continueHistoricalSync: boolean;
  forceRefresh: boolean;
}
export interface PrepareDeps {
  prisma: PrismaClient;
  provider: SolanaActivityProvider;
  /** Overrides for tests (e.g. pauseMs: 0). */
  syncOptions?: Partial<SyncWalletOptions>;
}

const blankStage = <T extends { status: PrepareStageStatus; reason: string | null; error: string | null }>(
  extra: Omit<T, 'status' | 'reason' | 'error'>,
): T => ({ status: 'NOT_STARTED', reason: null, error: null, ...extra }) as T;

async function prepareOneWallet(
  deps: PrepareDeps,
  wallet: TrackedWallet,
  options: PrepareOptions,
): Promise<PrepareWalletResult> {
  const { prisma, provider } = deps;
  let storedEventCountBefore = 0;
  let storedEventCountAfter = 0;
  let backfillComplete = false;

  const sync = blankStage<SyncStageResult>({
    transactionsProcessed: null,
    eventsCreated: null,
    duplicateEvents: null,
    tokensDiscovered: null,
    backfillComplete: null,
  });
  const reconstruction = blankStage<ReconstructionStageResult>({
    reconstructionRunId: null,
    positionsCreated: null,
    matchesCreated: null,
    warningCodes: [],
  });
  const quality = blankStage<QualityStageResult>({
    qualityMetricSetId: null,
    eligiblePositions: null,
    excludedPositions: null,
    warningCodes: [],
  });
  const fingerprint = blankStage<FingerprintStageResult>({
    fingerprintId: null,
    eligibleCycleCount: null,
    excludedCycleCount: null,
    descriptorCodes: [],
    warningCodes: [],
  });

  try {
    storedEventCountBefore = await prisma.walletEvent.count({ where: { walletId: wallet.id } });
    storedEventCountAfter = storedEventCountBefore;

    // --- Stage 1: synchronize activity ---
    // Once a wallet's backfill is fully complete, re-checking for brand-new
    // activity on every prepare click would mean a provider call every time,
    // for a wallet that usually has nothing new. "Continue older history"
    // (continueHistoricalSync) is the user's explicit signal that it's worth
    // checking again; forceRefresh always checks regardless. A wallet with an
    // incomplete backfill (or none yet) always attempts sync — there is
    // always more to fetch there.
    const existingSyncState = await prisma.walletSyncState.findUnique({ where: { walletId: wallet.id } });
    const alreadyCurrent =
      Boolean(existingSyncState?.backfillComplete) && !options.forceRefresh && !options.continueHistoricalSync;
    if (alreadyCurrent) {
      sync.status = 'SKIPPED';
      sync.reason = 'already_current';
      sync.backfillComplete = existingSyncState?.backfillComplete ?? null;
    } else if (!provider.isConfigured()) {
      sync.status = 'FAILED';
      sync.reason = 'provider_not_configured';
      sync.error = 'provider_not_configured';
    } else {
      const result = await syncWallet(
        { prisma, provider },
        { id: wallet.id, address: wallet.address },
        { maxTransactions: options.syncTransactionLimit, resetBeforeSync: false, ...deps.syncOptions },
      );
      if (result.status === 'ok') {
        sync.status = 'COMPLETED';
        sync.transactionsProcessed = result.transactionsProcessed;
        sync.eventsCreated = result.eventsCreated;
        sync.duplicateEvents = result.duplicateEvents;
        sync.tokensDiscovered = result.tokensDiscovered;
        sync.backfillComplete = result.backfillComplete;
      } else {
        sync.status = 'FAILED';
        sync.reason = result.status === 'locked' ? 'sync_in_progress' : 'sync_failed';
        sync.error = result.status === 'locked' ? 'sync_in_progress' : (result.error ?? 'sync_error');
      }
    }

    storedEventCountAfter = await prisma.walletEvent.count({ where: { walletId: wallet.id } });
    const currentSyncState = await prisma.walletSyncState.findUnique({ where: { walletId: wallet.id } });
    backfillComplete = currentSyncState?.backfillComplete ?? false;

    // --- Stage 2: reconstruct positions (only after a successful/skipped sync) ---
    if (sync.status === 'FAILED') {
      reconstruction.reason = 'sync_failed';
    } else {
      const existing = await latestCompletedReconstructionForWallet(prisma, wallet.id);
      const covered = existing ? await reconstructionCoverage(prisma, wallet.id, existing.reconstructionRunId) : 0;
      // Skip only when a completed run already accounts for every currently
      // stored event — i.e. it already represents the newest synchronized data.
      if (existing && !options.forceRefresh && covered === storedEventCountAfter) {
        reconstruction.status = 'SKIPPED';
        reconstruction.reason = 'reconstruction_current';
        reconstruction.reconstructionRunId = existing.reconstructionRunId;
      } else if (!tryAcquireReconstructionLock()) {
        reconstruction.status = 'FAILED';
        reconstruction.reason = 'reconstruction_in_progress';
        reconstruction.error = 'reconstruction_in_progress';
      } else {
        try {
          const runResult = await reconstructWallets(prisma, [wallet]);
          const walletResult = runResult.results.find(
            (r) => (r as { walletId: string }).walletId === wallet.id,
          ) as
            | { status: string; positionsCreated?: number; matchesCreated?: number; warningCodes?: string[] }
            | undefined;
          if (walletResult?.status === 'ok') {
            reconstruction.status = 'COMPLETED';
            reconstruction.reconstructionRunId = runResult.runId;
            reconstruction.positionsCreated = walletResult.positionsCreated ?? 0;
            reconstruction.matchesCreated = walletResult.matchesCreated ?? 0;
            reconstruction.warningCodes = walletResult.warningCodes ?? [];
          } else {
            reconstruction.status = 'FAILED';
            reconstruction.reason = 'reconstruction_failed';
            reconstruction.error = 'reconstruction_failed';
          }
        } finally {
          releaseReconstructionLock();
        }
      }
    }

    // --- Stage 3: analyze wallet quality (only after a valid reconstruction) ---
    if (reconstruction.status === 'NOT_STARTED' || reconstruction.status === 'FAILED') {
      quality.reason = reconstruction.status === 'FAILED' ? 'reconstruction_failed' : 'reconstruction_required';
    } else {
      const existing = await latestCompletedQualityForWallet(prisma, wallet.id);
      if (existing && !options.forceRefresh && existing.reconstructionRunId === reconstruction.reconstructionRunId) {
        quality.status = 'SKIPPED';
        quality.reason = 'quality_current';
        quality.qualityMetricSetId = existing.id;
      } else if (!tryAcquireQualityLock()) {
        quality.status = 'FAILED';
        quality.reason = 'quality_in_progress';
        quality.error = 'quality_in_progress';
      } else {
        try {
          const runResult = await analyzeWallets(prisma, [wallet]);
          const walletResult = runResult.results.find(
            (r) => (r as { walletId: string }).walletId === wallet.id,
          ) as
            | {
                status: string;
                metricSetId?: string;
                eligiblePositions?: number;
                excludedPositions?: number;
                warningCodes?: string[];
              }
            | undefined;
          if (walletResult?.status === 'ok') {
            quality.status = 'COMPLETED';
            quality.qualityMetricSetId = walletResult.metricSetId ?? null;
            quality.eligiblePositions = walletResult.eligiblePositions ?? 0;
            quality.excludedPositions = walletResult.excludedPositions ?? 0;
            quality.warningCodes = walletResult.warningCodes ?? [];
          } else {
            quality.status = 'FAILED';
            quality.reason = 'quality_failed';
            quality.error = 'quality_failed';
          }
        } finally {
          releaseQualityLock();
        }
      }
    }

    // --- Stage 4: generate strategy fingerprint (only after a valid reconstruction) ---
    if (reconstruction.status === 'NOT_STARTED' || reconstruction.status === 'FAILED') {
      fingerprint.reason = reconstruction.status === 'FAILED' ? 'reconstruction_failed' : 'reconstruction_required';
    } else {
      const existing = await latestCompletedFingerprintForWallet(prisma, wallet.id);
      const currentQualityId =
        quality.status === 'SKIPPED' || quality.status === 'COMPLETED' ? quality.qualityMetricSetId : null;
      const stillMatches =
        existing !== null &&
        existing.reconstructionRunId === reconstruction.reconstructionRunId &&
        (existing.qualityMetricSetId ?? null) === currentQualityId;
      if (existing && !options.forceRefresh && stillMatches) {
        fingerprint.status = 'SKIPPED';
        fingerprint.reason = 'fingerprint_current';
        fingerprint.fingerprintId = existing.id;
      } else if (!tryAcquireStrategyLock()) {
        fingerprint.status = 'FAILED';
        fingerprint.reason = 'fingerprint_in_progress';
        fingerprint.error = 'fingerprint_in_progress';
      } else {
        try {
          const runResult = await analyzeStrategies(prisma, [wallet]);
          const walletResult = runResult.results.find(
            (r) => (r as { walletId: string }).walletId === wallet.id,
          ) as
            | {
                status: string;
                fingerprintId?: string;
                eligibleCycles?: number;
                excludedCycles?: number;
                descriptorCodes?: string[];
                warningCodes?: string[];
              }
            | undefined;
          if (walletResult?.status === 'ok') {
            fingerprint.status = 'COMPLETED';
            fingerprint.fingerprintId = walletResult.fingerprintId ?? null;
            fingerprint.eligibleCycleCount = walletResult.eligibleCycles ?? 0;
            fingerprint.excludedCycleCount = walletResult.excludedCycles ?? 0;
            fingerprint.descriptorCodes = walletResult.descriptorCodes ?? [];
            fingerprint.warningCodes = walletResult.warningCodes ?? [];
          } else {
            fingerprint.status = 'FAILED';
            fingerprint.reason = 'fingerprint_failed';
            fingerprint.error = 'fingerprint_failed';
          }
        } finally {
          releaseStrategyLock();
        }
      }
    }

    const warningCodes = [
      ...new Set([...reconstruction.warningCodes, ...quality.warningCodes, ...fingerprint.warningCodes]),
    ].sort();
    const sanitizedError =
      [sync, reconstruction, quality, fingerprint].find((stage) => stage.status === 'FAILED')?.error ?? null;

    return {
      walletId: wallet.id,
      address: wallet.address,
      label: wallet.label,
      storedEventCountBefore,
      storedEventCountAfter,
      backfillComplete,
      sync,
      reconstruction,
      quality,
      fingerprint,
      warningCodes,
      sanitizedError,
    };
  } catch {
    // Isolated, sanitized failure: never leaks paths/keys, never aborts other wallets.
    if (sync.status === 'NOT_STARTED') {
      sync.status = 'FAILED';
      sync.reason = 'unexpected_error';
      sync.error = 'unexpected_error';
    }
    return {
      walletId: wallet.id,
      address: wallet.address,
      label: wallet.label,
      storedEventCountBefore,
      storedEventCountAfter,
      backfillComplete,
      sync,
      reconstruction,
      quality,
      fingerprint,
      warningCodes: [],
      sanitizedError: 'unexpected_error',
    };
  }
}

function unexpectedFailureResult(wallet: TrackedWallet): PrepareWalletResult {
  return {
    walletId: wallet.id,
    address: wallet.address,
    label: wallet.label,
    storedEventCountBefore: 0,
    storedEventCountAfter: 0,
    backfillComplete: false,
    sync: { ...blankStage<SyncStageResult>({ transactionsProcessed: null, eventsCreated: null, duplicateEvents: null, tokensDiscovered: null, backfillComplete: null }), status: 'FAILED', reason: 'unexpected_error', error: 'unexpected_error' },
    reconstruction: blankStage<ReconstructionStageResult>({ reconstructionRunId: null, positionsCreated: null, matchesCreated: null, warningCodes: [] }),
    quality: blankStage<QualityStageResult>({ qualityMetricSetId: null, eligiblePositions: null, excludedPositions: null, warningCodes: [] }),
    fingerprint: blankStage<FingerprintStageResult>({ fingerprintId: null, eligibleCycleCount: null, excludedCycleCount: null, descriptorCodes: [], warningCodes: [] }),
    warningCodes: [],
    sanitizedError: 'unexpected_error',
  };
}

/**
 * Processes wallets sequentially — conservative load on the activity provider.
 * A defense-in-depth catch wraps each wallet's call so that even an entirely
 * unexpected failure (outside prepareOneWallet's own try/catch) can never
 * abort the remaining wallets in the batch.
 */
export async function prepareFocusWallets(
  deps: PrepareDeps,
  wallets: TrackedWallet[],
  options: PrepareOptions,
): Promise<PrepareBatchResult> {
  const results: PrepareWalletResult[] = [];
  let failures = 0;
  for (const wallet of wallets) {
    let result: PrepareWalletResult;
    try {
      result = await prepareOneWallet(deps, wallet, options);
    } catch {
      result = unexpectedFailureResult(wallet);
    }
    if (result.sanitizedError) failures += 1;
    results.push(result);
  }
  return { requestedWallets: wallets.length, processedWallets: results.length, failures, results };
}
