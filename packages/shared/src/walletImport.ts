import { isValidSolanaAddress } from './solana.js';

export type ImportFormat = 'csv' | 'text' | 'json';
export type ImportFormatOption = ImportFormat | 'auto';

export interface ParsedWalletEntry {
  address: string;
  label?: string;
  /** Full group list (a wallet may belong to several groups). */
  groups?: string[];
  notes?: string;
  emoji?: string;
  /** Optional imported metadata (alert preferences, sound, ...). */
  meta?: Record<string, unknown>;
}

export interface InvalidRow {
  /** 1-based line (CSV/text) or array index + 1 (JSON). 0 = whole file. */
  line: number;
  value: string;
  reason: string;
}

export interface ParseResult {
  format: ImportFormat;
  entries: ParsedWalletEntry[];
  invalid: InvalidRow[];
  /** Blank/comment lines that were ignored. */
  skipped: number;
}

/** Best-effort format detection from content and (optionally) the file name. */
export function detectFormat(content: string, filename?: string): ImportFormat {
  const name = filename?.toLowerCase() ?? '';
  const trimmed = content.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.csv')) return 'csv';
  const firstLine = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine && firstLine.includes(',')) return 'csv';
  return 'text';
}

export function parseWalletImport(
  content: string,
  options: { format?: ImportFormatOption; filename?: string } = {},
): ParseResult {
  const format =
    !options.format || options.format === 'auto'
      ? detectFormat(content, options.filename)
      : options.format;
  switch (format) {
    case 'json':
      return parseJsonExport(content);
    case 'csv':
      return parseCsv(content);
    case 'text':
      return parseText(content);
  }
}

/** Plain text: one address per line. Blank lines and `#` comments are skipped. */
export function parseText(content: string): ParseResult {
  const entries: ParsedWalletEntry[] = [];
  const invalid: InvalidRow[] = [];
  let skipped = 0;

  const lines = content.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') {
      // Ignore the empty segment produced by a trailing newline.
      if (!(index === lines.length - 1 && raw === '')) skipped += 1;
      return;
    }
    if (line.startsWith('#')) {
      skipped += 1;
      return;
    }
    if (/[\s,]/.test(line)) {
      invalid.push({ line: index + 1, value: truncate(line), reason: 'expected_single_address' });
      return;
    }
    if (!isValidSolanaAddress(line)) {
      invalid.push({ line: index + 1, value: truncate(line), reason: 'invalid_address' });
      return;
    }
    entries.push({ address: line });
  });

  return { format: 'text', entries, invalid, skipped };
}

/**
 * CSV with optional header. Recognized columns: address, label, group, notes.
 * Without a header, columns are positional: address[,label[,group[,notes]]].
 */
export function parseCsv(content: string): ParseResult {
  const entries: ParsedWalletEntry[] = [];
  const invalid: InvalidRow[] = [];
  let skipped = 0;

  const lines = content.split(/\r?\n/);
  let columns: string[] | null = null; // header names, lowercased
  let headerSeen = false;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      if (line === '' && index === lines.length - 1) return; // trailing newline
      skipped += 1;
      return;
    }

    const fields = splitCsvLine(line);

    if (!headerSeen) {
      headerSeen = true;
      const lowered = fields.map((f) => f.toLowerCase());
      if (lowered.includes('address')) {
        columns = lowered;
        return; // header row, not data
      }
      columns = null; // positional mode
    }

    let record: { address?: string; label?: string; group?: string; notes?: string };
    if (columns) {
      record = {};
      columns.forEach((name, i) => {
        const value = fields[i]?.trim();
        if (!value) return;
        if (name === 'address') record.address = value;
        else if (name === 'label') record.label = value;
        else if (name === 'group') record.group = value;
        else if (name === 'notes') record.notes = value;
      });
    } else {
      record = {
        address: fields[0]?.trim() || undefined,
        label: fields[1]?.trim() || undefined,
        group: fields[2]?.trim() || undefined,
        notes: fields[3]?.trim() || undefined,
      };
    }

    if (!record.address) {
      invalid.push({ line: index + 1, value: truncate(line), reason: 'missing_address' });
      return;
    }
    if (!isValidSolanaAddress(record.address)) {
      invalid.push({ line: index + 1, value: truncate(record.address), reason: 'invalid_address' });
      return;
    }

    entries.push({
      address: record.address,
      label: record.label,
      groups: record.group ? [record.group] : undefined,
      notes: record.notes,
    });
  });

  return { format: 'csv', entries, invalid, skipped };
}

/**
 * JSON wallet-tracker export: an array of objects shaped like
 * { trackedWalletAddress, name, emoji, groups: string[],
 *   alertsOnToast, alertsOnBubble, alertsOnFeed, sound }.
 * Also accepts a plain `address` key as a fallback.
 */
export function parseJsonExport(content: string): ParseResult {
  const entries: ParsedWalletEntry[] = [];
  const invalid: InvalidRow[] = [];

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return {
      format: 'json',
      entries,
      invalid: [{ line: 0, value: '(file)', reason: 'invalid_json' }],
      skipped: 0,
    };
  }

  if (!Array.isArray(data)) {
    return {
      format: 'json',
      entries,
      invalid: [{ line: 0, value: '(file)', reason: 'expected_json_array' }],
      skipped: 0,
    };
  }

  data.forEach((item, index) => {
    const line = index + 1;
    if (typeof item !== 'object' || item === null) {
      invalid.push({ line, value: truncate(JSON.stringify(item)), reason: 'expected_object' });
      return;
    }
    const rec = item as Record<string, unknown>;
    const address =
      typeof rec.trackedWalletAddress === 'string'
        ? rec.trackedWalletAddress.trim()
        : typeof rec.address === 'string'
          ? rec.address.trim()
          : undefined;

    if (!address) {
      invalid.push({ line, value: '(no address field)', reason: 'missing_address' });
      return;
    }
    if (!isValidSolanaAddress(address)) {
      invalid.push({ line, value: truncate(address), reason: 'invalid_address' });
      return;
    }

    const label =
      typeof rec.name === 'string' && rec.name.trim() !== ''
        ? rec.name.trim()
        : typeof rec.label === 'string' && rec.label.trim() !== ''
          ? rec.label.trim()
          : undefined;

    const groups = Array.isArray(rec.groups)
      ? rec.groups.filter((g): g is string => typeof g === 'string' && g.trim() !== '')
      : undefined;

    const emoji =
      typeof rec.emoji === 'string' && rec.emoji.trim() !== '' ? rec.emoji : undefined;

    const meta: Record<string, unknown> = {};
    for (const key of ['alertsOnToast', 'alertsOnBubble', 'alertsOnFeed'] as const) {
      if (typeof rec[key] === 'boolean') meta[key] = rec[key];
    }
    if (typeof rec.sound === 'string') meta.sound = rec.sound;

    entries.push({
      address,
      label,
      groups: groups && groups.length > 0 ? groups : undefined,
      emoji,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    });
  });

  return { format: 'json', entries, invalid, skipped: 0 };
}

/** Minimal CSV field splitter with double-quote support. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
