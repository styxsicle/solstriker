/**
 * FOMO Simulator V1 — POST /api/fomo-simulator/calls and friends.
 *
 * Every wallet, token, event, snapshot and paper row is synthetic. The
 * action is always derived by the backend from real stored evidence — these
 * tests build the evidence and assert the derivation, the position
 * lifecycle, the pricing rules, and the zero-side-effect guarantees.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import {
  ago,
  completeReconstruction,
  coolingSetup,
  createEvent,
  createPaperCall,
  createPaperPosition,
  createPosition,
  createSnapshot,
  createToken,
  createWallet,
  distributionSetup,
  higherConfidenceSetup,
  resetIds,
  DAY,
  HOUR,
  MIN,
} from './fixtures.js';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await buildTestApp();
  await resetDb(ctx.prisma);
  resetIds();
});

const NO_COSTS = { feeRatePct: '0', entrySlippagePct: '0', exitSlippagePct: '0' };

const record = (payload: Record<string, unknown>) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/fomo-simulator/calls',
    payload: { includeLowerConfidence: true, ...payload },
  });

const summary = async () => (await ctx.app.inject({ method: 'GET', url: '/api/fomo-simulator/summary' })).json();

describe('call derivation from real stored evidence', () => {
  it('derives BUY from HOLDING + HIGHER with no open position and opens exactly one position', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 1000);
    const response = await record({ tokenId: token.id, walletIds });
    const body = response.json();
    expect(body.call.action).toBe('BUY');
    expect(body.call.conviction).toBe('HIGH');
    expect(body.call.slowCookState).toBe('HOLDING');
    expect(body.position.status).toBe('OPEN');
    expect(await ctx.prisma.paperPosition.count()).toBe(1);
  });

  it('derives BUY from BUILDING + HIGHER with no open position', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 1100, { buysPerWallet: 2 });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.slowCookState).toBe('BUILDING');
    expect(body.call.action).toBe('BUY');
  });

  it('MODERATE confidence never opens a new BUY', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 1200, { walletCount: 2 });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.slowCookConfidence).toBe('MODERATE');
    expect(body.call.action).toBe('NO_TRADE');
    expect(body.position).toBeNull();
    expect(await ctx.prisma.paperPosition.count()).toBe(0);
  });

  it('derives HOLD when an open position still has HOLDING evidence, without a duplicate position', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 1300);
    await record({ tokenId: token.id, walletIds });
    const second = (await record({ tokenId: token.id, walletIds })).json();
    expect(second.call.action).toBe('HOLD');
    expect(await ctx.prisma.paperPosition.count()).toBe(1);
    expect(await ctx.prisma.paperCall.count()).toBe(2);
  });

  it('derives EXIT from COOLING with an open position and closes it', async () => {
    const { token, walletIds } = await coolingSetup(ctx.prisma, 1400);
    await createSnapshot(ctx.prisma, token.id, { observedAt: ago(MIN), priceUsd: '0.002' });
    await createPaperPosition(ctx.prisma, { tokenId: token.id, tokenMint: token.mintAddress, walletIds });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.action).toBe('EXIT');
    expect(body.position.status).toBe('CLOSED');
    expect(body.position.realizedPlUsd).not.toBeNull();
  });

  it('derives EXIT from DISTRIBUTION_RISK with an open position', async () => {
    const { token, walletIds } = await distributionSetup(ctx.prisma, 1500);
    await createSnapshot(ctx.prisma, token.id, { observedAt: ago(MIN), priceUsd: '0.002' });
    await createPaperPosition(ctx.prisma, { tokenId: token.id, tokenMint: token.mintAddress, walletIds });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.slowCookState).toBe('DISTRIBUTION_RISK');
    expect(body.call.action).toBe('EXIT');
    expect(body.position.status).toBe('CLOSED');
  });

  it('derives AVOID from COOLING without a position and creates no position', async () => {
    const { token, walletIds } = await coolingSetup(ctx.prisma, 1600);
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.action).toBe('AVOID');
    expect(body.position).toBeNull();
    expect(await ctx.prisma.paperPosition.count()).toBe(0);
  });

  it('derives AVOID from DISTRIBUTION_RISK without a position', async () => {
    const { token, walletIds } = await distributionSetup(ctx.prisma, 1700);
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.action).toBe('AVOID');
    expect(body.position).toBeNull();
  });

  it('MIXED evidence returns NO_TRADE and leaves an open position unchanged', async () => {
    const token = await createToken(ctx.prisma, 1800);
    const buyer = await createWallet(ctx.prisma, 1801);
    const seller = await createWallet(ctx.prisma, 1802);
    await createEvent(ctx.prisma, { walletId: buyer.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(3 * HOUR) });
    await createEvent(ctx.prisma, { walletId: buyer.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(2 * HOUR) });
    const sell = await createEvent(ctx.prisma, { walletId: seller.id, tokenId: token.id, eventType: 'SELL', blockTime: ago(HOUR) });
    const run = await completeReconstruction(ctx.prisma, seller.id, [sell.id]);
    await createPosition(ctx.prisma, {
      reconstructionRunId: run.id,
      trackedWalletId: seller.id,
      tokenId: token.id,
      status: 'OPEN',
      includedEventIds: [sell.id],
    });
    const walletIds = [buyer.id, seller.id];
    const position = await createPaperPosition(ctx.prisma, { tokenId: token.id, tokenMint: token.mintAddress, walletIds });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.slowCookState).toBe('MIXED');
    expect(body.call.action).toBe('NO_TRADE');
    const after = await ctx.prisma.paperPosition.findUniqueOrThrow({ where: { id: position.id } });
    expect(after.status).toBe('OPEN');
  });

  it('INSUFFICIENT_EVIDENCE returns NO_TRADE', async () => {
    const token = await createToken(ctx.prisma, 1900);
    const wallet = await createWallet(ctx.prisma, 1901);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await record({ tokenId: token.id, walletIds: [wallet.id] })).json();
    expect(body.call.slowCookState).toBe('INSUFFICIENT_EVIDENCE');
    expect(body.call.action).toBe('NO_TRADE');
  });

  it('ignores a frontend-provided fake action entirely', async () => {
    const token = await createToken(ctx.prisma, 2000);
    const wallet = await createWallet(ctx.prisma, 2001);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await record({ tokenId: token.id, walletIds: [wallet.id], action: 'BUY' })).json();
    expect(body.call.action).toBe('NO_TRADE');
    expect(await ctx.prisma.paperPosition.count()).toBe(0);
  });
});

describe('wallet-selection scoping and cohort identity', () => {
  it('only explicitly selected wallets affect the call — unselected selling cannot leak in', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 2100);
    const unselected = await createWallet(ctx.prisma, 2190);
    for (let i = 0; i < 5; i += 1) {
      await createEvent(ctx.prisma, { walletId: unselected.id, tokenId: token.id, eventType: 'SELL', blockTime: ago(HOUR) });
    }
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.action).toBe('BUY'); // the unselected wallet's sells would have forced AVOID
    expect(body.call.walletIds).not.toContain(unselected.id);
  });

  it('wallet selection order produces the same cohort key and dedupes as the same call', async () => {
    const token = await createToken(ctx.prisma, 2200);
    const a = await createWallet(ctx.prisma, 2201);
    const b = await createWallet(ctx.prisma, 2202);
    for (const w of [a, b]) {
      await createEvent(ctx.prisma, { walletId: w.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(25 * DAY) });
    }
    const first = await record({ tokenId: token.id, walletIds: [a.id, b.id] });
    expect(first.statusCode).toBe(200);
    const second = await record({ tokenId: token.id, walletIds: [b.id, a.id] });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('duplicate_call');
    expect(await ctx.prisma.paperCall.count()).toBe(1);
  });

  it('duplicate wallet labels remain distinct wallets in the frozen evidence', async () => {
    const token = await createToken(ctx.prisma, 2300);
    const a = await createWallet(ctx.prisma, 2301, { label: 'bn' });
    const b = await createWallet(ctx.prisma, 2302, { label: 'bn' });
    for (const w of [a, b]) {
      await createEvent(ctx.prisma, { walletId: w.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    }
    const body = (await record({ tokenId: token.id, walletIds: [a.id, b.id] })).json();
    expect(body.call.evidence.walletInterest.walletsWithEvidenceCount).toBe(2);
    expect(new Set(body.call.walletAddresses).size).toBe(2);
  });

  it('rejects development wallets', async () => {
    const dev = await createWallet(ctx.prisma, 2400, { source: 'dev-seed' });
    const token = await createToken(ctx.prisma, 2401);
    const response = await record({ tokenId: token.id, walletIds: [dev.id] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('dev_wallet_excluded');
  });
});

describe('pricing rules — no invented prices, no look-ahead', () => {
  it('records an unpriced BUY when no snapshot exists; the missing price never becomes zero', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 2500);
    await ctx.prisma.tokenMarketSnapshot.deleteMany({ where: { tokenId: token.id } });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.action).toBe('BUY');
    expect(body.call.priced).toBe(false);
    expect(body.call.unpricedReason).toBe('No usable entry price was available at the time of the call.');
    expect(body.call.entryPriceUsd).toBeNull();
    expect(body.position).toBeNull();
    expect(await ctx.prisma.paperPosition.count()).toBe(0);
  });

  it('rejects a future-dated snapshot for pricing', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 2600);
    await ctx.prisma.tokenMarketSnapshot.deleteMany({ where: { tokenId: token.id } });
    await createSnapshot(ctx.prisma, token.id, { observedAt: new Date(Date.now() + HOUR) });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.priced).toBe(false);
    expect(body.call.snapshotFreshness).toBe('UNKNOWN');
    expect(body.position).toBeNull();
  });

  it('does not price against a STALE entry snapshot', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 2700);
    await ctx.prisma.tokenMarketSnapshot.deleteMany({ where: { tokenId: token.id } });
    await createSnapshot(ctx.prisma, token.id, { observedAt: ago(2 * HOUR) });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.priced).toBe(false);
    expect(body.call.snapshotFreshness).toBe('STALE');
    expect(body.position).toBeNull();
  });

  it('prices an AGING snapshot but records a visible warning', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 2800);
    await ctx.prisma.tokenMarketSnapshot.deleteMany({ where: { tokenId: token.id } });
    await createSnapshot(ctx.prisma, token.id, { observedAt: ago(30 * MIN) });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.priced).toBe(true);
    expect(body.call.warningCodes).toContain('AGING_SNAPSHOT');
    expect(body.position.entryWarningCodes).toContain('AGING_SNAPSHOT');
  });

  it('records an EXIT signal without closing when no usable closing price exists', async () => {
    const { token, walletIds } = await distributionSetup(ctx.prisma, 2900);
    const position = await createPaperPosition(ctx.prisma, { tokenId: token.id, tokenMint: token.mintAddress, walletIds });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.call.action).toBe('EXIT');
    expect(body.call.priced).toBe(false);
    expect(body.position.status).toBe('OPEN');
    expect(body.position.exitSignalPendingReason).toBe('Exit signal recorded — closing price unavailable.');
    const stored = await ctx.prisma.paperPosition.findUniqueOrThrow({ where: { id: position.id } });
    expect(stored.status).toBe('OPEN');
    expect(stored.realizedPlUsd).toBeNull(); // never silently closed at a future price
  });
});

describe('simulation math through the API', () => {
  it('computes exact P/L for a full BUY → EXIT round trip with zero-cost assumptions', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 3000, { priceUsd: '0.001' });
    const buy = (await record({
      tokenId: token.id,
      walletIds,
      simulatedAmountUsd: '100',
      assumptions: NO_COSTS,
    })).json();
    expect(buy.position.tokenQuantity).toBe('100000'); // 100 ÷ 0.001, no fee, no slippage
    // Selling pressure arrives and the price doubles in a newer snapshot.
    for (const walletId of walletIds) {
      await createEvent(ctx.prisma, { walletId, tokenId: token.id, eventType: 'SELL', blockTime: ago(MIN) });
    }
    await createSnapshot(ctx.prisma, token.id, { observedAt: new Date(Date.now() - 1000), priceUsd: '0.002' });
    const exit = (await record({ tokenId: token.id, walletIds })).json();
    expect(exit.call.action).toBe('EXIT');
    expect(exit.position.status).toBe('CLOSED');
    expect(exit.position.exitPriceUsd).toBe('0.002');
    expect(exit.position.netExitValueUsd).toBe('200');
    expect(exit.position.realizedPlUsd).toBe('100');
    expect(exit.position.realizedReturnPct).toBe('100');
  });

  it('applies entry fee, exit fee and slippage exactly on a closed trade', async () => {
    const { token, walletIds } = await distributionSetup(ctx.prisma, 3100);
    await createSnapshot(ctx.prisma, token.id, { observedAt: ago(MIN), priceUsd: '0.002' });
    // Position: 99700 tokens, notional 100, fee 0.3%, exit slippage 1%.
    // gross = 99700 × 0.002 × 0.99 = 197.406; fee = 0.592218; net = 196.813782
    await createPaperPosition(ctx.prisma, {
      tokenId: token.id,
      tokenMint: token.mintAddress,
      walletIds,
      tokenQuantity: '99700',
    });
    const body = (await record({ tokenId: token.id, walletIds })).json();
    expect(body.position.grossExitValueUsd).toBe('197.406');
    expect(body.position.exitFeeUsd).toBe('0.592218');
    expect(body.position.netExitValueUsd).toBe('196.813782');
    expect(body.position.realizedPlUsd).toBe('96.813782');
    expect(body.position.realizedReturnPct).toBe('96.813782');
  });
});

describe('valuation refresh — stored snapshots only, idempotent', () => {
  async function openPosition(seed: number) {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, seed, { priceUsd: '0.001' });
    const buy = (await record({ tokenId: token.id, walletIds, assumptions: NO_COSTS })).json();
    return { token, positionId: buy.position.id as string };
  }
  const refresh = (id: string) =>
    ctx.app.inject({ method: 'POST', url: `/api/fomo-simulator/positions/${id}/refresh` });

  it('creates a valuation from the latest stored snapshot without any provider call', async () => {
    const { positionId } = await openPosition(3200);
    const runsBefore = await ctx.prisma.tokenMarketRefreshRun.count();
    const body = (await refresh(positionId)).json();
    expect(body.valuationCreated).toBe(true);
    expect(await ctx.prisma.tokenMarketRefreshRun.count()).toBe(runsBefore); // no provider fetch happened
  });

  it('is idempotent for the same snapshot', async () => {
    const { positionId } = await openPosition(3300);
    await refresh(positionId);
    const second = (await refresh(positionId)).json();
    expect(second.valuationCreated).toBe(false);
    expect(await ctx.prisma.paperPositionValuation.count({ where: { positionId } })).toBe(1);
  });

  it('a newer snapshot creates exactly one new valuation and preserves prior history', async () => {
    const { token, positionId } = await openPosition(3400);
    await refresh(positionId);
    const firstValuation = await ctx.prisma.paperPositionValuation.findFirstOrThrow({ where: { positionId } });
    await createSnapshot(ctx.prisma, token.id, { observedAt: new Date(Date.now() - 1000), priceUsd: '0.003' });
    const body = (await refresh(positionId)).json();
    expect(body.valuationCreated).toBe(true);
    expect(body.position.unrealizedPlUsd).toBe('200'); // 100000 × 0.003 − 100, zero costs
    const valuations = await ctx.prisma.paperPositionValuation.findMany({ where: { positionId } });
    expect(valuations).toHaveLength(2);
    expect(valuations.find((v) => v.id === firstValuation.id)).toEqual(firstValuation);
  });
});

describe('scorecard', () => {
  it('reports null metrics — never fake zeros — when nothing has been recorded', async () => {
    const body = await summary();
    expect(body.netPlUsd).toBeNull();
    expect(body.realizedPlUsd).toBeNull();
    expect(body.unrealizedPlUsd).toBeNull();
    expect(body.winRatePct).toBeNull();
    expect(body.highConvictionPlUsd).toBeNull();
    expect(body.calls.total).toBe(0);
  });

  it('win rate uses only closed, priced positions; HOLD calls never inflate it', async () => {
    const token = await createToken(ctx.prisma, 3500);
    const wallet = await createWallet(ctx.prisma, 3501);
    const winner = await createPaperPosition(ctx.prisma, {
      tokenId: token.id, tokenMint: token.mintAddress, walletIds: [wallet.id],
      status: 'CLOSED', realizedPlUsd: '50',
    });
    await createPaperPosition(ctx.prisma, {
      tokenId: token.id, tokenMint: token.mintAddress, walletIds: [wallet.id, 'other'],
      status: 'CLOSED', realizedPlUsd: '-20',
    });
    const open = await createPaperPosition(ctx.prisma, {
      tokenId: token.id, tokenMint: token.mintAddress, walletIds: ['third'], unrealizedPlUsd: '10',
    });
    for (let i = 0; i < 3; i += 1) {
      await createPaperCall(ctx.prisma, {
        tokenId: token.id, tokenMint: token.mintAddress, walletIds: ['third'],
        action: 'HOLD', paperPositionId: open.id, priced: true,
      });
    }
    await createPaperCall(ctx.prisma, {
      tokenId: token.id, tokenMint: token.mintAddress, walletIds: [wallet.id],
      action: 'BUY', conviction: 'HIGH', paperPositionId: winner.id, priced: true,
    });
    const body = await summary();
    expect(body.winRatePct).toBe('50'); // 1 winner of 2 closed priced — HOLDs don't count
    expect(body.realizedPlUsd).toBe('30');
    expect(body.unrealizedPlUsd).toBe('10');
    expect(body.netPlUsd).toBe('40');
    expect(body.highConvictionPlUsd).toBe('50');
    expect(body.calls.hold).toBe(3);
  });

  it('AVOID and NO_TRADE calls and unpriced BUY calls are excluded from portfolio P/L', async () => {
    const token = await createToken(ctx.prisma, 3600);
    for (const action of ['AVOID', 'NO_TRADE', 'BUY'] as const) {
      await createPaperCall(ctx.prisma, {
        tokenId: token.id, tokenMint: token.mintAddress, walletIds: ['w'],
        action, priced: false,
      });
    }
    const body = await summary();
    expect(body.netPlUsd).toBeNull();
    expect(body.openTradeCount).toBe(0);
    expect(body.closedTradeCount).toBe(0);
    expect(body.calls.unpriced).toBe(3);
    expect(body.calls.avoid).toBe(1);
    expect(body.calls.noTrade).toBe(1);
  });
});

describe('immutability and zero side effects', () => {
  it('editing a wallet label later never rewrites frozen call evidence', async () => {
    const token = await createToken(ctx.prisma, 3700);
    const wallet = await createWallet(ctx.prisma, 3701, { label: 'original label' });
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(25 * DAY) });
    await record({ tokenId: token.id, walletIds: [wallet.id] });
    await ctx.prisma.trackedWallet.update({ where: { id: wallet.id }, data: { label: 'renamed later' } });
    const calls = (await ctx.app.inject({ method: 'GET', url: '/api/fomo-simulator/calls' })).json();
    expect(calls.items[0].walletLabels).toEqual(['original label']);
  });

  it('recording a call creates no sync, reconstruction, quality or fingerprint run and mutates no wallet event', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 3800);
    const eventsBefore = JSON.stringify(await ctx.prisma.walletEvent.findMany({ orderBy: { id: 'asc' } }));
    const countsBefore = await Promise.all([
      ctx.prisma.walletSyncState.count(),
      ctx.prisma.walletPositionReconstructionRun.count(),
      ctx.prisma.walletQualityAnalysisRun.count(),
      ctx.prisma.walletStrategyFingerprintRun.count(),
    ]);
    await record({ tokenId: token.id, walletIds });
    const countsAfter = await Promise.all([
      ctx.prisma.walletSyncState.count(),
      ctx.prisma.walletPositionReconstructionRun.count(),
      ctx.prisma.walletQualityAnalysisRun.count(),
      ctx.prisma.walletStrategyFingerprintRun.count(),
    ]);
    expect(countsAfter).toEqual(countsBefore);
    expect(JSON.stringify(await ctx.prisma.walletEvent.findMany({ orderBy: { id: 'asc' } }))).toBe(eventsBefore);
  });

  it('never returns guaranteed-profit or automatic-trading wording', async () => {
    const { token, walletIds } = await higherConfidenceSetup(ctx.prisma, 3900);
    const response = (await record({ tokenId: token.id, walletIds })).json();
    const text = JSON.stringify(response) + JSON.stringify(await summary());
    expect(text).not.toMatch(/guaranteed|easy money|risk[- ]free|definitely pump|copy this trade|automatically (buy|sell)/i);
  });
});

describe('validation and stale analysis', () => {
  it('rejects unknown wallet IDs', async () => {
    const token = await createToken(ctx.prisma, 4000);
    const response = await record({ tokenId: token.id, walletIds: ['missing'] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('unknown_wallet');
  });

  it('rejects an unknown token ID', async () => {
    const wallet = await createWallet(ctx.prisma, 4100);
    const response = await record({ tokenId: 'missing-token', walletIds: [wallet.id] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('unknown_token');
  });

  it('rejects an invalid simulated amount', async () => {
    const wallet = await createWallet(ctx.prisma, 4200);
    const token = await createToken(ctx.prisma, 4201);
    for (const bad of ['-5', '0', 'abc', '2000000']) {
      const response = await record({ tokenId: token.id, walletIds: [wallet.id], simulatedAmountUsd: bad });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('validation_error');
    }
  });

  it('returns stale_analysis when the token is no longer a Slow Cook candidate', async () => {
    const wallet = await createWallet(ctx.prisma, 4300);
    const token = await createToken(ctx.prisma, 4301); // no selected-wallet activity at all
    const response = await record({ tokenId: token.id, walletIds: [wallet.id] });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('stale_analysis');
  });
});
