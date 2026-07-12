/**
 * Centralized freshness rules for market snapshots.
 *
 * Freshness is computed from the OBSERVATION time of the latest usable
 * (COMPLETE or PARTIAL) snapshot — independent of fetch success/failure.
 * Manual snapshots are never called "live"; they are current snapshots that
 * age from the moment they were collected.
 *
 * Thresholds (documented, single source of truth):
 *   FRESH  — observed ≤ 5 minutes ago (memecoin markets move fast)
 *   AGING  — observed ≤ 60 minutes ago
 *   STALE  — observed  > 60 minutes ago
 *   NEVER_FETCHED — no usable snapshot exists
 *   UNKNOWN — a snapshot exists but its observation time is unusable
 */

export const FRESH_MAX_AGE_SECONDS = 5 * 60;
export const AGING_MAX_AGE_SECONDS = 60 * 60;

export type Freshness = 'FRESH' | 'AGING' | 'STALE' | 'NEVER_FETCHED' | 'UNKNOWN';

/** Snapshot statuses whose observation time counts toward freshness. */
export const USABLE_SNAPSHOT_STATUSES = ['COMPLETE', 'PARTIAL'] as const;

export function freshnessOf(observedAt: Date | null | undefined, now = new Date()): {
  freshness: Freshness;
  ageSeconds: number | null;
} {
  if (observedAt === null || observedAt === undefined) {
    return { freshness: 'NEVER_FETCHED', ageSeconds: null };
  }
  const ageSeconds = Math.round((now.getTime() - observedAt.getTime()) / 1000);
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return { freshness: 'UNKNOWN', ageSeconds: null };
  }
  if (ageSeconds <= FRESH_MAX_AGE_SECONDS) return { freshness: 'FRESH', ageSeconds };
  if (ageSeconds <= AGING_MAX_AGE_SECONDS) return { freshness: 'AGING', ageSeconds };
  return { freshness: 'STALE', ageSeconds };
}
