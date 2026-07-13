import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AdvancedPage } from '../src/pages/AdvancedPage';

describe('Advanced page', () => {
  it('reaches every existing technical page with a plain description', () => {
    const onNavigate = vi.fn();
    render(<AdvancedPage onNavigate={onNavigate} />);

    const destinations: [string, string][] = [
      ['Open Activity', 'activity'],
      ['Open Wallet Intelligence', 'intelligence'],
      ['Open Focus Trader Lab', 'focus'],
      ['Open Overview', 'overview'],
      ['Open Help', 'help'],
    ];
    for (const [buttonName, pageId] of destinations) {
      fireEvent.click(screen.getByRole('button', { name: buttonName }));
      expect(onNavigate).toHaveBeenCalledWith(pageId);
    }
    expect(screen.getByText(/Public trade history/)).toBeTruthy();
    expect(screen.getByText(/Detailed wallet results/)).toBeTruthy();
    expect(screen.getByText(/Focus-wallet comparisons/)).toBeTruthy();
    expect(screen.getByText(/Technical system status/)).toBeTruthy();
    expect(screen.getByText(/Help and definitions/)).toBeTruthy();
  });

  it('does not remove any page — it only relocates the entry point', () => {
    render(<AdvancedPage onNavigate={vi.fn()} />);
    expect(screen.getByText(/Nothing here is hidden/)).toBeTruthy();
  });
});
