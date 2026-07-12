import type { FastifyInstance } from 'fastify';
import type { PrismaClient, TrackedWallet } from '@prisma/client';
import { z } from 'zod';
import { isValidSolanaAddress, parseWalletImport } from '@memecoin-lab/shared';
import { importWallets } from '../services/walletImport.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().optional(),
  group: z.string().trim().optional(),
  enabled: z.enum(['true', 'false']).optional(),
  // 'false' hides synthetic dev-seed records; absent keeps prior behavior.
  includeDev: z.enum(['true', 'false']).optional(),
});

const createBodySchema = z.object({
  address: z.string().trim(),
  label: z.string().trim().max(200).optional(),
  group: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
  emoji: z.string().trim().max(16).optional(),
});

const patchBodySchema = z
  .object({
    label: z.string().trim().max(200).nullable().optional(),
    group: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    emoji: z.string().trim().max(16).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' });

const importBodySchema = z.object({
  content: z.string().min(1),
  format: z.enum(['auto', 'csv', 'text', 'json']).default('auto'),
  filename: z.string().max(300).optional(),
});

function serializeWallet(wallet: TrackedWallet) {
  let groups: string[] = [];
  if (wallet.groupsJson) {
    try {
      const parsed = JSON.parse(wallet.groupsJson);
      if (Array.isArray(parsed)) groups = parsed.filter((g): g is string => typeof g === 'string');
    } catch {
      groups = [];
    }
  }
  if (groups.length === 0 && wallet.group) groups = [wallet.group];
  return {
    id: wallet.id,
    address: wallet.address,
    label: wallet.label,
    group: wallet.group,
    groups,
    emoji: wallet.emoji,
    notes: wallet.notes,
    enabled: wallet.enabled,
    source: wallet.source,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

export function registerWalletRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/api/wallets', async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'validation_error', issues: query.error.issues });
    }
    const { page, pageSize, search, group, enabled, includeDev } = query.data;

    const where = {
      ...(enabled !== undefined ? { enabled: enabled === 'true' } : {}),
      ...(includeDev === 'false' ? { source: { not: 'dev-seed' } } : {}),
      ...(group
        ? { OR: [{ group }, { groupsJson: { contains: `"${group}"` } }] }
        : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { address: { contains: search } },
                  { label: { contains: search } },
                  { notes: { contains: search } },
                ],
              },
            ],
          }
        : {}),
    };

    const [items, total, totalAll, enabledAll, groupRows] = await Promise.all([
      prisma.trackedWallet.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.trackedWallet.count({ where }),
      prisma.trackedWallet.count(),
      prisma.trackedWallet.count({ where: { enabled: true } }),
      prisma.trackedWallet.findMany({ select: { group: true, groupsJson: true } }),
    ]);

    const groupSet = new Set<string>();
    for (const row of groupRows) {
      if (row.group) groupSet.add(row.group);
      if (row.groupsJson) {
        try {
          const parsed = JSON.parse(row.groupsJson);
          if (Array.isArray(parsed)) {
            for (const g of parsed) if (typeof g === 'string' && g !== '') groupSet.add(g);
          }
        } catch {
          // ignore malformed stored JSON
        }
      }
    }

    return {
      items: items.map(serializeWallet),
      page,
      pageSize,
      total,
      stats: { total: totalAll, enabled: enabledAll },
      groups: [...groupSet].sort((a, b) => a.localeCompare(b)),
    };
  });

  app.post('/api/wallets', async (request, reply) => {
    const body = createBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'validation_error', issues: body.error.issues });
    }
    const { address, label, group, notes, emoji } = body.data;
    if (!isValidSolanaAddress(address)) {
      return reply.code(400).send({ error: 'invalid_address' });
    }
    const existing = await prisma.trackedWallet.findUnique({ where: { address } });
    if (existing) {
      return reply.code(409).send({ error: 'duplicate_address' });
    }
    const wallet = await prisma.trackedWallet.create({
      data: {
        address,
        label: label || null,
        group: group || null,
        groupsJson: group ? JSON.stringify([group]) : null,
        notes: notes || null,
        emoji: emoji || null,
        source: 'manual',
      },
    });
    return reply.code(201).send(serializeWallet(wallet));
  });

  app.post('/api/wallets/import', async (request, reply) => {
    const body = importBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'validation_error', issues: body.error.issues });
    }
    const parsed = parseWalletImport(body.data.content, {
      format: body.data.format,
      filename: body.data.filename,
    });
    const summary = await importWallets(prisma, parsed, `import:${parsed.format}`);
    return summary;
  });

  app.patch('/api/wallets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = patchBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'validation_error', issues: body.error.issues });
    }
    const existing = await prisma.trackedWallet.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const { label, group, notes, emoji, enabled } = body.data;
    const wallet = await prisma.trackedWallet.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label } : {}),
        ...(group !== undefined
          ? { group, groupsJson: group ? JSON.stringify([group]) : null }
          : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(emoji !== undefined ? { emoji } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });
    return serializeWallet(wallet);
  });
}
