import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DECODER_VERSION, syntheticAddress } from '@memecoin-lab/shared';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import { FakeProvider, nextSignature, swapBuyTx, swapSellTx } from './fixtures.js';

const WALLET_ADDR = syntheticAddress(95);
const MEME = syntheticAddress(96);

describe('POST /api/activity/resync', () => {
  const apps: TestApp[] = [];

  async function makeApp(provider: FakeProvider) {
    const ctx = await buildTestApp({ activityProvider: provider });
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

  function history(count: number) {
    return Array.from({ length: count }, (_, i) => {
      const opts = { signature: nextSignature('re'), timestamp: 1_750_300_000 - i * 60 };
      return i % 2 === 0
        ? swapBuyTx(WALLET_ADDR, MEME, { ...opts, solAmount: 1, tokenAmount: 100 })
        : swapSellTx(WALLET_ADDR, MEME, { ...opts, solAmount: 1.2, tokenAmount: 100 });
    });
  }

  it('re-decodes a wallet by clearing only its events and re-fetching (idempotent)', async () => {
    const provider = new FakeProvider({ [WALLET_ADDR]: history(6) });
    const ctx = await makeApp(provider);
    const wallet = await ctx.prisma.trackedWallet.create({
      data: { address: WALLET_ADDR, enabled: true, source: 'manual' },
    });
    // A second wallet whose data must remain untouched.
    const bystander = await ctx.prisma.trackedWallet.create({
      data: { address: syntheticAddress(97), enabled: true, source: 'manual' },
    });
    await ctx.prisma.walletEvent.create({
      data: {
        dedupeKey: 'bystander-key',
        walletId: bystander.id,
        signature: 'bystander-sig',
        eventType: 'BUY',
      },
    });

    await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id] },
    });
    expect(await ctx.prisma.walletEvent.count({ where: { walletId: wallet.id } })).toBe(6);

    // Simulate legacy rows from the old decoder.
    await ctx.prisma.walletEvent.updateMany({
      where: { walletId: wallet.id },
      data: { decoderVersion: 1, confidence: null, quoteAmount: 9.99 },
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/resync',
      payload: { walletIds: [wallet.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({
      status: 'ok',
      eventsCleared: 6,
      eventsCreated: 6,
      duplicateEvents: 0,
      backfillComplete: true,
    });

    const rows = await ctx.prisma.walletEvent.findMany({ where: { walletId: wallet.id } });
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.decoderVersion).toBe(DECODER_VERSION);
      expect(row.confidence).toBe('CONFIRMED');
      expect(row.quoteAmount).not.toBe(9.99);
    }

    // Scoped: the other wallet's event is untouched.
    expect(await ctx.prisma.walletEvent.count({ where: { walletId: bystander.id } })).toBe(1);

    // Idempotent: a second resync yields the same final state.
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/resync',
      payload: { walletIds: [wallet.id] },
    });
    expect(again.json().results[0]).toMatchObject({ eventsCleared: 6, eventsCreated: 6 });
    expect(await ctx.prisma.walletEvent.count({ where: { walletId: wallet.id } })).toBe(6);
  });

  it('applies the same validations as sync', async () => {
    const ctx = await makeApp(new FakeProvider({}));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/resync',
      payload: { walletIds: Array.from({ length: 11 }, (_, i) => `id-${i}`) },
    });
    expect(res.statusCode).toBe(400);
  });
});
