import type { PrismaClient, WalletEvent } from '@prisma/client';
import { resolveTokenPair } from '../historicalMarket/pairResolution.js';
import {
  horizonExtremes,
  selectEntryCandle,
  windowResult,
  WINDOW_SECONDS,
  type CandleRow,
} from './outcomeMath.js';

/**
 * Deterministic post-entry outcome calculation from stored candles.
 *
 * Eligible events: eventType BUY, confidence CONFIRMED or LIKELY, with a token
 * and a blockTime. Transfers and sells are never given outcomes. Uses only
 * candles at/after the event time (no look-ahead; the pair is resolved the same
 * way regardless of later data). One row per (walletEventId, calculationVersion)
 * — recalculation upserts, so it is idempotent.
 */

export const CALCULATION_VERSION = 1;
export const MAX_EVENTS_PER_CALCULATION = 200;

export function isEligibleBuy(event: {
  eventType: string;
  confidence: string | null;
  tokenId: string | null;
  blockTime: Date | null;
}): boolean {
  return (
    event.eventType === 'BUY' &&
    (event.confidence === 'CONFIRMED' || event.confidence === 'LIKELY') &&
    event.tokenId !== null &&
    event.blockTime !== null
  );
}

export interface OutcomeResult {
  walletEventId: string;
  tokenId: string | null;
  status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' | 'ERROR';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  reason: string | null;
}

export interface CalculationRunResult {
  requested: number;
  processed: number;
  complete: number;
  partial: number;
  unavailable: number;
  errored: number;
  skippedIneligible: number;
  results: OutcomeResult[];
}

type OutcomeWriteData = Omit<
  import('@prisma/client').Prisma.WalletEntryOutcomeUncheckedCreateInput,
  'id' | 'createdAt' | 'updatedAt'
>;

async function loadCandles(
  prisma: PrismaClient,
  tokenId: string,
  pairAddress: string,
  fromSec: number,
): Promise<CandleRow[]> {
  // Only candles at/after the entry time are loaded (no look-ahead into the
  // pair choice; earlier candles are irrelevant to a post-entry outcome).
  const rows = await prisma.tokenMarketCandle.findMany({
    where: { tokenId, pairAddress, openTime: { gte: new Date(fromSec * 1000) } },
    orderBy: { openTime: 'asc' },
    select: { openTime: true, closeTime: true, open: true, high: true, low: true, close: true },
  });
  return rows.map((r) => ({
    openTimeSec: Math.floor(r.openTime.getTime() / 1000),
    closeTimeSec: Math.floor(r.closeTime.getTime() / 1000),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
  }));
}

