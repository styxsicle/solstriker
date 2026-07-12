import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { buildTestApp, resetDb, type TestApp } from './helpers.js';

const REAL_WALLET = syntheticAddress(110);
const MINT = syntheticAddress(111);

describe('overview and activity summary (read-only)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    // One real wallet with sync state + events, plus dev-seed data.
    const wallet = await ctx.prisma.trackedWallet.create({
      data: { address: REAL_WALLET, label: 'summary wallet', enabled: true, source: 'manual' },
    });
    await ctx.prisma.walletSyncState.create({
      data: { walletId: wallet.id, status: 'idle', totalTransactions: 42, totalEvents: 3 },
    });
    const token = await ctx.prisma.token.create({
      data: { mintAddress: MINT, source: 'activity' },
    });
    const rows = [
      { eventType: 'BUY', confidence: 'CONFIRMED', decoderVersion: 2 },
      { eventType: 'SELL', confidence: 'LIKELY', decoderVersion: 2 },
      { eventType: 'TOKEN_TRANSFER_IN', confidence: 'UNKNOWN', decoderVersion: 1 },
    ];
    for (const [i, row] of rows.entries()) {
      await ctx.prisma.walletEvent.create({
        data: {
          dedupeKey: `sum-${i}`,
          walletId: wallet.id,
          tokenId: token.id,
          signature: `sum-sig-${i}`,
          ...row,
        },
      });
    }
    await ctx.app.inject({ method: 'POST', url: '/api/dev/seed' });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('GET /api/overview reports database counts including dev records', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.wallets).toEqual({ total: 9, enabled: 8, dev: 8 }); // 1 real + 8 seeded (1 disabled)
    expect(body.activity).toEqual({ syncedWallets: 1, storedEvents: 3 });
    expect(body.tokens).toEqual({ total: 7, dev: 6 }); // 1 activity + 6 seeded
  });

  it('GET /api/activity/summary counts types, confidence, and legacy events', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/activity/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      transactionsChecked: 42,
      eventsStored: 3,
      buys: 1,
      sells: 1,
      transfersIn: 1,
      transfersOut: 0,
      confirmed: 1,
      likely: 1,
      unknownConfidence: 1,
      legacyEvents: 1,
    });
  });

  it('GET /api/wallets?includeDev=false hides dev-seed wallets only', async () => {
    const hidden = await ctx.app.inject({
      method: 'GET',
      url: '/api/wallets?includeDev=false&pageSize=50',
    });
    expect(hidden.json().total).toBe(1);
    expect(hidden.json().items[0].address).toBe(REAL_WALLET);

    const all = await ctx.app.inject({ method: 'GET', url: '/api/wallets?pageSize=50' });
    expect(all.json().total).toBe(9); // absent param keeps prior behavior
  });

  it('GET /api/tokens?includeDev=false hides dev-seed tokens only', async () => {
    const hidden = await ctx.app.inject({ method: 'GET', url: '/api/tokens?includeDev=false' });
    expect(hidden.json().total).toBe(1);
    expect(hidden.json().items[0].mintAddress).toBe(MINT);

    const all = await ctx.app.inject({ method: 'GET', url: '/api/tokens' });
    expect(all.json().total).toBe(7);
  });
});
