import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModeProvider, useMode, getStoredMode } from '../src/lib/mode';
import { ModeToggle } from '../src/components/ModeToggle';

function ModeProbe() {
  const { mode } = useMode();
  return <output data-testid="mode-probe">{mode}</output>;
}

function renderToggle() {
  return render(
    <ModeProvider>
      <ModeToggle />
      <ModeProbe />
    </ModeProvider>,
  );
}

describe('interface mode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to Simple Mode when nothing is saved', () => {
    expect(getStoredMode()).toBe('simple');
    renderToggle();
    expect(screen.getByTestId('mode-probe').textContent).toBe('simple');
    expect(
      screen.getByRole('button', { name: 'Simple' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('switches presentation without a reload and persists the choice', () => {
    renderToggle();
    fireEvent.click(screen.getByRole('button', { name: 'Quant' }));
    expect(screen.getByTestId('mode-probe').textContent).toBe('quant');
    expect(
      screen.getByRole('button', { name: 'Quant' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(window.localStorage.getItem('memecoin-lab.ui-mode')).toBe('quant');
  });

  it('restores a persisted Quant preference on mount', () => {
    window.localStorage.setItem('memecoin-lab.ui-mode', 'quant');
    renderToggle();
    expect(screen.getByTestId('mode-probe').textContent).toBe('quant');
  });
});
