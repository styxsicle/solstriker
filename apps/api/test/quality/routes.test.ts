import { beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';

let ctx: TestApp;
beforeEach(async () => { ctx = await buildTestApp(); await resetDb(ctx.prisma); });

async function fixture() {
  const wallet = await ctx.prisma.trackedWallet.create({ data: { address: syntheticAddress(12001), source: 'activity' } });
  const token = await ctx.prisma.token.create({ data: { mintAddress: syntheticAddress(12002), source: 'activity' } });
  const run = await ctx.prisma.walletPositionReconstructionRun.create({ data: { id: 'latest-reconstruction', status: 'COMPLETED', completedAt: new Date('2026-01-02') } });
  await ctx.prisma.walletBehaviorProfile.create({ data: { reconstructionRunId: run.id, trackedWalletId: wallet.id, status: 'PARTIAL', confidence: 'LOW', completeHistory: false } });
  await ctx.prisma.walletPosition.create({ data: { reconstructionRunId: run.id, trackedWalletId: wallet.id, tokenId: token.id, cycleNumber: 1, status: 'CLOSED', confidence: 'HIGH', openedAt: new Date('2026-01-01'), closedAt: new Date('2026-01-01T01:00:00Z'), knownCostBasisSol: '1', rawRealizedPnlSol: '.2', knownAllInRealizedPnlSol: '.18', rawRealizedRoiPct: '20', knownAllInRealizedRoiPct: '18', holdingDurationSeconds: 3600, unknownBasisAmount: '0', unmatchedSellAmount: '0', warningCodes: '[]' } });
  return { wallet };
}

describe('wallet quality APIs', () => {
  it('analyzes explicitly, retains history, and reads only latest completed quality run', async () => {
    const { wallet } = await fixture();
    const first = await ctx.app.inject({ method: 'POST', url: '/api/wallet-quality/analyze', payload: { walletIds: [wallet.id] } });
    expect(first.statusCode).toBe(200);
    const second = await ctx.app.inject({ method: 'POST', url: '/api/wallet-quality/analyze', payload: { walletIds: [wallet.id] } });
    expect(second.statusCode).toBe(200);
    expect(await ctx.prisma.walletQualityAnalysisRun.count()).toBe(2);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/wallet-quality-runs/${first.json().runId}` })).statusCode).toBe(200);
    const list = (await ctx.app.inject({ method: 'GET', url: '/api/wallet-quality' })).json();
    expect(list.total).toBe(1);
    expect(list.items[0].analysisRunId).toBe(second.json().runId);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/wallet-quality/${wallet.id}/categories?categoryType=POSITION_SIZE` })).json().items.length).toBeGreaterThan(0);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/wallet-quality/${wallet.id}/time-windows` })).json().items).toHaveLength(3);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/overview' })).json().quality).toMatchObject({ walletsAnalyzed: 1, metricSetsGenerated: 1, timeWindowComparisonsGenerated: 3 });
  });
  it('rejects empty, duplicate, unknown, and development selections', async () => {
    const { wallet } = await fixture();
    expect((await ctx.app.inject({ method: 'POST', url: '/api/wallet-quality/analyze', payload: { walletIds: [] } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/wallet-quality/analyze', payload: { walletIds: [wallet.id, wallet.id] } })).json().error).toBe('duplicate_selection');
    expect((await ctx.app.inject({ method: 'POST', url: '/api/wallet-quality/analyze', payload: { walletIds: ['missing'] } })).json().error).toBe('unknown_wallet');
    const dev = await ctx.prisma.trackedWallet.create({ data: { address: syntheticAddress(12003), source: 'dev-seed' } });
    expect((await ctx.app.inject({ method: 'POST', url: '/api/wallet-quality/analyze', payload: { walletIds: [dev.id] } })).json().error).toBe('dev_wallet_excluded');
  });
});
