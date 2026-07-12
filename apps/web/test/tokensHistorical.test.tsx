import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { TokensPage } from '../src/pages/TokensPage';
import { makeMarketSnapshot, makeToken } from './fixtures';

const tokens = Array.from({ length: 6 }, (_, i) =>
  makeToken({
    id: `token-${i + 1}`,
    mintAddress: `FAKEhistoricalMint${i + 1}111111111111111111111111`,
    name: `Historical Token ${i + 1}`,
    symbol: `HT${i + 1}`,
    market: makeMarketSnapshot({ tokenId: `token-${i + 1}` }),
  }),
);

function backfillResult(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'historical-run-1', provider: 'geckoterminal', status: 'COMPLETED',
    interval: '1m', requestedStart: '2026-07-11T00:00:00.000Z',
    requestedEnd: '2026-07-12T00:00:00.000Z', requested: 1, processed: 1,
    complete: 1, partial: 0, notFound: 0, failed: 0, candlesInserted: 120,
    candlesUpdated: 0, duplicatesPrevented: 0, gapCount: 0, results: [], ...overrides,
  };
}

function renderPage(fetchMock: typeof fetch) {
  window.localStorage.setItem('memecoin-lab.ui-mode', 'simple');
  vi.stubGlobal('fetch', fetchMock);
  return render(<ModeProvider><TokensPage /></ModeProvider>);
}

function makeFetch(backfill: () => Promise<Response> = async () =>
  new Response(JSON.stringify(backfillResult()), { status: 200, headers: { 'content-type': 'application/json' } })) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/historical-market/backfill')) return backfill();
    return new Response(JSON.stringify({ items: tokens, total: tokens.length, liveDiscovery: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
}

describe('TokensPage historical backfill', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('requires explicit selection and recommends a bounded 1–2 token start', async () => {
    renderPage(makeFetch());
    await waitFor(() => expect(screen.getByText('Historical Token 1')).toBeTruthy());
    expect((screen.getByRole('button', { name: /Backfill .*selected/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/start with 1–2/)).toBeTruthy();
    expect(screen.queryByText(/backfill all/i)).toBeNull();
  });

  it('enforces the maximum-five backfill selection', async () => {
    renderPage(makeFetch());
    await waitFor(() => expect(screen.getByText('Historical Token 1')).toBeTruthy());
    const boxes = screen.getAllByRole('checkbox', { name: /for refresh/ });
    boxes.forEach((box) => fireEvent.click(box));
    expect(screen.getByText('Select at most 5 tokens to backfill candles.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Backfill 6 selected' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('validates that the end is after the start before making a request', async () => {
    const fetchMock = makeFetch();
    renderPage(fetchMock);
    await waitFor(() => expect(screen.getByText('Historical Token 1')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('checkbox', { name: /for refresh/ })[0]);
    fireEvent.change(screen.getByLabelText('Start (UTC)'), { target: { value: '2026-07-12T12:00' } });
    fireEvent.change(screen.getByLabelText('End (UTC)'), { target: { value: '2026-07-12T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Backfill 1 selected' }));
    expect(screen.getByRole('alert').textContent).toMatch(/end time must be after/i);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/backfill'))).toHaveLength(0);
  });

  it('shows loading state and a complete result summary', async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((r) => { resolve = r; });
    renderPage(makeFetch(() => pending));
    await waitFor(() => expect(screen.getByText('Historical Token 1')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('checkbox', { name: /for refresh/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Backfill 1 selected' }));
    expect(screen.getByRole('button', { name: 'Collecting…' }).getAttribute('aria-busy')).toBe('true');
    resolve(new Response(JSON.stringify(backfillResult()), { status: 200, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(screen.getByText('candles added')).toBeTruthy());
    const summary = screen.getAllByRole('status').at(-1)!;
    expect(within(summary).getByText('120')).toBeTruthy();
    expect(within(summary).getByText('complete')).toBeTruthy();
  });

  it('shows a partial backfill result', async () => {
    renderPage(makeFetch(async () => new Response(JSON.stringify(backfillResult({ status: 'PARTIAL', complete: 0, partial: 1, gapCount: 3 })), { status: 200, headers: { 'content-type': 'application/json' } })));
    await waitFor(() => expect(screen.getByText('Historical Token 1')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('checkbox', { name: /for refresh/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Backfill 1 selected' }));
    await waitFor(() => expect(screen.getByText('gaps')).toBeTruthy());
    expect(screen.getAllByRole('status').at(-1)!.textContent).toContain('3 gaps');
  });

  it('shows the provider-unconfigured state without exposing internals', async () => {
    renderPage(makeFetch(async () => new Response(JSON.stringify({ error: 'provider_not_configured' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    await waitFor(() => expect(screen.getByText('Historical Token 1')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('checkbox', { name: /for refresh/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Backfill 1 selected' }));
    await waitFor(() => expect(screen.getByText('The historical market-data provider is not configured.')).toBeTruthy());
  });

  it('shows coverage details including gaps', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/coverage')) return new Response(JSON.stringify({ coverage: {
        pairAddress: 'FAKEpairAddress1111111111111111111111111111', interval: '1m',
        earliestCandle: '2026-07-11T00:00:00.000Z', latestCandle: '2026-07-12T00:00:00.000Z',
        candleCount: 120, gapCount: 3, lastBackfillAt: '2026-07-12T00:01:00.000Z', status: 'PARTIAL',
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ items: [tokens[0]], total: 1, liveDiscovery: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    renderPage(fetchMock);
    await waitFor(() => expect(screen.getByText('Historical Token 1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Candle coverage' }));
    await waitFor(() => expect(screen.getByText('Gaps')).toBeTruthy());
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('PARTIAL')).toBeTruthy();
  });
});
