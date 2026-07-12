import { Modal } from './Modal';

interface ConfirmPrepareModalProps {
  walletCount: number;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Shown before any real synchronization request — sync downloads public activity. */
export function ConfirmPrepareModal({ walletCount, busy, onConfirm, onCancel }: ConfirmPrepareModalProps) {
  return (
    <Modal
      title={`Prepare ${walletCount} selected wallet${walletCount === 1 ? '' : 's'}?`}
      onClose={onCancel}
      footer={
        <>
          <button className="btn secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {busy ? 'Preparing…' : 'Confirm and prepare'}
          </button>
        </>
      }
    >
      <p>
        This downloads public activity and prepares research data. It does not place trades,
        connect a wallet, or recommend copying the selected wallets.
      </p>
      <ul>
        <li>Only the wallets you selected are synchronized.</li>
        <li>Wallets are processed one at a time to stay conservative with the data provider.</li>
        <li>Stages that are already current are skipped automatically.</li>
      </ul>
    </Modal>
  );
}
