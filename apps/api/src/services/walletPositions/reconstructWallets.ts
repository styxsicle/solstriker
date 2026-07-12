import type { PrismaClient, TrackedWallet } from '@prisma/client';
import { exact, profileStats, reconstructToken, valuation, POSITION_CALCULATION_VERSION, POSITION_METHOD } from './reconstruct.js';
import { pct, sum } from './math.js';
import { POSITION_WARNINGS as W } from './warnings.js';

export const MAX_WALLETS_PER_RECONSTRUCTION = 10;
let locked = false;
export const tryAcquireReconstructionLock = () => locked ? false : (locked = true);
export const releaseReconstructionLock = () => { locked = false; };

export async function reconstructWallets(prisma: PrismaClient, wallets: TrackedWallet[]) {
  const run = await prisma.walletPositionReconstructionRun.create({ data: {
    calculationVersion: POSITION_CALCULATION_VERSION, method: POSITION_METHOD,
    requestedWalletCount: wallets.length,
  }});
  const perWallet: Array<Record<string, unknown>> = [];
  let processed = 0, eventCount = 0, included = 0, excluded = 0, positionsCreated = 0,
    matchesCreated = 0, profilesCreated = 0, warnings = 0, failures = 0;
  for (const wallet of wallets) {
    try {
      const [events, sync] = await Promise.all([
        prisma.walletEvent.findMany({ where: { walletId: wallet.id } }),
        prisma.walletSyncState.findUnique({ where: { walletId: wallet.id } }),
      ]);
      eventCount += events.length;
      const incomplete = !sync?.backfillComplete;
      const byToken = new Map<string, typeof events>();
      for (const event of events) if (event.tokenId) {
        const list = byToken.get(event.tokenId) ?? []; list.push(event); byToken.set(event.tokenId, list);
      }
      const drafts = [...byToken].flatMap(([tokenId, list]) => reconstructToken(list, tokenId, incomplete));
      let walletMatches = 0;
      for (const p of drafts) {
        const snapshot = await prisma.tokenMarketSnapshot.findFirst({
          where: { tokenId: p.tokenId, status: { in: ['COMPLETE', 'PARTIAL'] } },
          orderBy: [{ observedAt: 'desc' }, { fetchedAt: 'desc' }],
        });
        const v = valuation(p, snapshot);
        if (v.warning) p.warnings.add(v.warning);
        const matchCosts = sum(p.matches.map((m) => m.buyCost));
        const matchAllInCost = sum(p.matches.map((m) => m.buyFees === null ? null : m.buyCost.plus(m.buyFees)));
        const position = await prisma.walletPosition.create({ data: {
          reconstructionRunId: run.id, trackedWalletId: wallet.id, tokenId: p.tokenId,
          cycleNumber: p.cycleNumber, status: p.status, confidence: p.confidence,
          openedAt: p.openedAt, closedAt: p.closedAt, firstBuyEventId: p.firstBuyEventId,
          lastEventAt: p.lastEventAt, totalBoughtTokenAmount: exact(p.bought), totalSoldTokenAmount: exact(p.sold),
          openTokenAmount: exact(p.open), knownCostBasisSol: exact(p.cost), knownProceedsSol: exact(p.proceeds),
          allocatedKnownFeesSol: exact(p.fees), rawRealizedPnlSol: exact(p.rawPnl), knownAllInRealizedPnlSol: exact(p.allInPnl),
          rawRealizedRoiPct: pct(p.rawPnl, matchCosts), knownAllInRealizedRoiPct: pct(p.allInPnl, matchAllInCost),
          estimatedCurrentValueSol: exact(v.sol), estimatedCurrentValueUsd: exact(v.usd),
          estimatedUnrealizedPnlSol: exact(v.pnl), estimatedUnrealizedRoiPct: v.roi,
          valuationSnapshotId: snapshot?.id, valuationObservedAt: snapshot?.observedAt,
          valuationFreshness: v.freshness, valuationStatus: v.status,
          holdingDurationSeconds: p.closedAt && p.openedAt ? Math.floor((p.closedAt.getTime()-p.openedAt.getTime())/1000) : null,
          transferInAmount: exact(p.transferIn), transferOutAmount: exact(p.transferOut),
          unmatchedSellAmount: exact(p.unmatchedSell), unknownBasisAmount: exact(p.unknownBasis),
          includedEventCount: p.includedIds.length, excludedEventCount: p.excludedReasons.length,
          includedEventIdsJson: JSON.stringify(p.includedIds), exclusionReasonsJson: JSON.stringify(p.excludedReasons),
          decoderVersionsJson: JSON.stringify([...new Set(p.decoderVersions)].sort()),
          warningCodes: JSON.stringify([...p.warnings].sort()), calculationVersion: POSITION_CALCULATION_VERSION,
        }});
        for (const m of p.matches) await prisma.walletTradeMatch.create({ data: {
          positionId: position.id, buyEventId: m.buyEventId, sellEventId: m.sellEventId,
          sequence: m.sequence, matchedTokenAmount: exact(m.matched)!, allocatedBuyCostSol: exact(m.buyCost),
          allocatedBuyFeesSol: exact(m.buyFees), allocatedSellProceedsSol: exact(m.proceeds),
          allocatedSellFeesSol: exact(m.sellFees), rawRealizedPnlSol: exact(m.rawPnl),
          knownAllInRealizedPnlSol: exact(m.allInPnl), rawRealizedRoiPct: m.rawRoi,
          knownAllInRealizedRoiPct: m.allInRoi, holdingDurationSeconds: m.holdingSeconds,
          confidence: m.confidence, warningCodes: JSON.stringify(m.warnings), calculationVersion: POSITION_CALCULATION_VERSION,
        }});
        walletMatches += p.matches.length;
      }
      const stats = profileStats(drafts, !incomplete);
      const profileWarnings = new Set(drafts.flatMap((p) => [...p.warnings]));
      if (incomplete) profileWarnings.add(W.INCOMPLETE_WALLET_HISTORY);
      await prisma.walletBehaviorProfile.create({ data: {
        reconstructionRunId: run.id, trackedWalletId: wallet.id,
        status: incomplete || profileWarnings.size ? 'PARTIAL' : 'COMPLETE',
        confidence: incomplete ? 'LOW' : profileWarnings.size ? 'MEDIUM' : 'HIGH',
        eligibleBuyCount: events.filter((e)=>e.eventType==='BUY' && e.decoderVersion>=2 && ['CONFIRMED','LIKELY'].includes(e.confidence ?? '') && e.tokenAmount && e.quoteAmount && (e.quoteMint==='SOL'||e.quoteMint==='So11111111111111111111111111111111111111112')).length,
        eligibleSellCount: events.filter((e)=>e.eventType==='SELL' && e.decoderVersion>=2 && ['CONFIRMED','LIKELY'].includes(e.confidence ?? '') && e.tokenAmount && e.quoteAmount && (e.quoteMint==='SOL'||e.quoteMint==='So11111111111111111111111111111111111111112')).length,
        closedPositionCount: drafts.filter((p)=>p.status==='CLOSED').length,
        openPositionCount: drafts.filter((p)=>p.status==='OPEN').length,
        partialPositionCount: drafts.filter((p)=>!['OPEN','CLOSED'].includes(p.status)).length,
        unmatchedSellCount: drafts.filter((p)=>p.unmatchedSell.gt(0)).length,
        transferAffectedPositionCount: drafts.filter((p)=>p.transferIn.gt(0)||p.transferOut.gt(0)).length,
        knownPositionSizeMedianSol: exact(stats.median), knownPositionSizeMeanSol: exact(stats.mean),
        knownPositionSizeP25Sol: exact(stats.p25), knownPositionSizeP75Sol: exact(stats.p75),
        knownPositionSizeMinSol: exact(stats.min), knownPositionSizeMaxSol: exact(stats.max),
        closedHoldingMedianSeconds: exact(stats.holdMedian), closedHoldingMeanSeconds: exact(stats.holdMean),
        observedMaxConcurrentPositions: maxConcurrent(drafts), completeHistory: !incomplete,
        knownFeeBurdenMedianPct: exact(stats.feeBurdenMedian),
        warningCodes: JSON.stringify([...profileWarnings].sort()), calculationVersion: POSITION_CALCULATION_VERSION,
      }});
      processed++; positionsCreated += drafts.length; matchesCreated += walletMatches; profilesCreated++;
      included += drafts.reduce((n,p)=>n+p.includedIds.length,0); excluded += drafts.reduce((n,p)=>n+p.excludedReasons.length,0);
      warnings += profileWarnings.size;
      perWallet.push({ walletId: wallet.id, status: 'ok', positionsCreated: drafts.length, matchesCreated: walletMatches, warningCodes: [...profileWarnings].sort() });
    } catch {
      failures++; perWallet.push({ walletId: wallet.id, status: 'error', positionsCreated: 0, matchesCreated: 0, warningCodes: ['RECONSTRUCTION_ERROR'] });
    }
  }
  const status = failures === 0 ? 'COMPLETED' : processed ? 'PARTIAL' : 'FAILED';
  await prisma.walletPositionReconstructionRun.update({ where: { id: run.id }, data: {
    status, completedAt: new Date(), processedWalletCount: processed, eventCount,
    includedEventCount: included, excludedEventCount: excluded, positionCount: positionsCreated,
    matchCount: matchesCreated, profileCount: profilesCreated, warningCount: warnings,
    errorCount: failures, sanitizedErrorSummary: failures ? 'wallet_reconstruction_failed' : null,
  }});
  return { runId: run.id, calculationVersion: POSITION_CALCULATION_VERSION, method: POSITION_METHOD, status,
    requestedWallets: wallets.length, processedWallets: processed, includedEvents: included,
    excludedEvents: excluded, positionsCreated, matchesCreated, profilesCreated, warnings, failures, results: perWallet };
}

function maxConcurrent(positions: Array<{openedAt: Date|null; closedAt: Date|null}>) {
  const points = positions.flatMap((p)=>p.openedAt ? [[p.openedAt.getTime(),1] as const, [p.closedAt?.getTime() ?? Number.MAX_SAFE_INTEGER,-1] as const] : []);
  points.sort((a,b)=>a[0]-b[0] || a[1]-b[1]); let current=0,max=0;
  for (const [,d] of points) { current+=d; max=Math.max(max,current); } return max;
}
