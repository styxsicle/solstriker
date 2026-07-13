/**
 * BN Main identification audit — read-only.
 *
 * Finds every non-development tracked wallet whose label is exactly `bn`
 * (the BN Main candidate group), keeps it strictly separate from wallets
 * whose label only starts with, contains, or case-insensitively matches
 * `bn` (e.g. `bn trezor`, `bn new`, `cabal bn`), and builds a plain,
 * non-ranking comparison report.
 *
 * This module never assigns a "BN Main" role, never claims common
 * ownership or coordinated activity, and never synchronizes, reconstructs
 * or analyzes anything — it only reads and describes what is already
 * stored.
 */
import type { PrismaClient, TrackedWallet } from '@prisma/client';
import type { WalletReadinessReport } from './readinessReport.js';

export interface BnLabelGroups {
  /** label === 'bn', case-sensitive, non-development — the actual BN Main candidates. */
  exactBn: TrackedWallet[];
  /** lower(label) === 'bn' but the stored label is not exactly 'bn' (e.g. 'BN', 'Bn'). */
  caseInsensitiveExact: TrackedWallet[];
  /** label contains 'bn' (case-insensitive) but is not an exact match above (e.g. 'bn trezor', 'cabal bn'). */
  containsBn: TrackedWallet[];
}

/** Finds and strictly separates every bn-labeled, non-development wallet. Read-only. */
export async function findBnLabeledWallets(prisma: PrismaClient): Promise<BnLabelGroups> {
  const candidates = await prisma.trackedWallet.findMany({
    where: {
      source: { not: 'dev-seed' },
      label: { contains: 'bn' }, // SQLite LIKE is case-insensitive for ASCII by default
    },
    orderBy: { createdAt: 'asc' },
  });

  const exactBn: TrackedWallet[] = [];
  const caseInsensitiveExact: TrackedWallet[] = [];
  const containsBn: TrackedWallet[] = [];

  for (const wallet of candidates) {
    const label = wallet.label ?? '';
    if (label === 'bn') exactBn.push(wallet);
    else if (label.toLowerCase() === 'bn') caseInsensitiveExact.push(wallet);
    else if (label.toLowerCase().includes('bn')) containsBn.push(wallet);
  }

  return { exactBn, caseInsensitiveExact, containsBn };
}

export interface BnCandidateRow {
  walletId: string;
  address: string;
  label: string;
  historyState: 'Complete' | 'Partial' | 'None';
  storedEventCount: number;
  dateCoverage: string;
  reconstructionState: WalletReadinessReport['reconstruction']['state'];
  eligibleResultCount: number | null;
  strategySampleCount: number | null;
  mainWalletConfirmation: 'Unconfirmed — user must verify exact address';
}

export function toComparisonRow(report: WalletReadinessReport): BnCandidateRow {
  const historyState: BnCandidateRow['historyState'] =
    !report.sync.everSynced || report.events.storedEventCount === 0
      ? 'None'
      : report.sync.backfillComplete
        ? 'Complete'
        : 'Partial';
  const dateCoverage =
    report.events.earliest && report.events.latest
      ? `${report.events.earliest} → ${report.events.latest}`
      : 'No stored events';
  return {
    walletId: report.walletId,
    address: report.address,
    label: report.label ?? '(unlabeled)',
    historyState,
    storedEventCount: report.events.storedEventCount,
    dateCoverage,
    reconstructionState: report.reconstruction.state,
    eligibleResultCount: report.quality.eligibleCount,
    strategySampleCount: report.fingerprint.eligibleCycleCount,
    mainWalletConfirmation: 'Unconfirmed — user must verify exact address',
  };
}

const RECORD_STATE_TEXT: Record<WalletReadinessReport['reconstruction']['state'], string> = {
  MISSING: 'Missing — no record exists yet',
  RUNNING: 'Still running',
  FAILED: 'Failed',
  STALE: 'Stale — newer stored events exist since this record was calculated',
  CURRENT: 'Current',
};

/** Builds the "what is known" / "what is missing" / "what should happen next" narrative for one candidate. */
export function narrativeFor(report: WalletReadinessReport): { known: string[]; missing: string[]; next: string[] } {
  const known: string[] = [
    `Labeled exactly "${report.label}" at address ${report.address}.`,
    `Group: ${report.groups.length ? report.groups.join(', ') : 'none'}. Source: ${report.source}. Enabled: ${report.enabled ? 'yes' : 'no'}.`,
  ];
  if (report.sync.everSynced) {
    known.push(
      `Synchronization has run (${report.sync.status ?? 'unknown status'}); backfill is ${report.sync.backfillComplete ? 'complete' : 'partial'}.`,
    );
    known.push(
      `${report.events.storedEventCount} stored event(s): ${report.events.buyCount} buy, ${report.events.sellCount} sell, ${report.events.transferInCount} transfer-in, ${report.events.transferOutCount} transfer-out.`,
    );
    if (report.events.earliest && report.events.latest) {
      known.push(`Stored history spans ${report.events.earliest} → ${report.events.latest}.`);
    }
  } else {
    known.push('This wallet has never been synchronized.');
  }
  known.push(`Reconstruction: ${RECORD_STATE_TEXT[report.reconstruction.state]}.`);
  known.push(`Quality analysis: ${RECORD_STATE_TEXT[report.quality.state]}.`);
  known.push(`Strategy fingerprint: ${RECORD_STATE_TEXT[report.fingerprint.state]}.`);

  const missing: string[] = [];
  if (!report.sync.everSynced) missing.push('No synchronization has ever been run for this wallet.');
  else if (!report.sync.backfillComplete) missing.push('Only partial history has been downloaded so far.');
  if (report.reconstruction.state === 'STALE') missing.push('The reconstruction is stale relative to newer stored events.');
  if (report.reconstruction.state === 'MISSING') missing.push('No reconstruction has been produced yet.');
  if (report.reconstruction.unmatchedSellCount !== null && report.reconstruction.unmatchedSellCount > 0) {
    missing.push(`${report.reconstruction.unmatchedSellCount} unmatched sell(s) affect the sample.`);
  }
  if (report.quality.state === 'MISSING') missing.push('No quality analysis has been produced yet.');
  else if (report.quality.eligibleCount !== null && report.quality.eligibleCount === 0) {
    missing.push('No eligible closed cycles were available for quality analysis.');
  }
  if (report.fingerprint.state === 'MISSING') missing.push('No strategy fingerprint has been produced yet.');
  else if (report.fingerprint.eligibleCycleCount !== null && report.fingerprint.eligibleCycleCount === 0) {
    missing.push('The strategy-fingerprint sample has no eligible cycles.');
  } else if (report.fingerprint.eligibleCycleCount !== null && report.fingerprint.eligibleCycleCount < 5) {
    missing.push('The strategy-fingerprint sample is too small for a structural description.');
  }
  if (report.events.excludedUnsupportedCount > 0) {
    missing.push(`${report.events.excludedUnsupportedCount} stored event(s) are excluded/unsupported (legacy decoder or unknown confidence).`);
  }

  const next: string[] = ['Confirm whether this exact address is BN Main.'];
  if (!report.sync.everSynced || !report.sync.backfillComplete) next.push('Download more public history.');
  if (report.reconstruction.state === 'STALE' || report.quality.state === 'STALE' || report.fingerprint.state === 'STALE') {
    next.push('Refresh analysis after new events.');
  }
  if (report.reconstruction.unmatchedSellCount || (report.reconstruction.partialCount ?? 0) > 0) {
    next.push('Inspect excluded cycles.');
  }
  next.push('Do not use as BN Main without confirmation.');

  return { known, missing, next };
}
