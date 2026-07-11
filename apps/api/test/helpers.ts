import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { createPrisma } from '../src/db.js';
import { findRepoRoot, type AppEnv } from '../src/env.js';
import { createHeliusProvider } from '../src/providers/solana/heliusProvider.js';
import type { SolanaActivityProvider } from '../src/providers/solana/provider.js';
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
  } = {},
): Promise<TestApp> {
  const env = makeTestEnv(options.env);
  const prisma = createPrisma(TEST_DB_URL);
  const rpc = createRpcClient({
    apiKey: env.HELIUS_API_KEY,
    cluster: env.SOLANA_CLUSTER,
    fetchImpl: options.fetchImpl,
  });
  // Default: an unconfigured provider — tests never touch the network.
  const activityProvider =
    options.activityProvider ??
    createHeliusProvider({ apiKey: undefined, cluster: env.SOLANA_CLUSTER });
  const app = await buildApp({
    prisma,
    env,
    rpc,
    activityProvider,
    syncOptions: { pauseMs: 0 },
  });
  return { app, prisma };
}

export async function resetDb(prisma: PrismaClient) {
  await prisma.walletEvent.deleteMany();
  await prisma.walletSyncState.deleteMany();
  await prisma.trackedWallet.deleteMany();
  await prisma.token.deleteMany();
}
