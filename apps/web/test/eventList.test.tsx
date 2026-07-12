import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EventList } from '../src/components/EventList';
import { makeEvent } from './fixtures';

describe('EventList — Simple Mode', () => {
  it('renders a confirmed buy as a plain sentence with confidence text', () => {
    render(<EventList events={[makeEvent()]} mode="simple" />);
    expect(
      screen.getByText('mr phoof bought 15.6M tokens for 1.510707025 SOL.'),
    ).toBeTruthy();
    expect(screen.getByTitle('The transaction data clearly supports this result.')).toBeTruthy();
  });

  it('shows the unverified-quote wording instead of a dash', () => {
    render(
      <EventList
        events={[makeEvent({ quoteAmount: null, quoteMint: null, confidence: 'LIKELY' })]}
        mode="simple"
      />,
    );
    expect(screen.getByText('Exact SOL amount could not be verified.')).toBeTruthy();
    expect(
      screen.getByTitle(
        'The application has strong evidence, but some details could not be proven.',
      ),
    ).toBeTruthy();
  });

  it('expands “See details” into the full fee breakdown', () => {
    render(<EventList events={[makeEvent()]} mode="simple" />);
    const toggle = screen.getByRole('button', { name: 'See details' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Network fee')).toBeTruthy();
    expect(screen.getByText('Priority fee')).toBeTruthy();
    expect(screen.getByText('Platform / router fees')).toBeTruthy();
    expect(screen.getByText('Token-account rent')).toBeTruthy();
    expect(screen.getByText('Unattributed SOL')).toBeTruthy();
    expect(screen.getByText('Decoder version')).toBeTruthy();
    expect(screen.getByText('0.000307 SOL')).toBeTruthy(); // exact network fee preserved
  });

  it('shows an empty state when no events exist', () => {
    render(<EventList events={[]} mode="simple" />);
    expect(screen.getByText(/No activity events recorded yet/i)).toBeTruthy();
  });
});

describe('EventList — Quant Mode', () => {
  it('preserves raw technical values in the table', () => {
    render(<EventList events={[makeEvent()]} mode="quant" />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('BUY')).toBeTruthy();
    expect(screen.getByText('15,606,894.907348')).toBeTruthy(); // exact decimals
    expect(screen.getByText('1.510707025 SOL')).toBeTruthy();
    expect(screen.getByText('PUMP_FUN')).toBeTruthy();
  });
});
