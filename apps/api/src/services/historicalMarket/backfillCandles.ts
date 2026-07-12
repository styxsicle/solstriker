import type { PrismaClient, Token } from '@prisma/client';
import type { HistoricalMarketProvider } from '../../providers/historicalMarket/historicalMarketProvider.js';
import { sanitizedHistoricalErrorCode } from '../../providers/historicalMarket/errors.js';
import type { CandleInterval } from '../../providers/historicalMarket/types.js';
import { countGaps, normalizeCandles } from './normalization.js';
import { resolveTokenPair } from './pairResolution.js';

/**
 * Manual, bounded historical-candle backfill (Phase 1D-B2).
 *
 * - Resolves each token's pair from its latest usable market snapshot (no
 *   pair → PARTIAL result with reason `pair_required`, never a guessed pool).
 * - Provider HTTP happens BEFORE any DB writes; no transaction is held open
 *   across network calls.
 * - Candle upserts are idempotent on (tokenId, pairAddress, interval, openTime,
 *   source): re-fetching does not duplicate; corrected values update in place.
 * - Per-token failure isolation: one token's provider error does not abort the
 *   run.
 * - Gaps are detected and reported; missing candles are never manufactured.
 */

export const MAX_TOKENS_PER_BACKFILL = 5;

let backfillInProgress = false;

export function isBackfillInProgress(): boolean {
  return backfillInProgress;
}
export function tryAcquireBackfillLock(): boolean {
  if (backfillInProgress) return false;
  backfillInProgress = true;
  return true;
}
export function releaseBackfillLock(): void {
  backfillInProgress = false;
}

export interface BackfillTokenResult {
  tokenId: string;
  mint: string;
  pairAddress: string | null;
  status: 'COMPLETE' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR';
  candlesInserted: number;
  candlesUpdated: number;
  duplicatesPrevented: number;
  gapCount: number;
  coverageStart: string | null;
  coverageEnd: string | null;
  sanitizedErrorCode: string | null;
  reason: string | null;
}

export interface BackfillRunResult {
  runId: string;
  provider: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  interval: string;
  requestedStart: string;
  requestedEnd: string;
  requested: number;
  processed: number;
  complete: number;
  partial: number;
  notFound: number;
  failed: number;
  candlesInserted: number;
  candlesUpdated: number;
  duplicatesPrevented: number;
  gapCount: number;
  results: BackfillTokenResult[];
}

export interface BackfillParams {
  interval: CandleInterval;
  startSec: number;
  endSec: number;
}

