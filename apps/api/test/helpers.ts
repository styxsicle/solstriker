import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { createPrisma } from '../src/db.js';
import { findRepoRoot, type AppEnv } from '../src/env.js';
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
  options: { env?: Partial<AppEnv>; fetchImpl?: typeof fetch } = {},
): Promise<TestApp> {
  const env = makeTestEnv(options.env);
  const prisma = createPrisma(TEST_DB_URL);
  const rpc = createRpcClient({
    apiKey: env.HELIUS_API_KEY,
    cluster: env.SOLANA_CLUSTER,
    fetchImpl: options.fetchImpl,
  });
  const app = await buildApp({ prisma, env, rpc });
  return { app, prisma };
}

export async function resetDb(prisma: PrismaClient) {
  await prisma.trackedWallet.deleteMany();
  await prisma.token.deleteMany();
}
