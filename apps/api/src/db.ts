import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { findRepoRoot } from './env.js';

/**
 * Prisma CLI resolves relative `file:` URLs against the prisma/ directory,
 * but the runtime resolves them against the process CWD. Normalize to an
 * absolute path anchored at <repo>/prisma so both agree.
 */
export function resolveDatabaseUrl(raw: string, repoRoot = findRepoRoot()): string {
  if (!raw.startsWith('file:')) return raw;
  const filePath = raw.slice('file:'.length);
  if (path.isAbsolute(filePath)) return raw;
  return `file:${path.resolve(repoRoot, 'prisma', filePath)}`;
}

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: resolveDatabaseUrl(databaseUrl) });
}
