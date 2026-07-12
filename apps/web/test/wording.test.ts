import { describe, expect, it } from 'vitest';
import {
  confidenceInfo,
  eventSentence,
  quoteUnverified,
  UNKNOWN_ACTIVITY_TEXT,
  UNKNOWN_QUOTE_TEXT,
} from '../src/lib/wording';
import { makeEvent } from './fixtures';

describe('event sentences (Simple Mode)', () => {
  it('renders a buy sentence with the exact verified quote', () => {
    const sentence = eventSentence(makeEvent());
    expect(sentence).toBe('mr phoof bought 15.6M tokens for 1.510707025 SOL.');
  });

  it('renders a buy without a quote when the amount is unverified', () => {
    const event = makeEvent({ quoteAmount: null, quoteMint: null, confidence: 'LIKELY' });
    expect(eventSentence(event)).toBe('mr phoof bought 15.6M tokens.');
    expect(quoteUnverified(event)).toBe(true);
    expect(UNKNOWN_QUOTE_TEXT).toBe('Exact SOL amount could not be verified.');
  });

  it('renders a sell sentence with received proceeds', () => {
    const sentence = eventSentence(
      makeEvent({ eventType: 'SELL', tokenAmount: 14_400_000, quoteAmount: 2.5117 }),
    );
    expect(sentence).toBe('mr phoof sold 14.4M tokens and received 2.5117 SOL.');
  });

  it('explains transfers as possibly not trades', () => {
    expect(
      eventSentence(makeEvent({ eventType: 'TOKEN_TRANSFER_IN', tokenAmount: 1112, quoteAmount: null })),
    ).toBe('mr phoof received 1,112 tokens. This may not be a trade.');
    expect(
      eventSentence(makeEvent({ eventType: 'TOKEN_TRANSFER_OUT', tokenAmount: 1112, quoteAmount: null })),
    ).toBe('mr phoof sent 1,112 tokens. This may not be a trade.');
  });

  it('uses the unclassified wording for UNKNOWN-confidence activity', () => {
    const sentence = eventSentence(makeEvent({ confidence: 'UNKNOWN', quoteAmount: null }));
    expect(sentence).toBe(UNKNOWN_ACTIVITY_TEXT);
    expect(sentence).toBe(
      'The application detected token activity but could not confidently classify it.',
    );
  });
});

describe('confidence wording', () => {
  it('CONFIRMED', () => {
    const info = confidenceInfo('CONFIRMED');
    expect(info.label).toBe('Confirmed');
    expect(info.text).toBe('The transaction data clearly supports this result.');
  });

  it('LIKELY', () => {
    const info = confidenceInfo('LIKELY');
    expect(info.label).toBe('Likely');
    expect(info.text).toBe(
      'The application has strong evidence, but some details could not be proven.',
    );
  });

  it('UNKNOWN', () => {
    const info = confidenceInfo('UNKNOWN');
    expect(info.label).toBe('Unknown');
    expect(info.text).toBe('The activity was preserved without guessing.');
  });

  it('legacy (null) recommends a re-sync', () => {
    const info = confidenceInfo(null);
    expect(info.label).toBe('Legacy');
    expect(info.text).toContain('Re-sync');
  });
});
