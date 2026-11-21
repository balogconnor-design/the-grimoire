import { describe, expect, it, vi } from 'vitest';
import { canPin, hostViewPanel, pinCard, pinOnRightClick, unpinCard } from '../src/lib/viewPanel';
import { card } from './helpers';

describe('view panel', () => {
  const sol = card('Sol Ring');
  const evt = () => ({ preventDefault: vi.fn() }) as unknown as Parameters<ReturnType<typeof pinOnRightClick>>[0];

  it('leaves right-click alone when no deck page is open', () => {
    expect(canPin()).toBe(false);
    const e = evt();
    pinOnRightClick(sol)(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('pins on right-click while the deck page is open, and clears when it closes', () => {
    const leave = hostViewPanel();
    const e = evt();
    const before = vi.fn();
    pinOnRightClick(sol, 'u1', before)(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(before).toHaveBeenCalled();
    pinCard(card('Counterspell'));
    unpinCard();
    pinCard(sol, 'u1');
    leave();
    expect(canPin()).toBe(false);
  });
});
