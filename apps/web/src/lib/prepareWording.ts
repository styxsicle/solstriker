/**
 * Readable status labels for the one-click Focus Wallet Preparation
 * progress cards. Neutral and factual: no ranking, no follow/copy wording,
 * no trade language, and no claim that a stage produced usable evidence
 * when it did not.
 */
import type {
  PrepareFingerprintStage,
  PrepareQualityStage,
  PrepareReconstructionStage,
  PrepareStageStatus,
  PrepareSyncStage,
} from '../api';

export type StageKind = 'sync' | 'reconstruction' | 'quality' | 'fingerprint';

const BUSY_LABEL: Record<StageKind, string> = {
  sync: 'Synchronizing',
  reconstruction: 'Reconstructing',
  quality: 'Analyzing quality evidence',
  fingerprint: 'Generating strategy fingerprint',
};

const COMPLETED_LABEL: Record<StageKind, string> = {
  sync: 'Synchronized',
  reconstruction: 'Reconstructed',
  quality: 'Quality evidence ready',
  fingerprint: 'Strategy fingerprint ready',
};

const INSUFFICIENT_REASONS = new Set([
  'sync_failed',
  'reconstruction_required',
  'reconstruction_failed',
  'provider_not_configured',
]);

interface MinimalStage {
  status: PrepareStageStatus;
  reason: string | null;
}

/**
 * `busy` is a frontend-local flag (true only while this stage's request is
 * in flight) — the backend responds synchronously, so RUNNING never appears
 * in the API response itself.
 */
export function stageLabel(kind: StageKind, stage: MinimalStage | null, busy: boolean, eligibleCycleCount?: number | null): string {
  if (busy) return BUSY_LABEL[kind];
  if (!stage || stage.status === 'NOT_STARTED') {
    if (stage?.reason && INSUFFICIENT_REASONS.has(stage.reason)) return 'Insufficient history';
    return 'Not started';
  }
  if (stage.status === 'SKIPPED') return 'Already current';
  if (stage.status === 'FAILED') return 'Failed — retry available';
  // COMPLETED: a fingerprint calculated from zero eligible cycles produced no
  // usable evidence, so it reads the same as "insufficient" rather than "ready".
  if (kind === 'fingerprint' && eligibleCycleCount === 0) return 'Insufficient history';
  return COMPLETED_LABEL[kind];
}

export const STAGE_REASON_TEXT: Record<string, string> = {
  already_current: 'This wallet’s synchronized history was already complete. Nothing new was fetched.',
  sync_in_progress: 'This wallet is already being synchronized elsewhere. Try again shortly.',
  sync_failed: 'Synchronization failed, so later stages could not run.',
  provider_not_configured: 'No activity data provider is configured, so this wallet could not be synchronized.',
  reconstruction_current: 'The latest completed reconstruction already covers every synchronized event.',
  reconstruction_in_progress: 'A reconstruction is already running elsewhere. Try again shortly.',
  reconstruction_failed: 'Reconstruction failed, so quality evidence and a strategy fingerprint could not be produced.',
  reconstruction_required: 'This wallet must be synchronized and reconstructed first.',
  quality_current: 'The latest completed quality evidence already reflects the current reconstruction.',
  quality_in_progress: 'A quality analysis is already running elsewhere. Try again shortly.',
  quality_failed: 'Quality analysis failed for this wallet.',
  fingerprint_current: 'The latest strategy fingerprint already reflects the current reconstruction and quality evidence.',
  fingerprint_in_progress: 'A strategy-fingerprint calculation is already running elsewhere. Try again shortly.',
  fingerprint_failed: 'Strategy-fingerprint calculation failed for this wallet.',
  unexpected_error: 'An unexpected error occurred. No data was lost — you can retry.',
  wallet_prepare_in_progress: 'This wallet is already being prepared. Wait for it to finish before trying again.',
};

export const reasonText = (reason: string | null) => (reason ? (STAGE_REASON_TEXT[reason] ?? reason) : null);

export interface PreparedStages {
  sync: PrepareSyncStage;
  reconstruction: PrepareReconstructionStage;
  quality: PrepareQualityStage;
  fingerprint: PrepareFingerprintStage;
}
