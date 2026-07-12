/**
 * Phase 2C-A — focus cohort CRUD.
 *
 * A focus cohort is a USER-SELECTED research grouping of public wallets. It is
 * never evidence of common ownership, coordination or any relationship: similar
 * labels, shared funding, shared tokens and similar timing are all explicitly
 * insufficient, and every cohort response carries OWNERSHIP_NOT_ESTABLISHED to
 * say so. Creating a cohort never synchronizes, reconstructs or analyzes a
 * wallet, and deleting one never deletes wallets or any research data.
 */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { latestCompletedRunByWallet } from '../services/walletPositions/latestRuns.js';
import { latestQualityMetricSetByWallet } from '../services/walletQuality/latestRuns.js';
import { latestFingerprintByWallet } from '../services/walletStrategies/latestRuns.js';
import { STRATEGY_WARNINGS as W } from '../services/walletStrategies/warnings.js';

export const MAX_COHORT_MEMBERS = 10;
export const MAX_COMPARISON_MEMBERS = MAX_COHORT_MEMBERS - 1;

const memberSchema = z.object({
  trackedWalletId: z.string().min(1),
  role: z.enum(['PRIMARY', 'COMPARISON']),
  displayOrder: z.number().int().min(0).max(100).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  members: z.array(memberSchema).min(1).max(MAX_COHORT_MEMBERS),
});
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    members: z.array(memberSchema).min(1).max(MAX_COHORT_MEMBERS).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' });
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

type Member = z.infer<typeof memberSchema>;

/** Membership rules. Ownership is never inferred, only the structure is validated. */
function memberError(members: Member[]): string | null {
  if (members.length > MAX_COHORT_MEMBERS) return 'too_many_members';
  const ids = members.map((m) => m.trackedWalletId);
  if (new Set(ids).size !== ids.length) return 'duplicate_member';
  const primaries = members.filter((m) => m.role === 'PRIMARY');
  if (primaries.length !== 1) return 'exactly_one_primary_required';
  if (members.length - primaries.length > MAX_COMPARISON_MEMBERS) return 'too_many_members';
  return null;
}

async function walletError(prisma: PrismaClient, members: Member[]): Promise<string | null> {
  const ids = members.map((m) => m.trackedWalletId);
  const wallets = await prisma.trackedWallet.findMany({ where: { id: { in: ids } } });
  if (wallets.length !== ids.length) return 'unknown_wallet';
  if (wallets.some((wallet) => wallet.source === 'dev-seed')) return 'dev_wallet_excluded';
  return null;
}

/**
 * Shared-label warning. Two wallets whose labels start with the same word are
 * flagged ONLY to state that the similarity proves nothing.
 */
function labelWarnings(labels: (string | null)[]): string[] {
  const prefixes = labels
    .flatMap((label) => (label ? [label.trim().toLowerCase().split(/\s+/)[0]] : []))
    .filter((prefix) => prefix.length > 0);
  const counts = new Map<string, number>();
  for (const prefix of prefixes) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  const shared = [...counts.values()].some((count) => count > 1);
  return shared ? [W.OWNERSHIP_NOT_ESTABLISHED, W.POSSIBLE_SHARED_LABEL_ONLY] : [W.OWNERSHIP_NOT_ESTABLISHED];
}

/** PRIMARY always first, then the user's own comparison order — never a ranking. */
const orderMembers = <T extends { role: string; displayOrder: number; id: string }>(members: T[]) =>
  [...members].sort(
    (a, b) =>
      (a.role === 'PRIMARY' ? 0 : 1) - (b.role === 'PRIMARY' ? 0 : 1) ||
      a.displayOrder - b.displayOrder ||
      a.id.localeCompare(b.id),
  );

