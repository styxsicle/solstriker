/**
 * Focus-cohort CRUD. A cohort is a user grouping only — these tests pin down
 * that it never asserts ownership and never deletes wallets or research data.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import { resetIds, seedWallet } from './fixtures.js';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await buildTestApp();
  await resetDb(ctx.prisma);
  resetIds();
});

const post = (payload: unknown) =>
  ctx.app.inject({ method: 'POST', url: '/api/focus-cohorts', payload });

async function wallets(count: number, labelPrefix?: string) {
  const created = [];
  for (let index = 0; index < count; index += 1) {
    created.push(
      (
        await seedWallet(ctx.prisma, {
          seed: 20_000 + index,
          label: labelPrefix ? `${labelPrefix} ${index}` : null,
          cycles: [],
        })
      ).wallet,
    );
  }
  return created;
}

describe('focus cohorts', () => {
  it('creates a cohort with one primary wallet and ordered comparison wallets', async () => {
    const [a, b, c] = await wallets(3);
    const response = await post({
      name: 'Focus cohort A',
      description: 'User-selected wallets, possibly related.',
      members: [
        { trackedWalletId: a.id, role: 'PRIMARY' },
        { trackedWalletId: c.id, role: 'COMPARISON', displayOrder: 1, notes: 'similar observed timing' },
        { trackedWalletId: b.id, role: 'COMPARISON', displayOrder: 0 },
      ],
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.memberCount).toBe(3);
    // PRIMARY first, then the user's own comparison order — never a ranking.
    expect(body.members.map((m: { trackedWalletId: string }) => m.trackedWalletId)).toEqual([a.id, b.id, c.id]);
    expect(body.members[0].role).toBe('PRIMARY');
    expect(body.warningCodes).toContain('OWNERSHIP_NOT_ESTABLISHED');
  });

  it('warns that similar labels alone prove nothing', async () => {
    const [a, b] = await wallets(2, 'bn');
    const body = (
      await post({
        name: 'Similar labels',
        members: [
          { trackedWalletId: a.id, role: 'PRIMARY' },
          { trackedWalletId: b.id, role: 'COMPARISON' },
        ],
      })
    ).json();
    expect(body.warningCodes).toEqual(
      expect.arrayContaining(['OWNERSHIP_NOT_ESTABLISHED', 'POSSIBLE_SHARED_LABEL_ONLY']),
    );
  });

  it('requires exactly one primary wallet', async () => {
    const [a, b] = await wallets(2);
    const none = await post({
      name: 'No primary',
      members: [
        { trackedWalletId: a.id, role: 'COMPARISON' },
        { trackedWalletId: b.id, role: 'COMPARISON' },
      ],
    });
    expect(none.json().error).toBe('exactly_one_primary_required');
    const two = await post({
      name: 'Two primaries',
      members: [
        { trackedWalletId: a.id, role: 'PRIMARY' },
        { trackedWalletId: b.id, role: 'PRIMARY' },
      ],
    });
    expect(two.json().error).toBe('exactly_one_primary_required');
  });

  it('rejects more than ten members, duplicates, unknown and development wallets', async () => {
    const many = await wallets(11);
    const tooMany = await post({
      name: 'Too many',
      members: many.map((wallet, index) => ({
        trackedWalletId: wallet.id,
        role: index === 0 ? 'PRIMARY' : 'COMPARISON',
      })),
    });
    expect(tooMany.statusCode).toBe(400);

    const ten = await post({
      name: 'Exactly ten',
      members: many.slice(0, 10).map((wallet, index) => ({
        trackedWalletId: wallet.id,
        role: index === 0 ? 'PRIMARY' : 'COMPARISON',
      })),
    });
    expect(ten.statusCode).toBe(201);
    expect(ten.json().memberCount).toBe(10); // one primary + nine comparisons

    expect(
      (
        await post({
          name: 'Duplicate member',
          members: [
            { trackedWalletId: many[0].id, role: 'PRIMARY' },
            { trackedWalletId: many[0].id, role: 'COMPARISON' },
          ],
        })
      ).json().error,
    ).toBe('duplicate_member');

    expect(
      (await post({ name: 'Unknown', members: [{ trackedWalletId: 'missing', role: 'PRIMARY' }] })).json().error,
    ).toBe('unknown_wallet');

    const dev = await ctx.prisma.trackedWallet.create({
      data: { address: syntheticAddress(20_999), source: 'dev-seed' },
    });
    expect(
      (await post({ name: 'Dev', members: [{ trackedWalletId: dev.id, role: 'PRIMARY' }] })).json().error,
    ).toBe('dev_wallet_excluded');
  });

  it('rejects a duplicate cohort name', async () => {
    const [a] = await wallets(1);
    const members = [{ trackedWalletId: a.id, role: 'PRIMARY' }];
    expect((await post({ name: 'Same name', members })).statusCode).toBe(201);
    expect((await post({ name: 'Same name', members })).statusCode).toBe(409);
  });

  it('updates name, notes and membership order', async () => {
    const [a, b, c] = await wallets(3);
    const cohort = (
      await post({
        name: 'Editable',
        members: [
          { trackedWalletId: a.id, role: 'PRIMARY' },
          { trackedWalletId: b.id, role: 'COMPARISON', displayOrder: 0 },
        ],
      })
    ).json();

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/focus-cohorts/${cohort.id}`,
      payload: {
        name: 'Renamed cohort',
        description: 'Updated notes',
        members: [
          { trackedWalletId: c.id, role: 'PRIMARY', notes: 'now the focus wallet' },
          { trackedWalletId: a.id, role: 'COMPARISON', displayOrder: 0 },
          { trackedWalletId: b.id, role: 'COMPARISON', displayOrder: 1 },
        ],
      },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json();
    expect(body.name).toBe('Renamed cohort');
    expect(body.members.map((m: { trackedWalletId: string }) => m.trackedWalletId)).toEqual([c.id, a.id, b.id]);
    expect(body.members[0].notes).toBe('now the focus wallet');
    expect(await ctx.prisma.focusTraderCohortMember.count()).toBe(3); // replaced, not duplicated
    expect(await ctx.prisma.trackedWallet.count()).toBe(3); // wallets untouched
  });

  it('deletes a cohort without deleting wallets, events or analysis records', async () => {
    const { wallet } = await seedWallet(ctx.prisma, {
      seed: 21_500,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] }],
    });
    const cohort = (
      await post({ name: 'Disposable', members: [{ trackedWalletId: wallet.id, role: 'PRIMARY' }] })
    ).json();
    await ctx.app.inject({
      method: 'POST',
      url: '/api/wallet-strategies/analyze',
      payload: { walletIds: [wallet.id] },
    });

    const before = {
      wallets: await ctx.prisma.trackedWallet.count(),
      events: await ctx.prisma.walletEvent.count(),
      positions: await ctx.prisma.walletPosition.count(),
      fingerprints: await ctx.prisma.walletStrategyFingerprint.count(),
    };
    const deleted = await ctx.app.inject({ method: 'DELETE', url: `/api/focus-cohorts/${cohort.id}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ deleted: true, walletsDeleted: 0, analysisRecordsDeleted: 0 });

    expect(await ctx.prisma.focusTraderCohort.count()).toBe(0);
    expect(await ctx.prisma.focusTraderCohortMember.count()).toBe(0); // membership rows only
    expect(await ctx.prisma.trackedWallet.count()).toBe(before.wallets);
    expect(await ctx.prisma.walletEvent.count()).toBe(before.events);
    expect(await ctx.prisma.walletPosition.count()).toBe(before.positions);
    expect(await ctx.prisma.walletStrategyFingerprint.count()).toBe(before.fingerprints);
    expect(
      (await ctx.app.inject({ method: 'DELETE', url: `/api/focus-cohorts/${cohort.id}` })).statusCode,
    ).toBe(404);
  });

  it('lists cohorts in a stable creation order and paginates', async () => {
    const created = await wallets(3);
    for (const [index, wallet] of created.entries()) {
      await post({ name: `Cohort ${index}`, members: [{ trackedWalletId: wallet.id, role: 'PRIMARY' }] });
    }
    const list = (await ctx.app.inject({ method: 'GET', url: '/api/focus-cohorts' })).json();
    expect(list.total).toBe(3);
    expect(list.items.map((c: { name: string }) => c.name)).toEqual(['Cohort 0', 'Cohort 1', 'Cohort 2']);
    const page = (
      await ctx.app.inject({ method: 'GET', url: '/api/focus-cohorts?page=2&pageSize=1' })
    ).json();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe('Cohort 1');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/focus-cohorts/missing' })).statusCode).toBe(404);
  });

  it('reports per-member data readiness and missing prerequisites without fixing them', async () => {
    const ready = await seedWallet(ctx.prisma, {
      seed: 22_000,
      completeHistory: true,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] }],
    });
    const notReconstructed = await seedWallet(ctx.prisma, { seed: 22_100, withReconstruction: false });

    const cohort = (
      await post({
        name: 'Readiness',
        members: [
          { trackedWalletId: ready.wallet.id, role: 'PRIMARY' },
          { trackedWalletId: notReconstructed.wallet.id, role: 'COMPARISON' },
        ],
      })
    ).json();
    const detail = (
      await ctx.app.inject({ method: 'GET', url: `/api/focus-cohorts/${cohort.id}` })
    ).json();

    const readyState = detail.readiness[ready.wallet.id];
    expect(readyState).toMatchObject({
      synchronized: true,
      backfillComplete: true,
      storedEventCount: 2,
      reconstructionStatus: 'COMPLETED',
      canAnalyze: true,
    });
    expect(readyState.missingPrerequisites).toEqual(
      expect.arrayContaining(['NO_QUALITY_ANALYSIS', 'NO_STRATEGY_FINGERPRINT']),
    );

    const blocked = detail.readiness[notReconstructed.wallet.id];
    expect(blocked).toMatchObject({ reconstructionStatus: 'NONE', canAnalyze: false, storedEventCount: 0 });
    expect(blocked.missingPrerequisites).toContain('NO_COMPLETED_RECONSTRUCTION');

    // Reading readiness must never have created any analysis work.
    expect(await ctx.prisma.walletStrategyFingerprintRun.count()).toBe(0);
    expect(await ctx.prisma.walletQualityAnalysisRun.count()).toBe(0);
  });
});
