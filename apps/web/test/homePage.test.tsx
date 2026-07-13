import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HomePage } from '../src/pages/HomePage';

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = {
        wallets: { total: 1024, enabled: 1000, dev: 2 },
        activity: { syncedWallets: 12, storedEvents: 500 },
        tokens: { total: 65, dev: 1 },
        positions: { walletsReconstructed: 3, totalPositions: 84, closedPositions: 10, openPositions: 5, incompletePositions: 2, totalMatches: 24, profilesGenerated: 3, latestRunStatus: 'COMPLETED' },
      };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

beforeEach(() => stub());
afterEach(() => vi.unstubAllGlobals());

describe('Home page', () => {
  it('shows the four beginner actions, with unavailable features clearly marked', async () => {
    const onNavigate = vi.fn();
    render(<HomePage onNavigate={onNavigate} />);

    expect(screen.getByRole('button', { name: 'Learn a wallet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check a coin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View wallets' })).toBeTruthy();

    const opportunities = screen.getByRole('button', { name: 'Coming later' });
    expect((opportunities as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/does not currently discover live opportunities/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1,024')).toBeTruthy());
  });

  it('states clearly that full token safety checks are not implemented', async () => {
    render(<HomePage onNavigate={vi.fn()} />);
    expect(
      screen.getByText(
        /Full contract safety, bundle analysis, holder analysis, creator analysis, sellability checks and predictions are not implemented yet\./,
      ),
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1,024')).toBeTruthy());
  });

  it('navigates to the learn-wallet flow, coin check and wallets', async () => {
    const onNavigate = vi.fn();
    render(<HomePage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Learn a wallet' }));
    expect(onNavigate).toHaveBeenCalledWith('learn-wallet');
    fireEvent.click(screen.getByRole('button', { name: 'Check a coin' }));
    expect(onNavigate).toHaveBeenCalledWith('tokens');
    fireEvent.click(screen.getByRole('button', { name: 'View wallets' }));
    expect(onNavigate).toHaveBeenCalledWith('wallets');
    await waitFor(() => expect(screen.getByText('1,024')).toBeTruthy());
  });

  it('shows only a small research-status summary, not the full technical dashboard', async () => {
    render(<HomePage onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('1,024')).toBeTruthy());
    expect(screen.getByText('Tracked wallets')).toBeTruthy();
    expect(screen.getByText('Wallets with downloaded activity')).toBeTruthy();
    expect(screen.getByText('Wallets with completed research')).toBeTruthy();
    expect(screen.getByText('Discovered tokens')).toBeTruthy();
    // The large technical dashboards stay out of Home.
    expect(screen.queryByText('Current slot')).toBeNull();
    expect(screen.queryByText(/reconstruction run/i)).toBeNull();
    expect(screen.queryByText(/calculation version/i)).toBeNull();
  });

  it('never shows ranking, prediction or trading-recommendation language', async () => {
    render(<HomePage onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('1,024')).toBeTruthy());
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/best wallet|top wallet|leaderboard|rank/i);
    expect(text).not.toMatch(/buy now|sell now/i);
    // "predictions are not implemented yet" is the required, permitted disclaimer.
    expect(text).not.toMatch(/(?<!and )predict(?!ions are not implemented)/i);
  });
});
