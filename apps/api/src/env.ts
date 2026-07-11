import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Walk upward from this module until we find the repo root (prisma/schema.prisma). */
export function findRepoRoot(startDir?: string): string {
  let dir = startDir ?? path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'prisma', 'schema.prisma'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  HELIUS_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined)),
  SOLANA_CLUSTER: z.enum(['mainnet-beta', 'devnet']).default('mainnet-beta'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  API_PORT: z.coerce.number().int().min(0).default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Loads .env from the repo root, then validates process.env. */
export function loadEnv(): AppEnv {
  const root = findRepoRoot();
  dotenv.config({ path: path.join(root, '.env') });
  return envSchema.parse(process.env);
}
