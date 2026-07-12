import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import { FakeMarketProvider, makeCandidate, MEME_MINT, MEME_MINT_2 } from './fixtures.js';

describe('Tokens API market-data integration', () => {
  const apps: TestApp[] = [];
  let ctx: TestApp;

  beforeEach(async () => {
    const provider = new FakeMarketProvider({ [MEME_MINT]: [makeCandidate()] });
    ctx = await buildTestApp({ marketProvider: provider });
    apps.push(ctx);
    await resetDb(ctx.prisma);
    // One token with market data, one without, one dev token.
    const withMarket = await ctx.prisma.token.create({
      data: { mintAddress: MEME_MINT, source: 'activity' },
    });
    await ctx.prisma.token.create({ data: { mintAddress: MEME_MINT_2, source: 'activity' } });
    await ctx.prisma.token.create({
      data: { mintAddress: 'DevTokenMint1111111111111111111111111111111', source: 'dev-seed' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [withMarket.id] },
    });
  });

  afterAll(async () => {
    for (const c of apps) await c.app.close();
  });

  it('does not attach market data unless withMarket=true (backward compatible)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/tokens?includeDev=false' });
    const body = res.json();
    expect(body.items[0].market).toBeUndefined();
    expect(body.total).toBe(2); // dev token hidden
  });

  it('attaches the latest snapshot with withMarket=true', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/tokens?includeDev=false&withMarket=true',
    });
    const items = res.json().items as { mintAddress: string; market: unknown }[];
    const withData = items.find((i) => i.mintAddress === MEME_MINT);
    const withoutData = items.find((i) => i.mintAddress === MEME_MINT_2);
    expect(withData!.market).not.toBeNull();
    expect(withoutData!.market).toBeNull(); // missing data is null, never zero
  });

  it('filters by market-data presence', async () => {
    const withData = await ctx.app.inject({
      method: 'GET',
      url: '/api/tokens?includeDev=false&withMarket=true&marketData=with',
    });
    expect(withData.json().total).toBe(1);
    const without = await ctx.app.inject({
      method: 'GET',
      url: '/api/tokens?includeDev=false&withMarket=true&marketData=without',
    });
    expect(without.json().total).toBe(1);
  });

  it('sorts by market cap with unknown values last', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/tokens?includeDev=false&withMarket=true&sort=marketCap',
    });
    const items = res.json().items as { mintAddress: string }[];
    expect(items[0].mintAddress).toBe(MEME_MINT); // has market cap → first
    expect(items[1].mintAddress).toBe(MEME_MINT_2); // no data → last
  });
});

describe('Overview market summary', () => {
  const apps: TestApp[] = [];

  afterAll(async () => {
    for (const c of apps) await c.app.close();
  });

  it('counts non-dev tokens, snapshots, freshness, and last refresh', async () => {
    const provider = new FakeMarketProvider({ [MEME_MINT]: [makeCandidate()] });
    const ctx = await buildTestApp({ marketProvider: provider });
    apps.push(ctx);
    await resetDb(ctx.prisma);

    const refreshed = await ctx.prisma.token.create({
      data: { mintAddress: MEME_MINT, source: 'activity' },
    });
    await ctx.prisma.token.create({ data: { mintAddress: MEME_MINT_2, source: 'activity' } });
    await ctx.prisma.token.create({
      data: { mintAddress: 'DevMint111111111111111111111111111111111111', source: 'dev-seed' },
    });

    const before = await ctx.app.inject({ method: 'GET', url: '/api/overview' });
    expect(before.json().market).toMatchObject({
      nonDevTokens: 2,
      withSnapshots: 0,
      neverRefreshed: 2,
      fresh: 0,
      lastSuccessfulRefreshAt: null,
      lastRunStatus: null,
    });

    await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [refreshed.id] },
    });

    const after = await ctx.app.inject({ method: 'GET', url: '/api/overview' });
    const market = after.json().market;
    expect(market.nonDevTokens).toBe(2);
    expect(market.withSnapshots).toBe(1);
    expect(market.neverRefreshed).toBe(1);
    expect(market.fresh).toBe(1); // just collected
    expect(market.lastRunStatus).toBe('COMPLETED');
    expect(typeof market.lastSuccessfulRefreshAt).toBe('string');
  });
});
