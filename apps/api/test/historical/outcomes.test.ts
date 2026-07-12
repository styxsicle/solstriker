import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import type { PrismaClient } from '@prisma/client';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import { BASE_TS, PAIR_A } from './fixtures.js';

const MINT = syntheticAddress(140);
const WALLET = syntheticAddress(141);

async function setupTokenWithPair(prisma: PrismaClient, mint = MINT) {
  const token = await prisma.token.create({ data: { mintAddress: mint, source: 'activity' } });
  const run = await prisma.tokenMarketRefreshRun.create({ data: { provider: 'dexscreener', requestedCount: 1 } });
  await prisma.tokenMarketSnapshot.create({
    data: {
      tokenId: token.id,
      refreshRunId: run.id,
      observedAt: new Date(),
      source: 'dexscreener',
      status: 'COMPLETE',
      confidence: 'HIGH',
      pairAddress: PAIR_A,
      priceUsd: '1',
    },
  });
  return token;
}

/** Insert a contiguous minute-candle series directly (bypassing the provider). */
async function insertCandles(
  prisma: PrismaClient,
  tokenId: string,
  startSec: number,
  count: number,
  priceAt: (i: number) => { o: number; h: number; l: number; c: number },
) {
  const run = await prisma.historicalMarketBackfillRun.create({
    data: {
      provider: 'test',
      requestedInterval: '1m',
      requestedStart: new Date(startSec * 1000),
      requestedEnd: new Date((startSec + count * 60) * 1000),
    },
  });
  for (let i = 0; i < count; i++) {
    const p = priceAt(i);
    await prisma.tokenMarketCandle.create({
      data: {
        tokenId,
        pairAddress: PAIR_A,
        interval: '1m',
        openTime: new Date((startSec + i * 60) * 1000),
        closeTime: new Date((startSec + (i + 1) * 60) * 1000),
        open: String(p.o),
        high: String(p.h),
        low: String(p.l),
        close: String(p.c),
        volumeUsd: '100',
        source: 'test',
        backfillRunId: run.id,
      },
    });
  }
}

async function makeWallet(prisma: PrismaClient) {
  return prisma.trackedWallet.create({ data: { address: WALLET, source: 'manual' } });
}

async function makeBuy(
  prisma: PrismaClient,
  walletId: string,
  tokenId: string,
  blockTimeSec: number,
  opts: { eventType?: string; confidence?: string; key?: string } = {},
) {
  return prisma.walletEvent.create({
    data: {
      dedupeKey: opts.key ?? `buy-${blockTimeSec}`,
      walletId,
      tokenId,
      signature: `sig-${blockTimeSec}`,
      eventType: opts.eventType ?? 'BUY',
      confidence: opts.confidence ?? 'CONFIRMED',
      blockTime: new Date(blockTimeSec * 1000),
      decoderVersion: 2,
    },
  });
}

