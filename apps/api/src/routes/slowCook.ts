/**
 * Slow Cook V1 — POST /api/slow-cook/analyze.
 *
 * A read-only, deterministic, wallet-selection-scoped research query. It
 * never synchronizes, reconstructs, runs quality analysis, generates a
 * fingerprint, calls an external provider, or mutates the database — see
 * `services/slowCook/analyze.ts`. There is no "analyze every wallet" mode:
 * every result comes strictly from the explicitly requested wallet IDs.
 */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { analyzeSlowCook, MAX_CANDIDATE_LIMIT, MAX_LOOKBACK_DAYS, MAX_SLOW_COOK_WALLETS } from '../services/slowCook/analyze.js';

const analyzeSchema = z.object({
  walletIds: z.array(z.string().min(1)).min(1).max(MAX_SLOW_COOK_WALLETS),
  lookbackDays: z.coerce.number().int().min(1).max(MAX_LOOKBACK_DAYS).optional(),
  minimumWallets: z.coerce.number().int().min(1).max(MAX_SLOW_COOK_WALLETS).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_CANDIDATE_LIMIT).optional(),
  includeLowerConfidence: z.boolean().optional(),
});

export function registerSlowCookRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post('/api/slow-cook/analyze', async (request, reply) => {
    const body = analyzeSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const { walletIds } = body.data;
    if (new Set(walletIds).size !== walletIds.length) {
      return reply.code(400).send({ error: 'duplicate_selection' });
    }

    const wallets = await prisma.trackedWallet.findMany({ where: { id: { in: walletIds } } });
    if (wallets.length !== walletIds.length) return reply.code(400).send({ error: 'unknown_wallet' });
    if (wallets.some((wallet) => wallet.source === 'dev-seed')) {
      return reply.code(400).send({ error: 'dev_wallet_excluded' });
    }

    try {
      return await analyzeSlowCook(prisma, body.data);
    } catch {
      // Sanitized: an internal failure never returns paths, keys or driver text.
      return reply.code(500).send({ error: 'slow_cook_analysis_failed' });
    }
  });
}
