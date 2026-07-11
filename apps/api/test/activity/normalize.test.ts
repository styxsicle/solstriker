import { describe, expect, it } from 'vitest';
import { syntheticAddress, STABLE_MINTS, WSOL_MINT } from '@memecoin-lab/shared';
import { normalizeTransaction } from '../../src/services/activity/normalizeTransaction.js';
import { OTHER_PARTY, solOnlyTx, swapBuyTx, swapSellTx, tokenTransferInTx } from './fixtures.js';

const WALLET = syntheticAddress(60);
const MEME = syntheticAddress(61);
const MEME2 = syntheticAddress(62);
const USDC = STABLE_MINTS[0];

describe('normalizeTransaction', () => {
  it('classifies a SOL swap purchase as BUY with quote amount', () => {
    const events = normalizeTransaction(
      WALLET,
      swapBuyTx(WALLET, MEME, { tokenAmount: 250_000, solAmount: 1.5, source: 'PUMP_FUN' }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'BUY',
      mint: MEME,
      tokenAmount: 250_000,
      quoteMint: 'SOL',
      quoteAmount: 1.5,
      source: 'PUMP_FUN',
    });
  });

  it('classifies a swap back to SOL as SELL', () => {
    const events = normalizeTransaction(
      WALLET,
      swapSellTx(WALLET, MEME, { tokenAmount: 250_000, solAmount: 2.25 }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'SELL',
      mint: MEME,
      tokenAmount: 250_000,
      quoteMint: 'SOL',
      quoteAmount: 2.25,
    });
  });

  it('treats stablecoins as quote currency, not tracked tokens', () => {
    const tx = swapBuyTx(WALLET, MEME, { tokenAmount: 1000 });
    tx.nativeTransfers = [];
    tx.tokenTransfers.push({
      mint: USDC,
      fromUserAccount: WALLET,
      toUserAccount: OTHER_PARTY,
      tokenAmount: 150,
    });
    const events = normalizeTransaction(WALLET, tx);
    expect(events).toHaveLength(1); // no separate USDC event
    expect(events[0]).toMatchObject({
      eventType: 'BUY',
      mint: MEME,
      quoteMint: USDC,
      quoteAmount: 150,
    });
  });

  it('folds wSOL transfers into the SOL quote', () => {
    const tx = swapBuyTx(WALLET, MEME, { tokenAmount: 1000 });
    tx.nativeTransfers = [];
    tx.tokenTransfers.push({
      mint: WSOL_MINT,
      fromUserAccount: WALLET,
      toUserAccount: OTHER_PARTY,
      tokenAmount: 0.75,
    });
    const events = normalizeTransaction(WALLET, tx);
    expect(events[0]).toMatchObject({ eventType: 'BUY', quoteMint: 'SOL', quoteAmount: 0.75 });
  });

  it('classifies incoming tokens without payment as TOKEN_TRANSFER_IN', () => {
    const events = normalizeTransaction(WALLET, tokenTransferInTx(WALLET, MEME, { tokenAmount: 500 }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'TOKEN_TRANSFER_IN',
      tokenAmount: 500,
      quoteMint: null,
      quoteAmount: null,
    });
  });

  it('classifies outgoing tokens without proceeds as TOKEN_TRANSFER_OUT', () => {
    const tx = tokenTransferInTx(WALLET, MEME, { tokenAmount: 500 });
    tx.tokenTransfers[0] = {
      ...tx.tokenTransfers[0],
      fromUserAccount: WALLET,
      toUserAccount: OTHER_PARTY,
    };
    const events = normalizeTransaction(WALLET, tx);
    expect(events[0]).toMatchObject({ eventType: 'TOKEN_TRANSFER_OUT', tokenAmount: 500 });
  });

  it('produces SELL + BUY for token-to-token swaps (quote unattributed)', () => {
    const tx = swapBuyTx(WALLET, MEME2, { tokenAmount: 9999 });
    tx.nativeTransfers = [];
    tx.tokenTransfers.push({
      mint: MEME,
      fromUserAccount: WALLET,
      toUserAccount: OTHER_PARTY,
      tokenAmount: 1234,
    });
    const events = normalizeTransaction(WALLET, tx);
    expect(events).toHaveLength(2);
    const buy = events.find((e) => e.eventType === 'BUY');
    const sell = events.find((e) => e.eventType === 'SELL');
    expect(buy).toMatchObject({ mint: MEME2, tokenAmount: 9999, quoteMint: null });
    expect(sell).toMatchObject({ mint: MEME, tokenAmount: 1234, quoteMint: null });
  });

  it('ignores dust SOL movement (fees) when classifying transfers', () => {
    const tx = tokenTransferInTx(WALLET, MEME);
    tx.nativeTransfers = [
      { fromUserAccount: WALLET, toUserAccount: OTHER_PARTY, lamports: 5_000 }, // fee-level
    ];
    const events = normalizeTransaction(WALLET, tx);
    expect(events[0].eventType).toBe('TOKEN_TRANSFER_IN');
  });

  it('returns nothing for failed transactions', () => {
    const tx = swapBuyTx(WALLET, MEME);
    tx.failed = true;
    expect(normalizeTransaction(WALLET, tx)).toHaveLength(0);
  });

  it('returns nothing for plain SOL transfers', () => {
    expect(normalizeTransaction(WALLET, solOnlyTx(WALLET))).toHaveLength(0);
  });

  it('nets multiple transfers of the same mint within one transaction', () => {
    const tx = swapBuyTx(WALLET, MEME, { tokenAmount: 1000 });
    tx.tokenTransfers.push({
      mint: MEME,
      fromUserAccount: WALLET,
      toUserAccount: OTHER_PARTY,
      tokenAmount: 400,
    });
    const events = normalizeTransaction(WALLET, tx);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'BUY', tokenAmount: 600 });
  });
});
