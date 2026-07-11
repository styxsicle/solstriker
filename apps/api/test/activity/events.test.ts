import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';

const W1 = syntheticAddress(85);
const W2 = syntheticAddress(86);
const MINT = syntheticAddress(87);

describe('GET /api/activity/events', () => {
  let ctx: TestApp;
  let walletId1: string;
  let walletId2: string;
  let tokenId: string;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const w1 = await ctx.prisma.trackedWallet.create({
      data: { address: W1, label: 'events wallet 1', source: 'manual' },
    });
    const w2 = await ctx.prisma.trackedWallet.create({
      data: { address: W2, label: 'events wallet 2', source: 'manual' },
    });
    walletId1 = w1.id;
    walletId2 = w2.id;
    const token = await ctx.prisma.token.create({
      data: { mintAddress: MINT, symbol: 'FAKE', source: 'activity' },
    });
    tokenId = token.id;

    const rows = [
      { walletId: walletId1, eventType: 'BUY', signature: 'e-1', minutesAgo: 1 },
      { walletId: walletId1, eventType: 'SELL', signature: 'e-2', minutesAgo: 2 },
      { walletId: walletId2, eventType: 'BUY', signature: 'e-3', minutesAgo: 3 },
      { walletId: walletId2, eventType: 'TOKEN_TRANSFER_IN', signature: 'e-4', minutesAgo: 4 },
    ];
    for (const row of rows) {
      await ctx.prisma.walletEvent.create({
        data: {
          dedupeKey: `${row.walletId}:${row.signature}:${row.eventType}:${MINT}`,
          walletId: row.walletId,
          tokenId,
          signature: row.signature,
          eventType: row.eventType,
          tokenAmount: 100,
          quoteMint: 'SOL',
          quoteAmount: 0.5,
          source: 'PUMP_FUN',
          blockTime: new Date(Date.now() - row.minutesAgo * 60_000),
        },
      });
    }
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('lists events newest first with wallet and token info', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/activity/events' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
    expect(body.items.map((e: { signature: string }) => e.signature)).toEqual([
      'e-1',
      'e-2',
      'e-3',
      'e-4',
    ]);
    expect(body.items[0].wallet).toMatchObject({ address: W1, label: 'events wallet 1' });
    expect(body.items[0].token).toMatchObject({ mintAddress: MINT, symbol: 'FAKE' });
  });

  it('filters by wallet, token, and event type', async () => {
    const byWallet = await ctx.app.inject({
      method: 'GET',
      url: `/api/activity/events?walletId=${walletId2}`,
    });
    expect(byWallet.json().total).toBe(2);

    const byType = await ctx.app.inject({
      method: 'GET',
      url: '/api/activity/events?eventType=BUY',
    });
    expect(byType.json().total).toBe(2);

    const combined = await ctx.app.inject({
      method: 'GET',
      url: `/api/activity/events?walletId=${walletId1}&eventType=SELL&tokenId=${tokenId}`,
    });
    expect(combined.json().total).toBe(1);
    expect(combined.json().items[0].signature).toBe('e-2');
  });

  it('paginates', async () => {
    const page1 = await ctx.app.inject({
      method: 'GET',
      url: '/api/activity/events?page=1&pageSize=3',
    });
    expect(page1.json().items).toHaveLength(3);
    const page2 = await ctx.app.inject({
      method: 'GET',
      url: '/api/activity/events?page=2&pageSize=3',
    });
    expect(page2.json().items).toHaveLength(1);
    expect(page2.json().total).toBe(4);
  });

  it('rejects unknown event types', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/activity/events?eventType=YOLO',
    });
    expect(res.statusCode).toBe(400);
  });
});
