/**
 * Read-only terminal report: `npm run audit:bn-wallets` (from the repo root).
 *
 * Finds every non-development tracked wallet labeled exactly `bn`, reports
 * its stored research readiness, and prints a plain comparison table. It
 * NEVER:
 *   - synchronizes, reconstructs, analyzes, or generates a fingerprint,
 *   - mutates any tracked-wallet record (label, group, enabled state, notes),
 *   - assigns a "BN Main" alias or infers which candidate is BN Main,
 *   - claims common ownership or coordinated activity between wallets.
 *
 * Every row's "Main-wallet confirmation" column is always the same fixed
 * text: the exact address must still be confirmed by the user.
 *
 * Prints to stdout only. Pass `--out <path>` to additionally write the same
 * report as JSON to a local, gitignored path (defaults to
 * `<repo>/local-reports/bn-wallet-audit.json`, already covered by the
 * `private/` and generated-file rules in .gitignore — verify before reuse).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, findRepoRoot } from '../env.js';
import { createPrisma } from '../db.js';
import { findBnLabeledWallets, narrativeFor, toComparisonRow } from '../services/walletResearch/bnAudit.js';
import { buildWalletReadinessReports } from '../services/walletResearch/readinessReport.js';

function parseOutPath(argv: string[]): string | null {
  const flagIndex = argv.indexOf('--out');
  if (flagIndex === -1) return null;
  return argv[flagIndex + 1] ?? path.join(findRepoRoot(), 'local-reports', 'bn-wallet-audit.json');
}

async function main() {
  const env = loadEnv();
  const prisma = createPrisma(env.DATABASE_URL);

  try {
    const groups = await findBnLabeledWallets(prisma);
    const exactReports = await buildWalletReadinessReports(
      prisma,
      groups.exactBn.map((w) => w.id),
    );

    console.log('=== BN Main identification audit (read-only) ===\n');
    console.log(`Exact label "bn" (case-sensitive, non-development): ${groups.exactBn.length}`);
    console.log(`Case-insensitive-only "bn" variants (e.g. "BN", "Bn"): ${groups.caseInsensitiveExact.length}`);
    console.log(`Other labels containing "bn" (e.g. "bn trezor", "cabal bn"): ${groups.containsBn.length}\n`);

    if (groups.caseInsensitiveExact.length) {
      console.log('Case-insensitive-only variants:');
      for (const w of groups.caseInsensitiveExact) console.log(`  ${w.label}  ${w.address}`);
      console.log('');
    }
    if (groups.containsBn.length) {
      console.log('Other "bn"-containing labels (kept separate from the exact-"bn" candidate group):');
      for (const w of groups.containsBn) console.log(`  ${w.label}  ${w.address}`);
      console.log('');
    }

    console.log('--- Exact-"bn" candidate comparison (never ranked; never a BN Main inference) ---\n');
    const rows = exactReports.map(toComparisonRow);
    for (const row of rows) {
      console.log(
        [
          row.label.padEnd(4),
          row.address,
          row.historyState.padEnd(9),
          String(row.storedEventCount).padStart(6) + ' events',
          row.reconstructionState.padEnd(8),
          `eligible=${row.eligibleResultCount ?? 'none'}`,
          `strategySample=${row.strategySampleCount ?? 'none'}`,
          row.mainWalletConfirmation,
        ].join('  |  '),
      );
    }

    console.log('\n--- Per-candidate detail ---\n');
    for (const report of exactReports) {
      const { known, missing, next } = narrativeFor(report);
      console.log(`## ${report.address}`);
      console.log('What is known:');
      for (const line of known) console.log(`  - ${line}`);
      console.log('What is missing:');
      if (missing.length) for (const line of missing) console.log(`  - ${line}`);
      else console.log('  - Nothing outstanding by the checks this audit runs.');
      console.log('What should happen next:');
      for (const line of next) console.log(`  - ${line}`);
      console.log('');
    }

    console.log('Confirmation request: Which exact address should be treated as BN Main?\n');

    const outPath = parseOutPath(process.argv.slice(2));
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        JSON.stringify({ groups: { ...groups }, reports: exactReports }, null, 2),
      );
      console.log(`Full JSON report written to ${outPath} (local only — never commit this file).`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
