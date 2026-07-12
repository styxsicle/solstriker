/**
 * Per-wallet in-process lock for the Focus Wallet Preparation workflow.
 *
 * Distinct from the per-stage locks already owned by syncWallet (per wallet),
 * reconstructWallets, analyzeWallets and analyzeStrategies (each global,
 * single-flight across all wallets). This lock exists so two concurrent
 * `/api/focus-wallets/prepare` requests can never run the full pipeline for
 * the same wallet at the same time.
 */
const locked = new Set<string>();

export function tryAcquirePrepareLock(walletId: string): boolean {
  if (locked.has(walletId)) return false;
  locked.add(walletId);
  return true;
}

export function releasePrepareLock(walletId: string): void {
  locked.delete(walletId);
}

export function isPrepareLocked(walletId: string): boolean {
  return locked.has(walletId);
}
