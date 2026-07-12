// Beginner-facing wording for real decoded data. These functions never invent
// amounts: unknown values are stated as unknown, in plain language.
import type { ActivityEvent } from '../api';
import { compactAmount, shortAddr } from './format';

export const UNKNOWN_QUOTE_TEXT = 'Exact SOL amount could not be verified.';

export const UNKNOWN_ACTIVITY_TEXT =
  'The application detected token activity but could not confidently classify it.';

export interface ConfidenceInfo {
  label: string;
  icon: string;
  text: string;
  tone: 'good' | 'warn' | 'muted' | 'bad';
}

export function confidenceInfo(confidence: string | null): ConfidenceInfo {
  switch (confidence) {
    case 'CONFIRMED':
      return {
        label: 'Confirmed',
        icon: '✔',
        tone: 'good',
        text: 'The transaction data clearly supports this result.',
      };
    case 'LIKELY':
      return {
        label: 'Likely',
        icon: '≈',
        tone: 'warn',
        text: 'The application has strong evidence, but some details could not be proven.',
      };
    case 'UNKNOWN':
      return {
        label: 'Unknown',
        icon: '?',
        tone: 'muted',
        text: 'The activity was preserved without guessing.',
      };
    default:
      return {
        label: 'Legacy',
        icon: '⚠',
        tone: 'bad',
        text: 'This event was decoded by an older version of the app. Re-sync the wallet to decode it again with exact amounts.',
      };
  }
}

export function walletDisplayName(wallet: {
  label: string | null;
  emoji: string | null;
  address: string;
}): string {
  const name = wallet.label ?? shortAddr(wallet.address);
  return wallet.emoji ? `${wallet.emoji} ${name}` : name;
}

function quotePhrase(event: ActivityEvent): string | null {
  if (event.quoteAmount === null) return null;
  const unit = event.quoteMint === 'SOL' ? 'SOL' : `of a stablecoin/token (${shortAddr(event.quoteMint ?? '')})`;
  return `${event.quoteAmount.toLocaleString(undefined, { maximumFractionDigits: 9 })} ${unit}`;
}

/** One plain-English sentence describing what happened. */
export function eventSentence(event: ActivityEvent): string {
  const name = walletDisplayName(event.wallet);
  const amount = compactAmount(event.tokenAmount);
  const quote = quotePhrase(event);

  if (event.confidence === 'UNKNOWN') {
    return UNKNOWN_ACTIVITY_TEXT;
  }
  switch (event.eventType) {
    case 'BUY':
      return quote
        ? `${name} bought ${amount} tokens for ${quote}.`
        : `${name} bought ${amount} tokens.`;
    case 'SELL':
      return quote
        ? `${name} sold ${amount} tokens and received ${quote}.`
        : `${name} sold ${amount} tokens.`;
    case 'TOKEN_TRANSFER_IN':
      return `${name} received ${amount} tokens. This may not be a trade.`;
    case 'TOKEN_TRANSFER_OUT':
      return `${name} sent ${amount} tokens. This may not be a trade.`;
    default:
      return UNKNOWN_ACTIVITY_TEXT;
  }
}

/** True when this is a trade whose exact quote could not be verified. */
export function quoteUnverified(event: ActivityEvent): boolean {
  return (
    (event.eventType === 'BUY' || event.eventType === 'SELL') && event.quoteAmount === null
  );
}

export function routerVenueText(event: ActivityEvent): string | null {
  if (event.source && event.venue && event.source !== event.venue) {
    return `${event.source} → ${event.venue}`;
  }
  return event.venue ?? event.source ?? null;
}
