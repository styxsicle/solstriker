import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, resetDb, type TestApp } from './helpers.js';

describe('POST /api/dev/seed', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('seeds clearly-marked development wallets and tokens', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/dev/seed' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ seededWallets: 8, seededTokens: 6 });

    const wallets = await ctx.prisma.trackedWallet.findMany();
    expect(wallets).toHaveLength(8);
    for (const wallet of wallets) {
      expect(wallet.source).toBe('dev-seed');
      expect(wallet.label).toMatch(/^\[DEV\]/);
    }

    const tokens = await ctx.prisma.token.findMany();
    expect(tokens).toHaveLength(6);
    for (const token of tokens) {
      expect(token.source).toBe('dev-seed');
      expect(token.name).toMatch(/^\[DEV\]/);
      expect(['UNCLASSIFIED', 'FINAL_STRETCH', 'MIGRATED']).toContain(token.stage);
    }
  });

  it('is idempotent across repeated calls', async () => {
    await ctx.app.inject({ method: 'POST', url: '/api/dev/seed' });
    await ctx.app.inject({ method: 'POST', url: '/api/dev/seed' });

    expect(await ctx.prisma.trackedWallet.count()).toBe(8);
    expect(await ctx.prisma.token.count()).toBe(6);
  });

  it('is disabled in production', async () => {
    const prod = await buildTestApp({ env: { NODE_ENV: 'production' } });
    const res = await prod.app.inject({ method: 'POST', url: '/api/dev/seed' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('disabled_in_production');
    expect(await prod.prisma.trackedWallet.count()).toBe(0);
    await prod.app.close();
  });
});
