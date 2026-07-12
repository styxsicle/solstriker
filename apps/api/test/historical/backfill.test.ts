import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import type { PrismaClient } from '@prisma/client';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import { HistoricalProviderError } from '../../src/providers/historicalMarket/errors.js';
import { isBackfillInProgress } from '../../src/services/historicalMarket/backfillCandles.js';
import { BASE_TS, FakeHistoricalProvider, makeMinuteSeries, PAIR_A } from './fixtures.js';

const MINT = syntheticAddress(120);
const iso = (sec: number) => new Date(sec * 1000).toISOString();

async function tokenWithPair(prisma: PrismaClient, mint = MINT, pair = PAIR_A, source = 'activity') {
  const token = await prisma.token.create({ data: { mintAddress: mint, source } });
  // A usable snapshot gives the token a resolvable pair.
  const run = await prisma.tokenMarketRefreshRun.create({ data: { provider: 'dexscreener', requestedCount: 1 } });
  await prisma.tokenMarketSnapshot.create({
    data: {
      tokenId: token.id,
      refreshRunId: run.id,
      observedAt: new Date(),
      source: 'dexscreener',
      status: 'COMPLETE',
      confidence: 'HIGH',
      pairAddress: pair,
      priceUsd: '1',
    },
  });
  return token;
}

