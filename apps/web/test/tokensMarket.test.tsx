import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { TokensPage } from '../src/pages/TokensPage';
import { makeMarketSnapshot, makeToken } from './fixtures';

const TOKEN_WITH_MARKET = makeToken({
  id: 't-market',
  mintAddress: 'FAKEmarketMint11111111111111111111111111111',
  market: makeMarketSnapshot(),
});
const TOKEN_NO_MARKET = makeToken({
  id: 't-nomarket',
  mintAddress: 'FAKEnoMarketMint111111111111111111111111111',
  name: null,
  symbol: null,
  market: null,
});
const DEV_TOKEN = makeToken({
  id: 't-dev',
  mintAddress: 'FAKEdevMint1111111111111111111111111111111',
  name: '[DEV] Sample',
  source: 'dev-seed',
  market: null,
});

let lastRefreshBody: unknown = null;

function stubFetch(mode: 'simple' | 'quant', refreshResponse?: () => Response) {
  window.localStorage.setItem('memecoin-lab.ui-mode', mode);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/token-metrics/refresh')) {
      lastRefreshBody = init?.body ? JSON.parse(String(init.body)) : null;
      return (
        refreshResponse?.() ??
        new Response(
          JSON.stringify({
            runId: 'run-1',
            provider: 'dexscreener',
            status: 'COMPLETED',
            requested: 1,
            processed: 1,
            complete: 1,
            partial: 0,
            notFound: 0,
            failed: 0,
            snapshotsInserted: 1,
            duplicatesPrevented: 0,
            results: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      );
    }
    // /api/tokens
    const hideDev = url.includes('includeDev=false');
    const items = hideDev
      ? [TOKEN_WITH_MARKET, TOKEN_NO_MARKET]
      : [TOKEN_WITH_MARKET, TOKEN_NO_MARKET, DEV_TOKEN];
    return new Response(JSON.stringify({ items, total: items.length, liveDiscovery: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    <ModeProvider>
      <TokensPage />
    </ModeProvider>,
  );
}

describe('TokensPage — Simple Mode market display', () => {
  beforeEach(() => {
    window.localStorage.clear();
    lastRefreshBody = null;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requests market data and shows the no-market-data wording', async () => {
    const fetchMock = stubFetch('simple');
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain('withMarket=true');
    expect(
      screen.getByText('Market data has not been collected for this token yet.'),
    ).toBeTruthy();
  });

  it('explains market cap, FDV, liquidity, volume, and freshness', async () => {
    stubFetch('simple');
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Market cap').length).toBeGreaterThan(0));
    // Humanized values, exact string preserved underneath.
    expect(screen.getByText('$363.42M')).toBeTruthy(); // market cap
    expect(screen.getByText('$400.00M')).toBeTruthy(); // FDV, separate
    expect(screen.getByText('$122,350')).toBeTruthy(); // liquidity
    // Definitions available as tooltips on the field labels.
    const withTitle = (label: string, needle: string) =>
      screen.getAllByText(label).some((el) => el.getAttribute('title')?.includes(needle));
    expect(withTitle('Market cap', 'circulating value')).toBe(true);
    expect(withTitle('FDV', 'full supply')).toBe(true);
    expect(withTitle('Liquidity', 'trading pool')).toBe(true);
  });

  it('shows freshness label and price change, without recommendation language', async () => {
    stubFetch('simple');
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('Fresh')).toBeTruthy());
    expect(screen.getByText('-0.6%')).toBeTruthy(); // 24h change
    const text = container.textContent ?? '';
    for (const banned of ['Buy', 'Sell now', 'Avoid', 'Safe', 'Risky', 'Scalp', 'High chance']) {
      // "Buys" count is Quant-only; Simple Mode must not tell the user to buy/sell.
      expect(text.includes(`${banned} this`)).toBe(false);
    }
  });

  it('shows a missing-field message instead of a bare dash', async () => {
    window.localStorage.clear();
    lastRefreshBody = null;
    const partialToken = makeToken({
      id: 't-partial',
      mintAddress: 'FAKEpartialMint11111111111111111111111111111',
      market: makeMarketSnapshot({ status: 'PARTIAL', liquidityUsd: null, marketCapUsd: null }),
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/token-metrics')) return new Response('{}', { status: 200 });
      return new Response(
        JSON.stringify({ items: [partialToken], total: 1, liveDiscovery: false }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    window.localStorage.setItem('memecoin-lab.ui-mode', 'simple');
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Not reported by the selected provider.').length).toBeGreaterThan(0));
  });
});

describe('TokensPage — selection and refresh', () => {
  beforeEach(() => {
    window.localStorage.clear();
    lastRefreshBody = null;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refresh button is disabled with no selection and enabled after selecting', async () => {
    stubFetch('simple');
    renderPage();
    await waitFor(() => expect(screen.getByText('Fixture Meme')).toBeTruthy());
    const refreshBtn = screen.getByRole('button', { name: /Refresh .*selected/ });
    expect((refreshBtn as HTMLButtonElement).disabled).toBe(true);

    const checkboxes = screen.getAllByRole('checkbox', { name: /Select .* for refresh/ });
    fireEvent.click(checkboxes[0]);
    expect(screen.getByText('1 / 20 selected')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Refresh .*selected/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('selects visible non-dev tokens and clears the selection', async () => {
    stubFetch('simple');
    renderPage();
    await waitFor(() => expect(screen.getByText('Fixture Meme')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Select visible tokens' }));
    // Two eligible (non-dev) tokens in the hidden-dev list.
    expect(screen.getByText('2 / 20 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('0 / 20 selected')).toBeTruthy();
  });

  it('sends the selection to the refresh endpoint and shows completion totals', async () => {
    stubFetch('simple');
    renderPage();
    await waitFor(() => expect(screen.getByText('Fixture Meme')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Select .* for refresh/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Refresh .*selected/ }));
    await waitFor(() => expect(screen.getByText('complete')).toBeTruthy());
    expect(lastRefreshBody).toEqual({ tokens: ['t-market'] });
    const summary = screen.getByRole('status');
    expect(within(summary).getByText('1')).toBeTruthy();
  });

  it('shows a partial refresh result summary', async () => {
    stubFetch('simple', () =>
      new Response(
        JSON.stringify({
          runId: 'run-2',
          provider: 'dexscreener',
          status: 'COMPLETED',
          requested: 2,
          processed: 2,
          complete: 1,
          partial: 1,
          notFound: 0,
          failed: 0,
          snapshotsInserted: 2,
          duplicatesPrevented: 0,
          results: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Fixture Meme')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Select .* for refresh/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Refresh .*selected/ }));
    await waitFor(() => expect(screen.getByText('partial')).toBeTruthy());
    const summary = screen.getByRole('status');
    expect(within(summary).getByText('complete')).toBeTruthy();
    expect(within(summary).getByText('partial')).toBeTruthy();
  });

  it('surfaces sanitized rate-limit wording on 429', async () => {
    stubFetch('simple', () =>
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Fixture Meme')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Select .* for refresh/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Refresh .*selected/ }));
    await waitFor(() =>
      expect(screen.getByText(/temporarily rate-limited/i)).toBeTruthy(),
    );
  });

  it('does not offer a refresh-all control', async () => {
    stubFetch('simple');
    renderPage();
    await waitFor(() => expect(screen.getByText('Fixture Meme')).toBeTruthy());
    expect(screen.queryByText(/refresh all/i)).toBeNull();
  });
});

describe('TokensPage — development records', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('hides development tokens by default and reveals them via the toggle', async () => {
    const fetchMock = stubFetch('simple');
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain('includeDev=false');
    await waitFor(() => expect(screen.queryByText('[DEV] Sample')).toBeNull());

    fireEvent.click(screen.getByRole('checkbox', { name: /show development records/i }));
    await waitFor(() => expect(screen.getByText('[DEV] Sample')).toBeTruthy());
    expect(screen.getByText('DEV')).toBeTruthy(); // visible badge, not color-only
  });
});

describe('TokensPage — Quant Mode', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('renders exact decimal strings and technical fields', async () => {
    stubFetch('quant');
    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    // Exact decimal strings preserved verbatim (no lossy rounding).
    expect(screen.getByText('0.000004089')).toBeTruthy(); // priceUsd
    expect(screen.getByText('0.00000005243')).toBeTruthy(); // priceSol
    expect(screen.getByText('363418575')).toBeTruthy(); // marketCap
    expect(screen.getByText('400000000')).toBeTruthy(); // fdv (separate)
    expect(screen.getByText('only_usable_pair')).toBeTruthy(); // selection reason
    // Existing discovery fields remain (both tokens are UNCLASSIFIED).
    expect(screen.getAllByText('UNCLASSIFIED').length).toBeGreaterThan(0);
  });

  it('shows "unknown" for missing values, never zero', async () => {
    window.localStorage.setItem('memecoin-lab.ui-mode', 'quant');
    const partial = makeToken({
      id: 't-partial',
      mintAddress: 'FAKEpartialMint11111111111111111111111111111',
      market: makeMarketSnapshot({ status: 'PARTIAL', liquidityUsd: null }),
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/token-metrics')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ items: [partial], total: 1, liveDiscovery: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
  });
});
