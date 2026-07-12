import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { TokensPage } from '../src/pages/TokensPage';

const DEV_TOKEN = {
  id: 't-dev',
  mintAddress: 'FAKEdevMint111111111111111111111111111111',
  name: '[DEV] Sample token 1',
  symbol: 'DEV1',
  stage: 'UNCLASSIFIED',
  source: 'dev-seed',
  discoveredAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
};

const REAL_TOKEN = {
  ...DEV_TOKEN,
  id: 't-real',
  mintAddress: 'FAKErealMint11111111111111111111111111111',
  name: null,
  symbol: null,
  source: 'activity',
};

describe('TokensPage development-record filtering', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hideDev = url.includes('includeDev=false');
      const items = hideDev ? [REAL_TOKEN] : [REAL_TOKEN, DEV_TOKEN];
      return new Response(
        JSON.stringify({ items, total: items.length, liveDiscovery: false }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hides development tokens by default', async () => {
    render(
      <ModeProvider>
        <TokensPage />
      </ModeProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain('includeDev=false');
    await waitFor(() => expect(screen.queryByText('[DEV] Sample token 1')).toBeNull());
  });

  it('reveals development tokens with the toggle, clearly marked', async () => {
    render(
      <ModeProvider>
        <TokensPage />
      </ModeProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('checkbox', { name: /show development records/i }));
    await waitFor(() => expect(screen.getByText('[DEV] Sample token 1')).toBeTruthy());
    expect(String(fetchMock.mock.calls.at(-1)![0])).not.toContain('includeDev=false');
    expect(screen.getByText('DEV')).toBeTruthy(); // visible badge, not color-only
  });
});
