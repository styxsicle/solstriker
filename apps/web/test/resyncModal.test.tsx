import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmResyncModal } from '../src/components/ConfirmResyncModal';

describe('ConfirmResyncModal', () => {
  it('names the wallet and explains exactly what is affected', () => {
    render(
      <ConfirmResyncModal walletName="mr phoof" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Re-sync mr phoof?');
    expect(screen.getByText(/only this wallet's/i)).toBeTruthy();
    expect(screen.getByText(/is not deleted/i)).toBeTruthy();
    expect(screen.getByText(/No other wallet is affected/i)).toBeTruthy();
  });

  it('requires explicit confirmation before re-syncing', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmResyncModal walletName="mr phoof" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /delete and re-download/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmResyncModal walletName="mr phoof" onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
