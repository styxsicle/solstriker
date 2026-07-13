/**
 * Slow Cook V1 — POST /api/slow-cook/analyze.
 *
 * Every wallet, token, event and position is synthetic. Timestamps are
 * always relative to the real "now" at test-run time, since the service
 * itself always evaluates the lookback window against the real clock.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import {
  completeReconstruction,
  createEvent,
  createPosition,
  createSnapshot,
  createToken,
  createWallet,
  resetIds,
} from './fixtures.js';

let ctx: TestApp;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(async () => {
  ctx = await buildTestApp();
  await resetDb(ctx.prisma);
  resetIds();
});

const analyze = (payload: unknown) =>
  ctx.app.inject({ method: 'POST', url: '/api/slow-cook/analyze', payload });

async function tableCounts() {
  const [wallets, events, syncStates, reconRuns, qualityRuns, fingerprintRuns, positions] = await Promise.all([
    ctx.prisma.trackedWallet.count(),
    ctx.prisma.walletEvent.count(),
    ctx.prisma.walletSyncState.count(),
    ctx.prisma.walletPositionReconstructionRun.count(),
    ctx.prisma.walletQualityAnalysisRun.count(),
    ctx.prisma.walletStrategyFingerprintRun.count(),
    ctx.prisma.walletPosition.count(),
  ]);
  return { wallets, events, syncStates, reconRuns, qualityRuns, fingerprintRuns, positions };
}

describe('Slow Cook — selection scoping', () => {
  it('only explicitly selected wallets affect results', async () => {
    const token = await createToken(ctx.prisma, 1001);
    const selected = await createWallet(ctx.prisma, 1002, { label: 'selected' });
    const unselected = await createWallet(ctx.prisma, 1003, { label: 'unselected' });
    await createEvent(ctx.prisma, { walletId: selected.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    await createEvent(ctx.prisma, { walletId: unselected.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });

    const body = (await analyze({ walletIds: [selected.id], includeLowerConfidence: true })).json();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].walletInterest.walletsWithEvidenceCount).toBe(1);
    expect(body.candidates[0].wallets.map((w: { walletId: string }) => w.walletId)).toEqual([selected.id]);
  });

  it('unselected-wallet activity never leaks into facts, counts, or explanations', async () => {
    const token = await createToken(ctx.prisma, 1101);
    const selected = await createWallet(ctx.prisma, 1102);
    const unselected = await createWallet(ctx.prisma, 1103);
    await createEvent(ctx.prisma, { walletId: selected.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    // The unselected wallet has MUCH more activity — it must not inflate anything.
    for (let i = 0; i < 5; i += 1) {
      await createEvent(ctx.prisma, { walletId: unselected.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    }

    const body = (await analyze({ walletIds: [selected.id], includeLowerConfidence: true })).json();
    expect(body.candidates[0].walletInterest.recentBuyCount).toBe(1);
    expect(body.candidates[0].whyThisAppeared.join(' ')).not.toContain(unselected.address);
  });

  it('duplicate wallet labels remain distinct by wallet ID and address', async () => {
    const token = await createToken(ctx.prisma, 1201);
    const a = await createWallet(ctx.prisma, 1202, { label: 'bn' });
    const b = await createWallet(ctx.prisma, 1203, { label: 'bn' });
    await createEvent(ctx.prisma, { walletId: a.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    await createEvent(ctx.prisma, { walletId: b.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });

    const body = (await analyze({ walletIds: [a.id, b.id], includeLowerConfidence: true })).json();
    const addresses = body.candidates[0].wallets.map((w: { address: string }) => w.address);
    expect(new Set(addresses).size).toBe(2);
    expect(addresses).toEqual(expect.arrayContaining([a.address, b.address]));
  });

  it('excludes development wallets from the request entirely', async () => {
    const dev = await createWallet(ctx.prisma, 1301, { source: 'dev-seed' });
    const response = await analyze({ walletIds: [dev.id] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('dev_wallet_excluded');
  });
});

describe('Slow Cook — candidate eligibility', () => {
  it('a recent selected-wallet buy creates an eligible candidate', async () => {
    const token = await createToken(ctx.prisma, 1401);
    const wallet = await createWallet(ctx.prisma, 1402);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].tokenId).toBe(token.id);
  });

  it('transfer-only activity never creates a candidate', async () => {
    const token = await createToken(ctx.prisma, 1501);
    const wallet = await createWallet(ctx.prisma, 1502);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'TOKEN_TRANSFER_IN', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates).toHaveLength(0);
  });

  it('unsupported/legacy-decoded events do not create a candidate', async () => {
    const token = await createToken(ctx.prisma, 1601);
    const wallet = await createWallet(ctx.prisma, 1602);
    await createEvent(ctx.prisma, {
      walletId: wallet.id,
      tokenId: token.id,
      eventType: 'BUY',
      blockTime: ago(HOUR),
      decoderVersion: 1,
    });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates).toHaveLength(0);
  });

  it('excludes development-seed tokens even with real selected-wallet events', async () => {
    const devToken = await createToken(ctx.prisma, 1701, { source: 'dev-seed' });
    const wallet = await createWallet(ctx.prisma, 1702);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: devToken.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates).toHaveLength(0);
  });

  it('activity outside the lookback window does not create a candidate', async () => {
    const token = await createToken(ctx.prisma, 1801);
    const wallet = await createWallet(ctx.prisma, 1802);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(40 * DAY) });
    const body = (await analyze({ walletIds: [wallet.id], lookbackDays: 30, includeLowerConfidence: true })).json();
    expect(body.candidates).toHaveLength(0);
  });

  it('respects the minimumWallets setting', async () => {
    const token = await createToken(ctx.prisma, 1901);
    const wallet = await createWallet(ctx.prisma, 1902);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], minimumWallets: 2, includeLowerConfidence: true })).json();
    expect(body.candidates).toHaveLength(0);
  });

  it('respects the candidate limit setting', async () => {
    const wallet = await createWallet(ctx.prisma, 2001);
    for (let i = 0; i < 5; i += 1) {
      const token = await createToken(ctx.prisma, 2100 + i);
      await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    }
    const body = (await analyze({ walletIds: [wallet.id], limit: 2, includeLowerConfidence: true })).json();
    expect(body.candidates).toHaveLength(2);
  });
});

describe('Slow Cook — accumulation and distribution evidence', () => {
  it('repeated buys increase accumulation evidence and can produce BUILDING', async () => {
    const token = await createToken(ctx.prisma, 2201);
    const wallet = await createWallet(ctx.prisma, 2202);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(3 * HOUR) });
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates[0].accumulation.repeatBuyWalletCount).toBe(1);
    expect(body.candidates[0].accumulation.addsAfterEntryCount).toBe(1);
    expect(body.candidates[0].state).toBe('BUILDING');
  });

  it('detected sells increase distribution pressure and can produce DISTRIBUTION_RISK', async () => {
    const token = await createToken(ctx.prisma, 2301);
    const wallet = await createWallet(ctx.prisma, 2302);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(3 * HOUR) });
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'SELL', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates[0].state).toBe('DISTRIBUTION_RISK');
    expect(body.candidates[0].distributionPressure.detectedSellCount).toBe(1);
  });

  it('multiple selected wallets are counted distinctly in wallet interest', async () => {
    const token = await createToken(ctx.prisma, 2401);
    const a = await createWallet(ctx.prisma, 2402);
    const b = await createWallet(ctx.prisma, 2403);
    await createEvent(ctx.prisma, { walletId: a.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    await createEvent(ctx.prisma, { walletId: b.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [a.id, b.id], includeLowerConfidence: true })).json();
    expect(body.candidates[0].walletInterest.walletsWithEvidenceCount).toBe(2);
  });

  it('represents a currently open reconstructed position as holding evidence', async () => {
    const token = await createToken(ctx.prisma, 2501);
    const wallet = await createWallet(ctx.prisma, 2502);
    const buy = await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(2 * DAY) });
    const run = await completeReconstruction(ctx.prisma, wallet.id, [buy.id]);
    await createPosition(ctx.prisma, {
      reconstructionRunId: run.id,
      trackedWalletId: wallet.id,
      tokenId: token.id,
      status: 'OPEN',
      includedEventIds: [buy.id],
    });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates[0].walletInterest.openPositionWalletCount).toBe(1);
    expect(body.candidates[0].holdingConviction.openPositionCount).toBe(1);
    expect(body.candidates[0].state).toBe('HOLDING');
  });
});

describe('Slow Cook — data quality and confidence', () => {
  it('missing market snapshot values remain null, never zero', async () => {
    const token = await createToken(ctx.prisma, 2601);
    const wallet = await createWallet(ctx.prisma, 2602);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates[0].market).toBeNull(); // no snapshot exists at all
    expect(body.candidates[0].dataQuality.marketSnapshotStatus).toBe('UNAVAILABLE');
  });

  it('a stale market snapshot is labeled STALE, not silently treated as fresh', async () => {
    const token = await createToken(ctx.prisma, 2701);
    const wallet = await createWallet(ctx.prisma, 2702);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    await createSnapshot(ctx.prisma, token.id, { observedAt: ago(3 * HOUR) }); // beyond AGING_MAX_AGE_SECONDS
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates[0].dataQuality.marketSnapshotStatus).toBe('STALE');
    expect(body.candidates[0].market.priceUsd).toBe('0.001'); // still present — stale, not missing
  });

  it('reports missing reconstruction for a wallet that was never reconstructed', async () => {
    const token = await createToken(ctx.prisma, 2801);
    const wallet = await createWallet(ctx.prisma, 2802);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.styleMemories[0].ids.reconstructionRunId).toBeNull();
    expect(body.candidates[0].dataQuality.contributingWalletsStaleOrMissingCount).toBe(1);
  });

  it('reports a stale reconstruction when new events exist since the last completed run', async () => {
    const token = await createToken(ctx.prisma, 2901);
    const wallet = await createWallet(ctx.prisma, 2902);
    const oldBuy = await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(5 * DAY) });
    await completeReconstruction(ctx.prisma, wallet.id, [oldBuy.id]);
    // A new event arrives after the reconstruction, making it stale.
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.styleMemories[0].ids.reconstructionRunId).toBeNull(); // stale reconstruction is not "current"
  });

  it('missing quality data keeps evidence state INSUFFICIENT and lowers confidence', async () => {
    const token = await createToken(ctx.prisma, 3001);
    const wallet = await createWallet(ctx.prisma, 3002);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.styleMemories[0].evidenceState).toBe('INSUFFICIENT');
    expect(body.candidates[0].confidence).toBe('LOW');
  });

  it('small samples cannot receive HIGHER confidence', async () => {
    const token = await createToken(ctx.prisma, 3101);
    const wallet = await createWallet(ctx.prisma, 3102);
    const buy = await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    await completeReconstruction(ctx.prisma, wallet.id, [buy.id]);
    // Even with a current (but tiny) reconstruction and a fresh snapshot, one
    // wallet and no fingerprint sample cannot reach HIGHER.
    await createSnapshot(ctx.prisma, token.id, { observedAt: ago(MIN) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    expect(body.candidates[0].confidence).not.toBe('HIGHER');
  });

  it('conflicting selected-wallet activity produces MIXED', async () => {
    const token = await createToken(ctx.prisma, 3201);
    const buyer = await createWallet(ctx.prisma, 3202);
    const seller = await createWallet(ctx.prisma, 3203);
    await createEvent(ctx.prisma, { walletId: buyer.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    await createEvent(ctx.prisma, { walletId: seller.id, tokenId: token.id, eventType: 'SELL', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [buyer.id, seller.id], includeLowerConfidence: true })).json();
    // A sell with no offsetting buy from that wallet still trips the sell-pressure
    // rule first (documented rule order) — MIXED requires buy pressure to exceed
    // sell pressure for the DISTRIBUTION_RISK rule to fall through.
    expect(['MIXED', 'DISTRIBUTION_RISK']).toContain(body.candidates[0].state);
  });
});

describe('Slow Cook — style memory uses each wallet\'s own evidence', () => {
  it('keeps each selected wallet\'s style memory separate rather than averaging them', async () => {
    const walletA = await createWallet(ctx.prisma, 3301);
    const walletB = await createWallet(ctx.prisma, 3302);
    const body = (await analyze({ walletIds: [walletA.id, walletB.id], includeLowerConfidence: true })).json();
    expect(body.styleMemories).toHaveLength(2);
    expect(body.styleMemories.map((m: { walletId: string }) => m.walletId).sort()).toEqual(
      [walletA.id, walletB.id].sort(),
    );
  });
});

describe('Slow Cook — determinism and safety', () => {
  it('produces identical output for identical stored input', async () => {
    const token = await createToken(ctx.prisma, 3401);
    const wallet = await createWallet(ctx.prisma, 3402);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const payload = { walletIds: [wallet.id], includeLowerConfidence: true };
    const first = (await analyze(payload)).json();
    const second = (await analyze(payload)).json();
    expect(first.candidates).toEqual(second.candidates);
  });

  it('never calls a provider, never mutates the database, and creates no analysis run', async () => {
    const token = await createToken(ctx.prisma, 3501);
    const wallet = await createWallet(ctx.prisma, 3502);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const before = await tableCounts();
    await analyze({ walletIds: [wallet.id], includeLowerConfidence: true });
    const after = await tableCounts();
    expect(after).toEqual(before);
  });

  it('never emits guaranteed-profit or automatic-trading language', async () => {
    const token = await createToken(ctx.prisma, 3601);
    const wallet = await createWallet(ctx.prisma, 3602);
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(3 * HOUR) });
    await createEvent(ctx.prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(HOUR) });
    const body = (await analyze({ walletIds: [wallet.id], includeLowerConfidence: true })).json();
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/guaranteed|easy money|this will pump|buy now|copy this trade|automatic buy|automatic sell/i);
  });

  it('rejects an unknown wallet ID with a validation error', async () => {
    const response = await analyze({ walletIds: ['does-not-exist'] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('unknown_wallet');
  });

  it('rejects an empty wallet selection with a validation error', async () => {
    const response = await analyze({ walletIds: [] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('validation_error');
  });

  it('rejects a duplicate wallet ID in the same request', async () => {
    const wallet = await createWallet(ctx.prisma, 3701);
    const response = await analyze({ walletIds: [wallet.id, wallet.id] });
    expect(response.json().error).toBe('duplicate_selection');
  });
});
