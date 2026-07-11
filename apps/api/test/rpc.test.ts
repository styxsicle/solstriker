import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const FAKE_KEY = 'TEST-FAKE-HELIUS-KEY-1234567890';

function okFetch(slot = 123456789): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    const result = body.method === 'getHealth' ? 'ok' : slot;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('GET /api/rpc/status', () => {
  it('starts and reports not_configured when no Helius key is set', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/rpc/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.healthy).toBeNull();
    expect(body.slot).toBeNull();
    expect(body.error).toBe('not_configured');
    await app.close();
  });

  it('reports health, slot, and latency when configured', async () => {
    const { app } = await buildTestApp({
      env: { HELIUS_API_KEY: FAKE_KEY },
      fetchImpl: okFetch(987654),
    });
    const res = await app.inject({ method: 'GET', url: '/api/rpc/status' });
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.healthy).toBe(true);
    expect(body.slot).toBe(987654);
    expect(typeof body.latencyMs).toBe('number');
    await app.close();
  });

  it('never leaks the API key or RPC URL in responses', async () => {
    const { app } = await buildTestApp({
      env: { HELIUS_API_KEY: FAKE_KEY },
      fetchImpl: okFetch(),
    });
    const res = await app.inject({ method: 'GET', url: '/api/rpc/status' });
    expect(res.body).not.toContain(FAKE_KEY);
    expect(res.body.toLowerCase()).not.toContain('helius');
    expect(res.body).not.toContain('api-key');
    await app.close();
  });

  it('sanitizes RPC failures whose error messages contain the URL/key', async () => {
    const throwingFetch: typeof fetch = async () => {
      throw new Error(`connect failed: https://mainnet.helius-rpc.com/?api-key=${FAKE_KEY}`);
    };
    const { app } = await buildTestApp({
      env: { HELIUS_API_KEY: FAKE_KEY },
      fetchImpl: throwingFetch,
    });
    const res = await app.inject({ method: 'GET', url: '/api/rpc/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.healthy).toBe(false);
    expect(body.error).toBe('rpc_error');
    expect(res.body).not.toContain(FAKE_KEY);
    expect(res.body.toLowerCase()).not.toContain('helius');
    await app.close();
  });
});