/** Callers must hold the backfill lock around this. */
export async function backfillCandles(
  deps: { prisma: PrismaClient; provider: HistoricalMarketProvider },
  tokens: Token[],
  params: BackfillParams,
): Promise<BackfillRunResult> {
  const { prisma, provider } = deps;
  const run = await prisma.historicalMarketBackfillRun.create({
    data: {
      provider: provider.name,
      requestedTokenCount: tokens.length,
      requestedInterval: params.interval,
      requestedStart: new Date(params.startSec * 1000),
      requestedEnd: new Date(params.endSec * 1000),
    },
  });

  const results: BackfillTokenResult[] = [];
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalDuplicates = 0;
  let totalGaps = 0;
  let complete = 0;
  let partial = 0;
  let notFound = 0;
  let failed = 0;
  let firstErrorCode: string | null = null;

  for (const token of tokens) {
    const base: BackfillTokenResult = {
      tokenId: token.id,
      mint: token.mintAddress,
      pairAddress: null,
      status: 'ERROR',
      candlesInserted: 0,
      candlesUpdated: 0,
      duplicatesPrevented: 0,
      gapCount: 0,
      coverageStart: null,
      coverageEnd: null,
      sanitizedErrorCode: null,
      reason: null,
    };

    const pair = await resolveTokenPair(prisma, token.id);
    if (!pair) {
      results.push({ ...base, status: 'NOT_FOUND', reason: 'pair_required' });
      notFound += 1;
      continue;
    }
    base.pairAddress = pair.pairAddress;

    let inserted = 0;
    let updated = 0;
    let duplicates = 0;
    try {
      const lookup = await provider.fetchCandles({
        chainId: 'solana',
        pairAddress: pair.pairAddress,
        interval: params.interval,
        startSec: params.startSec,
        endSec: params.endSec,
      });
      const { candles } = normalizeCandles(lookup.candles, params.interval);

      if (candles.length === 0) {
        results.push({ ...base, status: 'NOT_FOUND', reason: 'no_candles_in_range' });
        notFound += 1;
        continue;
      }

      const fetchedAt = new Date(lookup.fetchedAt);
      for (const candle of candles) {
        const openTime = new Date(candle.openTimeSec * 1000);
        const closeTime = new Date(candle.closeTimeSec * 1000);
        const where = {
          tokenId_pairAddress_interval_openTime_source: {
            tokenId: token.id,
            pairAddress: pair.pairAddress,
            interval: params.interval,
            openTime,
            source: provider.name,
          },
        };
        const existing = await prisma.tokenMarketCandle.findUnique({ where });
        if (!existing) {
          await prisma.tokenMarketCandle.create({
            data: {
              tokenId: token.id,
              pairAddress: pair.pairAddress,
              interval: params.interval,
              openTime,
              closeTime,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volumeUsd: candle.volumeUsd,
              source: provider.name,
              fetchedAt,
              backfillRunId: run.id,
            },
          });
          inserted += 1;
        } else {
          const changed =
            existing.open !== candle.open ||
            existing.high !== candle.high ||
            existing.low !== candle.low ||
            existing.close !== candle.close ||
            existing.volumeUsd !== candle.volumeUsd;
          if (changed) {
            await prisma.tokenMarketCandle.update({
              where: { id: existing.id },
              data: {
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volumeUsd: candle.volumeUsd,
                fetchedAt,
                backfillRunId: run.id,
              },
            });
            updated += 1;
          } else {
            duplicates += 1;
          }
        }
      }

      const gaps = countGaps(candles, params.interval);
      const coverageStart = new Date(candles[0].openTimeSec * 1000);
      const coverageEnd = new Date(candles[candles.length - 1].openTimeSec * 1000);
      // COMPLETE = observed coverage spans the requested range with no interior
      // gaps; otherwise PARTIAL. Coverage bounds are inclusive of interval slots.
      const coversRange =
        candles[0].openTimeSec <= params.startSec + 0 &&
        candles[candles.length - 1].openTimeSec >= params.endSec - 0;
      const status = gaps === 0 && coversRange ? 'COMPLETE' : 'PARTIAL';

      results.push({
        ...base,
        status,
        candlesInserted: inserted,
        candlesUpdated: updated,
        duplicatesPrevented: duplicates,
        gapCount: gaps,
        coverageStart: coverageStart.toISOString(),
        coverageEnd: coverageEnd.toISOString(),
        reason: status === 'PARTIAL' ? (gaps > 0 ? 'gaps_present' : 'incomplete_range') : null,
      });
      totalInserted += inserted;
      totalUpdated += updated;
      totalDuplicates += duplicates;
      totalGaps += gaps;
      if (status === 'COMPLETE') complete += 1;
      else partial += 1;
    } catch (err) {
      const code = sanitizedHistoricalErrorCode(err);
      if (firstErrorCode === null) firstErrorCode = code;
      results.push({
        ...base,
        status: 'ERROR',
        candlesInserted: inserted,
        candlesUpdated: updated,
        duplicatesPrevented: duplicates,
        sanitizedErrorCode: code,
      });
      totalInserted += inserted;
      totalUpdated += updated;
      totalDuplicates += duplicates;
      failed += 1;
    }
  }

  const processed = results.length;
  const runStatus =
    failed > 0 ? (failed === processed ? 'FAILED' : 'PARTIAL') : partial > 0 ? 'PARTIAL' : 'COMPLETED';

  await prisma.historicalMarketBackfillRun.update({
    where: { id: run.id },
    data: {
      status: runStatus,
      completedAt: new Date(),
      processedTokenCount: processed,
      candlesInserted: totalInserted,
      candlesUpdated: totalUpdated,
      duplicatesPrevented: totalDuplicates,
      gapCount: totalGaps,
      completeCount: complete,
      partialCount: partial,
      notFoundCount: notFound,
      errorCount: failed,
      sanitizedErrorSummary: firstErrorCode,
    },
  });

  return {
    runId: run.id,
    provider: provider.name,
    status: runStatus,
    interval: params.interval,
    requestedStart: new Date(params.startSec * 1000).toISOString(),
    requestedEnd: new Date(params.endSec * 1000).toISOString(),
    requested: tokens.length,
    processed,
    complete,
    partial,
    notFound,
    failed,
    candlesInserted: totalInserted,
    candlesUpdated: totalUpdated,
    duplicatesPrevented: totalDuplicates,
    gapCount: totalGaps,
    results,
  };
}
