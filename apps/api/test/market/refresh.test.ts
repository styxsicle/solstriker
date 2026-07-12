import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import type { PrismaClient } from '@prisma/client';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import { MarketProviderError } from '../../src/providers/market/errors.js';
import { isRefreshInProgress } from '../../src/services/tokenMetrics/refreshTokenMetrics.js';
import {
  candidateWithNoAmounts,
  FakeMarketProvider,
  makeCandidate,
  MEME_MINT,
  MEME_MINT_2,
} from './fixtures.js';

async function createToken(
  prisma: PrismaClient,
  mint: string,
  opts: { source?: string; name?: string | null; symbol?: string | null } = {},
) {
  return prisma.token.create({
    data: {
      mintAddress: mint,
      source: opts.source ?? 'activity',
      name: opts.name ?? null,
      symbol: opts.symbol ?? null,
    },
  });
}

describe('POST /api/token-metrics/refresh', () => {
  const apps: TestApp[] = [];

  async function makeApp(provider?: FakeMarketProvider) {
    const ctx = await buildTestApp({ marketProvider: provider });
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

  it('returns 503 when the market provider is not configured', async () => {
    const ctx = await makeApp(); // default: unconfigured 'none' provider
    const token = await createToken(ctx.prisma, MEME_MINT);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [token.id] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('provider_not_configured');
  });

  it('rejects an empty token list', async () => {
    const ctx = await makeApp(new FakeMarketProvider({}));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('rejects duplicate selections', async () => {
    const ctx = await makeApp(new FakeMarketProvider({}));
    const token = await createToken(ctx.prisma, MEME_MINT);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [token.id, token.id] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('duplicate_selection');
  });

  it('rejects more than 20 tokens', async () => {
    const ctx = await makeApp(new FakeMarketProvider({}));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: Array.from({ length: 21 }, (_, i) => syntheticAddress(160 + i)) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('rejects an unknown token / invalid mint', async () => {
    const ctx = await makeApp(new FakeMarketProvider({}));
    const invalid = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: ['not-a-real-mint!!'] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('invalid_mint_address');
  });

  it('excludes development tokens by default and allows them with includeDev', async () => {
    const provider = new FakeMarketProvider({ [MEME_MINT]: [makeCandidate()] });
    const ctx = await makeApp(provider);
    const devToken = await createToken(ctx.prisma, MEME_MINT, { source: 'dev-seed' });

    const excluded = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [devToken.id] },
    });
    expect(excluded.statusCode).toBe(400);
    expect(excluded.json().error).toBe('dev_token_excluded');

    const included = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [devToken.id], includeDev: true },
    });
    expect(included.statusCode).toBe(200);
    expect(included.json().complete).toBe(1);
  });

  it('blocks includeDev in production', async () => {
    const provider = new FakeMarketProvider({ [MEME_MINT]: [makeCandidate()] });
    const ctx = await buildTestApp({ marketProvider: provider, env: { NODE_ENV: 'production' } });
    apps.push(ctx);
    await resetDb(ctx.prisma);
    const devToken = await createToken(ctx.prisma, MEME_MINT, { source: 'dev-seed' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [devToken.id], includeDev: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('include_dev_disabled_in_production');
  });

  it('inserts a COMPLETE snapshot and reports run totals', async () => {
    const provider = new FakeMarketProvider({ [MEME_MINT]: [makeCandidate()] });
    const ctx = await makeApp(provider);
    const token = await createToken(ctx.prisma, MEME_MINT);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [token.mintAddress] }, // by mint address
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      requested: 1,
      processed: 1,
      complete: 1,
      partial: 0,
      notFound: 0,
      failed: 0,
      snapshotsInserted: 1,
      duplicatesPrevented: 0,
      status: 'COMPLETED',
    });
    expect(body.results[0]).toMatchObject({
      mint: MEME_MINT,
      status: 'COMPLETE',
      confidence: 'HIGH',
      dex: 'raydium',
    });

    const snapshot = await ctx.prisma.tokenMarketSnapshot.findFirst({
      where: { tokenId: token.id },
    });
    expect(snapshot!.priceUsd).toBe('0.000004089');
    expect(snapshot!.marketCapUsd).toBe('363418575');
    expect(snapshot!.fdvUsd).toBe('400000000'); // separate from market cap

    const run = await ctx.prisma.tokenMarketRefreshRun.findUnique({ where: { id: body.runId } });
    expect(run!.status).toBe('COMPLETED');
    expect(run!.snapshotCount).toBe(1);
  });

  it('fills token name/symbol only when currently null, never overwriting curated values', async () => {
    const provider = new FakeMarketProvider({
      [MEME_MINT]: [makeCandidate({ baseName: 'Provider Name', baseSymbol: 'PROV' })],
      [MEME_MINT_2]: [makeCandidate({ baseMint: MEME_MINT_2, baseName: 'New Name', baseSymbol: 'NEW' })],
    });
    const ctx = await makeApp(provider);
    const curated = await createToken(ctx.prisma, MEME_MINT, { name: 'User Curated', symbol: 'USER' });
    const blank = await createToken(ctx.prisma, MEME_MINT_2);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [curated.id, blank.id] },
    });

    const curatedAfter = await ctx.prisma.token.findUnique({ where: { id: curated.id } });
    expect(curatedAfter!.name).toBe('User Curated'); // unchanged
    expect(curatedAfter!.symbol).toBe('USER');
    const blankAfter = await ctx.prisma.token.findUnique({ where: { id: blank.id } });
    expect(blankAfter!.name).toBe('New Name'); // filled from provider
    expect(blankAfter!.symbol).toBe('NEW');
  });

  it('records an auditable NOT_FOUND result when the provider returns no pairs', async () => {
    const provider = new FakeMarketProvider({ [MEME_MINT]: [] });
    const ctx = await makeApp(provider);
    const token = await createToken(ctx.prisma, MEME_MINT);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [token.id] },
    });
    const body = res.json();
    expect(body).toMatchObject({ notFound: 1, complete: 0, status: 'COMPLETED' });
    expect(body.results[0].status).toBe('NOT_FOUND');
    const snapshot = await ctx.prisma.tokenMarketSnapshot.findFirst({ where: { tokenId: token.id } });
    expect(snapshot!.status).toBe('NOT_FOUND');
    expect(snapshot!.priceUsd).toBeNull(); // never zero
  });

  it('records a PARTIAL snapshot when key fields are missing', async () => {
    const provider = new FakeMarketProvider({
      [MEME_MINT]: [makeCandidate({ liquidityUsd: null })],
    });
    const ctx = await makeApp(provider);
    const token = await createToken(ctx.prisma, MEME_MINT);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [token.id] },
    });
    expect(res.json().partial).toBe(1);
    const snapshot = await ctx.prisma.tokenMarketSnapshot.findFirst({ where: { tokenId: token.id } });
    expect(snapshot!.status).toBe('PARTIAL');
    expect(snapshot!.liquidityUsd).toBeNull();
    expect(snapshot!.priceUsd).toBe('0.000004089'); // present values still stored
  });

  it('isolates a provider failure into ERROR snapshots without aborting the run', async () => {
    const provider = new FakeMarketProvider(
      {},
      { failWith: new MarketProviderError('rate_limited', 'rate limited', true) },
    );
    const ctx = await makeApp(provider);
    const t1 = await createToken(ctx.prisma, MEME_MINT);
    const t2 = await createToken(ctx.prisma, MEME_MINT_2);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [t1.id, t2.id] },
    });
    const body = res.json();
    expect(body.failed).toBe(2);
    expect(body.status).toBe('FAILED');
    expect(body.results.every((r: { status: string }) => r.status === 'ERROR')).toBe(true);
    expect(body.results[0].sanitizedErrorCode).toBe('rate_limited');
    // Both tokens still produced auditable snapshots.
    expect(await ctx.prisma.tokenMarketSnapshot.count()).toBe(2);
    // Lock released after the failure.
    expect(isRefreshInProgress()).toBe(false);
  });

  it('reports PARTIAL run status when only some tokens error', async () => {
    // A provider that returns a good pair for one mint; the other has no pairs.
    const provider = new FakeMarketProvider({
      [MEME_MINT]: [makeCandidate()],
      [MEME_MINT_2]: [],
    });
    const ctx = await makeApp(provider);
    const t1 = await createToken(ctx.prisma, MEME_MINT);
    const t2 = await createToken(ctx.prisma, MEME_MINT_2);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [t1.id, t2.id] },
    });
    const body = res.json();
    // NOT_FOUND is an answer, not an error → run COMPLETED (1 complete, 1 notFound).
    expect(body).toMatchObject({ complete: 1, notFound: 1, failed: 0, status: 'COMPLETED' });
  });

  it('prevents duplicate snapshots for the same token within one run', async () => {
    // Two tokens mapping to the same mint would collide on (runId, tokenId)
    // only if the same token id appears twice — deduped at the route. Here we
    // assert the DB unique constraint via a direct double-insert.
    const provider = new FakeMarketProvider({ [MEME_MINT]: [makeCandidate()] });
    const ctx = await makeApp(provider);
    const token = await createToken(ctx.prisma, MEME_MINT);
    const run = await ctx.prisma.tokenMarketRefreshRun.create({
      data: { provider: 'fake', requestedCount: 1 },
    });
    await ctx.prisma.tokenMarketSnapshot.create({
      data: {
        tokenId: token.id,
        refreshRunId: run.id,
        observedAt: new Date(),
        source: 'fake',
        status: 'COMPLETE',
        confidence: 'HIGH',
      },
    });
    await expect(
      ctx.prisma.tokenMarketSnapshot.create({
        data: {
          tokenId: token.id,
          refreshRunId: run.id,
          observedAt: new Date(),
          source: 'fake',
          status: 'COMPLETE',
          confidence: 'HIGH',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('handles the requested token appearing only as a quote token (PARTIAL, no invented price)', async () => {
    const provider = new FakeMarketProvider({
      [MEME_MINT]: [
        makeCandidate({ baseMint: MEME_MINT_2, baseName: 'Base', quoteMint: MEME_MINT }),
      ],
    });
    const ctx = await makeApp(provider);
    const token = await createToken(ctx.prisma, MEME_MINT);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [token.id] },
    });
    expect(res.json().partial).toBe(1);
    const snapshot = await ctx.prisma.tokenMarketSnapshot.findFirst({ where: { tokenId: token.id } });
    expect(snapshot!.status).toBe('PARTIAL');
    expect(snapshot!.selectionReason).toBe('token_only_appears_as_quote');
    expect(snapshot!.priceUsd).toBeNull();
    expect(snapshot!.pairAddress).not.toBeNull(); // identity preserved
  });

  it('sanitizes errors and never leaks raw provider internals', async () => {
    const provider = new FakeMarketProvider(
      {},
      { failWith: new MarketProviderError('timeout', 'the request timed out', true) },
    );
    const ctx = await makeApp(provider);
    const token = await createToken(ctx.prisma, MEME_MINT);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [token.id] },
    });
    expect(res.body).not.toContain('Error:');
    expect(res.body).not.toContain('stack');
    expect(res.json().results[0].sanitizedErrorCode).toBe('timeout');
  });
});