describe('POST /api/historical-market/backfill', () => {
  const apps: TestApp[] = [];
  async function makeApp(provider?: FakeHistoricalProvider) {
    const ctx = await buildTestApp({ historicalProvider: provider });
    apps.push(ctx);
    return ctx;
  }

  beforeEach(async () => {
    const ctx = await buildTestApp();
    await resetDb(ctx.prisma);
    await ctx.app.close();
  });
  afterAll(async () => {
    for (const ctx of apps) await ctx.app.close();
  });

  const window = { start: iso(BASE_TS), end: iso(BASE_TS + 600), interval: '1m' as const };

  it('503 when the historical provider is not configured', async () => {
    const ctx = await makeApp(); // default 'none'
    const token = await tokenWithPair(ctx.prisma);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/historical-market/backfill',
      payload: { tokens: [token.id], ...window },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('provider_not_configured');
  });

  it('rejects empty, duplicate, >5, bad range, and unsupported interval', async () => {
    const ctx = await makeApp(new FakeHistoricalProvider([]));
    const token = await tokenWithPair(ctx.prisma);
    const empty = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [], ...window } });
    expect(empty.statusCode).toBe(400);
    const dup = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [token.id, token.id], ...window } });
    expect(dup.json().error).toBe('duplicate_selection');
    const six = await ctx.app.inject({
      method: 'POST',
      url: '/api/historical-market/backfill',
      payload: { tokens: Array.from({ length: 6 }, (_, i) => syntheticAddress(130 + i)), ...window },
    });
    expect(six.statusCode).toBe(400);
    const badRange = await ctx.app.inject({
      method: 'POST',
      url: '/api/historical-market/backfill',
      payload: { tokens: [token.id], interval: '1m', start: iso(BASE_TS + 600), end: iso(BASE_TS) },
    });
    expect(badRange.json().error).toBe('invalid_range');
    const tooBig = await ctx.app.inject({
      method: 'POST',
      url: '/api/historical-market/backfill',
      payload: { tokens: [token.id], interval: '1m', start: iso(BASE_TS), end: iso(BASE_TS + 30 * 24 * 3600) },
    });
    expect(tooBig.json().error).toBe('range_too_large');
  });

  it('excludes dev tokens by default, allows with includeDev', async () => {
    const ctx = await makeApp(new FakeHistoricalProvider(makeMinuteSeries(BASE_TS, 11)));
    const dev = await tokenWithPair(ctx.prisma, MINT, PAIR_A, 'dev-seed');
    const excluded = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [dev.id], ...window } });
    expect(excluded.json().error).toBe('dev_token_excluded');
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [dev.id], includeDev: true, ...window } });
    expect(ok.statusCode).toBe(200);
  });

  it('returns NOT_FOUND with pair_required when the token has no snapshot pair', async () => {
    const ctx = await makeApp(new FakeHistoricalProvider(makeMinuteSeries(BASE_TS, 11)));
    const token = await ctx.prisma.token.create({ data: { mintAddress: MINT, source: 'activity' } });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [token.id], ...window } });
    const body = res.json();
    expect(body.notFound).toBe(1);
    expect(body.results[0].reason).toBe('pair_required');
    expect(await ctx.prisma.tokenMarketCandle.count()).toBe(0);
  });

  it('inserts candles and reports coverage; re-running is idempotent (duplicates prevented)', async () => {
    const ctx = await makeApp(new FakeHistoricalProvider(makeMinuteSeries(BASE_TS, 11)));
    const token = await tokenWithPair(ctx.prisma);
    const first = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [token.id], ...window } });
    const body = first.json();
    expect(body.candlesInserted).toBe(11);
    expect(body.gapCount).toBe(0);
    expect(body.results[0].status).toBe('COMPLETE');
    expect(await ctx.prisma.tokenMarketCandle.count()).toBe(11);

    const second = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [token.id], ...window } });
    expect(second.json().candlesInserted).toBe(0);
    expect(second.json().duplicatesPrevented).toBe(11);
    expect(await ctx.prisma.tokenMarketCandle.count()).toBe(11); // no duplicates
  });

  it('updates a candle when the provider returns corrected values', async () => {
    const series = makeMinuteSeries(BASE_TS, 3);
    const provider = new FakeHistoricalProvider(series);
    const ctx = await makeApp(provider);
    const token = await tokenWithPair(ctx.prisma);
    await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [token.id], start: iso(BASE_TS), end: iso(BASE_TS + 120), interval: '1m' } });
    // Correct the first candle's close to a still-valid OHLC value
    // (must stay within the candle's low/high to pass normalization).
    const original = series[0];
    const correctedClose = String((Number(original.low) + Number(original.high)) / 2);
    series[0] = { ...original, close: correctedClose };
    const res = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [token.id], start: iso(BASE_TS), end: iso(BASE_TS + 120), interval: '1m' } });
    expect(res.json().candlesUpdated).toBe(1);
    const updated = await ctx.prisma.tokenMarketCandle.findFirst({ where: { tokenId: token.id }, orderBy: { openTime: 'asc' } });
    expect(updated!.close).toBe(correctedClose);
  });

  it('reports gaps as PARTIAL and never manufactures missing candles', async () => {
    const series = makeMinuteSeries(BASE_TS, 11).filter((_, i) => i !== 5); // hole in the middle
    const ctx = await makeApp(new FakeHistoricalProvider(series));
    const token = await tokenWithPair(ctx.prisma);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [token.id], ...window } });
    const body = res.json();
    expect(body.candlesInserted).toBe(10);
    expect(body.gapCount).toBe(1);
    expect(body.results[0].status).toBe('PARTIAL');
    expect(await ctx.prisma.tokenMarketCandle.count()).toBe(10); // gap not filled
    const coverage = await ctx.app.inject({
      method: 'GET',
      url: `/api/historical-market/${MINT}/coverage`,
    });
    expect(coverage.json().coverage).toMatchObject({ gapCount: 1, status: 'PARTIAL' });
  });

  it('isolates a provider failure per token and releases the lock', async () => {
    const provider = new FakeHistoricalProvider([], {
      failWith: new HistoricalProviderError('rate_limited', 'rate limited', true),
    });
    const ctx = await makeApp(provider);
    const token = await tokenWithPair(ctx.prisma);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [token.id], ...window } });
    const body = res.json();
    expect(body.failed).toBe(1);
    expect(body.status).toBe('FAILED');
    expect(body.results[0].sanitizedErrorCode).toBe('rate_limited');
    expect(isBackfillInProgress()).toBe(false);
  });

  it('GET coverage and backfill-runs reflect the stored series', async () => {
    const ctx = await makeApp(new FakeHistoricalProvider(makeMinuteSeries(BASE_TS, 11)));
    const token = await tokenWithPair(ctx.prisma);
    const run = await ctx.app.inject({ method: 'POST', url: '/api/historical-market/backfill', payload: { tokens: [token.id], ...window } });
    const runId = run.json().runId;

    const coverage = await ctx.app.inject({ method: 'GET', url: `/api/historical-market/${MINT}/coverage` });
    expect(coverage.json().coverage).toMatchObject({ candleCount: 11, gapCount: 0, status: 'COVERED', pairAddress: PAIR_A, interval: '1m' });

    const candles = await ctx.app.inject({ method: 'GET', url: `/api/historical-market/candles?mint=${MINT}&interval=1m&pageSize=5` });
    expect(candles.json().total).toBe(11);
    expect(candles.json().items).toHaveLength(5);
    expect(candles.json().items[0].open).toBeDefined();

    const runInfo = await ctx.app.inject({ method: 'GET', url: `/api/historical-market/backfill-runs/${runId}` });
    expect(runInfo.json()).toMatchObject({ status: 'COMPLETED', candlesInserted: 11, requestedInterval: '1m' });
  });
});
