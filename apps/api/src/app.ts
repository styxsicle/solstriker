import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import type { AppEnv } from './env.js';
import type { RpcClient } from './rpc.js';
import { registerWalletRoutes } from './routes/wallets.js';
import { registerTokenRoutes } from './routes/tokens.js';
import { runDevSeed } from './services/seed.js';

export interface AppDeps {
  prisma: PrismaClient;
  env: AppEnv;
  rpc: RpcClient;
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
