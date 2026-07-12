import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { FUTURE_FEATURES, Sidebar } from '../src/components/Sidebar';

describe('Sidebar', () => {
  it('labels future features as unavailable instead of making them work', () => {
    const onNavigate = vi.fn();
    render(
      <ModeProvider>
        <Sidebar page="overview" onNavigate={onNavigate} />
      </ModeProvider>,
    );
    for (const name of FUTURE_FEATURES) {
      const button = screen.getByRole('button', { name: new RegExp(name, 'i') });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(button);
    }
    expect(onNavigate).not.toHaveBeenCalled();
    // Every future item carries a visible "not built" label, not just styling.
    expect(screen.getAllByText('not built')).toHaveLength(FUTURE_FEATURES.length);
  });

  it('navigates between real pages and marks the current one', () => {
    const onNavigate = vi.fn();
    render(
      <ModeProvider>
        <Sidebar page="wallets" onNavigate={onNavigate} />
      </ModeProvider>,
    );
    expect(
      screen.getByRole('button', { name: 'Wallets' }).getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(onNavigate).toHaveBeenCalledWith('activity');
    const intelligence = screen.getByRole('button', { name: 'Wallet Intelligence' });
    expect((intelligence as HTMLButtonElement).disabled).toBe(false);
  });
});
