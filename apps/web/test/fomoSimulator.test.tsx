import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { FomoSimulatorPage } from '../src/pages/FomoSimulatorPage';
import { PAGES, SIMPLE_NAV, QUANT_NAV } from '../src/components/Sidebar';
import { AdvancedPage } from '../src/pages/AdvancedPage';
import { makeFomoSummary, makePaperCall, makePaperPosition } from './fixtures';

function stub(options: {
  summary?: unknown;
  positions?: unknown[];
  calls?: unknown[];
  summaryStatus?: number;
} = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/fomo-simulator/summary')) {
        const status = options.summaryStatus ?? 200;
        const body = status !== 200 ? { error: 'server_error' } : (options.summary ?? makeFomoSummary());
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/fomo-simulator/positions')) {
        const items = options.positions ?? [makePaperPosition()];
        return new Response(JSON.stringify({ items, total: items.length }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/fomo-simulator/calls')) {
        const items = options.calls ?? [makePaperCall()];
        return new Response(JSON.stringify({ items, total: items.length }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

function view(mode: 'simple' | 'quant' = 'simple') {
  window.localStorage.setItem('memecoin-lab.ui-mode', mode);
  return render(
    <ModeProvider>
      <FomoSimulatorPage />
    </ModeProvider>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('FOMO Simulator — navigation', () => {
  it('is included in Simple Mode nav, in the correct order after Slow Cook', () => {
    const ids = SIMPLE_NAV.map((item) => item.id);
    expect(ids.indexOf('fomo-simulator')).toBe(ids.indexOf('slow-cook') + 1);
    expect(ids.indexOf('fomo-simulator')).toBeLessThan(ids.indexOf('alerts' as never));
  });

  it('resolves the direct #/fomo-simulator hash route', () => {
    expect(PAGES.some((p) => p.id === 'fomo-simulator')).toBe(true);
  });

  it('is reachable from Quant Mode nav', () => {
    expect(QUANT_NAV.some((item) => item.id === 'fomo-simulator')).toBe(true);
  });

  it('is reachable from the Advanced directory', () => {
    window.localStorage.setItem('memecoin-lab.ui-mode', 'simple');
    const onNavigate = vi.fn();
    render(
      <ModeProvider>
        <AdvancedPage onNavigate={onNavigate} />
      </ModeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open FOMO Simulator' }));
    expect(onNavigate).toHaveBeenCalledWith('fomo-simulator');
  });
});

describe('FOMO Simulator — empty state', () => {
  it('shows the exact no-recorded-calls message', async () => {
    stub({ summary: makeFomoSummary({ calls: { total: 0, buy: 0, hold: 0, exit: 0, avoid: 0, noTrade: 0, unpriced: 0 } }), positions: [], calls: [] });
    view();
    await waitFor(() => expect(screen.getByText('No paper calls yet.')).toBeTruthy());
    expect(screen.getByText('Run Slow Cook and record a call to begin testing Solstriker.')).toBeTruthy();
  });
});

describe('FOMO Simulator — summary cards', () => {
  it('renders the required summary cards', async () => {
    stub();
    view();
    await waitFor(() => expect(screen.getByText('Net P/L')).toBeTruthy());
    expect(screen.getAllByText('Open trades').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Closed trades').length).toBeGreaterThan(0);
    expect(screen.getByText('Win rate')).toBeTruthy();
    expect(screen.getByText('High-conviction P/L')).toBeTruthy();
  });

  it('shows "Not enough data" instead of a fake 0% win rate', async () => {
    stub({ summary: makeFomoSummary({ winRatePct: null }) });
    view();
    await waitFor(() => expect(screen.getByText('Not enough data')).toBeTruthy());
  });

  it('separates realized and unrealized P/L', async () => {
    stub({ summary: makeFomoSummary({ realizedPlUsd: '30', unrealizedPlUsd: '10', netPlUsd: '40' }) });
    view();
    await waitFor(() => expect(screen.getByText(/Realized: \+\$30\.00/)).toBeTruthy());
    expect(screen.getByText(/Unrealized: \+\$10\.00/)).toBeTruthy();
  });
});

describe('FOMO Simulator — trade cards', () => {
  it('renders an open trade card with a headline, P/L and return', async () => {
    stub();
    view();
    await waitFor(() => expect(screen.getByText(/BUY — HIGH CONVICTION/)).toBeTruthy());
    expect(screen.getAllByText('+$18.40').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+18.4%').length).toBeGreaterThan(0);
  });

  it('renders a closed trade card with positive P/L formatting', async () => {
    stub({
      positions: [
        makePaperPosition({
          id: 'closed-1',
          status: 'CLOSED',
          closedAt: '2026-07-12T05:00:00.000Z',
          exitPriceUsd: '0.0015',
          realizedPlUsd: '42.10',
          realizedReturnPct: '42.1',
          unrealizedPlUsd: null,
          unrealizedReturnPct: null,
          latestValueUsd: null,
        }),
      ],
      summary: makeFomoSummary({ openTradeCount: 0, closedTradeCount: 1, unrealizedPlUsd: null, realizedPlUsd: '42.10', netPlUsd: '42.10' }),
    });
    view();
    await waitFor(() => expect(screen.getByText(/EXIT/)).toBeTruthy());
    expect(screen.getAllByText('+$42.10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+42.1%').length).toBeGreaterThan(0);
  });

  it('renders negative P/L formatting for a losing closed trade', async () => {
    stub({
      positions: [
        makePaperPosition({
          id: 'closed-2',
          status: 'CLOSED',
          realizedPlUsd: '-16.70',
          realizedReturnPct: '-16.7',
          unrealizedPlUsd: null,
          unrealizedReturnPct: null,
        }),
      ],
      summary: makeFomoSummary({ openTradeCount: 0, closedTradeCount: 1, unrealizedPlUsd: null, realizedPlUsd: '-16.70', netPlUsd: '-16.70' }),
    });
    view();
    await waitFor(() => expect(screen.getAllByText('-$16.70').length).toBeGreaterThan(0));
    expect(screen.getAllByText('-16.7%').length).toBeGreaterThan(0);
  });

  it('shows "Win rate will appear..." when there are no closed trades', async () => {
    stub({ positions: [makePaperPosition()], summary: makeFomoSummary({ closedTradeCount: 0 }) });
    view();
    await waitFor(() => expect(screen.getByText('Win rate will appear after at least one priced paper trade closes.')).toBeTruthy());
  });
});

describe('FOMO Simulator — collapsed sections', () => {
  it('keeps Why?, invalidation, call history and simulation assumptions collapsed by default', async () => {
    // The card always leads with the FIRST reason as a short one-sentence
    // summary; the full reasons list (including a second reason) only
    // appears once "Why?" is expanded.
    stub({
      calls: [makePaperCall({ reasons: ['1 selected wallet(s) interacted with the token', 'A second, more detailed reason'] })],
    });
    view();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Why?' })).toBeTruthy());
    expect(screen.queryByText('A second, more detailed reason')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
    expect(screen.getByText('A second, more detailed reason')).toBeTruthy();
  });

  it('shows the paper-simulation notice inside Simulation assumptions', async () => {
    stub();
    view();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simulation assumptions' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Simulation assumptions' }));
    expect(screen.getAllByText('Paper simulation only. No real trade was placed.').length).toBeGreaterThan(0);
  });

  it('keeps Quant details hidden in Simple Mode and visible in Quant Mode', async () => {
    stub();
    view('simple');
    await waitFor(() => expect(screen.getByText('Net P/L')).toBeTruthy());
    expect(screen.queryByText('fomo-sim-v1')).toBeNull();
  });

  it('shows methodology version and call breakdown in Quant Mode', async () => {
    stub();
    view('quant');
    await waitFor(() => expect(screen.getAllByText('fomo-sim-v1').length).toBeGreaterThan(0));
    expect(screen.getByText('Total calls')).toBeTruthy();
  });
});

describe('FOMO Simulator — missing/stale price handling', () => {
  it('never shows a missing current price as $0', async () => {
    stub({ positions: [makePaperPosition({ latestValueUsd: null, unrealizedPlUsd: null, unrealizedReturnPct: null })] });
    view();
    await waitFor(() => expect(screen.getByText(/Not yet valued/)).toBeTruthy());
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });

  it('shows the exit-signal-pending reason without closing the position', async () => {
    stub({
      positions: [
        makePaperPosition({ exitSignalPendingReason: 'Exit signal recorded — closing price unavailable.' }),
      ],
    });
    view();
    await waitFor(() => expect(screen.getByText('Exit signal recorded — closing price unavailable.')).toBeTruthy());
  });
});

describe('FOMO Simulator — calls without positions', () => {
  it('separates AVOID, NO_TRADE and unpriced BUY calls from win rate and P/L', async () => {
    stub({
      positions: [],
      calls: [
        makePaperCall({ id: 'avoid-1', action: 'AVOID', paperPositionId: null }),
        makePaperCall({ id: 'no-trade-1', action: 'NO_TRADE', paperPositionId: null }),
        makePaperCall({ id: 'unpriced-1', action: 'BUY', priced: false, unpricedReason: 'No usable entry price was available at the time of the call.', paperPositionId: null }),
      ],
      summary: makeFomoSummary({ openTradeCount: 0, closedTradeCount: 0, netPlUsd: null, unrealizedPlUsd: null, realizedPlUsd: null, calls: { total: 3, buy: 1, hold: 0, exit: 0, avoid: 1, noTrade: 1, unpriced: 1 } }),
    });
    view();
    await waitFor(() => expect(screen.getByText('Calls without positions')).toBeTruthy());
    expect(screen.getAllByText(/AVOID/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/NO TRADE/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/This call was recorded, but no usable market price was available for a simulation\./).length).toBeGreaterThan(0);
  });
});

describe('FOMO Simulator — error handling', () => {
  it('shows a retry action on API failure, never a raw stack trace', async () => {
    stub({ summaryStatus: 500 });
    view();
    await waitFor(() => expect(screen.getByText(/Something went wrong loading the FOMO Simulator\./)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(/at FomoSimulatorPage|node_modules|\.tsx:\d+/)).toBeNull();
  });
});

describe('FOMO Simulator — safety', () => {
  it('never shows a real buy/sell button, a wallet-connect control, or auto-trade wording', async () => {
    stub();
    view();
    await waitFor(() => expect(screen.getByText('Net P/L')).toBeTruthy());
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/connect wallet|private key|seed phrase|automatically (buy|sell)/i);
    expect(screen.queryByRole('button', { name: /^Buy$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sell$/i })).toBeNull();
  });
});
