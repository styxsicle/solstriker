import type { TokenMarketSnapshot, WalletEvent } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { D, exact, pct, quantile, sum } from './math.js';
import { POSITION_WARNINGS as W, type PositionWarning } from './warnings.js';

export const POSITION_CALCULATION_VERSION = 1;
export const POSITION_METHOD = 'FIFO';
const WSOL = 'So11111111111111111111111111111111111111112';

export interface Lot { event: WalletEvent; original: Decimal; remaining: Decimal; cost: Decimal; fees: Decimal | null }
export interface MatchDraft {
  buyEventId: string; sellEventId: string; sequence: number; matched: Decimal;
  buyCost: Decimal; buyFees: Decimal | null; proceeds: Decimal; sellFees: Decimal | null;
  rawPnl: Decimal; allInPnl: Decimal | null; rawRoi: string | null; allInRoi: string | null;
  holdingSeconds: number | null; confidence: string; warnings: PositionWarning[];
}
export interface PositionDraft {
  tokenId: string; cycleNumber: number; status: string; confidence: string;
  openedAt: Date | null; closedAt: Date | null; firstBuyEventId: string | null; lastEventAt: Date | null;
  bought: Decimal; sold: Decimal; open: Decimal; cost: Decimal; proceeds: Decimal;
  fees: Decimal | null; rawPnl: Decimal | null; allInPnl: Decimal | null;
  transferIn: Decimal; transferOut: Decimal; unmatchedSell: Decimal; unknownBasis: Decimal;
  includedIds: string[]; excludedReasons: string[]; decoderVersions: number[];
  warnings: Set<PositionWarning>; matches: MatchDraft[]; lots: Lot[];
}

function amount(v: number | null): Decimal | null {
  if (v === null || !Number.isFinite(v) || v <= 0) return null;
  return D(v.toString());
}
function solQuote(q: string | null) { return q === 'SOL' || q === WSOL; }
function knownFees(e: WalletEvent): Decimal | null {
  const fields = [e.networkFeeSol, e.platformFeeSol, e.tipSol];
  if (fields.some((v) => v === null)) return null;
  return fields.reduce<Decimal>((a, v) => a.plus(D((v as number).toString())), D(0));
}
function blank(tokenId: string, cycleNumber: number): PositionDraft {
  return { tokenId, cycleNumber, status: 'OPEN', confidence: 'HIGH', openedAt: null, closedAt: null,
    firstBuyEventId: null, lastEventAt: null, bought: D(0), sold: D(0), open: D(0), cost: D(0),
    proceeds: D(0), fees: D(0), rawPnl: null, allInPnl: null, transferIn: D(0), transferOut: D(0),
    unmatchedSell: D(0), unknownBasis: D(0), includedIds: [], excludedReasons: [], decoderVersions: [],
    warnings: new Set(), matches: [], lots: [] };
}

export function sortEvents(events: WalletEvent[]) {
  return [...events].sort((a, b) => {
    const ta = a.blockTime?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = b.blockTime?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb || (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER) ||
      a.signature.localeCompare(b.signature) || a.id.localeCompare(b.id);
  });
}

