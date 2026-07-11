import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  DEFAULT_TX_PER_SYNC,
  MAX_TX_PER_SYNC,
  MAX_WALLETS_PER_SYNC,
  WALLET_EVENT_TYPES,
} from '@memecoin-lab/shared';
import type { SolanaActivityProvider } from '../providers/solana/provider.js';
import { syncWallet, type SyncWalletOptions } from '../services/activity/syncWallet.js';

const syncBodySchema = z.object({
  walletIds: z.array(z.string().min(1)).min(1).max(MAX_WALLETS_PER_SYNC),
  maxTransactions: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_TX_PER_SYNC)
    .default(DEFAULT_TX_PER_SYNC),
});

const eventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  walletId: z.string().optional(),
  tokenId: z.string().optional(),
  eventType: z.enum(WALLET_EVENT_TYPES).optional(),
});

export interface ActivityRouteDeps {
  prisma: PrismaClient;
  provider: SolanaActivityProvider;
  /** Overrides for tests (e.g. pauseMs: 0). */
  syncOptions?: Partial<SyncWalletOptions>;
}

export function registerActivityRoutes(app: FastifyInstance, deps: ActivityRouteDeps) {
  const { prisma, provider } = deps;

  async function runSyncRequest(
    rawBody: unknown,
    reply: import('fastify').FastifyReply,
    resetBeforeSync: boolean,
  ) {
    const body = syncBodySchema.safeParse(rawBody);
    if (!body.success) {
      return reply.code(400).send({ error: 'validation_error', issues: body.error.issues });
    }
    if (!provider.isConfigured()) {
      return reply.code(503).send({ error: 'provider_not_configured' });
    }

    const walletIds = [...new Set(body.data.walletIds)];
    const wallets = await prisma.trackedWallet.findMany({ where: { id: { in: walletIds } } });
    if (wallets.length !== walletIds.length) {
      const found = new Set(wallets.map((w) => w.id));
      return reply.code(400).send({
        error: 'unknown_wallet',
        walletIds: walletIds.filter((id) => !found.has(id)),
      });
    }
    const disabled = wallets.filter((w) => !w.enabled);
    if (disabled.length > 0) {
      return reply.code(400).send({
        error: 'wallet_disabled',
        walletIds: disabled.map((w) => w.id),
      });
    }

    // Deliberately sequential: conservative load on the provider.
    const results = [];
    for (const wallet of wallets) {
      results.push(
        await syncWallet(
          { prisma, provider },
          { id: wallet.id, address: wallet.address },
          { maxTransactions: body.data.maxTransactions, resetBeforeSync, ...deps.syncOptions },
        ),
      );
    }
    return { results };
  }

  app.post('/api/activity/sync', async (request, reply) =>
    runSyncRequest(request.body, reply, false),
  );

  // Wallet-scoped re-sync: clears the selected wallets' stored events and
  // cursors (under the sync lock), then re-fetches so history is re-decoded
  // with the current decoder. Raw provider payloads are not stored in the
  // database, so re-decoding without re-fetching is impossible by design.
  app.post('/api/activity/resync', async (request, reply) =>
    runSyncRequest(request.body, reply, true),
  );

  app.get('/api/activity/status', async () => {
    const states = await prisma.walletSyncState.findMany({
      include: {
        wallet: { select: { id: true, address: true, label: true, emoji: true, enabled: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      providerConfigured: provider.isConfigured(),
      maxWalletsPerSync: MAX_WALLETS_PER_SYNC,
      items: states.map((s) => ({
        walletId: s.walletId,
        address: s.wallet.address,
        label: s.wallet.label,
        emoji: s.wallet.emoji,
        enabled: s.wallet.enabled,
        status: s.status,
        backfillComplete: s.backfillComplete,
        totalTransactions: s.totalTransactions,
        totalEvents: s.totalEvents,
        lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
        lastError: s.lastError,
      })),
    };
  });

  app.get('/api/activity/events', async (request, reply) => {
    const query = eventsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'validation_error', issues: query.error.issues });
    }
    const { page, pageSize, walletId, tokenId, eventType } = query.data;
    const where = {
      ...(walletId ? { walletId } : {}),
      ...(tokenId ? { tokenId } : {}),
      ...(eventType ? { eventType } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.walletEvent.findMany({
        where,
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          wallet: { select: { address: true, label: true, emoji: true } },
          token: { select: { mintAddress: true, name: true, symbol: true } },
        },
      }),
      prisma.walletEvent.count({ where }),
    ]);

    return {
      items: items.map((e) => ({
        id: e.id,
        walletId: e.walletId,
        wallet: {
          address: e.wallet.address,
          label: e.wallet.label,
          emoji: e.wallet.emoji,
        },
        tokenId: e.tokenId,
        token: e.token
          ? { mintAddress: e.token.mintAddress, name: e.token.name, symbol: e.token.symbol }
          : null,
        signature: e.signature,
        eventType: e.eventType,
        tokenAmount: e.tokenAmount,
        quoteMint: e.quoteMint,
        quoteAmount: e.quoteAmount,
        source: e.source,
        venue: e.venue,
        confidence: e.confidence,
        explanation: e.explanation,
        swapInMint: e.swapInMint,
        swapInAmount: e.swapInAmount,
        swapOutMint: e.swapOutMint,
        swapOutAmount: e.swapOutAmount,
        walletSolChange: e.walletSolChange,
        networkFeeSol: e.networkFeeSol,
        priorityFeeSol: e.priorityFeeSol,
        platformFeeSol: e.platformFeeSol,
        tipSol: e.tipSol,
        rentSol: e.rentSol,
        unrelatedSolIn: e.unrelatedSolIn,
        unrelatedSolOut: e.unrelatedSolOut,
        unattributedSol: e.unattributedSol,
        decoderVersion: e.decoderVersion,
        blockTime: e.blockTime?.toISOString() ?? null,
      })),
      page,
      pageSize,
      total,
    };
  });
}
