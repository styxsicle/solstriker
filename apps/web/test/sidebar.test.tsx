import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModeProvider } from '../src/lib/mode';
import { FUTURE_FEATURES, Sidebar } from '../src/components/Sidebar';

function renderSidebar(mode: 'simple' | 'quant', page: string, onNavigate = vi.fn()) {
  window.localStorage.setItem('memecoin-lab.ui-mode', mode);
  render(
    <ModeProvider>
      <Sidebar page={page as never} onNavigate={onNavigate} />
    </ModeProvider>,
  );
  return onNavigate;
}

describe('Sidebar — Simple Mode navigation', () => {
  it('shows Home, Wallets, Coin Check, Advanced as functional, and Alerts/My Positions as unavailable', () => {
    renderSidebar('simple', 'home');
    for (const name of ['Home', 'Wallets', 'Coin Check', 'Advanced']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
    for (const name of ['Alerts', 'My Positions']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.textContent).toMatch(/Coming later/);
    }
  });

  it('never navigates when Alerts or My Positions is clicked', () => {
    const onNavigate = renderSidebar('simple', 'home');
    fireEvent.click(screen.getByRole('button', { name: /^Alerts/ }));
    fireEvent.click(screen.getByRole('button', { name: /^My Positions/ }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not show the old technical pages as primary Simple Mode destinations', () => {
    renderSidebar('simple', 'home');
    expect(screen.queryByRole('button', { name: 'Activity' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wallet Intelligence' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Focus Trader Lab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull();
  });

  it('navigates to Coin Check (the Tokens page) and marks the current page', () => {
    const onNavigate = renderSidebar('simple', 'wallets');
    expect(screen.getByRole('button', { name: 'Wallets' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: /^Coin Check/ }));
    expect(onNavigate).toHaveBeenCalledWith('tokens');
  });
});

describe('Sidebar — Quant Mode navigation', () => {
  it('still shows every existing technical page as a primary destination', () => {
    renderSidebar('quant', 'overview');
    for (const name of ['Overview', 'Wallets', 'Activity', 'Tokens', 'Wallet Intelligence', 'Focus Trader Lab', 'Help']) {
      const button = screen.getByRole('button', { name });
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('does not show the Simple Mode Home/Coin Check/My Positions/Advanced items', () => {
    renderSidebar('quant', 'overview');
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Coin Check/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^My Positions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull();
    // Quant Mode's own pre-existing "Coming later" section legitimately has its
    // own unrelated "Alerts" entry — that one is fine; there just shouldn't be
    // a second, Simple-Mode-style primary "Alerts" nav item alongside it.
    expect(screen.getAllByRole('button', { name: /^Alerts/ })).toHaveLength(1);
  });

  it('navigates between real pages and marks the current one', () => {
    const onNavigate = renderSidebar('quant', 'wallets');
    expect(screen.getByRole('button', { name: 'Wallets' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(onNavigate).toHaveBeenCalledWith('activity');
    const intelligence = screen.getByRole('button', { name: 'Wallet Intelligence' });
    expect((intelligence as HTMLButtonElement).disabled).toBe(false);
  });

  it('exposes Focus Trader Lab as a visible primary navigation page', () => {
    const onNavigate = renderSidebar('quant', 'overview');
    const focus = screen.getByRole('button', { name: 'Focus Trader Lab' });
    expect((focus as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(focus);
    expect(onNavigate).toHaveBeenCalledWith('focus');
  });

  it('still labels the future-feature list as unavailable instead of making it work', () => {
    const onNavigate = renderSidebar('quant', 'overview');
    for (const name of FUTURE_FEATURES) {
      const button = screen.getByRole('button', { name: new RegExp(name, 'i') });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(button);
    }
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getAllByText('not built')).toHaveLength(FUTURE_FEATURES.length);
  });
});
