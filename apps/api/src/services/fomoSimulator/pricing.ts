/**
 * FOMO Simulator V1 — execution-price eligibility.
 *
 * Prices come ONLY from already-stored TokenMarketSnapshot rows — never from
 * a provider call, and never from a future observation. Missing values stay
 * missing: an unpriced call is recorded as unpriced, never priced at zero and
 * never priced later with a future price (no look-ahead bias).
 *
 * Eligibility, built on the centralized freshness rules
 * (services/tokenMetrics/freshness.ts):
 *   FRESH         → allowed
 *   AGING         → allowed, with a visible AGING_SNAPSHOT warning
 *   STALE         → not priced
 *   UNKNOWN       → not priced (includes future-dated observations)
 *   NEVER_FETCHED → not priced
 */
import type { PrismaClient, TokenMarketSnapshot } from '@prisma/client';
import { freshnessOf, USABLE_SNAPSHOT_STATUSES, type Freshness } from '../tokenMetrics/freshness.js';

export const AGING_SNAPSHOT_WARNING = 'AGING_SNAPSHOT';

export async function latestUsableSnapshotForToken(
  prisma: PrismaClient,
  tokenId: string,
): Promise<TokenMarketSnapshot | null> {
  return prisma.tokenMarketSnapshot.findFirst({
    where: { tokenId, status: { in: [...USABLE_SNAPSHOT_STATUSES] } },
    orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export interface ExecutionEligibility {
  eligible: boolean;
  freshness: Freshness;
  priceUsd: string | null;
  warningCodes: string[];
  /** Plain-language reason when not eligible. */
  reason: string | null;
}

export function executionEligibility(
  snapshot: TokenMarketSnapshot | null,
  now = new Date(),
): ExecutionEligibility {
  if (!snapshot) {
    return {
      eligible: false,
      freshness: 'NEVER_FETCHED',
      priceUsd: null,
      warningCodes: [],
      reason: 'No market snapshot has been collected for this token.',
    };
  }
  const { freshness } = freshnessOf(snapshot.observedAt, now);
  if (snapshot.priceUsd === null) {
    return {
      eligible: false,
      freshness,
      priceUsd: null,
      warningCodes: [],
      reason: 'The latest stored snapshot has no USD price.',
    };
  }
  if (freshness === 'FRESH') {
    return { eligible: true, freshness, priceUsd: snapshot.priceUsd, warningCodes: [], reason: null };
  }
  if (freshness === 'AGING') {
    return {
      eligible: true,
      freshness,
      priceUsd: snapshot.priceUsd,
      warningCodes: [AGING_SNAPSHOT_WARNING],
      reason: null,
    };
  }
  return {
    eligible: false,
    freshness,
    priceUsd: snapshot.priceUsd,
    warningCodes: [],
    reason:
      freshness === 'STALE'
        ? 'The latest stored market price is too old to simulate an execution.'
        : 'The latest stored snapshot has an unusable observation time.',
  };
}
