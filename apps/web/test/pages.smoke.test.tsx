// Mounts every page in both modes against mocked APIs — catches runtime
// rendering errors and verifies the key beginner/technical content appears.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { OverviewPage } from '../src/pages/OverviewPage';
import { WalletsPage } from '../src/pages/WalletsPage';
import { ActivityPage } from '../src/pages/ActivityPage';
import { HelpPage } from '../src/pages/HelpPage';
import { makeEvent } from './fixtures';

const RESPONSES: Record<string, unknown> = {
  '/api/health': { status: 'ok', db: 'ok', uptimeSec: 12, timestamp: 'now' },
  '/api/rpc/status': {
    configured: true,
    cluster: 'mainnet-beta',
    healthy: true,
    slot: 123456,
    latencyMs: 88,
    checkedAt: 'now',
    error: null,
  },
  '/api/overview': {
    wallets: { total: 10, enabled: 9, dev: 2 },
    activity: { syncedWallets: 1, storedEvents: 5 },
    tokens: { total: 3, dev: 1 },
    market: {
      nonDevTokens: 2,
      withSnapshots: 1,
      neverRefreshed: 1,
      fresh: 1,
      aging: 0,
      stale: 0,
      partialLatest: 0,
      lastSuccessfulRefreshAt: '2026-07-12T00:00:00.000Z',
      lastRunStatus: 'COMPLETED',
    },
    historical: {
      tokensWithCandles: 1,
      totalCandles: 120,
      earliestCandle: '2026-07-11T00:00:00.000Z',
      latestCandle: '2026-07-12T00:00:00.000Z',
      lastBackfillStatus: 'COMPLETED',
      lastBackfillAt: '2026-07-12T00:00:00.000Z',
      eligibleBuyEvents: 3,
      buysWithCompleteOutcome: 1,
      buysWithPartialOutcome: 1,
      buysWithoutOutcome: 1,
    },
    positions: { walletsReconstructed: 0, totalPositions: 0, closedPositions: 0, openPositions: 0, incompletePositions: 0, totalMatches: 0, profilesGenerated: 0, latestRunStatus: null },
    quality: { walletsAnalyzed: 0, latestRunStatus: null, metricSetsGenerated: 0, categoryMetricSetsGenerated: 0, timeWindowComparisonsGenerated: 0, verySmallSamples: 0, smallSamples: 0, moderateSamples: 0, largeSamples: 0, incompleteHistoryWallets: 0 },
    focus: { cohorts: 2, cohortMembers: 5, walletsWithFingerprints: 1, latestRunStatus: 'COMPLETED', latestRunAt: '2026-07-12T00:00:00.000Z', insufficientEvidenceFingerprints: 0, incompleteHistoryFingerprints: 1 },
  },
  '/api/wallets': { items: [], page: 1, pageSize: 50, total: 0, stats: { total: 10, enabled: 9 }, groups: [] },
  '/api/activity/status': { providerConfigured: true, maxWalletsPerSync: 10, items: [] },
  '/api/activity/summary': {
    transactionsChecked: 100,
    eventsStored: 5,
    buys: 2,
    sells: 1,
    transfersIn: 1,
    transfersOut: 0,
    confirmed: 3,
    likely: 2,
    unknownConfidence: 0,
    legacyEvents: 0,
  },
  '/api/activity/events': { items: [makeEvent()], page: 1, pageSize: 50, total: 1 },
};

function withMode(mode: 'simple' | 'quant', node: React.ReactNode) {
  window.localStorage.setItem('memecoin-lab.ui-mode', mode);
  return render(<ModeProvider>{node}</ModeProvider>);
}

