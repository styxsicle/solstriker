import type { PrismaClient, Token } from '@prisma/client';
import type { MarketDataProvider } from '../../providers/market/marketDataProvider.js';
import { sanitizedMarketErrorCode } from '../../providers/market/errors.js';
import { selectBestPair } from '../../providers/market/pairSelection.js';
import { emptySnapshotFields, snapshotFieldsFromSelection } from './normalization.js';

/**
 * Manual, bounded market-data refresh (Phase 1D-B1).
 *
 * - One provider batch lookup per run (HTTP happens BEFORE any DB writes; no
 *   transaction is held open across network calls).
 * - Exactly one auditable snapshot row per requested token per run, enforced
 *   by the (refreshRunId, tokenId) unique constraint.
 * - One failing token never fails the batch: provider-level failures produce
 *   ERROR snapshots for every requested token instead of losing the run.
 * - A module-level lock rejects concurrent refreshes (double-click safety).
 */

export const MAX_TOKENS_PER_REFRESH = 20;

let refreshInProgress = false;

export function isRefreshInProgress(): boolean {
  return refreshInProgress;
}

export interface RefreshTokenResult {
  tokenId: string;
  mint: string;
  status: string;
  confidence: string;
  pairAddress: string | null;
  dex: string | null;
  observedAt: string;
  sanitizedErrorCode: string | null;
}

export interface RefreshRunResult {
  runId: string;
  provider: string;
  status: string;
  requested: number;
  processed: number;
  complete: number;
  partial: number;
  notFound: number;
  failed: number;
  snapshotsInserted: number;
  duplicatesPrevented: number;
  results: RefreshTokenResult[];
}

/** Callers must hold the refresh lock (tryAcquireRefreshLock) around this. */
export async function refreshTokenMetrics(
  deps: { prisma: PrismaClient; provider: MarketDataProvider },
  tokens: Token[],
): Promise<RefreshRunResult> {
  const { prisma, provider } = deps;
  {
    const run = await prisma.tokenMarketRefreshRun.create({
      data: { provider: provider.name, requestedCount: tokens.length },
    });

    // --- provider lookup (network) — no open DB transaction here ---
    let lookupError: unknown = null;
    let candidatesByMint = new Map<string, import('../../providers/market/types.js').MarketPairCandidate[]>();
    let fetchedAt = new Date();
    try {
      const lookup = await provider.lookupTokens(tokens.map((t) => t.mintAddress));
      candidatesByMint = lookup.candidatesByMint;
      fetchedAt = new Date(lookup.fetchedAt);
    } catch (err) {
      lookupError = err;
    }

    // --- per-token snapshots (DB) ---
    const results: RefreshTokenResult[] = [];
    let complete = 0;
    let partial = 0;
    let notFound = 0;
    let failed = 0;
    let snapshotsInserted = 0;
    let duplicatesPrevented = 0;

    for (const token of tokens) {
      let fields;
      let confidence = 'UNKNOWN';
      let selectionReason: string | null = null;
      let sanitizedErrorCode: string | null = null;
      // DexScreener exposes no observation timestamp, so the observation time
      // is the fetch time (documented in HANDOFF).
      const observedAt = fetchedAt;

      if (lookupError !== null) {
        fields = emptySnapshotFields('ERROR');
        sanitizedErrorCode = sanitizedMarketErrorCode(lookupError);
      } else {
        const candidates = candidatesByMint.get(token.mintAddress) ?? [];
        if (candidates.length === 0) {
          fields = emptySnapshotFields('NOT_FOUND');
          selectionReason = 'no_pairs_returned';
        } else {
          const selection = selectBestPair(token.mintAddress, candidates);
          fields = snapshotFieldsFromSelection(selection);
          confidence = selection.confidence;
          selectionReason = selection.reason;
        }
      }

      try {
        await prisma.tokenMarketSnapshot.create({
          data: {
            tokenId: token.id,
            refreshRunId: run.id,
            observedAt,
            fetchedAt,
            source: provider.name,
            confidence,
            selectionReason,
            sanitizedErrorCode,
            ...fields,
          },
        });
        snapshotsInserted += 1;
      } catch (err) {
        // Unique (refreshRunId, tokenId) violation — duplicate within the run.
        if ((err as { code?: string }).code === 'P2002') {
          duplicatesPrevented += 1;
          continue;
        }
        fields = emptySnapshotFields('ERROR');
        sanitizedErrorCode = 'storage_error';
      }

      // Fill token name/symbol ONLY when currently null — provider data never
      // overwrites user-curated or previously stored metadata.
      if (fields.status === 'COMPLETE' || fields.status === 'PARTIAL') {
        const metadata: { name?: string; symbol?: string } = {};
        if (token.name === null && fields.tokenName) metadata.name = fields.tokenName;
        if (token.symbol === null && fields.tokenSymbol) metadata.symbol = fields.tokenSymbol;
        if (Object.keys(metadata).length > 0) {
          await prisma.token.update({ where: { id: token.id }, data: metadata });
        }
      }

      if (fields.status === 'COMPLETE') complete += 1;
      else if (fields.status === 'PARTIAL') partial += 1;
      else if (fields.status === 'NOT_FOUND') notFound += 1;
      else failed += 1;

      results.push({
        tokenId: token.id,
        mint: token.mintAddress,
        status: fields.status,
        confidence,
        pairAddress: fields.pairAddress,
        dex: fields.dex,
        observedAt: observedAt.toISOString(),
        sanitizedErrorCode,
      });
    }

    const processed = results.length;
    // Run status: FAILED = everything errored; PARTIAL = some errors;
    // COMPLETED = no errors (NOT_FOUND is an answer, not an error).
    const runStatus =
      failed > 0 ? (failed === processed ? 'FAILED' : 'PARTIAL') : 'COMPLETED';

    await prisma.tokenMarketRefreshRun.update({
      where: { id: run.id },
      data: {
        status: runStatus,
        completedAt: new Date(),
        processedCount: processed,
        completeCount: complete,
        partialCount: partial,
        notFoundCount: notFound,
        errorCount: failed,
        snapshotCount: snapshotsInserted,
        sanitizedErrorSummary:
          lookupError !== null ? sanitizedMarketErrorCode(lookupError) : null,
      },
    });

    return {
      runId: run.id,
      provider: provider.name,
      status: runStatus,
      requested: tokens.length,
      processed,
      complete,
      partial,
      notFound,
      failed,
      snapshotsInserted,
      duplicatesPrevented,
      results,
    };
  }
}

export function tryAcquireRefreshLock(): boolean {
  if (refreshInProgress) return false;
  refreshInProgress = true;
  return true;
}

export function releaseRefreshLock(): void {
  refreshInProgress = false;
}
