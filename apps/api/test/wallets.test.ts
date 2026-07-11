import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { buildTestApp, resetDb, type TestApp } from './helpers.js';

// Invented addresses only.
const W1 = syntheticAddress(30);
const W2 = syntheticAddress(31);

describe('wallet CRUD routes', () => {
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

  it('creates a wallet manually and lists it', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets',
      payload: { address: W1, label: 'Manual One', group: 'Main' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      address: W1,
      label: 'Manual One',
      group: 'Main',
      groups: ['Main'],
      enabled: true,
      source: 'manual',
    });

    const list = await ctx.app.inject({ method: 'GET', url: '/api/wallets' });
    const body = list.json();
    expect(body.total).toBe(1);
    expect(body.stats).toEqual({ total: 1, enabled: 1 });
    expect(body.groups).toEqual(['Main']);
  });

  it('rejects an invalid address', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets',
      payload: { address: 'definitely-not-base58!' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_address');
  });

  it('rejects a duplicate address with 409', async () => {
    await ctx.app.inject({ method: 'POST', url: '/api/wallets', payload: { address: W1 } });
    const dup = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets',
      payload: { address: W1 },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('duplicate_address');
  });

  it('toggles enabled via PATCH', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets',
      payload: { address: W2 },
    });
    const id = created.json().id as string;

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/wallets/${id}`,
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().enabled).toBe(false);

    const list = await ctx.app.inject({ method: 'GET', url: '/api/wallets?enabled=false' });
    expect(list.json().total).toBe(1);
  });

  it('returns 404 when patching an unknown wallet', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/wallets/nonexistent-id',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('supports search and group filters', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets',
      payload: { address: W1, label: 'alpha whale', group: 'Whales' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets',
      payload: { address: W2, label: 'beta dev', group: 'Devs' },
    });

    const bySearch = await ctx.app.inject({ method: 'GET', url: '/api/wallets?search=alpha' });
    expect(bySearch.json().total).toBe(1);

    const byGroup = await ctx.app.inject({ method: 'GET', url: '/api/wallets?group=Devs' });
    expect(byGroup.json().total).toBe(1);
    expect(byGroup.json().items[0].label).toBe('beta dev');
  });
});