function buildOutcome(
  event: WalletEvent,
  pairAddress: string | null,
  candles: CandleRow[],
): OutcomeWriteData {
  const entryTimeSec = Math.floor((event.blockTime as Date).getTime() / 1000);
  const baseUnavailable: OutcomeWriteData = {
    walletEventId: event.id,
    tokenId: event.tokenId as string,
    pairAddress,
    entryTime: event.blockTime as Date,
    entryPriceUsd: null,
    entryPriceMethod: 'UNAVAILABLE',
    entryCandleTime: null,
    entryDelaySeconds: null,
    status: 'UNAVAILABLE',
    confidence: 'UNKNOWN',
    coverageStart: null,
    coverageEnd: null,
    missingWindowCount: 7,
    calculationVersion: CALCULATION_VERSION,
    calculatedAt: new Date(),
  };

  if (pairAddress === null) return { ...baseUnavailable };
  const entry = selectEntryCandle(candles, entryTimeSec);
  if (!entry) return { ...baseUnavailable };

  const entryPrice = Number(entry.entryPriceUsd);
  const windows = {
    '1m': windowResult(candles, entryTimeSec, entryPrice, WINDOW_SECONDS['1m']),
    '5m': windowResult(candles, entryTimeSec, entryPrice, WINDOW_SECONDS['5m']),
    '15m': windowResult(candles, entryTimeSec, entryPrice, WINDOW_SECONDS['15m']),
    '30m': windowResult(candles, entryTimeSec, entryPrice, WINDOW_SECONDS['30m']),
    '1h': windowResult(candles, entryTimeSec, entryPrice, WINDOW_SECONDS['1h']),
    '4h': windowResult(candles, entryTimeSec, entryPrice, WINDOW_SECONDS['4h']),
    '24h': windowResult(candles, entryTimeSec, entryPrice, WINDOW_SECONDS['24h']),
  };
  const h1 = horizonExtremes(candles, entryTimeSec, entry.entryCandleOpenTimeSec, entryPrice, WINDOW_SECONDS['1h']);
  const h24 = horizonExtremes(candles, entryTimeSec, entry.entryCandleOpenTimeSec, entryPrice, WINDOW_SECONDS['24h']);

  const missingWindowCount = Object.values(windows).filter((w) => w.price === null).length;
  // COMPLETE requires all 7 window prices and full 24h horizon coverage.
  const status = missingWindowCount === 0 && h24.fullyCovered ? 'COMPLETE' : 'PARTIAL';
  // Confidence: HIGH when complete and entry delay is within one interval-ish
  // window (≤ 5 min); MEDIUM partial with a good entry; LOW sparse; else UNKNOWN.
  const confidence =
    status === 'COMPLETE' && entry.entryDelaySeconds <= 300
      ? 'HIGH'
      : missingWindowCount <= 3
        ? 'MEDIUM'
        : 'LOW';

  const inRange = candles.filter(
    (c) => c.openTimeSec >= entry.entryCandleOpenTimeSec && c.openTimeSec <= entryTimeSec + WINDOW_SECONDS['24h'],
  );
  const coverageStart = new Date(entry.entryCandleOpenTimeSec * 1000);
  const coverageEnd =
    inRange.length > 0 ? new Date(inRange[inRange.length - 1].openTimeSec * 1000) : coverageStart;

  return {
    walletEventId: event.id,
    tokenId: event.tokenId as string,
    pairAddress,
    entryTime: event.blockTime as Date,
    entryPriceUsd: entry.entryPriceUsd,
    entryPriceMethod: 'CANDLE_OPEN',
    entryCandleTime: new Date(entry.entryCandleOpenTimeSec * 1000),
    entryDelaySeconds: entry.entryDelaySeconds,
    price1mUsd: windows['1m'].price,
    price5mUsd: windows['5m'].price,
    price15mUsd: windows['15m'].price,
    price30mUsd: windows['30m'].price,
    price1hUsd: windows['1h'].price,
    price4hUsd: windows['4h'].price,
    price24hUsd: windows['24h'].price,
    return1mPct: windows['1m'].returnPct,
    return5mPct: windows['5m'].returnPct,
    return15mPct: windows['15m'].returnPct,
    return30mPct: windows['30m'].returnPct,
    return1hPct: windows['1h'].returnPct,
    return4hPct: windows['4h'].returnPct,
    return24hPct: windows['24h'].returnPct,
    maxPrice1hUsd: h1.maxPriceUsd,
    minPrice1hUsd: h1.minPriceUsd,
    maxReturn1hPct: h1.maxReturnPct,
    maxDrawdown1hPct: h1.maxDrawdownPct,
    timeToMax1hSeconds: h1.timeToMaxSeconds,
    maxPrice24hUsd: h24.maxPriceUsd,
    minPrice24hUsd: h24.minPriceUsd,
    maxReturn24hPct: h24.maxReturnPct,
    maxDrawdown24hPct: h24.maxDrawdownPct,
    timeToMax24hSeconds: h24.timeToMaxSeconds,
    status,
    confidence,
    coverageStart,
    coverageEnd,
    missingWindowCount,
    calculationVersion: CALCULATION_VERSION,
    calculatedAt: new Date(),
  };
}

export async function calculateOutcomes(
  deps: { prisma: PrismaClient },
  events: WalletEvent[],
): Promise<CalculationRunResult> {
  const { prisma } = deps;
  const results: OutcomeResult[] = [];
  let complete = 0;
  let partial = 0;
  let unavailable = 0;
  let errored = 0;
  let skippedIneligible = 0;

  for (const event of events) {
    if (!isEligibleBuy(event)) {
      skippedIneligible += 1;
      results.push({
        walletEventId: event.id,
        tokenId: event.tokenId,
        status: 'UNAVAILABLE',
        confidence: 'UNKNOWN',
        reason: 'ineligible_event',
      });
      continue;
    }

    try {
      const pair = await resolveTokenPair(prisma, event.tokenId as string);
      const candles =
        pair !== null
          ? await loadCandles(
              prisma,
              event.tokenId as string,
              pair.pairAddress,
              Math.floor((event.blockTime as Date).getTime() / 1000),
            )
          : [];
      const data = buildOutcome(event, pair?.pairAddress ?? null, candles);

      // Idempotent upsert on (walletEventId, calculationVersion).
      await prisma.walletEntryOutcome.upsert({
        where: {
          walletEventId_calculationVersion: {
            walletEventId: event.id,
            calculationVersion: CALCULATION_VERSION,
          },
        },
        create: data,
        update: { ...data, updatedAt: new Date() },
      });

      const reason =
        data.status === 'UNAVAILABLE'
          ? pair === null
            ? 'pair_required'
            : 'no_candle_coverage'
          : null;
      results.push({
        walletEventId: event.id,
        tokenId: event.tokenId,
        status: data.status as OutcomeResult['status'],
        confidence: data.confidence as OutcomeResult['confidence'],
        reason,
      });
      if (data.status === 'COMPLETE') complete += 1;
      else if (data.status === 'PARTIAL') partial += 1;
      else unavailable += 1;
    } catch {
      errored += 1;
      results.push({
        walletEventId: event.id,
        tokenId: event.tokenId,
        status: 'ERROR',
        confidence: 'UNKNOWN',
        reason: 'calculation_error',
      });
    }
  }

  return {
    requested: events.length,
    processed: results.length,
    complete,
    partial,
    unavailable,
    errored,
    skippedIneligible,
    results,
  };
}
