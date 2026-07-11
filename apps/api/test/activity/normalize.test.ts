import { describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { normalizeTransaction } from '../../src/services/activity/normalizeTransaction.js';
import {
  heuristicBuyTx,
  OTHER_PARTY,
  POOL_ACCOUNT,
  solOnlyTx,
  swapBuyTx,
  swapSellTx,
  tokenToTokenSwapTx,
  tokenTransferInTx,
} from './fixtures.js';

const WALLET = syntheticAddress(60);
const MEME = syntheticAddress(61);
const MEME2 = syntheticAddress(62);

describe('normalizeTransaction — decoded swaps (CONFIRMED)', () => {
  it('uses the exact swap input as the quote, not the total wallet outflow', () => {
    const events = normalizeTransaction(
      WALLET,
      swapBuyTx(WALLET, MEME, {
        tokenAmount: 250_000,
        solAmount: 1.5,
        platformFeeSol: 0.015,
        tipSol: 0.01,
        source: 'PUMP_FUN',
      }),
    );
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toMatchObject({
      eventType: 'BUY',
      confidence: 'CONFIRMED',
      mint: MEME,
      tokenAmount: 250_000,
      quoteMint: 'SOL',
      quoteAmount: 1.5, // exact swap leg
      swapInMint: 'SOL',
      swapInAmount: 1.5,
      swapOutMint: MEME,
      swapOutAmount: 250_000,
      venue: 'PUMP_FUN',
    });
    // The wallet lost more than the swap input (fees/tips) — quote must not absorb that.
    expect(event.breakdown.walletSolChange).toBeLessThan(-1.5);
    expect(event.quoteAmount).not.toBe(Math.abs(event.breakdown.walletSolChange!));
    expect(event.explanation).toContain('exactly 1.5 SOL');
  });

  it('decodes a sell with exact SOL proceeds', () => {
    const events = normalizeTransaction(
      WALLET,
      swapSellTx(WALLET, MEME, { tokenAmount: 250_000, solAmount: 2.25, source: 'PUMP_AMM' }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'SELL',
      confidence: 'CONFIRMED',
      tokenAmount: 250_000,
      quoteMint: 'SOL',
      quoteAmount: 2.25,
      swapInMint: MEME,
      swapInAmount: 250_000,
      swapOutMint: 'SOL',
      swapOutAmount: 2.25,
      venue: 'PUMP_AMM',
    });
  });

  it('decodes token→token swaps as SELL + BUY with exact counter-legs', () => {
    const events = normalizeTransaction(
      WALLET,
      tokenToTokenSwapTx(WALLET, MEME, MEME2, {
        amountIn: 1234,
        amountOut: 9999,
        source: 'JUPITER',
        innerVenues: ['RAYDIUM'],
      }),
    );
    expect(events).toHaveLength(2);
    const buy = events.find((e) => e.eventType === 'BUY')!;
    const sell = events.find((e) => e.eventType === 'SELL')!;
    expect(buy).toMatchObject({
      mint: MEME2,
      tokenAmount: 9999,
      confidence: 'CONFIRMED',
      quoteMint: MEME,
      quoteAmount: 1234,
      source: 'JUPITER',
      venue: 'RAYDIUM',
    });
    expect(sell).toMatchObject({
      mint: MEME,
      tokenAmount: 1234,
      confidence: 'CONFIRMED',
      quoteMint: MEME2,
      quoteAmount: 9999,
    });
  });

  it('preserves router (source) separately from execution venue', () => {
    const events = normalizeTransaction(
      WALLET,
      swapBuyTx(WALLET, MEME, { source: 'AXIOM', innerVenues: ['PUMP_AMM'] }),
    );
    expect(events[0].source).toBe('AXIOM');
    expect(events[0].venue).toBe('PUMP_AMM');
    expect(events[0].explanation).toContain('PUMP_AMM');
    expect(events[0].explanation).toContain('via AXIOM');
  });
});

describe('normalizeTransaction — heuristic path (no decoded swap event)', () => {
  it('classifies a probable buy as LIKELY and never invents the quote', () => {
    const events = normalizeTransaction(
      WALLET,
      heuristicBuyTx(WALLET, MEME, { tokenAmount: 100_000, solAmount: 1.5 }),
    );
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toMatchObject({
      eventType: 'BUY',
      confidence: 'LIKELY',
      tokenAmount: 100_000,
      quoteMint: null,
      quoteAmount: null,
      swapInAmount: null,
      venue: null,
    });
    // Exact wallet change is preserved and the SOL outflow is unattributed.
    expect(event.breakdown.walletSolChange).toBeCloseTo(-1.500005, 9);
    expect(event.breakdown.unattributedSol).toBeCloseTo(-1.5, 9);
    expect(event.explanation).toContain('exact price unknown');
  });

  it('keeps plain incoming token transfers CONFIRMED as non-trades', () => {
    const events = normalizeTransaction(
      WALLET,
      tokenTransferInTx(WALLET, MEME, { tokenAmount: 500 }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'TOKEN_TRANSFER_IN',
      confidence: 'CONFIRMED',
      tokenAmount: 500,
      quoteAmount: null,
    });
    expect(events[0].explanation).toContain('not a trade');
  });

  it('classifies outgoing transfers without proceeds as TOKEN_TRANSFER_OUT', () => {
    const tx = tokenTransferInTx(WALLET, MEME, { tokenAmount: 500 });
    tx.tokenTransfers[0] = {
      ...tx.tokenTransfers[0],
      fromUserAccount: WALLET,
      toUserAccount: OTHER_PARTY,
    };
    const events = normalizeTransaction(WALLET, tx);
    expect(events[0]).toMatchObject({
      eventType: 'TOKEN_TRANSFER_OUT',
      confidence: 'CONFIRMED',
      tokenAmount: 500,
    });
  });

  it('marks undecoded two-direction token movement in a SWAP as UNKNOWN', () => {
    const tx = heuristicBuyTx(WALLET, MEME2, { tokenAmount: 9999 });
    tx.nativeTransfers = [];
    tx.tokenTransfers.push({
      mint: MEME,
      fromUserAccount: WALLET,
      toUserAccount: POOL_ACCOUNT,
      tokenAmount: 1234,
    });
    const events = normalizeTransaction(WALLET, tx);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.confidence).toBe('UNKNOWN');
      expect(event.quoteAmount).toBeNull();
    }
    expect(events.map((e) => e.eventType).sort()).toEqual(['BUY', 'SELL']);
  });

  it('marks two-direction movement without a SWAP label as UNKNOWN transfers', () => {
    const tx = tokenTransferInTx(WALLET, MEME2, { tokenAmount: 10 });
    tx.tokenTransfers.push({
      mint: MEME,
      fromUserAccount: WALLET,
      toUserAccount: OTHER_PARTY,
      tokenAmount: 20,
    });
    const events = normalizeTransaction(WALLET, tx);
    expect(events.map((e) => e.eventType).sort()).toEqual([
      'TOKEN_TRANSFER_IN',
      'TOKEN_TRANSFER_OUT',
    ]);
    for (const event of events) expect(event.confidence).toBe('UNKNOWN');
  });

  it('nets multiple transfers of the same mint within one transaction', () => {
    const tx = heuristicBuyTx(WALLET, MEME, { tokenAmount: 1000 });
    tx.tokenTransfers.push({
      mint: MEME,
      fromUserAccount: WALLET,
      toUserAccount: OTHER_PARTY,
      tokenAmount: 400,
    });
    const events = normalizeTransaction(WALLET, tx);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'BUY', tokenAmount: 600, quoteAmount: null });
  });
});

describe('normalizeTransaction — non-events', () => {
  it('returns nothing for failed transactions', () => {
    const tx = swapBuyTx(WALLET, MEME);
    tx.failed = true;
    expect(normalizeTransaction(WALLET, tx)).toHaveLength(0);
  });

  it('returns nothing for plain SOL transfers', () => {
    expect(normalizeTransaction(WALLET, solOnlyTx(WALLET))).toHaveLength(0);
  });
});
