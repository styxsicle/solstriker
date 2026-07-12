/**
 * One-click Focus Wallet Preparation.
 *
 * A user-triggered orchestration endpoint only — it never runs on a schedule,
 * never processes wallets the caller did not explicitly select, and never
 * touches more than five wallets in one request.
 */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { MAX_TX_PER_SYNC } from '@memecoin-lab/shared';
import type { SolanaActivityProvider } from '../providers/solana/provider.js';
import type { SyncWalletOptions } from '../services/activity/syncWallet.js';
import {
  DEFAULT_SYNC_TRANSACTION_LIMIT,
  MAX_FOCUS_PREPARE_WALLETS,
  prepareFocusWallets,
} from '../services/focusWallets/prepareWallets.js';
import { releasePrepareLock, tryAcquirePrepareLock } from '../services/focusWallets/prepareLock.js';

const bodySchema = z.object({
  walletIds: z.array(z.string().min(1)).min(1).max(MAX_FOCUS_PREPARE_WALLETS),
  syncTransactionLimit: z.coerce.number().int().min(1).max(MAX_TX_PER_SYNC).default(DEFAULT_SYNC_TRANSACTION_LIMIT),
  continueHistoricalSync: z.boolean().default(false),
  forceRefresh: z.boolean().default(false),
});

export interface FocusWalletRouteDeps {
  prisma: PrismaClient;
  provider: SolanaActivityProvider;
  /** Overrides for tests (e.g. pauseMs: 0). */
  syncOptions?: Partial<SyncWalletOptions>;
}

export function registerFocusWalletRoutes(app: FastifyInstance, deps: FocusWalletRouteDeps) {
  const { prisma, provider } = deps;

  app.post('/api/focus-wallets/prepare', async (request, reply) => {
    const body = bodySchema.safeParse(request.body);
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

    // Selection order is preserved through the whole sequential pipeline.
    const ordered = walletIds.flatMap((id) => wallets.filter((wallet) => wallet.id === id));

    const acquired: string[] = [];
    for (const wallet of ordered) {
      if (!tryAcquirePrepareLock(wallet.id)) {
        for (const id of acquired) releasePrepareLock(id);
        return reply.code(409).send({ error: 'wallet_prepare_in_progress', walletIds: [wallet.id] });
      }
      acquired.push(wallet.id);
    }

    try {
      return await prepareFocusWallets(
        { prisma, provider, syncOptions: deps.syncOptions },
        ordered,
        {
          syncTransactionLimit: body.data.syncTransactionLimit,
          continueHistoricalSync: body.data.continueHistoricalSync,
          forceRefresh: body.data.forceRefresh,
        },
      );
    } catch {
      return reply.code(500).send({ error: 'focus_wallet_preparation_failed' });
    } finally {
      for (const id of acquired) releasePrepareLock(id);
    }
  });
}
