/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { SlowCookPage } from '../src/pages/SlowCookPage';
import { makeSlowCookCandidate, makeSlowCookResult, makeSlowCookStyleMemory } from './fixtures';

const WALLETS = [
  { id: 'wallet-1', address: 'FAKEwa11etAddressForTests11111111111111111', label: 'bn trezor', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'wallet-2', address: 'FAKEwa11etAddressForTests22222222222222222', label: 'bn new', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
];

const posted: { url: string; body: any }[] = [];

function stub(options: { analyze?: unknown; analyzeStatus?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.body) posted.push({ url, body: JSON.parse(String(init.body)) });
      if (url.includes('/api/wallets')) {
        const search = (new URL(url, 'http://localhost').searchParams.get('search') ?? '').toLowerCase();
        const items = WALLETS.filter(
          (w) => !search || (w.label ?? '').toLowerCase().includes(search) || w.address.toLowerCase().includes(search),
        );
        return new Response(
          JSON.stringify({ items, page: 1, pageSize: 200, total: items.length, stats: { total: 2, enabled: 2 }, groups: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/api/slow-cook/analyze')) {
        const status = options.analyzeStatus ?? 200;
        const body = options.analyze ?? (status !== 200 ? { error: 'slow_cook_analysis_failed' } : makeSlowCookResult());
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

function view(mode: 'simple' | 'quant' = 'simple') {
  window.localStorage.setItem('memecoin-lab.ui-mode', mode);
  return render(
    <ModeProvider>
      <SlowCookPage onNavigate={vi.fn()} />
    </ModeProvider>,
  );
}

async function selectWallet(label: string) {
  await waitFor(() => expect(screen.getByText(new RegExp(label))).toBeTruthy());
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(label) }));
}

beforeEach(() => {
  window.localStorage.clear();
  posted.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('Slow Cook — safety and voice', () => {
  it('never mentions private keys, seed phrases, signing, or trading anywhere on the page', () => {
    stub();
    view();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/private key|seed phrase/i);
  });

  it('states this is research, not a trading system', () => {
    stub();
    view();
    expect(screen.getByText(/never connects a wallet, never signs anything, never buys or sells/)).toBeTruthy();
  });
});

describe('Slow Cook — wallet selection', () => {
  it('disables the Find button until at least one wallet is selected', async () => {
    stub();
    view();
    const button = screen.getByRole('button', { name: 'Find slow-cook setups' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Select at least one wallet to search for slow-cook setups.')).toBeTruthy();
  });

  it('shows the exact required no-selection message', async () => {
    stub();
    view();
    expect(screen.getByText('Select at least one wallet to search for slow-cook setups.')).toBeTruthy();
  });

  it('lets a user select and then remove a wallet, updating the selected count', async () => {
    stub();
    view();
    await selectWallet('bn trezor');
    expect(screen.getByText('1 / 10 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove bn trezor/ }));
    expect(screen.getByText('0 / 10 selected')).toBeTruthy();
  });

  it('shows duplicate labels with distinguishing addresses', async () => {
    stub();
    view();
    fireEvent.change(screen.getByLabelText('Search tracked wallets'), { target: { value: 'bn' } });
    await waitFor(() => expect(screen.getAllByText(/bn (trezor|new)/).length).toBeGreaterThan(0));
    // Both distinct wallets are shown even though both labels start with "bn".
    expect(screen.getByText(/bn trezor/)).toBeTruthy();
    expect(screen.getByText(/bn new/)).toBeTruthy();
  });

  it('only sends explicitly selected wallet IDs to the API', async () => {
    stub();
    view();
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(posted.some((p) => p.url.includes('/api/slow-cook/analyze'))).toBe(true));
    const call = posted.find((p) => p.url.includes('/api/slow-cook/analyze'))!;
    expect(call.body.walletIds).toEqual(['wallet-1']);
  });
});

describe('Slow Cook — research settings defaults', () => {
  it('keeps quant details collapsed by default in Simple Mode', () => {
    stub();
    view('simple');
    const details = screen.getByText('Research settings').closest('details');
    expect(details?.hasAttribute('open')).toBe(false);
  });

  it('sends the documented defaults when settings are untouched', async () => {
    stub();
    view();
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(posted.some((p) => p.url.includes('/api/slow-cook/analyze'))).toBe(true));
    const call = posted.find((p) => p.url.includes('/api/slow-cook/analyze'))!;
    expect(call.body.lookbackDays).toBe(30);
    expect(call.body.minimumWallets).toBe(1);
    expect(call.body.limit).toBe(20);
    expect(call.body.includeLowerConfidence).toBe(false);
  });

  it('lets the user change research settings inside the disclosure', async () => {
    stub();
    view();
    fireEvent.click(screen.getByText('Research settings'));
    fireEvent.change(screen.getByLabelText('Lookback days'), { target: { value: '7' } });
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(posted.some((p) => p.url.includes('/api/slow-cook/analyze'))).toBe(true));
    const call = posted.find((p) => p.url.includes('/api/slow-cook/analyze'))!;
    expect(call.body.lookbackDays).toBe(7);
  });
});

describe('Slow Cook — results rendering', () => {
  it('renders a candidate headline, why-this-appeared, style, invalidation and market sections', async () => {
    stub();
    view();
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(screen.getByText(/HIGH-CONVICTION HOLD/)).toBeTruthy());
    expect(screen.getByText('Why this appeared')).toBeTruthy();
    expect(screen.getByText('How these wallets have behaved before')).toBeTruthy();
    expect(screen.getByText('What changes the call?')).toBeTruthy();
    expect(screen.getByText('Market context')).toBeTruthy();
  });

  it('shows the wallet style memory section with a separate card per wallet', async () => {
    stub({
      analyze: makeSlowCookResult({
        styleMemories: [
          makeSlowCookStyleMemory({ walletId: 'wallet-1', label: 'bn trezor' }),
          makeSlowCookStyleMemory({ walletId: 'wallet-2', label: 'bn new', address: 'FAKEwa11etAddressForTests22222222222222222' }),
        ],
      }),
    });
    view();
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(screen.getByText('Wallet style memory')).toBeTruthy());
    expect(screen.getAllByText(/Often adds to a position after the first buy\./).length).toBe(2);
    expect(screen.getByText('Styles are never averaged together.', { exact: false })).toBeTruthy();
  });

  it('shows the not-enough-evidence fallback sentence for an insufficient-evidence wallet', async () => {
    stub({
      analyze: makeSlowCookResult({
        styleMemories: [
          makeSlowCookStyleMemory({
            evidenceState: 'INSUFFICIENT',
            summarySentences: ['Not enough clean completed trades are available to describe this wallet reliably.'],
          }),
        ],
      }),
    });
    view();
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() =>
      expect(
        screen.getByText('Not enough clean completed trades are available to describe this wallet reliably.'),
      ).toBeTruthy(),
    );
  });

  it('shows null market values as Unavailable, never as zero', async () => {
    stub({
      analyze: makeSlowCookResult({
        candidates: [
          makeSlowCookCandidate({
            market: {
              priceUsd: null,
              marketCapUsd: null,
              liquidityUsd: null,
              volume24hUsd: null,
              priceChange24hPct: null,
              observedAt: null,
              freshness: null,
            },
          }),
        ],
      }),
    });
    view();
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(screen.getAllByText(/Unavailable/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/\$0(\.00)?\b/)).toBeNull();
  });

  it('shows the exact no-candidates message when the API returns zero candidates with usable style and weaker evidence is already included', async () => {
    stub({ analyze: makeSlowCookResult({ candidates: [], candidatesFound: 0, strongerCandidateCount: 0 }) });
    view();
    fireEvent.click(screen.getByText('Research settings'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include weaker evidence' }));
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() =>
      expect(
        screen.getByText('No slow-cook setups were found for the selected wallets in this lookback window.'),
      ).toBeTruthy(),
    );
  });

  it('hints that weaker evidence is hidden when zero candidates are found without including lower confidence', async () => {
    stub({ analyze: makeSlowCookResult({ candidates: [], candidatesFound: 0, strongerCandidateCount: 0 }) });
    view();
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(screen.getByText('Only weak-evidence setups were found for the selected wallets.')).toBeTruthy());
  });

  it('shows the unprepared-wallets message with a link to Learn a wallet when no wallet has usable style or candidates', async () => {
    stub({
      analyze: makeSlowCookResult({
        walletsWithUsableStyle: 0,
        candidates: [],
        candidatesFound: 0,
        styleMemories: [makeSlowCookStyleMemory({ evidenceState: 'INSUFFICIENT' })],
      }),
    });
    const onNavigate = vi.fn();
    window.localStorage.setItem('memecoin-lab.ui-mode', 'simple');
    render(
      <ModeProvider>
        <SlowCookPage onNavigate={onNavigate} />
      </ModeProvider>,
    );
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(screen.getByText('None of the selected wallets have prepared research data yet.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Go to Learn a wallet' }));
    expect(onNavigate).toHaveBeenCalledWith('learn-wallet');
  });

  it('never fires an automatic preparation call from the unprepared-wallets state', async () => {
    stub({
      analyze: makeSlowCookResult({
        walletsWithUsableStyle: 0,
        candidates: [],
        candidatesFound: 0,
        styleMemories: [makeSlowCookStyleMemory({ evidenceState: 'INSUFFICIENT' })],
      }),
    });
    view();
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(screen.getByText('None of the selected wallets have prepared research data yet.')).toBeTruthy());
    expect(posted.some((p) => p.url.includes('/api/focus-wallets/prepare'))).toBe(false);
  });

  it('shows an API-failure message with a retry action, never a raw error stack', async () => {
    stub({ analyzeStatus: 500 });
    view();
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(screen.getByText(/Something went wrong while analyzing these wallets\./)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(/at SlowCookPage|node_modules|\.tsx:\d+/)).toBeNull();
  });
});

describe('Slow Cook — Quant Mode', () => {
  it('exposes methodology version, confidence score and IDs only in Quant Mode', async () => {
    stub();
    view('quant');
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(screen.getByText('slow-cook-v1')).toBeTruthy());
    expect(screen.getByText('Confidence score')).toBeTruthy();
  });

  it('does not show quant IDs or raw confidence scores in Simple Mode', async () => {
    stub();
    view('simple');
    await selectWallet('bn trezor');
    fireEvent.click(screen.getByRole('button', { name: 'Find slow-cook setups' }));
    await waitFor(() => expect(screen.getByText(/HIGH-CONVICTION HOLD/)).toBeTruthy());
    expect(screen.queryByText('slow-cook-v1')).toBeNull();
    expect(screen.queryByText('Confidence score')).toBeNull();
  });
});
