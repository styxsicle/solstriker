// The backend wallet search already supports server-side search; several
// pickers used to load one fixed page and filter it locally, which silently
// hid wallets outside that page. This hook always searches the server.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useWalletSearch } from '../src/hooks/useWalletSearch';
import type { Wallet } from '../src/api';

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
/** Deliberately NOT part of any default (unfiltered) page — only findable by search. */
const OUTSIDE_FIRST_PAGE: Wallet = {
  id: 'wallet-outside-page',
  address: 'FAKEwa11etOutsideFirstPage1111111111111111',
  label: 'bn multi',
  group: null,
  groups: [],
  emoji: null,
  notes: null,
  enabled: true,
  source: 'activity',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const OTHER: Wallet = {
  id: 'wallet-other',
  address: 'FAKEwa11etOtherAddress11111111111111111111',
  label: 'unrelated wallet',
  group: null,
  groups: [],
  emoji: null,
  notes: null,
  enabled: true,
  source: 'activity',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const ALL = [TREZOR, OTHER]; // the "default page" — OUTSIDE_FIRST_PAGE is never in it

let calls: string[] = [];

function stub() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const search = (new URL(url, 'http://localhost').searchParams.get('search') ?? '').toLowerCase();
      // Simulates a real backend: `search` matches label OR address over the
      // FULL table, not just whatever page happened to load first.
      const universe = [...ALL, OUTSIDE_FIRST_PAGE];
      const items = search
        ? universe.filter((w) => (w.label ?? '').toLowerCase().includes(search) || w.address.toLowerCase().includes(search))
        : ALL;
      return new Response(
        JSON.stringify({ items, page: 1, pageSize: 25, total: items.length, stats: { total: 3, enabled: 3 }, groups: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
}

function Harness() {
  const { query, setQuery, results, getWallet } = useWalletSearch();
  const [selected, setSelectedState] = useState<Set<string>>(new Set());
  return (
    <div>
      <input aria-label="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul aria-label="results">
        {results.map((w) => (
          <li key={w.id}>
            <button onClick={() => setSelectedState(new Set(selected).add(w.id))}>{w.label}</button>
          </li>
        ))}
      </ul>
      <ul aria-label="selected">
        {[...selected].map((id: string) => {
          const w = getWallet(id);
          return <li key={id}>{w ? w.label : 'unresolved'}</li>;
        })}
      </ul>
    </div>
  );
}

beforeEach(() => stub());
afterEach(() => vi.unstubAllGlobals());

describe('useWalletSearch', () => {
  it('searches "bn trezor" against the server, not a locally cached page', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'bn trezor' } });
    await waitFor(() => expect(screen.getByText('bn trezor')).toBeTruthy());
    expect(calls.some((c) => c.includes('search=bn') || c.includes('search=bn%20trezor'))).toBe(true);
  });

  it('finds a wallet by its exact public address', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('search'), {
      target: { value: 'HBYkoojFkFX7NWuF2VcpDWNXEdGatfNE6mYLsR2udSzo' },
    });
    await waitFor(() => expect(screen.getByText('bn trezor')).toBeTruthy());
  });

  it('finds a wallet that was never part of the initial default page', async () => {
    render(<Harness />);
    // Confirm it is absent from the unfiltered default view first.
    await waitFor(() => expect(screen.getByLabelText('results').children.length).toBeGreaterThan(0));
    expect(screen.queryByText('bn multi')).toBeNull();

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'bn multi' } });
    await waitFor(() => expect(screen.getByText('bn multi')).toBeTruthy());
  });

  it('keeps resolving a selected wallet after the search query changes', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('bn trezor')).toBeTruthy());
    fireEvent.click(screen.getByText('bn trezor'));
    expect(screen.getByLabelText('selected').textContent).toContain('bn trezor');

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'unrelated' } });
    await waitFor(() => expect(screen.getByText('unrelated wallet')).toBeTruthy());
    // Selection cache still resolves the wallet even though it no longer matches the query.
    expect(screen.getByLabelText('selected').textContent).toContain('bn trezor');
  });
});
