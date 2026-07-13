/**
 * BN-specific safety requirements.
 *
 * Several wallets share the exact label `bn`. `bn trezor` is a known wallet,
 * but it is NOT "BN Main" — no wallet is ever automatically promoted to a
 * primary/main role merely because of a shared or similar label, and this
 * app never claims common ownership between similarly labeled wallets.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { PrepareWalletPanel } from '../src/components/PrepareWalletPanel';
import { LearnWalletPage } from '../src/pages/LearnWalletPage';
import { WalletsPage } from '../src/pages/WalletsPage';
import { ModeProvider } from '../src/lib/mode';
import type { Wallet } from '../src/api';

const BN_WALLETS: Wallet[] = [
  { id: 'bn-1', address: 'AECU4NWws6JnAmxzGPAgsrJ3cgJsbsWgXbqq9EjXtLgH', label: 'bn', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'bn-2', address: 'FAKEbnDuplicateLabelAddress222222222222222', label: 'bn', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'bn-3', address: 'FAKEbnDuplicateLabelAddress333333333333333', label: 'bn', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'bn-trezor', address: 'HBYkoojFkFX7NWuF2VcpDWNXEdGatfNE6mYLsR2udSzo', label: 'bn trezor', group: null, groups: [], emoji: null, notes: null, enabled: true, source: 'activity', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
];

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const search = (new URL(url, 'http://localhost').searchParams.get('search') ?? '').toLowerCase();
      const items = BN_WALLETS.filter(
        (w) => !search || (w.label ?? '').toLowerCase().includes(search) || w.address.toLowerCase().includes(search),
      );
      return new Response(
        JSON.stringify({ items, page: 1, pageSize: 25, total: items.length, stats: { total: 4, enabled: 4 }, groups: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
}

beforeEach(() => stub());
afterEach(() => vi.unstubAllGlobals());

describe('BN wallet safety', () => {
  it('shows every wallet sharing the exact label "bn" with a distinguishable address', async () => {
    render(<PrepareWalletPanel />);
    await waitFor(() => expect(screen.getAllByText('bn').length).toBe(3));

    // The three `bn`-labeled wallets each show their own distinct shortened address.
    expect(screen.getByText('AECU…tLgH')).toBeTruthy();
    expect(screen.getByText('FAKE…2222')).toBeTruthy();
    expect(screen.getByText('FAKE…3333')).toBeTruthy();
  });

  it('never labels any wallet "BN Main", even when several share the label "bn"', async () => {
    render(<PrepareWalletPanel />);
    await waitFor(() => expect(screen.getAllByText('bn').length).toBe(3));
    expect(document.body.textContent).not.toMatch(/bn main/i);
  });

  it('never pre-selects or auto-checks a "bn" wallet merely because its label matched a search', async () => {
    render(<PrepareWalletPanel />);
    fireEvent.change(screen.getByLabelText('Search wallets to prepare'), { target: { value: 'bn' } });
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0));
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect((checkbox as HTMLInputElement).checked).toBe(false);
    }
    expect(screen.getByText('0 / 5 selected')).toBeTruthy();
  });

  it('does not treat "bn trezor" as BN Main, and the exact BN Main address stays unconfirmed', async () => {
    render(<LearnWalletPage onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Label or public address'), { target: { value: 'bn' } });
    await waitFor(() => expect(screen.getByText(/bn trezor/)).toBeTruthy());
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/bn main/i);
    expect(text).not.toMatch(/bn trezor is bn main/i);
  });

  it('never claims shared ownership between similarly labeled "bn" wallets', async () => {
    render(<PrepareWalletPanel />);
    await waitFor(() => expect(screen.getAllByText('bn').length).toBe(3));
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/same owner|shared owner|confirmed same owner|owned by the same/i);
  });

  it('keeps every "bn"-labeled wallet distinguishable by address on the Wallets page too', async () => {
    render(
      <ModeProvider>
        <WalletsPage />
      </ModeProvider>,
    );
    const list = () => within(screen.getByRole('region', { name: 'Search wallets' }));
    await waitFor(() => expect(list().getAllByText('bn').length).toBe(3));
    expect(list().getByText('AECU…tLgH')).toBeTruthy();
    expect(list().getByText('FAKE…2222')).toBeTruthy();
    expect(list().getByText('FAKE…3333')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/bn main/i);
  });
});
