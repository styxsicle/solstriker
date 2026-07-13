/**
 * Simple Mode "Coin Check" — the redesigned Tokens page. Leads with search,
 * shows a small set of fields first, states plainly that full token safety
 * checks are not built, and moves snapshot/candle collection out of the way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { TokensPage } from '../src/pages/TokensPage';
import { makeMarketSnapshot, makeToken } from './fixtures';

const PUMP = makeToken({
  id: 't-pump',
  mintAddress: 'FAKEpumpMint1111111111111111111111111111111',
  name: 'Pump Coin',
  symbol: 'PUMP',
  market: makeMarketSnapshot(),
});
const OTHER = makeToken({
  id: 't-other',
  mintAddress: 'FAKEotherMint111111111111111111111111111111',
  name: 'Other Coin',
  symbol: 'OTHR',
  market: null,
});

function stub() {
  window.localStorage.setItem('memecoin-lab.ui-mode', 'simple');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ items: [PUMP, OTHER], total: 2, liveDiscovery: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

function view() {
  return render(
    <ModeProvider>
      <TokensPage />
    </ModeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  stub();
});
afterEach(() => vi.unstubAllGlobals());

describe('Coin Check (Simple Mode Tokens page)', () => {
  it('titles the page "Coin Check" and states full safety checks are not built yet', async () => {
    view();
    expect(screen.getByRole('heading', { name: 'Coin Check', level: 1 })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Pump Coin')).toBeTruthy());
    expect(screen.getByText(/Full token safety checks are not built yet\./)).toBeTruthy();
    expect(
      screen.getByText(
        /Contract safety, bundle analysis, holder analysis, creator-history analysis, sellability checks and price predictions are all/,
      ),
    ).toBeTruthy();
  });

  it('leads with a search field over name, symbol or mint address', async () => {
    view();
    await waitFor(() => expect(screen.getByText('Pump Coin')).toBeTruthy());
    expect(screen.getByText('Other Coin')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Name, symbol or mint address'), { target: { value: 'PUMP' } });
    expect(screen.getByText('Pump Coin')).toBeTruthy();
    expect(screen.queryByText('Other Coin')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Name, symbol or mint address'), {
      target: { value: 'FAKEotherMint111111111111111111111111111111' },
    });
    expect(screen.getByText('Other Coin')).toBeTruthy();
  });

  it('shows a small set of fields first, with the rest under "More details"', async () => {
    view();
    await waitFor(() => expect(screen.getByText('Pump Coin')).toBeTruthy());
    expect(screen.getByText('Price (USD)')).toBeTruthy();
    expect(screen.getByText('Market cap')).toBeTruthy();
    expect(screen.getByText('Liquidity')).toBeTruthy();
    expect(screen.getByText('Volume (24h)')).toBeTruthy();
    expect(screen.getByText('Freshness')).toBeTruthy();

    const more = screen.getByText('More details').closest('details');
    expect(more?.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByText('More details'));
    expect(more?.hasAttribute('open')).toBe(true);
    expect(screen.getByText('Provider')).toBeTruthy();
    expect(screen.getByText('DEX')).toBeTruthy();
  });

  it('collapses snapshot and candle collection under Advanced, not shown first', async () => {
    view();
    await waitFor(() => expect(screen.getByText('Pump Coin')).toBeTruthy());
    const advanced = screen.getByText('Advanced token research options').closest('details');
    expect(advanced?.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByText('Advanced token research options'));
    expect(advanced?.hasAttribute('open')).toBe(true);
    expect(screen.getByText('Collect market snapshots')).toBeTruthy();
    expect(screen.getByText('Collect historical candles')).toBeTruthy();
  });

  it('never claims this is a complete safety check', async () => {
    view();
    await waitFor(() => expect(screen.getByText('Pump Coin')).toBeTruthy());
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/complete safety check|fully safe|guaranteed safe/i);
  });
});
