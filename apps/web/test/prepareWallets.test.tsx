/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrepareWalletPanel } from '../src/components/PrepareWalletPanel';
import type { PrepareBatchResult, Wallet } from '../src/api';

const WALLETS: Wallet[] = [
  { id: 'wallet-1', address: 'FAKEwa11etAddressForTests11111111111111111', label: 'bn trezor', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'wallet-2', address: 'FAKEwa11etAddressForTests22222222222222222', label: 'bn new', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'wallet-3', address: 'FAKEwa11etAddressForTests33333333333333333', label: 'unrelated research wallet', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
];

function makeResult(overrides: Partial<PrepareBatchResult> = {}): PrepareBatchResult {
  return {
    requestedWallets: 2,
    processedWallets: 2,
    failures: 1,
    results: [
      {
        walletId: 'wallet-1',
        address: WALLETS[0].address,
        label: 'bn trezor',
        storedEventCountBefore: 0,
        storedEventCountAfter: 42,
        backfillComplete: true,
        sync: { status: 'COMPLETED', reason: null, error: null, transactionsProcessed: 42, eventsCreated: 42, duplicateEvents: 0, tokensDiscovered: 3, backfillComplete: true },
        reconstruction: { status: 'COMPLETED', reason: null, error: null, reconstructionRunId: 'run-1', positionsCreated: 5, matchesCreated: 4, warningCodes: [] },
        quality: { status: 'COMPLETED', reason: null, error: null, qualityMetricSetId: 'quality-1', eligiblePositions: 3, excludedPositions: 2, warningCodes: [] },
        fingerprint: { status: 'COMPLETED', reason: null, error: null, fingerprintId: 'fingerprint-1', eligibleCycleCount: 3, excludedCycleCount: 2, descriptorCodes: [], warningCodes: [] },
        warningCodes: [],
        sanitizedError: null,
      },
      {
        walletId: 'wallet-2',
        address: WALLETS[1].address,
        label: 'bn new',
        storedEventCountBefore: 0,
        storedEventCountAfter: 0,
        backfillComplete: false,
        sync: { status: 'FAILED', reason: 'provider_not_configured', error: 'provider_not_configured', transactionsProcessed: null, eventsCreated: null, duplicateEvents: null, tokensDiscovered: null, backfillComplete: null },
        reconstruction: { status: 'NOT_STARTED', reason: 'sync_failed', error: null, reconstructionRunId: null, positionsCreated: null, matchesCreated: null, warningCodes: [] },
        quality: { status: 'NOT_STARTED', reason: 'reconstruction_required', error: null, qualityMetricSetId: null, eligiblePositions: null, excludedPositions: null, warningCodes: [] },
        fingerprint: { status: 'NOT_STARTED', reason: 'reconstruction_required', error: null, fingerprintId: null, eligibleCycleCount: null, excludedCycleCount: null, descriptorCodes: [], warningCodes: [] },
        warningCodes: [],
        sanitizedError: 'provider_not_configured',
      },
    ],
    ...overrides,
  };
}

let posted: any[] = [];

function stub(result: PrepareBatchResult = makeResult()) {
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Prepare wallet research', () => {
  it('explains what preparation does and requires confirmation before syncing', async () => {
    stub();
    render(<PrepareWalletPanel wallets={WALLETS} />);
    expect(
      screen.getByText(
        'This downloads public activity and prepares research data. It does not place trades, connect a wallet, or recommend copying the selected wallets.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare selected wallets' }));
    // Confirmation dialog appears before any real sync happens.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(posted.length).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posted.length).toBe(0);
  });

  it('sends the request only after confirming, with the selected wallets and options', async () => {
    stub();
    render(<PrepareWalletPanel wallets={WALLETS} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByLabelText('Transaction limit per wallet'));
    fireEvent.change(screen.getByLabelText('Transaction limit per wallet'), { target: { value: '250' } });
    fireEvent.click(screen.getByLabelText('Continue older history'));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare selected wallets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' })); // the modal's confirm button

    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toMatchObject({
      walletIds: ['wallet-1'],
      syncTransactionLimit: 250,
      continueHistoricalSync: true,
      forceRefresh: false,
    });
  });

  it('defaults the transaction limit to 500', () => {
    stub();
    render(<PrepareWalletPanel wallets={WALLETS} />);
    expect((screen.getByLabelText('Transaction limit per wallet') as HTMLInputElement).value).toBe('500');
  });

  it('limits selection to five wallets', () => {
    const many: Wallet[] = Array.from({ length: 6 }, (_, i) => ({
      ...WALLETS[0],
      id: `w${i}`,
      address: `FAKEwa11etAddressForTests${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`,
      label: `wallet ${i}`,
    }));
    stub();
    render(<PrepareWalletPanel wallets={many} />);
    const boxes = screen.getAllByRole('checkbox');
    for (let i = 0; i < 5; i += 1) fireEvent.click(boxes[i]);
    expect(screen.getByText('5 / 5 selected')).toBeTruthy();
    expect((boxes[5] as HTMLInputElement).disabled).toBe(true);
  });

  it('preserves selected wallets when the search query changes', () => {
    stub();
    render(<PrepareWalletPanel wallets={WALLETS} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]); // selects "bn trezor"
    expect(screen.getByText('1 / 5 selected')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search wallets to prepare'), { target: { value: 'unrelated' } });
    expect(screen.getByText('1 / 5 selected')).toBeTruthy(); // selection unchanged though the list is filtered
    expect(screen.queryByText(/bn trezor/)).toBeNull(); // filtered out of view, but still selected

    fireEvent.change(screen.getByLabelText('Search wallets to prepare'), { target: { value: '' } });
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);
  });

  it('shows readable progress statuses for each stage after preparation completes', async () => {
    stub();
    render(<PrepareWalletPanel wallets={WALLETS} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare selected wallets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));

    await waitFor(() => expect(screen.getByText('2 processed')).toBeTruthy());
    expect(screen.getByText('Synchronized')).toBeTruthy();
    expect(screen.getByText('Reconstructed')).toBeTruthy();
    expect(screen.getByText('Quality evidence ready')).toBeTruthy();
    expect(screen.getByText('Strategy fingerprint ready')).toBeTruthy();
    expect(screen.getByText('Failed — retry available')).toBeTruthy();
    // Reconstruction, quality and fingerprint all cascade NOT_STARTED once sync fails.
    expect(screen.getAllByText('Insufficient history').length).toBe(3);
    expect(screen.getByText('Retry this wallet')).toBeTruthy();
  });

  it('shows "Already current" for skipped stages', async () => {
    stub(
      makeResult({
        results: [
          {
            walletId: 'wallet-1',
            address: WALLETS[0].address,
            label: 'bn trezor',
            storedEventCountBefore: 42,
            storedEventCountAfter: 42,
            backfillComplete: true,
            sync: { status: 'SKIPPED', reason: 'already_current', error: null, transactionsProcessed: null, eventsCreated: null, duplicateEvents: null, tokensDiscovered: null, backfillComplete: true },
            reconstruction: { status: 'SKIPPED', reason: 'reconstruction_current', error: null, reconstructionRunId: 'run-1', positionsCreated: null, matchesCreated: null, warningCodes: [] },
            quality: { status: 'SKIPPED', reason: 'quality_current', error: null, qualityMetricSetId: 'quality-1', eligiblePositions: null, excludedPositions: null, warningCodes: [] },
            fingerprint: { status: 'SKIPPED', reason: 'fingerprint_current', error: null, fingerprintId: 'fingerprint-1', eligibleCycleCount: null, excludedCycleCount: null, descriptorCodes: [], warningCodes: [] },
            warningCodes: [],
            sanitizedError: null,
          },
        ],
      }),
    );
    render(<PrepareWalletPanel wallets={WALLETS} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare selected wallets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(screen.getAllByText('Already current').length).toBe(4));
    expect(
      screen.getByText('This wallet’s synchronized history was already complete. Nothing new was fetched.'),
    ).toBeTruthy();
  });

  it('never fabricates a fingerprint when no eligible cycles exist', async () => {
    stub(
      makeResult({
        requestedWallets: 1,
        processedWallets: 1,
        failures: 0,
        results: [
          {
            walletId: 'wallet-1',
            address: WALLETS[0].address,
            label: 'bn trezor',
            storedEventCountBefore: 0,
            storedEventCountAfter: 2,
            backfillComplete: false,
            sync: { status: 'COMPLETED', reason: null, error: null, transactionsProcessed: 2, eventsCreated: 2, duplicateEvents: 0, tokensDiscovered: 1, backfillComplete: false },
            reconstruction: { status: 'COMPLETED', reason: null, error: null, reconstructionRunId: 'run-1', positionsCreated: 1, matchesCreated: 0, warningCodes: [] },
            quality: { status: 'COMPLETED', reason: null, error: null, qualityMetricSetId: 'quality-1', eligiblePositions: 0, excludedPositions: 1, warningCodes: [] },
            fingerprint: { status: 'COMPLETED', reason: null, error: null, fingerprintId: 'fingerprint-1', eligibleCycleCount: 0, excludedCycleCount: 1, descriptorCodes: [], warningCodes: [] },
            warningCodes: [],
            sanitizedError: null,
          },
        ],
      }),
    );
    render(<PrepareWalletPanel wallets={WALLETS} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare selected wallets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(screen.getByText('1 processed')).toBeTruthy());
    // Fingerprint stage COMPLETED but with zero eligible cycles reads as
    // "Insufficient history", never as "Strategy fingerprint ready".
    expect(screen.queryByText('Strategy fingerprint ready')).toBeNull();
    expect(screen.getAllByText('Insufficient history').length).toBeGreaterThan(0);
  });

  it('re-selects only the failed wallet when retrying', async () => {
    stub();
    render(<PrepareWalletPanel wallets={WALLETS} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare selected wallets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(screen.getByText('Retry this wallet')).toBeTruthy());

    posted.length = 0;
    fireEvent.click(screen.getByText('Retry this wallet'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Prepare 1 selected wallet?' })).toBeTruthy();
  });

  it('links to Wallet Intelligence after completion', async () => {
    stub();
    render(<PrepareWalletPanel wallets={WALLETS} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare selected wallets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(screen.getAllByText('View in Wallet Intelligence').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('View in Wallet Intelligence')[0]);
    expect(window.location.hash).toBe('#/intelligence');
  });

  it('never shows ranking, copy-recommendation, prediction or trading language', async () => {
    stub();
    render(<PrepareWalletPanel wallets={WALLETS} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare selected wallets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and prepare' }));
    await waitFor(() => expect(screen.getByText('2 processed')).toBeTruthy());

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/rank|leaderboard|best wallet|top wallet/i);
    expect(text).not.toMatch(/follow this|copy trade|copyable/i);
    expect(text).not.toMatch(/insider|sniper|whale|cabal/i);
    expect(text).not.toMatch(/predict|buy now|sell now|should (buy|sell|hold)/i);
    // "recommend copying" is only permitted inside the required disclaimer's negation.
    expect(text).not.toMatch(/(?<!does not place trades, connect a wallet, or )recommend copying/i);
  });
});
