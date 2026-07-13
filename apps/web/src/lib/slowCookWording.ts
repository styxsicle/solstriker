/**
 * Slow Cook V1 — frontend-only wording helpers.
 *
 * The backend's `CandidateState`/`ConfidenceLevel` are evidence-only facts —
 * they never encode a "call." The short headline shown to the user (e.g.
 * "HIGH-CONVICTION HOLD", "NO TRADE") is derived here, on the frontend, from
 * those two facts. This keeps the backend strictly evidence-based while still
 * giving Simple Mode a direct, one-line answer.
 */
import type { SlowCookCandidateState, SlowCookConfidenceLevel } from '../api';

export function slowCookHeadline(state: SlowCookCandidateState, confidence: SlowCookConfidenceLevel): string {
  // Weak evidence, or a state that never accumulated a documented pattern,
  // is always presented as "no trade" rather than as a weak version of a call.
  if (confidence === 'LOW' || state === 'INSUFFICIENT_EVIDENCE') return 'NO TRADE';

  const prefix = confidence === 'HIGHER' ? 'HIGH-CONVICTION ' : '';
  switch (state) {
    case 'BUILDING':
      return `${prefix}ACCUMULATION`;
    case 'HOLDING':
      return `${prefix}HOLD`;
    case 'MIXED':
      return 'MIXED SIGNALS';
    case 'COOLING':
      return 'COOLING';
    case 'DISTRIBUTION_RISK':
      return 'DISTRIBUTION RISK';
    default:
      return 'NO TRADE';
  }
}

export function slowCookStateText(state: SlowCookCandidateState): string {
  switch (state) {
    case 'BUILDING':
      return 'Selected wallets are accumulating — repeat buys with no detected selling.';
    case 'HOLDING':
      return 'Selected wallets appear to be holding an open position with no detected selling.';
    case 'MIXED':
      return 'Selected wallets show no shared direction — some are only buying, others are only selling.';
    case 'COOLING':
      return 'Selected-wallet activity on this token is no longer recent.';
    case 'DISTRIBUTION_RISK':
      return 'Selected wallets have detected selling that is at least as large as detected buying.';
    case 'INSUFFICIENT_EVIDENCE':
    default:
      return 'There is not enough evidence yet to describe a clear pattern.';
  }
}

export function slowCookConfidenceText(confidence: SlowCookConfidenceLevel): string {
  switch (confidence) {
    case 'HIGHER':
      return 'Higher evidence confidence — based on a larger sample and current research. Not a profit probability.';
    case 'MODERATE':
      return 'Moderate evidence confidence. Not a profit probability.';
    case 'LOW':
    default:
      return 'Low evidence confidence — based on a small sample or incomplete research. Not a profit probability.';
  }
}
