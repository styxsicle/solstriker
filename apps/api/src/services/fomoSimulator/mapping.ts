/**
 * FOMO Simulator V1 — deterministic call mapping.
 *
 * A paper-call action is derived ONLY on the backend, from the current
 * Slow Cook state + confidence and whether an open paper position already
 * exists for the same (token, cohort, methodology). A frontend-provided
 * action is never trusted. The mapping is a fixed lookup — no scoring, no
 * randomness, no machine learning.
 *
 * Methodology version: fomo-sim-v1.
 */
import { createHash } from 'node:crypto';
import type { CandidateState, ConfidenceLevel } from '../slowCook/candidates.js';

export const FOMO_METHODOLOGY_VERSION = 'fomo-sim-v1';

export type PaperAction = 'BUY' | 'HOLD' | 'EXIT' | 'AVOID' | 'NO_TRADE';
export type Conviction = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * V1 mapping, documented in BUILD_PLAN/HANDOFF:
 *
 * Without an open paper position:
 *   BUILDING or HOLDING + HIGHER            → BUY
 *   BUILDING or HOLDING + MODERATE or LOW   → NO_TRADE
 *   COOLING or DISTRIBUTION_RISK            → AVOID
 *   MIXED or INSUFFICIENT_EVIDENCE          → NO_TRADE
 *
 * With an open paper position for the same token + cohort + methodology:
 *   BUILDING or HOLDING + HIGHER or MODERATE → HOLD
 *   BUILDING or HOLDING + LOW                → NO_TRADE (a LOW-confidence
 *     reading never forces an exit; the position is left unchanged)
 *   COOLING or DISTRIBUTION_RISK             → EXIT
 *   MIXED or INSUFFICIENT_EVIDENCE           → NO_TRADE (position unchanged)
 */
export function derivePaperAction(
  state: CandidateState,
  confidence: ConfidenceLevel,
  hasOpenPosition: boolean,
): PaperAction {
  if (state === 'MIXED' || state === 'INSUFFICIENT_EVIDENCE') return 'NO_TRADE';
  if (state === 'COOLING' || state === 'DISTRIBUTION_RISK') {
    return hasOpenPosition ? 'EXIT' : 'AVOID';
  }
  // state is BUILDING or HOLDING from here on.
  if (hasOpenPosition) {
    return confidence === 'LOW' ? 'NO_TRADE' : 'HOLD';
  }
  return confidence === 'HIGHER' ? 'BUY' : 'NO_TRADE';
}

/** User-facing conviction wording; the raw Slow Cook confidence stays in Quant details. */
export function convictionFor(confidence: ConfidenceLevel): Conviction {
  if (confidence === 'HIGHER') return 'HIGH';
  if (confidence === 'MODERATE') return 'MEDIUM';
  return 'LOW';
}

/**
 * Cohort identity: sorted wallet IDs. Selection order and wallet labels never
 * matter — addresses/IDs are identity, labels are display only.
 */
export function cohortKeyFor(walletIds: string[]): string {
  return [...new Set(walletIds)].sort().join('|');
}

/**
 * Deterministic dedupe key from real inputs — never a random value or a bare
 * timestamp. Re-recording the same derived action against identical
 * underlying evidence (same latest evidence, same entry snapshot) collides
 * here and is rejected instead of duplicated.
 */
export function dedupeKeyFor(input: {
  tokenId: string;
  walletIds: string[];
  action: PaperAction;
  latestEvidenceAt: string | null;
  entrySnapshotId: string | null;
  methodologyVersion: string;
}): string {
  const material = [
    input.tokenId,
    cohortKeyFor(input.walletIds),
    input.action,
    input.latestEvidenceAt ?? 'none',
    input.entrySnapshotId ?? 'none',
    input.methodologyVersion,
  ].join('::');
  return createHash('sha256').update(material).digest('hex');
}