describe('page smoke rendering', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const body = RESPONSES[path];
      if (!body) throw new Error(`unmocked path ${path}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Overview (Simple Mode) explains health in plain language with the scope notice', async () => {
    withMode('simple', <OverviewPage />);
    await waitFor(() =>
      expect(screen.getByText('The application and its saved data are available.')).toBeTruthy(),
    );
    expect(
      screen.getByText('The app can currently communicate with the Solana blockchain.'),
    ).toBeTruthy();
    expect(screen.getByText(/Historical research only\./)).toBeTruthy();
    expect(screen.getByText('Predictions')).toBeTruthy(); // listed as not implemented
  });

  it('Overview (Quant Mode) preserves the technical fields', async () => {
    withMode('quant', <OverviewPage />);
    await waitFor(() => expect(screen.getByText('RPC health')).toBeTruthy());
    expect(screen.getByText('Cluster')).toBeTruthy();
    expect(screen.getByText('Current slot')).toBeTruthy();
    expect(screen.getByText('123,456')).toBeTruthy();
    expect(screen.getByText('Latency')).toBeTruthy();
  });

  it('Wallets page shows the import steps and the no-private-key explanation', async () => {
    withMode('simple', <WalletsPage />);
    await waitFor(() =>
      expect(screen.getByText(/never needs its private key or seed phrase/)).toBeTruthy(),
    );
    expect(screen.getByText('Import wallets')).toBeTruthy();
    expect(screen.getByText('Supported file formats')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /show development records/i })).toBeTruthy();
  });

  it('Activity page renders summaries, sync guidance, and a decoded event', async () => {
    withMode('simple', <ActivityPage />);
    await waitFor(() =>
      expect(
        screen.getByText('mr phoof bought 15.6M tokens for 1.510707025 SOL.'),
      ).toBeTruthy(),
    );
    expect(screen.getByText('Transactions checked')).toBeTruthy();
    expect(screen.getByText(/start with 1–5 wallets and 100 transactions/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'See details' })).toBeTruthy();
  });

  it('Help page includes the glossary and safety rules', () => {
    withMode('simple', <HelpPage />);
    expect(screen.getByText('Privacy and safety')).toBeTruthy();
    expect(screen.getByText('Seed phrase')).toBeTruthy();
    expect(screen.getByText('Execution venue')).toBeTruthy();
    expect(screen.getByText('Positive reconstructed-result rate')).toBeTruthy();
    expect(screen.getByText('Profit factor')).toBeTruthy();
    expect(screen.getByText('Evidence confidence')).toBeTruthy();
    expect(screen.getByText('Pump.fun')).toBeTruthy();
    expect(screen.getByText(/cannot sign\s*or submit transactions/)).toBeTruthy();
  });

  it('Help page defines the focus-trader research terms neutrally', () => {
    withMode('simple', <HelpPage />);
    for (const term of [
      'Focus trader',
      'Focus cohort',
      'Primary wallet',
      'Comparison wallet',
      'Strategy fingerprint',
      'Scale in',
      'Scale out',
      'Partial exit',
      'Observed inventory',
      'Position cycle',
      'Fee burden',
      'Portability illustration',
      'Incomplete history',
      'Cohort evidence',
      'Ownership uncertainty',
    ]) {
      expect(screen.getByText(term)).toBeTruthy();
    }
    expect(
      screen.getByText(/Similar labels, shared funding, shared tokens and similar timing do not prove/),
    ).toBeTruthy();
    expect(screen.getByText(/not a recommended position size and not a verdict/)).toBeTruthy();
  });

  it('Overview shows focus-research counts without naming a best wallet', async () => {
    withMode('simple', <OverviewPage />);
    await waitFor(() => expect(screen.getByText('Focus trader research')).toBeTruthy());
    expect(screen.getByText('Focus cohorts created')).toBeTruthy();
    expect(screen.getByText('Focus-wallet members')).toBeTruthy();
    expect(screen.getByText('Wallets with strategy fingerprints')).toBeTruthy();
    expect(screen.getByText('Insufficient evidence')).toBeTruthy();
    expect(screen.getByText('Incomplete-history fingerprints')).toBeTruthy();
    expect(screen.getByText(/No wallet is ranked, recommended or called best\./)).toBeTruthy();
    expect(screen.queryByText(/best focus trader|most profitable|highest-quality/i)).toBeNull();
  });
});
