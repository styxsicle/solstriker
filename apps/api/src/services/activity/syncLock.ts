/**
 * In-process per-wallet sync locks. Prevents two concurrent syncs of the same
 * wallet inside this API process (the only writer in this local, single-user
 * app). Not a distributed lock — revisit if the API is ever scaled out.
 */

const locked = new Set<string>();

export function tryAcquireSyncLock(walletId: string): boolean {
  if (locked.has(walletId)) return false;
  locked.add(walletId);
  return true;
}

export function releaseSyncLock(walletId: string): void {
  locked.delete(walletId);
}

export function isSyncLocked(walletId: string): boolean {
  return locked.has(walletId);
}