export function reconstructToken(events: WalletEvent[], tokenId: string, incompleteHistory: boolean): PositionDraft[] {
  const result: PositionDraft[] = [];
  let p = blank(tokenId, 1);
  if (incompleteHistory) p.warnings.add(W.INCOMPLETE_WALLET_HISTORY);
  const finish = () => { if (p.includedIds.length || p.excludedReasons.length) result.push(p); };
  for (const e of sortEvents(events)) {
    const qty = amount(e.tokenAmount);
    p.lastEventAt = e.blockTime ?? p.lastEventAt;
    p.decoderVersions.push(e.decoderVersion);
    if (!e.blockTime) { p.warnings.add(W.MISSING_EVENT_TIME); p.excludedReasons.push(`${e.id}:MISSING_EVENT_TIME`); continue; }
    if (e.eventType === 'TOKEN_TRANSFER_IN' || e.eventType === 'TOKEN_TRANSFER_OUT') {
      if (!qty) { p.warnings.add(W.MISSING_TOKEN_AMOUNT); p.excludedReasons.push(`${e.id}:MISSING_TOKEN_AMOUNT`); continue; }
      if (p.closedAt && p.open.isZero() && p.unknownBasis.isZero()) {
        finish(); p = blank(tokenId, p.cycleNumber + 1);
        if (incompleteHistory) p.warnings.add(W.INCOMPLETE_WALLET_HISTORY);
        p.lastEventAt = e.blockTime; p.decoderVersions.push(e.decoderVersion);
      }
      p.includedIds.push(e.id);
      if (e.eventType === 'TOKEN_TRANSFER_IN') {
        p.transferIn = p.transferIn.plus(qty); p.unknownBasis = p.unknownBasis.plus(qty);
        p.warnings.add(W.TRANSFER_IN_UNKNOWN_BASIS);
      } else {
        p.transferOut = p.transferOut.plus(qty); p.warnings.add(W.TRANSFER_OUT_BASIS_REMOVED);
        let left = qty;
        while (left.gt(0) && p.lots.length) {
          const lot = p.lots[0]; const used = Decimal.min(left, lot.remaining);
          lot.remaining = lot.remaining.minus(used); p.open = p.open.minus(used); left = left.minus(used);
          if (lot.remaining.isZero()) p.lots.shift();
        }
        const unknownUsed = Decimal.min(left, p.unknownBasis);
        p.unknownBasis = p.unknownBasis.minus(unknownUsed);
      }
      continue;
    }
    if (e.eventType !== 'BUY' && e.eventType !== 'SELL') continue;
    if (e.decoderVersion < 2) { p.warnings.add(W.LEGACY_DECODER_EVENT); p.excludedReasons.push(`${e.id}:LEGACY_DECODER_EVENT`); continue; }
    if (e.confidence === 'UNKNOWN' || e.confidence === null) { p.warnings.add(W.UNKNOWN_EVENT); p.excludedReasons.push(`${e.id}:UNKNOWN_EVENT`); continue; }
    if (e.confidence === 'LIKELY') p.warnings.add(W.LIKELY_EVENT);
    if (!qty) { p.warnings.add(W.MISSING_TOKEN_AMOUNT); p.excludedReasons.push(`${e.id}:MISSING_TOKEN_AMOUNT`); continue; }
    if (!solQuote(e.quoteMint)) { p.warnings.add(W.UNSUPPORTED_QUOTE_ASSET); p.excludedReasons.push(`${e.id}:UNSUPPORTED_QUOTE_ASSET`); continue; }
    const quote = amount(e.quoteAmount);
    if (!quote) { p.warnings.add(W.UNKNOWN_QUOTE_AMOUNT); p.excludedReasons.push(`${e.id}:UNKNOWN_QUOTE_AMOUNT`); continue; }
    const fees = knownFees(e);
    if (fees === null) p.warnings.add(W.UNKNOWN_FEES);
    if (e.unattributedSol !== null && e.unattributedSol !== 0) p.warnings.add(W.UNATTRIBUTED_SOL);
    if (e.eventType === 'BUY') {
      if (p.open.isZero() && p.unknownBasis.isZero() && p.closedAt) {
        finish(); p = blank(tokenId, p.cycleNumber + 1); if (incompleteHistory) p.warnings.add(W.INCOMPLETE_WALLET_HISTORY);
        p.lastEventAt = e.blockTime; p.decoderVersions.push(e.decoderVersion);
      }
      p.includedIds.push(e.id);
      p.openedAt ??= e.blockTime; p.firstBuyEventId ??= e.id;
      p.bought = p.bought.plus(qty); p.open = p.open.plus(qty); p.cost = p.cost.plus(quote);
      p.fees = p.fees === null || fees === null ? null : p.fees.plus(fees);
      p.lots.push({ event: e, original: qty, remaining: qty, cost: quote, fees });
      continue;
    }
    p.includedIds.push(e.id);
    let left = qty; let seq = 0; const sellFeePerToken = fees?.div(qty) ?? null;
    while (left.gt(0) && p.lots.length) {
      const lot = p.lots[0]; const matched = Decimal.min(left, lot.remaining);
      const ratio = matched.div(lot.original); const buyCost = lot.cost.mul(ratio);
      const buyFees = lot.fees?.mul(ratio) ?? null; const proceeds = quote.mul(matched.div(qty));
      const sellFees = sellFeePerToken?.mul(matched) ?? null; const raw = proceeds.minus(buyCost);
      const allIn = buyFees !== null && sellFees !== null ? raw.minus(buyFees).minus(sellFees) : null;
      p.matches.push({ buyEventId: lot.event.id, sellEventId: e.id, sequence: seq++, matched,
        buyCost, buyFees, proceeds, sellFees, rawPnl: raw, allInPnl: allIn,
        rawRoi: pct(raw, buyCost), allInRoi: pct(allIn, buyFees === null ? null : buyCost.plus(buyFees)),
        holdingSeconds: lot.event.blockTime ? Math.max(0, Math.floor((e.blockTime.getTime() - lot.event.blockTime.getTime()) / 1000)) : null,
        confidence: e.confidence === 'CONFIRMED' && lot.event.confidence === 'CONFIRMED' ? 'HIGH' : 'MEDIUM', warnings: [] });
      lot.remaining = lot.remaining.minus(matched); p.open = p.open.minus(matched); left = left.minus(matched);
      if (lot.remaining.isZero()) p.lots.shift();
    }
    const unknownMatched = Decimal.min(left, p.unknownBasis);
    p.unknownBasis = p.unknownBasis.minus(unknownMatched); left = left.minus(unknownMatched);
    if (left.gt(0)) { p.unmatchedSell = p.unmatchedSell.plus(left); p.warnings.add(W.UNMATCHED_SELL); p.warnings.add(W.OVERSELL); }
    p.sold = p.sold.plus(qty); p.proceeds = p.proceeds.plus(quote);
    p.fees = p.fees === null || fees === null ? null : p.fees.plus(fees);
    if (p.open.isZero() && p.unknownBasis.isZero() && p.unmatchedSell.isZero()) p.closedAt = e.blockTime;
  }
  finish();
  for (const x of result) {
    x.rawPnl = sum(x.matches.map((m) => m.rawPnl)); x.allInPnl = sum(x.matches.map((m) => m.allInPnl));
    const uncertain = x.warnings.size > 0;
    x.status = x.unmatchedSell.gt(0) ? 'UNMATCHED_SELL' : x.unknownBasis.gt(0) ? 'UNKNOWN_BASIS' :
      incompleteHistory ? 'INCOMPLETE_HISTORY' : x.open.gt(0) ? (x.sold.gt(0) ? 'PARTIAL' : 'OPEN') : 'CLOSED';
    x.confidence = uncertain ? (x.matches.length ? 'MEDIUM' : 'LOW') : 'HIGH';
  }
  return result;
}

