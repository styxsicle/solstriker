import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { buildTestApp, resetDb, type TestApp } from './helpers.js';

// Invented addresses only — tests never touch real wallet data.
const A = Array.from({ length: 8 }, (_, i) => syntheticAddress(50 + i));

describe('POST /api/wallets/import', () => {
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

  it('imports a valid CSV with header', async () => {
    const content = `address,label,group,notes\n${A[0]},Trader A,Main,fast fingers\n${A[1]},Trader B,Side,\n`;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets/import',
      payload: { content, filename: 'wallets.csv' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ format: 'csv', imported: 2, duplicates: 0, invalid: 0 });

    const stored = await ctx.prisma.trackedWallet.findUnique({ where: { address: A[0] } });
    expect(stored).toMatchObject({
      label: 'Trader A',
      group: 'Main',
      notes: 'fast fingers',
      source: 'import:csv',
      enabled: true,
    });
  });

  it('imports plain text and rejects invalid lines', async () => {
    const content = `${A[2]}\nnot-a-wallet\n\n${A[3]}\n`;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets/import',
      payload: { content, format: 'text' },
    });
    const body = res.json();
    expect(body).toMatchObject({ format: 'text', imported: 2, invalid: 1, skipped: 1 });
    expect(body.invalidSamples[0]).toMatchObject({ line: 2, reason: 'invalid_address' });
  });

  it('imports the JSON tracker-export format and preserves metadata', async () => {
    const content = JSON.stringify([
      {
        trackedWalletAddress: A[4],
        name: 'Fake JSON Trader',
        emoji: '🐸',
        alertsOnToast: true,
        alertsOnBubble: true,
        alertsOnFeed: false,
        groups: ['Main', 'Insiders'],
        sound: 'ding',
      },
      { trackedWalletAddress: A[5], name: 'Second Fake', groups: ['Main'] },
      { trackedWalletAddress: 'bogus-address', name: 'Broken' },
    ]);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets/import',
      payload: { content, filename: 'export.txt' }, // .txt file containing JSON — must auto-detect
    });
    const body = res.json();
    expect(body).toMatchObject({ format: 'json', imported: 2, invalid: 1, duplicates: 0 });

    const stored = await ctx.prisma.trackedWallet.findUnique({ where: { address: A[4] } });
    expect(stored).toMatchObject({
      label: 'Fake JSON Trader',
      emoji: '🐸',
      group: 'Main',
      source: 'import:json',
    });
    expect(JSON.parse(stored!.groupsJson!)).toEqual(['Main', 'Insiders']);
    expect(JSON.parse(stored!.metaJson!)).toEqual({
      alertsOnToast: true,
      alertsOnBubble: true,
      alertsOnFeed: false,
      sound: 'ding',
    });
  });

  it('counts duplicates within a file and against the database', async () => {
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets/import',
      payload: { content: `${A[6]}\n`, format: 'text' },
    });
    expect(first.json().imported).toBe(1);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets/import',
      payload: { content: `${A[6]}\n${A[7]}\n${A[7]}\n`, format: 'text' },
    });
    expect(second.json()).toMatchObject({ imported: 1, duplicates: 2, invalid: 0 });
  });

  it('is idempotent: re-importing the same file creates nothing new', async () => {
    const content = JSON.stringify([
      { trackedWalletAddress: A[0], name: 'One', groups: ['Main'] },
      { trackedWalletAddress: A[1], name: 'Two', groups: ['Side'] },
    ]);
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets/import',
      payload: { content, format: 'json' },
    });
    expect(first.json().imported).toBe(2);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/wallets/import',
      payload: { content, format: 'json' },
    });
    expect(second.json()).toMatchObject({ imported: 0, duplicates: 2 });

    expect(await ctx.prisma.trackedWallet.count()).toBe(2);
  });
});