describe('POST /api/wallet-entry-outcomes/calculate', () => {
  const apps: TestApp[] = [];
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await buildTestApp();
    apps.push(ctx);
    await resetDb(ctx.prisma);
  });
  afterAll(async () => {
    for (const c of apps) await c.app.close();
  });

  it('computes a COMPLETE outcome with correct entry, window, and horizon math', async () => {
    const token = await setupTokenWithPair(ctx.prisma);
    const wallet = await makeWallet(ctx.prisma);
    // Entry exactly at a candle open; price doubles by +5m then holds; full 24h coverage.
    const entrySec = BASE_TS;
    // 1441 minute candles cover 24h fully. Price: 10 at entry, jumps to 20 at +5m, stays.
    await insertCandles(ctx.prisma, token.id, entrySec, 1442, (i) => {
      const price = i === 0 ? 10 : i < 5 ? 10 : 20;
      return { o: price, h: price * 1.1, l: price * 0.9, c: price };
    });
    const buy = await makeBuy(ctx.prisma, wallet.id, token.id, entrySec);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallet-entry-outcomes/calculate',
      payload: { walletEventIds: [buy.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ complete: 1, partial: 0, unavailable: 0, errored: 0 });

    const outcome = await ctx.prisma.walletEntryOutcome.findFirst({ where: { walletEventId: buy.id } });
    expect(outcome!.status).toBe('COMPLETE');
    expect(outcome!.entryPriceMethod).toBe('CANDLE_OPEN');
    expect(outcome!.entryPriceUsd).toBe('10');
    expect(outcome!.entryDelaySeconds).toBe(0);
    expect(outcome!.price5mUsd).toBe('20'); // close of the +5m candle
    expect(outcome!.return5mPct).toBe('100.000000'); // doubled
    expect(outcome!.maxReturn24hPct).toBe('120.000000'); // high 22 vs entry 10
  });

  it('marks PARTIAL when later windows are missing', async () => {
    const token = await setupTokenWithPair(ctx.prisma);
    const wallet = await makeWallet(ctx.prisma);
    // Only 10 minutes of candles → 1h/4h/24h windows missing.
    await insertCandles(ctx.prisma, token.id, BASE_TS, 10, () => ({ o: 10, h: 11, l: 9, c: 10 }));
    const buy = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: { walletEventIds: [buy.id] } });
    expect(res.json().partial).toBe(1);
    const outcome = await ctx.prisma.walletEntryOutcome.findFirst({ where: { walletEventId: buy.id } });
    expect(outcome!.status).toBe('PARTIAL');
    expect(outcome!.price1hUsd).toBeNull();
    expect(outcome!.missingWindowCount).toBeGreaterThan(0);
  });

  it('marks UNAVAILABLE when there is no candle coverage at/after entry (no look-ahead)', async () => {
    const token = await setupTokenWithPair(ctx.prisma);
    const wallet = await makeWallet(ctx.prisma);
    // All candles are BEFORE the entry → cannot be used (would be look-ahead/back).
    await insertCandles(ctx.prisma, token.id, BASE_TS - 3600, 30, () => ({ o: 10, h: 11, l: 9, c: 10 }));
    const buy = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: { walletEventIds: [buy.id] } });
    expect(res.json().unavailable).toBe(1);
    const outcome = await ctx.prisma.walletEntryOutcome.findFirst({ where: { walletEventId: buy.id } });
    expect(outcome!.status).toBe('UNAVAILABLE');
    expect(outcome!.entryPriceUsd).toBeNull();
  });

  it('marks UNAVAILABLE (pair_required) when the token has no snapshot pair', async () => {
    const token = await ctx.prisma.token.create({ data: { mintAddress: MINT, source: 'activity' } });
    const wallet = await makeWallet(ctx.prisma);
    const buy = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: { walletEventIds: [buy.id] } });
    expect(res.json().unavailable).toBe(1);
    expect(res.json().results[0].reason).toBe('pair_required');
  });

  it('skips ineligible events (sells, transfers, low confidence)', async () => {
    const token = await setupTokenWithPair(ctx.prisma);
    const wallet = await makeWallet(ctx.prisma);
    await insertCandles(ctx.prisma, token.id, BASE_TS, 30, () => ({ o: 10, h: 11, l: 9, c: 10 }));
    const sell = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS, { eventType: 'SELL', key: 'sell' });
    const transfer = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS, { eventType: 'TOKEN_TRANSFER_IN', key: 'xfer' });
    const unknownConf = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS, { confidence: 'UNKNOWN', key: 'unk' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallet-entry-outcomes/calculate',
      payload: { walletEventIds: [sell.id, transfer.id, unknownConf.id] },
    });
    expect(res.json().skippedIneligible).toBe(3);
    // No outcome rows persisted for ineligible events.
    expect(await ctx.prisma.walletEntryOutcome.count()).toBe(0);
  });

  it('is idempotent: recalculating updates in place (one row per version)', async () => {
    const token = await setupTokenWithPair(ctx.prisma);
    const wallet = await makeWallet(ctx.prisma);
    await insertCandles(ctx.prisma, token.id, BASE_TS, 30, () => ({ o: 10, h: 11, l: 9, c: 10 }));
    const buy = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS);
    await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: { walletEventIds: [buy.id] } });
    await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: { walletEventIds: [buy.id] } });
    expect(await ctx.prisma.walletEntryOutcome.count({ where: { walletEventId: buy.id } })).toBe(1);
  });

  it('rejects empty selection and calculates by token selection', async () => {
    const token = await setupTokenWithPair(ctx.prisma);
    const wallet = await makeWallet(ctx.prisma);
    await insertCandles(ctx.prisma, token.id, BASE_TS, 30, () => ({ o: 10, h: 11, l: 9, c: 10 }));
    await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS);
    const empty = await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: {} });
    expect(empty.statusCode).toBe(400);
    const byToken = await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: { tokens: [MINT] } });
    expect(byToken.json().processed).toBe(1);
  });

  it('never modifies the WalletEvent', async () => {
    const token = await setupTokenWithPair(ctx.prisma);
    const wallet = await makeWallet(ctx.prisma);
    await insertCandles(ctx.prisma, token.id, BASE_TS, 30, () => ({ o: 10, h: 11, l: 9, c: 10 }));
    const buy = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS);
    const before = await ctx.prisma.walletEvent.findUnique({ where: { id: buy.id } });
    await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: { walletEventIds: [buy.id] } });
    const after = await ctx.prisma.walletEvent.findUnique({ where: { id: buy.id } });
    expect(after).toEqual(before);
  });

  it('Overview reports historical candle and outcome summaries', async () => {
    const token = await setupTokenWithPair(ctx.prisma);
    const wallet = await makeWallet(ctx.prisma);
    await insertCandles(ctx.prisma, token.id, BASE_TS, 30, () => ({ o: 10, h: 11, l: 9, c: 10 }));
    const buy = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS);
    await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: { walletEventIds: [buy.id] } });

    const overview = await ctx.app.inject({ method: 'GET', url: '/api/overview' });
    const h = overview.json().historical;
    expect(h.tokensWithCandles).toBe(1);
    expect(h.totalCandles).toBe(30);
    expect(h.eligibleBuyEvents).toBe(1);
    // The 30-minute series can't cover the full 24h horizon → PARTIAL outcome.
    expect(h.buysWithPartialOutcome + h.buysWithCompleteOutcome).toBe(1);
    expect(h.lastBackfillStatus).toBeDefined();
  });

  it('GET routes return the stored outcome and list', async () => {
    const token = await setupTokenWithPair(ctx.prisma);
    const wallet = await makeWallet(ctx.prisma);
    await insertCandles(ctx.prisma, token.id, BASE_TS, 30, () => ({ o: 10, h: 11, l: 9, c: 10 }));
    const buy = await makeBuy(ctx.prisma, wallet.id, token.id, BASE_TS);
    await ctx.app.inject({ method: 'POST', url: '/api/wallet-entry-outcomes/calculate', payload: { walletEventIds: [buy.id] } });

    const single = await ctx.app.inject({ method: 'GET', url: `/api/wallet-entry-outcomes/${buy.id}` });
    expect(single.statusCode).toBe(200);
    expect(single.json().walletEventId).toBe(buy.id);

    const list = await ctx.app.inject({ method: 'GET', url: `/api/wallet-entry-outcomes?tokenId=${token.id}` });
    expect(list.json().total).toBe(1);

    const missing = await ctx.app.inject({ method: 'GET', url: '/api/wallet-entry-outcomes/nonexistent' });
    expect(missing.statusCode).toBe(404);
  });
});
