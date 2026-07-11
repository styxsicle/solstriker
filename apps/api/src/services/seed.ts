import type { PrismaClient } from '@prisma/client';
import { syntheticAddress, TOKEN_STAGES } from '@memecoin-lab/shared';

export const DEV_SEED_SOURCE = 'dev-seed';
export const DEV_SEED_NOTE = 'Development seed data — not a real record.';

/**
 * Idempotent development seed. All records are synthetic and clearly marked:
 * source = "dev-seed", labels/names prefixed with "[DEV]".
 * Addresses/mints are deterministic base58 encodings of fixed bytes —
 * they are NOT real wallets or tokens.
 */
export async function runDevSeed(prisma: PrismaClient) {
  const wallets = Array.from({ length: 8 }, (_, i) => {
    const group = i % 2 === 0 ? 'dev-alpha' : 'dev-beta';
    return {
      address: syntheticAddress(200 + i),
      label: `[DEV] Seed wallet ${i + 1}`,
      group,
      groupsJson: JSON.stringify(i === 0 ? [group, 'dev-vip'] : [group]),
      emoji: i % 2 === 0 ? '🧪' : '🛠️',
      notes: DEV_SEED_NOTE,
      metaJson: null,
      source: DEV_SEED_SOURCE,
      enabled: i !== 7, // one disabled wallet to exercise the UI
    };
  });

  for (const wallet of wallets) {
    await prisma.trackedWallet.upsert({
      where: { address: wallet.address },
      create: wallet,
      update: {},
    });
  }

  const tokens = Array.from({ length: 6 }, (_, i) => ({
    mintAddress: syntheticAddress(150 + i),
    name: `[DEV] Sample token ${i + 1}`,
    symbol: `DEV${i + 1}`,
    stage: TOKEN_STAGES[i % TOKEN_STAGES.length],
    source: DEV_SEED_SOURCE,
  }));

  for (const token of tokens) {
    await prisma.token.upsert({
      where: { mintAddress: token.mintAddress },
      create: token,
      update: {},
    });
  }

  return {
    seededWallets: wallets.length,
    seededTokens: tokens.length,
    note: DEV_SEED_NOTE,
  };
}
