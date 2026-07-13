/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LearnWalletPage } from '../src/pages/LearnWalletPage';
import type { PrepareBatchResult, Wallet } from '../src/api';

const TREZOR: Wallet = {
  id: 'wallet-trezor',
  address: 'HBYkoojFkFX7NWuF2VcpDWNXEdGatfNE6mYLsR2udSzo',
  label: 'bn trezor',
  group: null,
  groups: [],
  emoji: null,
  notes: null,
  enabled: true,
  source: 'activity',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function makeResult(overrides: Partial<PrepareBatchResult['results'][number]> = {}): PrepareBatchResult {
  return {
    requestedWallets: 1,
    processedWallets: 1,
    failures: 0,
    results: [
      {
        walletId: TREZOR.id,
        address: TREZOR.address,
        label: TREZOR.label,
        storedEventCountBefore: 0,
        storedEventCountAfter: 40,
        backfillComplete: true,
        sync: { status: 'COMPLETED', reason: null, error: null, transactionsProcessed: 40, eventsCreated: 40, duplicateEvents: 0, tokensDiscovered: 4, backfillComplete: true },
        reconstruction: { status: 'COMPLETED', reason: null, error: null, reconstructionRunId: 'run-1', positionsCreated: 6, matchesCreated: 5, warningCodes: [] },
        quality: { status: 'COMPLETED', reason: null, error: null, qualityMetricSetId: 'quality-1', eligiblePositions: 4, excludedPositions: 2, warningCodes: [] },
        fingerprint: { status: 'COMPLETED', reason: null, error: null, fingerprintId: 'fingerprint-1', eligibleCycleCount: 4, excludedCycleCount: 2, descriptorCodes: [], warningCodes: [] },
        warningCodes: [],
        sanitizedError: null,
        ...overrides,
      },
    ],
  };
}

let posted: any[] = [];

function stub(result: PrepareBatchResult = makeResult()) {
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.body) posted.push({ url, body: JSON.parse(String(init.body)) });
      if (url.includes('/api/focus-wallets/prepare')) {
        return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(
        JSON.stringify({ items: [TREZOR], page: 1, pageSize: 25, total: 1, stats: { total: 1, enabled: 1 }, groups: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
}

async function selectTrezor() {
  render(<LearnWalletPage onNavigate={vi.fn()} />);
  await waitFor(() => expect(screen.getByText(/bn trezor/)).toBeTruthy());
  fireEvent.click(screen.getByRole('radio'));
}

beforeEach(() => stub());
afterEach(() => vi.unstubAllGlobals());

describe('Learn a wallet', () => {
  it('shows one primary "Learn this wallet" action once a wallet is selected', async () => {
    await selectTrezor();
    expect(screen.getByRole('button', { name: 'Learn this wallet' })).toBeTruthy();
  });

  it('confirms before any real synchronization, then calls the existing preparation endpoint', async () => {
    await selectTrezor();
    fireEvent.click(screen.getByRole('button', { name: 'Learn this wallet' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(posted.some((p) => p.url.includes('/api/focus-wallets/prepare'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(posted.some((p) => p.url.includes('/api/focus-wallets/prepare'))).toBe(true));
    const call = posted.find((p) => p.url.includes('/api/focus-wallets/prepare'));
    expect(call.body.walletIds).toEqual(['wallet-trezor']);
  });

  it('collapses advanced options and preserves the existing defaults and behavior', async () => {
    await selectTrezor();
    const details = screen.getByText('Advanced preparation options').closest('details');
    expect(details?.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByText('Advanced preparation options'));

    expect((screen.getByLabelText('Transaction limit per wallet') as HTMLInputElement).value).toBe('500');
    fireEvent.click(screen.getByLabelText('Continue older history'));
    fireEvent.click(screen.getByRole('button', { name: 'Learn this wallet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));

    await waitFor(() => expect(posted.some((p) => p.url.includes('/api/focus-wallets/prepare'))).toBe(true));
    const call = posted.find((p) => p.url.includes('/api/focus-wallets/prepare'));
    expect(call.body).toMatchObject({ syncTransactionLimit: 500, continueHistoricalSync: true, forceRefresh: false });
  });

  it('summarizes the result in plain language: downloaded, organized, checked, learned, and what to inspect next', async () => {
    await selectTrezor();
    fireEvent.click(screen.getByRole('button', { name: 'Learn this wallet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(screen.getByText(/What happened with bn trezor/)).toBeTruthy());

    expect(screen.getByText(/Download public trades: done/)).toBeTruthy();
    expect(screen.getByText(/Organize buys and sells: done/)).toBeTruthy();
    expect(screen.getByText(/Check past results: done/)).toBeTruthy();
    expect(screen.getByText(/Learn trading style: done/)).toBeTruthy();
    expect(screen.getByText('Inspect next')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Wallet Intelligence' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Focus Trader Lab' })).toBeTruthy();
  });

  it('never claims a trading-style summary when there was not enough eligible evidence', async () => {
    stub(
      makeResult({
        quality: { status: 'COMPLETED', reason: null, error: null, qualityMetricSetId: 'quality-1', eligiblePositions: 0, excludedPositions: 3, warningCodes: [] },
        fingerprint: { status: 'COMPLETED', reason: null, error: null, fingerprintId: 'fingerprint-1', eligibleCycleCount: 0, excludedCycleCount: 3, descriptorCodes: [], warningCodes: [] },
      }),
    );
    await selectTrezor();
    fireEvent.click(screen.getByRole('button', { name: 'Learn this wallet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(screen.getByText(/What happened with bn trezor/)).toBeTruthy());

    expect(screen.getByText(/Check past results: attempted, but there was not yet enough usable evidence\./)).toBeTruthy();
    expect(screen.getByText(/Learn trading style: attempted, but there was not yet enough usable evidence\./)).toBeTruthy();
    expect(screen.getByText(/Not enough usable evidence exists yet/)).toBeTruthy();
  });

  it('does not expose raw run IDs, metric-set IDs, calculation versions or exact warning codes in the summary', async () => {
    await selectTrezor();
    fireEvent.click(screen.getByRole('button', { name: 'Learn this wallet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(screen.getByText(/What happened with bn trezor/)).toBeTruthy());

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('run-1');
    expect(text).not.toContain('quality-1');
    expect(text).not.toContain('fingerprint-1');
    expect(text).not.toMatch(/calculation version/i);
  });

  it('never shows ranking, prediction or copy-trading language', async () => {
    await selectTrezor();
    fireEvent.click(screen.getByRole('button', { name: 'Learn this wallet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(screen.getByText(/What happened with bn trezor/)).toBeTruthy());

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/best wallet|top wallet|leaderboard|rank/i);
    expect(text).not.toMatch(/follow this|copy trade|copyable/i);
    expect(text).not.toMatch(/insider|sniper|whale|cabal/i);
    expect(text).not.toMatch(/predict|buy now|sell now|should (buy|sell|hold)/i);
  });
});
