/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { FocusTraderLabPage } from '../src/pages/FocusTraderLabPage';
import { makeCohort, makeFingerprint } from './fixtures';

const WALLETS = [
  { id: 'wallet-1', address: 'FAKEwa11etAddressForTests11111111111111111', label: 'bn trezor', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'wallet-2', address: 'FAKEwa11etAddressForTests22222222222222222', label: 'bn new', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'wallet-3', address: 'FAKEwa11etAddressForTests33333333333333333', label: 'unrelated research wallet', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
];

const posted: { url: string; body: any }[] = [];

function stub(options: { cohorts?: unknown[]; fingerprints?: unknown[] } = {}) {
  const cohorts = options.cohorts ?? [];
  const fingerprints = options.fingerprints ?? [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.body) posted.push({ url, body: JSON.parse(String(init.body)) });
      let body: any = {};
      if (url.includes('/api/wallets')) {
        const search = (new URL(url, 'http://localhost').searchParams.get('search') ?? '').toLowerCase();
        const items = WALLETS.filter(
          (w) => !search || (w.label ?? '').toLowerCase().includes(search) || w.address.toLowerCase().includes(search),
        );
        body = { items, page: 1, pageSize: 200, total: items.length, stats: { total: 3, enabled: 3 }, groups: [] };
      } else if (url.includes('/api/wallet-strategies/analyze')) {
        body = { runId: 'strategy-run-1', calculationVersion: 1, status: 'COMPLETED', requestedWallets: 1, processedWallets: 1, fingerprintsCreated: 1, patternsCreated: 6, eligibleCycles: 5, excludedCycles: 1, warnings: 2, failures: 0, results: [] };
      } else if (url.includes('/api/wallet-strategies')) {
        body = { items: fingerprints, page: 1, pageSize: 100, total: fingerprints.length };
      } else if (/\/api\/focus-cohorts\/[^?]+/.test(url)) {
        body = cohorts[0] ?? makeCohort();
      } else if (url.includes('/api/focus-cohorts')) {
        body = init?.method === 'POST' ? makeCohort() : { items: cohorts, page: 1, pageSize: 100, total: cohorts.length };
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

function view(mode: 'simple' | 'quant' = 'simple') {
  window.localStorage.setItem('memecoin-lab.ui-mode', mode);
  return render(
    <ModeProvider>
      <FocusTraderLabPage />
    </ModeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  posted.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('Focus Trader Lab — cohort setup', () => {
  // The page also renders the Prepare Wallet Research picker (same wallet
  // labels, its own checkboxes), so cohort-setup queries are scoped to the
  // "Focus cohort setup" region rather than the whole screen.
  const cohortSetup = () => within(screen.getByRole('region', { name: 'Focus cohort setup' }));

  it('shows the page subtitle, the ownership disclaimer and the shared-label warning', async () => {
    stub();
    view();
    expect(
      screen.getByText(
        'Study how selected public wallets appear to enter, size, manage and exit observed positions.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Observed behavior does not prove ownership, insider status, lifetime profitability or that the strategy can be copied successfully\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Similar labels do not prove that wallets share an owner\./)).toBeTruthy();
    await waitFor(() => expect(cohortSetup().getByText(/bn trezor/)).toBeTruthy());
  });

  it('searches labels and addresses without auto-adding any wallet', async () => {
    stub();
    view();
    await waitFor(() => expect(cohortSetup().getByText(/unrelated research wallet/)).toBeTruthy());
    fireEvent.change(cohortSetup().getByLabelText('Search tracked wallets'), { target: { value: 'bn' } });
    await waitFor(() => expect(cohortSetup().queryByText(/unrelated research wallet/)).toBeNull());
    expect(cohortSetup().getByText(/bn trezor/)).toBeTruthy();
    // Nothing was selected merely because the labels matched "bn".
    expect(cohortSetup().getByText('0 primary · 0 / 9 comparison wallets')).toBeTruthy();
    expect(cohortSetup().getByText(/Select exactly one primary wallet/)).toBeTruthy();
  });

  it('enforces one primary wallet and at most nine comparison wallets', async () => {
    stub();
    view();
    await waitFor(() => expect(cohortSetup().getAllByRole('radio').length).toBe(3));
    fireEvent.click(cohortSetup().getAllByRole('radio')[0]);
    fireEvent.click(cohortSetup().getAllByRole('checkbox')[1]);
    fireEvent.click(cohortSetup().getAllByRole('checkbox')[2]);
    expect(cohortSetup().getByText('1 primary · 2 / 9 comparison wallets')).toBeTruthy();

    // Choosing a new primary removes it from the comparison list (never both).
    fireEvent.click(cohortSetup().getAllByRole('radio')[1]);
    expect(cohortSetup().getByText('1 primary · 1 / 9 comparison wallets')).toBeTruthy();
    // The primary wallet cannot also be selected as a comparison wallet.
    expect((cohortSetup().getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(true);
  });

  it('reorders comparison members and saves the user-defined order', async () => {
    stub();
    view();
    await waitFor(() => expect(cohortSetup().getAllByRole('radio').length).toBe(3));
    fireEvent.change(cohortSetup().getByLabelText('Cohort name'), { target: { value: 'Focus cohort A' } });
    fireEvent.click(cohortSetup().getAllByRole('radio')[0]);
    fireEvent.click(cohortSetup().getAllByRole('checkbox')[1]);
    fireEvent.click(cohortSetup().getAllByRole('checkbox')[2]);

    const order = cohortSetup().getByRole('list', { name: '' }) ?? null;
    expect(order).toBeTruthy();
    fireEvent.click(cohortSetup().getByRole('button', { name: 'Move unrelated research wallet up' }));
    fireEvent.click(cohortSetup().getByRole('button', { name: 'Save cohort' }));

    await waitFor(() => expect(posted.some((p) => p.url.includes('/api/focus-cohorts'))).toBe(true));
    const payload = posted.find((p) => p.url.endsWith('/api/focus-cohorts'))?.body;
    expect(payload.name).toBe('Focus cohort A');
    expect(payload.members[0]).toMatchObject({ trackedWalletId: 'wallet-1', role: 'PRIMARY' });
    // Reordered: wallet-3 was moved above wallet-2.
    expect(payload.members.slice(1)).toEqual([
      { trackedWalletId: 'wallet-3', role: 'COMPARISON', displayOrder: 0 },
      { trackedWalletId: 'wallet-2', role: 'COMPARISON', displayOrder: 1 },
    ]);
  });

  it('confirms before deleting and states that no wallet or research record is deleted', async () => {
    stub({ cohorts: [makeCohort()] });
    view();
    await waitFor(() => expect(screen.getByText('Focus cohort A')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByText(/No tracked wallet, stored activity, reconstruction, quality record or strategy fingerprint is deleted\./),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() =>
      expect(screen.getByText('Focus cohort deleted. No wallet or research record was deleted.')).toBeTruthy(),
    );
  });
});

describe('Focus Trader Lab — readiness and analysis', () => {
  it('shows data readiness and the missing-reconstruction message without fixing it', async () => {
    stub({ cohorts: [makeCohort()] });
    view();
    await waitFor(() => expect(screen.getByText('Focus cohort A')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => expect(screen.getByText(/Data readiness/)).toBeTruthy());
    expect(screen.getByText('Partial history')).toBeTruthy(); // backfill incomplete
    expect(screen.getByText('Never synchronized')).toBeTruthy();
    expect(
      screen.getByText(/This wallet must be synchronized and reconstructed before a strategy fingerprint can be calculated\./),
    ).toBeTruthy();
    expect(
      screen.getByText(/The lab never synchronizes, reconstructs or analyzes prerequisites automatically\./),
    ).toBeTruthy();
    // Only the one ready member can be analyzed.
    expect(screen.getByText('1 of 2 members have the required reconstruction.')).toBeTruthy();
  });

  it('shows a loading state while analyzing and reports the run result', async () => {
    stub({ cohorts: [makeCohort()] });
    view();
    await waitFor(() => expect(screen.getByText('Focus cohort A')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze 1 cohort member' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Analyze 1 cohort member' }));
    expect(screen.getByRole('button', { name: 'Analyzing…' }).getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(screen.getByText('5 eligible cycles')).toBeTruthy());
    expect(screen.getByText('1 fingerprints')).toBeTruthy();
    // The primary wallet is analyzed first, and only ready members are sent.
    const payload = posted.find((p) => p.url.includes('/analyze'))?.body;
    expect(payload.walletIds).toEqual(['wallet-1']);
  });
});

describe('Focus Trader Lab — strategy fingerprint', () => {
  const open = async (mode: 'simple' | 'quant' = 'simple') => {
    stub({ cohorts: [makeCohort()], fingerprints: [makeFingerprint()] });
    view(mode);
    await waitFor(() => expect(screen.getByText('Focus cohort A')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByText(/observed strategy fingerprint/)).toBeTruthy());
  };

  it('describes entry, exit, partial-exit and holding behavior in neutral wording', async () => {
    await open();
    expect(screen.getByText('3 of 5 eligible cycles used more than one buy.')).toBeTruthy();
    expect(screen.getByText('Median observed buys per cycle: 2.')).toBeTruthy();
    expect(screen.getByText('Median delay between the first and second buy: 74 seconds.')).toBeTruthy();
    expect(screen.getByText('4 of 5 eligible cycles with a sell had more than one sell.')).toBeTruthy();
    expect(screen.getByText('The first known sell removed a median 58% of observed inventory.')).toBeTruthy();
    expect(screen.getByText(/Multiple buys are recorded as observed scale-in behavior/)).toBeTruthy();
    expect(
      screen.getByText(/The app does not label this wallet a scalper, a holder or any other trader type\./),
    ).toBeTruthy();
    expect(screen.getByText('Repeated-token behavior')).toBeTruthy();
    expect(screen.getByText(/Returning to a token is not evidence that the earlier cycle succeeded\./)).toBeTruthy();
  });

  it('defaults the reference bankroll to 2.2 SOL, persists it, and illustrates fee sensitivity', async () => {
    await open();
    const input = screen.getByLabelText('Reference bankroll (SOL)') as HTMLInputElement;
    expect(input.value).toBe('2.2');
    // Stated both as a notice and as an evidence limitation.
    expect(
      screen.getAllByText(/The app does not know this wallet’s historical total bankroll/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Fee burden at a proportionally scaled position/)).toBeTruthy();
    // Fixed per-transaction fees cost a larger share of a smaller position.
    expect(screen.getByText(/3\.64% of position cost/)).toBeTruthy(); // 0.004 SOL of a 0.11 SOL position
    expect(screen.getByText(/0\.73% of position cost/)).toBeTruthy(); // 0.004 SOL of a 0.55 SOL position
    expect(
      screen.getByText(
        /Observed cycles typically use several entries and exits, so per-transaction costs repeat within one cycle\./,
      ),
    ).toBeTruthy();
    // 0.18 SOL median cycle cost × 3 observed concurrent positions ≈ 0.54 SOL of a 2.2 SOL bankroll.
    expect(screen.getByText(/would use approximately 0\.5400 SOL before fees/)).toBeTruthy();

    fireEvent.change(input, { target: { value: '5' } });
    expect(window.localStorage.getItem('memecoin-lab.reference-bankroll-sol')).toBe('5');
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getAllByRole('alert')[0].textContent).toMatch(/greater than zero/);
  });

  it('states the fee-sensitivity wording when the scaled fee burden crosses the threshold', async () => {
    stub({
      cohorts: [makeCohort()],
      // 0.02 SOL of fees is 9.1% of a 0.22 SOL position (10% of a 2.2 SOL bankroll).
      fingerprints: [makeFingerprint({ medianFeePerCycleSol: '0.02' })],
    });
    view();
    await waitFor(() => expect(screen.getByText('Focus cohort A')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByText(/observed strategy fingerprint/)).toBeTruthy());
    expect(
      screen.getByText(
        /At the scaled position size, repeating several entries and exits may make fees a larger percentage of capital\./,
      ),
    ).toBeTruthy();
  });

  it('expands each descriptor into its formula, sample, threshold and confidence', async () => {
    await open();
    const descriptor = screen.getByText('Frequently scales in');
    fireEvent.click(descriptor);
    expect(
      screen.getByText('cycles with two or more buys (observed scale-in behavior) ÷ eligible cycles × 100'),
    ).toBeTruthy();
    expect(screen.getByText('3 of 5')).toBeTruthy();
    expect(screen.getAllByText('5 eligible observations').length).toBeGreaterThan(0);
    expect(screen.getByText('40')).toBeTruthy(); // threshold
    expect(screen.getAllByText('MEDIUM').length).toBeGreaterThan(0); // confidence
    // Each descriptor repeats the warnings behind it.
    expect(
      screen.getAllByText(/Only part of this wallet’s history has been synchronized/).length,
    ).toBeGreaterThan(0);
  });

  it('keeps the cohort comparison in the user-defined order and never ranks it', async () => {
    await open();
    expect(
      screen.getByText(
        'Cohort comparison is descriptive and does not prove shared ownership or recommend following any wallet.',
      ),
    ).toBeTruthy();
    const rows = screen.getAllByRole('row');
    const bodyText = rows.map((row) => row.textContent ?? '');
    const primaryIndex = bodyText.findIndex((text) => text.includes('Primary'));
    const comparisonIndex = bodyText.findIndex((text) => text.includes('Comparison'));
    expect(primaryIndex).toBeLessThan(comparisonIndex); // primary first, then user order
    expect(
      screen.getByText('No strategy fingerprint has been calculated for this wallet yet.'),
    ).toBeTruthy();
    expect(
      screen.getByText(/They are never ordered by profit, quality or any ranking\./),
    ).toBeTruthy();
  });

  it('preserves exact decimal strings and calculation IDs in Quant Mode', async () => {
    await open('quant');
    expect(screen.getAllByText('0.180000123456789 SOL').length).toBeGreaterThan(0);
    expect(screen.getByText('Quant Mode — exact calculation record')).toBeTruthy();
    expect(screen.getAllByText('fingerprint-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('reconstruction-run-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('quality-set-1').length).toBeGreaterThan(0);
    expect(screen.getByText('2.222222222222')).toBeTruthy(); // exact median fee burden
    expect(screen.getByText('FREQUENTLY_SCALES_IN, INCOMPLETE_HISTORY_SAMPLE')).toBeTruthy();
    expect(screen.getByText('INCOMPLETE_WALLET_HISTORY, SMALL_CYCLE_SAMPLE')).toBeTruthy();
    expect(screen.getByText('cohort-1')).toBeTruthy();
  });

  it('never shows a ranking, a follow/copy suggestion or a trade recommendation', async () => {
    await open();
    const page = document.body.textContent ?? '';
    // No ranking, leaderboard or "best/top wallet" claim anywhere on the page.
    expect(page).not.toMatch(/best wallet|top wallet|leaderboard|highest[- ]quality|rank #|ranked \d/i);
    expect(page).not.toMatch(/follow this wallet|copy this|copy trade|copyable|mirror this/i);
    expect(page).not.toMatch(/you should (buy|sell|hold)|suggested size|safe size/i);
    expect(page).not.toMatch(/\bUse \d+(\.\d+)? SOL\b/); // no imperative sizing instruction
    // "recommended position size" may appear ONLY inside its disclaimer.
    expect(page).not.toMatch(/(?<!not a )recommended position size/i);
    expect(page).toMatch(/not a recommended position size/i);
    expect(page).not.toMatch(/confirmed same owner|insider network|cabal|dev group|coordinated manipulation/i);
    expect(page).not.toMatch(/\b(scalp|moonbag|FOMO)\b/i);
    // The only uses of "insider", "rank" and "copied" are explicit disclaimers.
    expect(page).toMatch(/does not prove ownership, insider status, lifetime profitability or that the strategy can be copied successfully/);
    expect(page).toMatch(/never ordered by profit, quality or any ranking/);
  });
});