export function registerFocusCohortRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const serialize = async (cohortId: string, withReadiness: boolean) => {
    const cohort = await prisma.focusTraderCohort.findUnique({
      where: { id: cohortId },
      include: {
        members: {
          include: {
            trackedWallet: { select: { id: true, address: true, label: true, emoji: true, source: true } },
          },
        },
      },
    });
    if (!cohort) return null;
    const members = orderMembers(cohort.members);

    let readiness: Record<string, unknown> = {};
    if (withReadiness) {
      const walletIds = members.map((m) => m.trackedWalletId);
      const [syncStates, reconstructions, quality, fingerprints] = await Promise.all([
        prisma.walletSyncState.findMany({ where: { walletId: { in: walletIds } } }),
        latestCompletedRunByWallet(prisma),
        latestQualityMetricSetByWallet(prisma),
        latestFingerprintByWallet(prisma),
      ]);
      const fingerprintRows = await prisma.walletStrategyFingerprint.findMany({
        where: { id: { in: [...fingerprints.values()] } },
        select: { id: true, trackedWalletId: true, status: true, confidence: true, eligibleCycleCount: true },
      });
      const fingerprintByWallet = new Map(fingerprintRows.map((f) => [f.trackedWalletId, f]));
      const eventCounts = await prisma.walletEvent.groupBy({
        by: ['walletId'],
        where: { walletId: { in: walletIds } },
        _count: { _all: true },
      });
      const eventsByWallet = new Map(eventCounts.map((row) => [row.walletId, row._count._all]));
      const syncByWallet = new Map(syncStates.map((state) => [state.walletId, state]));

      readiness = Object.fromEntries(
        members.map((member) => {
          const walletId = member.trackedWalletId;
          const sync = syncByWallet.get(walletId);
          const reconstructionRunId = reconstructions.get(walletId) ?? null;
          const fingerprint = fingerprintByWallet.get(walletId) ?? null;
          const missing: string[] = [];
          if (!sync) missing.push('NOT_SYNCHRONIZED');
          else if (!sync.backfillComplete) missing.push('PARTIAL_HISTORY');
          if (!reconstructionRunId) missing.push('NO_COMPLETED_RECONSTRUCTION');
          if (!quality.has(walletId)) missing.push('NO_QUALITY_ANALYSIS');
          if (!fingerprint) missing.push('NO_STRATEGY_FINGERPRINT');
          return [
            walletId,
            {
              synchronized: Boolean(sync),
              backfillComplete: sync?.backfillComplete ?? false,
              syncStatus: sync?.status ?? 'never synchronized',
              storedEventCount: eventsByWallet.get(walletId) ?? 0,
              reconstructionRunId,
              reconstructionStatus: reconstructionRunId ? 'COMPLETED' : 'NONE',
              qualityMetricSetId: quality.get(walletId) ?? null,
              qualityStatus: quality.has(walletId) ? 'COMPLETED' : 'NONE',
              fingerprintId: fingerprint?.id ?? null,
              fingerprintStatus: fingerprint?.status ?? 'NONE',
              fingerprintConfidence: fingerprint?.confidence ?? null,
              eligibleCycleCount: fingerprint?.eligibleCycleCount ?? null,
              missingPrerequisites: missing,
              /** Prerequisites are never satisfied automatically — the user must act explicitly. */
              canAnalyze: Boolean(reconstructionRunId),
            },
          ];
        }),
      );
    }

    return {
      id: cohort.id,
      name: cohort.name,
      description: cohort.description,
      createdAt: cohort.createdAt.toISOString(),
      updatedAt: cohort.updatedAt.toISOString(),
      memberCount: members.length,
      members: members.map((member) => ({
        id: member.id,
        cohortId: member.cohortId,
        trackedWalletId: member.trackedWalletId,
        role: member.role,
        displayOrder: member.displayOrder,
        notes: member.notes,
        wallet: member.trackedWallet,
        createdAt: member.createdAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
      })),
      warningCodes: labelWarnings(members.map((m) => m.trackedWallet.label)),
      ...(withReadiness ? { readiness } : {}),
    };
  };

  app.post('/api/focus-cohorts', async (request, reply) => {
    const body = createSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const structural = memberError(body.data.members);
    if (structural) return reply.code(400).send({ error: structural });
    const invalid = await walletError(prisma, body.data.members);
    if (invalid) return reply.code(400).send({ error: invalid });
    const duplicate = await prisma.focusTraderCohort.findUnique({ where: { name: body.data.name } });
    if (duplicate) return reply.code(409).send({ error: 'duplicate_cohort_name' });

    const cohort = await prisma.focusTraderCohort.create({
      data: {
        name: body.data.name,
        description: body.data.description ?? null,
        members: {
          create: body.data.members.map((member, index) => ({
            trackedWalletId: member.trackedWalletId,
            role: member.role,
            displayOrder: member.displayOrder ?? index,
            notes: member.notes ?? null,
          })),
        },
      },
    });
    return reply.code(201).send(await serialize(cohort.id, false));
  });

  app.get('/api/focus-cohorts', async (request, reply) => {
    const query = listSchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error' });
    const { page, pageSize } = query.data;
    const [rows, total] = await Promise.all([
      prisma.focusTraderCohort.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // stable; never ordered by any result
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true },
      }),
      prisma.focusTraderCohort.count(),
    ]);
    const items = [];
    for (const row of rows) items.push(await serialize(row.id, false));
    return { items, page, pageSize, total };
  });

  app.get('/api/focus-cohorts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cohort = await serialize(id, true);
    if (!cohort) return reply.code(404).send({ error: 'cohort_not_found' });
    return cohort;
  });

  app.patch('/api/focus-cohorts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = patchSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const existing = await prisma.focusTraderCohort.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'cohort_not_found' });
    if (body.data.members) {
      const structural = memberError(body.data.members);
      if (structural) return reply.code(400).send({ error: structural });
      const invalid = await walletError(prisma, body.data.members);
      if (invalid) return reply.code(400).send({ error: invalid });
    }
    if (body.data.name && body.data.name !== existing.name) {
      const duplicate = await prisma.focusTraderCohort.findUnique({ where: { name: body.data.name } });
      if (duplicate) return reply.code(409).send({ error: 'duplicate_cohort_name' });
    }

    await prisma.focusTraderCohort.update({
      where: { id },
      data: {
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.description !== undefined ? { description: body.data.description } : {}),
        // Membership is replaced wholesale; only cohort membership rows are touched.
        ...(body.data.members
          ? {
              members: {
                deleteMany: {},
                create: body.data.members.map((member, index) => ({
                  trackedWalletId: member.trackedWalletId,
                  role: member.role,
                  displayOrder: member.displayOrder ?? index,
                  notes: member.notes ?? null,
                })),
              },
            }
          : {}),
      },
    });
    return serialize(id, false);
  });

  app.delete('/api/focus-cohorts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.focusTraderCohort.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'cohort_not_found' });
    // Cascades to membership rows only. Tracked wallets, events, positions,
    // quality records and fingerprints are deliberately left untouched.
    await prisma.focusTraderCohort.delete({ where: { id } });
    return { id, deleted: true, walletsDeleted: 0, analysisRecordsDeleted: 0 };
  });
}
