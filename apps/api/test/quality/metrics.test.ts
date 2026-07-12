import { describe, expect, it } from 'vitest';
import type { WalletPosition } from '@prisma/client';
import { holdingBucket, sampleTier, sizeBucket, summarize, summaryFields, type PositionWithMatches } from '../../src/services/walletQuality/metrics.js';

function position(i:number,pnl:string,status='CLOSED'):PositionWithMatches {
  return { id:`p${i}`,reconstructionRunId:'r',trackedWalletId:'w',tokenId:`t${i%2}`,cycleNumber:i,status,confidence:'HIGH',openedAt:new Date('2026-01-01'),closedAt:new Date('2026-01-01T01:00:00Z'),firstBuyEventId:null,lastEventAt:null,quoteAsset:'SOL',totalBoughtTokenAmount:'1',totalSoldTokenAmount:'1',openTokenAmount:'0',knownCostBasisSol:'1',knownProceedsSol:null,allocatedKnownFeesSol:'.01',rawRealizedPnlSol:pnl,knownAllInRealizedPnlSol:pnl,rawRealizedRoiPct:String(Number(pnl)*100),knownAllInRealizedRoiPct:String(Number(pnl)*100),estimatedCurrentValueSol:null,estimatedCurrentValueUsd:null,estimatedUnrealizedPnlSol:null,estimatedUnrealizedRoiPct:null,valuationSnapshotId:null,valuationObservedAt:null,valuationFreshness:null,valuationStatus:null,holdingDurationSeconds:3600,transferInAmount:'0',transferOutAmount:'0',unmatchedSellAmount:'0',unknownBasisAmount:'0',includedEventCount:2,excludedEventCount:0,includedEventIdsJson:'[]',exclusionReasonsJson:'[]',decoderVersionsJson:'[2]',warningCodes:'[]',calculationVersion:1,calculatedAt:new Date(),createdAt:new Date(),updatedAt:new Date(),matches:[] } as WalletPosition & {matches:[]};
}
describe('quality metric math',()=>{
  it('computes exact median, mean, percentiles, rates, gains/losses and contribution',()=>{
    const fields=summaryFields(summarize([position(1,'1'),position(2,'2'),position(3,'-1'),position(4,'0')],true));
    expect(fields.medianRawPnlSol).toBe('0.5'); expect(fields.meanRawPnlSol).toBe('0.5');
    expect(fields.p25RawPnlSol).toBe('-0.25'); expect(fields.p75RawPnlSol).toBe('1.25');
    expect(fields.rawPositiveRatePct).toBe('50'); expect(fields.grossGainSol).toBe('3');
    expect(fields.grossLossSol).toBe('1'); expect(fields.profitFactor).toBe('3');
    expect(fields.largestGainContributionPct).toBe('66.6666666666666666666666666666666666666666666667');
    expect(fields.flatRawCount).toBe(1); expect(fields.observedDistinctTokenCount).toBe(2);
  });
  it('handles zero denominator and sample tiers',()=>{
    expect(summaryFields(summarize([],false)).rawPositiveRatePct).toBeNull();
    expect(summaryFields(summarize([position(1,'1')],true)).profitFactor).toBeNull();
    expect([0,4,5,20,50,200].map(sampleTier)).toEqual(['VERY_SMALL','VERY_SMALL','SMALL','MODERATE','LARGE','VERY_LARGE']);
  });
  it('uses deterministic size and holding buckets',()=>{
    expect(['.01','.07','.2','.4','.7','2'].map(sizeBucket)).toEqual(['under 0.05 SOL','0.05–0.10 SOL','0.10–0.25 SOL','0.25–0.50 SOL','0.50–1.00 SOL','over 1.00 SOL']);
    expect([60,600,2000,5000,20000,90000,null].map(holdingBucket)).toEqual(['under 5m','5–30m','30–60m','1–4h','4–24h','over 24h','open/unknown']);
  });
});