export function valuation(p: PositionDraft, snapshot: TokenMarketSnapshot | null, now = new Date()) {
  if (!snapshot) return { sol: null, usd: null, pnl: null, roi: null, freshness: 'NEVER_FETCHED', status: 'MISSING', warning: W.MISSING_MARKET_SNAPSHOT };
  const age = Math.max(0, (now.getTime() - snapshot.observedAt.getTime()) / 1000);
  const freshness = age <= 300 ? 'FRESH' : age <= 3600 ? 'AGING' : 'STALE';
  const sol = snapshot.priceSol ? p.open.mul(D(snapshot.priceSol)) : null;
  const usd = snapshot.priceUsd ? p.open.mul(D(snapshot.priceUsd)) : null;
  const remainingCost = p.lots.reduce((a, lot) => a.plus(lot.cost.mul(lot.remaining.div(lot.original))), D(0));
  const pnl = sol !== null && p.unknownBasis.isZero() ? sol.minus(remainingCost) : null;
  return { sol, usd, pnl, roi: pct(pnl, remainingCost), freshness, status: snapshot.status,
    warning: freshness === 'STALE' ? W.STALE_MARKET_SNAPSHOT : null };
}

export function profileStats(positions: PositionDraft[], completeHistory: boolean) {
  const buys = positions.flatMap((p) => p.lots.map((l) => l.cost));
  const allBuyCosts = positions.flatMap((p) => p.matches.map((m) => m.buyCost));
  const sizes = buys.length ? buys : allBuyCosts;
  const mean = sizes.length ? sizes.reduce((a, b) => a.plus(b), D(0)).div(sizes.length) : null;
  const holding = positions.flatMap((p) => p.closedAt && p.openedAt ? [D((p.closedAt.getTime() - p.openedAt.getTime()) / 1000)] : []);
  const feeBurden = positions.flatMap((p) => p.matches.flatMap((m) => m.buyFees === null || m.buyCost.isZero() ? [] : [m.buyFees.div(m.buyCost).mul(100)]));
  return { median: quantile(sizes, .5), mean, p25: quantile(sizes, .25), p75: quantile(sizes, .75),
    min: sizes.length ? Decimal.min(...sizes) : null, max: sizes.length ? Decimal.max(...sizes) : null,
    holdMedian: quantile(holding, .5), holdMean: holding.length ? holding.reduce((a,b)=>a.plus(b),D(0)).div(holding.length) : null,
    feeBurdenMedian: quantile(feeBurden,.5), completeHistory };
}

export { exact };
