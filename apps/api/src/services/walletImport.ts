import type { PrismaClient } from '@prisma/client';
import type { InvalidRow, ParsedWalletEntry, ParseResult } from '@memecoin-lab/shared';

export interface ImportSummary {
  format: string;
  totalRows: number;
  imported: number;
  duplicates: number;
  invalid: number;
  skipped: number;
  invalidSamples: InvalidRow[];
}

function toCreateData(entry: ParsedWalletEntry, source: string) {
  const groups = entry.groups?.map((g) => g.trim()).filter((g) => g !== '') ?? [];
  return {
    address: entry.address,
    label: entry.label ?? null,
    group: groups[0] ?? null,
    groupsJson: groups.length > 0 ? JSON.stringify(groups) : null,
    emoji: entry.emoji ?? null,
    notes: entry.notes ?? null,
    metaJson:
      entry.meta && Object.keys(entry.meta).length > 0 ? JSON.stringify(entry.meta) : null,
    source,
    enabled: true,
  };
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/**
 * Persists a parsed import. Duplicates (repeated in the file or already in
 * the database) are counted but never re-created, so re-importing the same
 * file is idempotent.
 */
export async function importWallets(
  prisma: PrismaClient,
  parsed: ParseResult,
  source: string,
): Promise<ImportSummary> {
  const seen = new Set<string>();
  const unique: ParsedWalletEntry[] = [];
  let inFileDuplicates = 0;
  for (const entry of parsed.entries) {
    if (seen.has(entry.address)) {
      inFileDuplicates += 1;
      continue;
    }
    seen.add(entry.address);
    unique.push(entry);
  }

  const existing = new Set<string>();
  for (const chunk of chunks([...seen], 500)) {
    const rows = await prisma.trackedWallet.findMany({
      where: { address: { in: chunk } },
      select: { address: true },
    });
    for (const row of rows) existing.add(row.address);
  }

  const toCreate = unique.filter((entry) => !existing.has(entry.address));
  for (const chunk of chunks(toCreate, 200)) {
    await prisma.trackedWallet.createMany({
      data: chunk.map((entry) => toCreateData(entry, source)),
    });
  }

  return {
    format: parsed.format,
    totalRows: parsed.entries.length + parsed.invalid.length + parsed.skipped,
    imported: toCreate.length,
    duplicates: inFileDuplicates + (unique.length - toCreate.length),
    invalid: parsed.invalid.length,
    skipped: parsed.skipped,
    invalidSamples: parsed.invalid.slice(0, 20),
  };
}