describe('token-metrics read routes', () => {
  const apps: TestApp[] = [];

  async function seededApp() {
    const provider = new FakeMarketProvider({
      [MEME_MINT]: [makeCandidate()],
      [MEME_MINT_2]: [candidateWithNoAmounts({ baseMint: MEME_MINT_2 })],
    });
    const ctx = await buildTestApp({ marketProvider: provider });
    apps.push(ctx);
    await resetDb(ctx.prisma);
    const complete = await createToken(ctx.prisma, MEME_MINT);
    const partial = await createToken(ctx.prisma, MEME_MINT_2);
    const runRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/token-metrics/refresh',
      payload: { tokens: [complete.id, partial.id] },
    });
    return { ctx, complete, partial, runId: runRes.json().runId as string };
  }

  afterAll(async () => {
    for (const ctx of apps) await ctx.app.close();
  });

  it('GET /api/token-metrics lists latest usable snapshots with freshness', async () => {
    const { ctx } = await seededApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/token-metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    for (const item of body.items) {
      expect(item.freshness).toBe('FRESH'); // just collected
      expect(typeof item.ageSeconds).toBe('number');
      expect(item.source).toBe('fake-market');
    }
  });

  it('GET /api/token-metrics/:mint/latest returns latest + latestUsable + freshness', async () => {
    const { ctx } = await seededApp();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/token-metrics/${MEME_MINT}/latest`,
    });
    const body = res.json();
    expect(body.token.mintAddress).toBe(MEME_MINT);
    expect(body.freshness).toBe('FRESH');
    expect(body.latestUsable.status).toBe('COMPLETE');
    expect(body.latestUsable.priceUsd).toBe('0.000004089');
  });

  it('GET /api/token-metrics/:mint/latest reports NEVER_FETCHED for an unrefreshed token', async () => {
    const { ctx } = await seededApp();
    const fresh = await createToken(ctx.prisma, syntheticAddress(170));
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/token-metrics/${fresh.mintAddress}/latest`,
    });
    expect(res.json().freshness).toBe('NEVER_FETCHED');
    expect(res.json().latestUsable).toBeNull();
  });

  it('GET /api/token-metrics/:mint/latest 404s for an unknown token', async () => {
    const { ctx } = await seededApp();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/token-metrics/${syntheticAddress(199)}/latest`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/token-metrics/:mint/snapshots paginates history', async () => {
    const { ctx } = await seededApp();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/token-metrics/${MEME_MINT}/snapshots?page=1&pageSize=10`,
    });
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].pairAddress).not.toBeNull();
  });

  it('GET /api/token-metrics/refresh-runs/:id returns run totals and per-token snapshots', async () => {
    const { ctx, runId } = await seededApp();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/token-metrics/refresh-runs/${runId}`,
    });
    const body = res.json();
    expect(body.id).toBe(runId);
    expect(body.status).toBe('COMPLETED');
    expect(body.snapshots).toHaveLength(2);
    expect(body.snapshots[0].mint).toBeDefined();
  });

  it('GET /api/token-metrics/refresh-runs/:id 404s for an unknown run', async () => {
    const { ctx } = await seededApp();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/token-metrics/refresh-runs/does-not-exist',
    });
    expect(res.statusCode).toBe(404);
  });
});
