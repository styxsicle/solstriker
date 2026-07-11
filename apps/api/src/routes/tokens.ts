import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export function registerTokenRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/api/tokens', async () => {
    const tokens = await prisma.token.findMany({ orderBy: { discoveredAt: 'desc' } });
    return {
      items: tokens.map((t) => ({
        id: t.id,
        mintAddress: t.mintAddress,
        name: t.name,
        symbol: t.symbol,
        stage: t.stage,
        source: t.source,
        discoveredAt: t.discoveredAt.toISOString(),
        lastSeenAt: t.lastSeenAt.toISOString(),
      })),
      total: tokens.length,
      liveDiscovery: false, // Phase 1A: no real token discovery yet
    };
  });
}
