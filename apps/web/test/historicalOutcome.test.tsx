import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EventList } from '../src/components/EventList';
import { makeEvent, makeOutcome } from './fixtures';

function outcomeResponse(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('HistoricalOutcome', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows no-history wording for an eligible buy with no stored outcome', async () => {
    outcomeResponse({ error: 'outcome_not_found' }, 404);
    render(<EventList events={[makeEvent()]} mode="simple" />);
    fireEvent.click(screen.getByRole('button', { name: 'Historical outcome' }));
    await waitFor(() =>
      expect(
        screen.getByText('Historical price data has not been collected for this entry.'),
      ).toBeTruthy(),
    );
  });

  it('shows partial wording and the required market-pair warning', async () => {
    outcomeResponse(makeOutcome({ status: 'PARTIAL', confidence: 'LOW', price24hUsd: null, return24hPct: null, missingWindowCount: 1 }));
    render(<EventList events={[makeEvent()]} mode="simple" />);
    fireEvent.click(screen.getByRole('button', { name: 'Historical outcome' }));
    await waitFor(() =>
      expect(screen.getByText('Only part of the requested outcome window is available.')).toBeTruthy(),
    );
    expect(screen.getByText(/They do not represent a guaranteed fill/)).toBeTruthy();
    expect(screen.getByText('not available')).toBeTruthy();
  });

  it('renders a complete Simple Mode outcome without claiming wallet profit', async () => {
    outcomeResponse(makeOutcome());
    const { container } = render(<EventList events={[makeEvent()]} mode="simple" />);
    fireEvent.click(screen.getByRole('button', { name: 'Historical outcome' }));
    await waitFor(() => expect(screen.getByText('Estimated entry price')).toBeTruthy());
    expect(screen.getByText('After 5 minutes')).toBeTruthy();
    expect(screen.getByText('Max downside (first 24h)')).toBeTruthy();
    expect(container.textContent).not.toMatch(/wallet (earned|made|profit)/i);
  });

  it('preserves exact decimal strings and technical metadata in Quant Mode', async () => {
    outcomeResponse(makeOutcome());
    render(<EventList events={[makeEvent()]} mode="quant" />);
    fireEvent.click(screen.getByText('BUY').closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Historical outcome' }));
    await waitFor(() => expect(screen.getByText('0.000004000123456789')).toBeTruthy());
    expect(screen.getByText('9.996606354413')).toBeTruthy();
    expect(screen.getByText('FAKEpairAddress1111111111111111111111111111')).toBeTruthy();
    expect(screen.getByText('calc version')).toBeTruthy();
    expect(screen.getByText('missing windows')).toBeTruthy();
  });

  it('never renders an outcome panel for transfers', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<EventList events={[makeEvent({ eventType: 'TOKEN_TRANSFER_IN' })]} mode="simple" />);
    expect(screen.queryByRole('button', { name: 'Historical outcome' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not offer outcomes for unknown-confidence buys', () => {
    render(<EventList events={[makeEvent({ confidence: 'UNKNOWN' })]} mode="simple" />);
    expect(screen.queryByRole('button', { name: 'Historical outcome' })).toBeNull();
  });
});
