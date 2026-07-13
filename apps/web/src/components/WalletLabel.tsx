import { shortAddr } from '../lib/format';

/**
 * Consistent "label + shortened address" rendering used by every wallet
 * picker. Always shows both, so wallets that share the exact same label
 * (for example several wallets labeled `bn`) remain visually distinguishable
 * by address. Never implies a relationship between similarly labeled wallets.
 */
export function WalletLabel({
  wallet,
}: {
  wallet: { label: string | null; address: string; emoji?: string | null };
}) {
  return (
    <>
      {wallet.emoji ? `${wallet.emoji} ` : ''}
      {wallet.label ?? shortAddr(wallet.address)} <span className="mono">{shortAddr(wallet.address)}</span>
    </>
  );
}
