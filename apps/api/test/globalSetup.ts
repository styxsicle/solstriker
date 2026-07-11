import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../src/env.js';
import { TEST_DB_URL } from './helpers.js';

export default function setup() {
  const root = findRepoRoot();
  const schema = path.join(root, 'prisma', 'schema.prisma');

  // Start every run from a clean throwaway database file.
  const dbPath = TEST_DB_URL.slice('file:'.length);
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-journal`, { force: true });

  execSync(`npx prisma db push --schema="${schema}" --skip-generate`, {
    cwd: root,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  });
}
