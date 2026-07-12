import { Modal } from './Modal';

interface ConfirmResyncModalProps {
  walletName: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmResyncModal({
  walletName,
  busy,
  onConfirm,
  onCancel,
}: ConfirmResyncModalProps) {
  return (
    <Modal
      title={`Re-sync ${walletName}?`}
      onClose={onCancel}
      footer={
        <>
          <button className="btn secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Re-syncing…' : 'Delete and re-download'}
          </button>
        </>
      }
    >
      <p>
        Re-syncing deletes and re-downloads <strong>only this wallet's</strong> stored activity
        events and synchronization state, so its history can be decoded again with the latest
        decoder.
      </p>
      <ul>
        <li>The tracked-wallet record itself (label, groups, notes) is not deleted.</li>
        <li>No other wallet is affected.</li>
        <li>Re-downloading uses your configured data provider and can take a moment.</li>
      </ul>
    </Modal>
  );
}
