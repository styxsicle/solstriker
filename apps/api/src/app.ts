import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import type { AppEnv } from './env.js';
import type { RpcClient } from './rpc.js';
import type { SolanaActivityProvider } from './providers/solana/provider.js';
import type { MarketDataProvider } from './providers/market/marketDataProvider.js';
import type { HistoricalMarketProvider } from './providers/historicalMarket/historicalMarketProvider.js';
import { registerWalletRoutes } from './routes/wallets.js';
import { registerTokenRoutes } from './routes/tokens.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerOverviewRoute } from './routes/overview.js';
import { registerTokenMetricsRoutes } from './routes/tokenMetrics.js';
import { registerHistoricalMarketRoutes } from './routes/historicalMarket.js';
import { registerWalletOutcomesRoutes } from './routes/walletOutcomes.js';
import { registerWalletPositionRoutes } from './routes/walletPositions.js';
import { registerWalletQualityRoutes } from './routes/walletQuality.js';
import type { SyncWalletOptions } from './services/activity/syncWallet.js';
import { runDevSeed } from './services/seed.js';

export interface AppDeps {
  prisma: PrismaClient;
  env: AppEnv;
  rpc: RpcClient;
  activityProvider: SolanaActivityProvider;
  marketProvider: MarketDataProvider;
  historicalProvider: HistoricalMarketProvider;
  /** Overrides for tests (e.g. pauseMs: 0). */
  syncOptions?: Partial<SyncWalletOptions>;
  logger?: boolean | object;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { prisma, env, rpc } = deps;
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: 20 * 1024 * 1024, // large wallet exports
  });

  await app.register(cors, { origin: env.WEB_ORIGIN });

  app.get('/api/health', async () => {
    let db: 'ok' | 'error' = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    return {
      status: 'ok',
      db,
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/rpc/status', async () => rpc.getStatus());

  registerWalletRoutes(app, prisma);
  registerTokenRoutes(app, prisma);
  registerOverviewRoute(app, prisma);
  registerTokenMetricsRoutes(app, {
    prisma,
    marketProvider: deps.marketProvider,
    nodeEnv: env.NODE_ENV,
  });
  registerHistoricalMarketRoutes(app, {
    prisma,
    historicalProvider: deps.historicalProvider,
    nodeEnv: env.NODE_ENV,
  });
  registerWalletOutcomesRoutes(app, { prisma });
  registerWalletPositionRoutes(app, prisma, env.NODE_ENV);
  registerWalletQualityRoutes(app, prisma);
  registerActivityRoutes(app, {
    prisma,
    provider: deps.activityProvider,
    syncOptions: deps.syncOptions,
  });

  app.post('/api/dev/seed', async (_request, reply) => {
    if (env.NODE_ENV === 'production') {
      return reply.code(403).send({ error: 'disabled_in_production' });
    }
    return runDevSeed(prisma);
  });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}
