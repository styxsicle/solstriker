import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { createPrisma } from '../src/db.js';
import { findRepoRoot, type AppEnv } from '../src/env.js';
import { createHeliusProvider } from '../src/providers/solana/heliusProvider.js';
import type { SolanaActivityProvider } from '../src/providers/solana/provider.js';
import type { MarketDataProvider } from '../src/providers/market/marketDataProvider.js';
import { createMarketDataProvider } from '../src/providers/market/providerFactory.js';
import type { HistoricalMarketProvider } from '../src/providers/historicalMarket/historicalMarketProvider.js';
import { createHistoricalMarketProvider } from '../src/providers/historicalMarket/providerFactory.js';
import { createRpcClient } from '../src/rpc.js';

export const TEST_DB_URL = `file:${path.join(findRepoRoot(), 'prisma', 'test.db')}`;

export function makeTestEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    HELIUS_API_KEY: undefined,
    SOLANA_CLUSTER: 'mainnet-beta',
    DATABASE_URL: TEST_DB_URL,
    API_PORT: 0,
    WEB_ORIGIN: 'http://localhost:5173',
    MARKET_DATA_PROVIDER: 'none',
    HISTORICAL_MARKET_PROVIDER: 'none',
    ...overrides,
  };
}

export interface TestApp {
  app: FastifyInstance;
  prisma: PrismaClient;
}

export async function buildTestApp(
  options: {
    env?: Partial<AppEnv>;
    fetchImpl?: typeof fetch;
    activityProvider?: SolanaActivityProvider;
    marketProvider?: MarketDataProvider;
    historicalProvider?: HistoricalMarketProvider;
  } = {},
): Promise<TestApp> {
  const env = makeTestEnv(options.env);
  const prisma = createPrisma(TEST_DB_URL);
  const rpc = createRpcClient({
    apiKey: env.HELIUS_API_KEY,
    cluster: env.SOLANA_CLUSTER,
    fetchImpl: options.fetchImpl,
  });
  // Defaults: unconfigured providers — tests never touch the network, and the
  // app must boot with no provider configuration at all.
  const activityProvider =
    options.activityProvider ??
    createHeliusProvider({ apiKey: undefined, cluster: env.SOLANA_CLUSTER });
  const marketProvider = options.marketProvider ?? createMarketDataProvider('none');
  const historicalProvider =
    options.historicalProvider ?? createHistoricalMarketProvider('none');
  const app = await buildApp({
    prisma,
    env,
    rpc,
    activityProvider,
    marketProvider,
    historicalProvider,
    syncOptions: { pauseMs: 0 },
  });
  return { app, prisma };
}

export async function resetDb(prisma: PrismaClient) {
  await prisma.walletTimeWindowMetric.deleteMany();
  await prisma.walletCategoryMetric.deleteMany();
  await prisma.walletQualityMetricSet.deleteMany();
  await prisma.walletQualityAnalysisRun.deleteMany();
  await prisma.walletTradeMatch.deleteMany();
  await prisma.walletPosition.deleteMany();
  await prisma.walletBehaviorProfile.deleteMany();
  await prisma.walletPositionReconstructionRun.deleteMany();
  await prisma.walletEntryOutcome.deleteMany();
  await prisma.tokenMarketCandle.deleteMany();
  await prisma.historicalMarketBackfillRun.deleteMany();
  await prisma.tokenMarketSnapshot.deleteMany();
  await prisma.tokenMarketRefreshRun.deleteMany();
  await prisma.walletEvent.deleteMany();
  await prisma.walletSyncState.deleteMany();
  await prisma.trackedWallet.deleteMany();
  await prisma.token.deleteMany();
}
