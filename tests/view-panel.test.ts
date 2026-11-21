import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canPin, closeView, focusCard, hostViewPanel, pinCard, pinOnRightClick, removeCard, setPinned, setViewMode, showCard,
  sortPinned, viewPanelState,
} from '../src/lib/viewPanel';
import { card } from './helpers';

const names = () => viewPanelState().items.map((p) => p.card.name);

describe('view panel', () => {
  const sol = card('Sol Ring');
  const counter = card('Counterspell');
  const bolt = card('Lightning Bolt');
  const evt = () => ({ preventDefault: vi.fn() }) as unknown as Parameters<ReturnType<typeof pinOnRightClick>>[0];
  let leave: (() => void) | undefined;
  afterEach(() => { leave?.(); leave = undefined; setViewMode('expanded'); });

  it('leaves right-click alone when no deck page is open', () => {
    expect(canPin()).toBe(false);
    const e = evt();
    pinOnRightClick(sol)(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    pinCard(sol);
    expect(names()).toEqual([]);
  });

  it('shows on right-click while the deck page is open, and clears when it closes', () => {
    leave = hostViewPanel();
    const e = evt();
    const before = vi.fn();
    pinOnRightClick(sol, 'u1', before)(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(before).toHaveBeenCalled();
    expect(viewPanelState().items).toEqual([{ card: sol, entryUid: 'u1' }]);
    leave();
    leave = undefined;
    expect(canPin()).toBe(false);
    expect(names()).toEqual([]);
  });

  it('unpinned, a right-click replaces the card; pinned, it adds to the list', () => {
    leave = hostViewPanel();
    showCard(sol);
    showCard(counter);
    expect(names()).toEqual(['Counterspell']);
    setPinned(true);
    showCard(bolt);
    showCard(sol);
    expect(names()).toEqual(['Counterspell', 'Lightning Bolt', 'Sol Ring']);
    expect(viewPanelState().focus).toBe('Sol Ring');
    // The same card again keeps one copy (now with its deck entry) and brings it to the front.
    focusCard('Counterspell');
    showCard(bolt, 'u9');
    expect(names()).toEqual(['Counterspell', 'Lightning Bolt', 'Sol Ring']);
    expect(viewPanelState().items[1].entryUid).toBe('u9');
    expect(viewPanelState().focus).toBe('Lightning Bolt');
  });

  it('pinning (card window, drag and drop) keeps the card on show and adds the new one', () => {
    leave = hostViewPanel();
    showCard(sol);
    pinCard(counter);
    expect(viewPanelState().pinned).toBe(true);
    expect(names()).toEqual(['Sol Ring', 'Counterspell']);
  });

  it('removes cards, moves the focus along, and closes when the last one goes', () => {
    leave = hostViewPanel();
    pinCard(sol); pinCard(counter); pinCard(bolt);
    focusCard('Counterspell');
    removeCard('Counterspell');
    expect(names()).toEqual(['Sol Ring', 'Lightning Bolt']);
    expect(viewPanelState().focus).toBe('Lightning Bolt');
    removeCard('Sol Ring');
    removeCard('Lightning Bolt');
    expect(names()).toEqual([]);
    expect(viewPanelState().pinned).toBe(false);
  });

  it('unpinning keeps only the card on show; closing clears everything', () => {
    leave = hostViewPanel();
    pinCard(sol); pinCard(counter);
    focusCard('Sol Ring');
    setPinned(false);
    expect(names()).toEqual(['Sol Ring']);
    pinCard(bolt);
    closeView();
    expect(names()).toEqual([]);
    expect(viewPanelState().pinned).toBe(false);
  });

  it('has no limit on pinned cards', () => {
    leave = hostViewPanel();
    for (let i = 0; i < 500; i++) pinCard(card(`Card ${i}`));
    expect(names()).toHaveLength(500);
  });

  it('adding a card brings a collapsed or hidden panel back', () => {
    leave = hostViewPanel();
    setViewMode('hidden');
    showCard(sol);
    expect(viewPanelState().mode).toBe('expanded');
    setViewMode('collapsed');
    pinCard(counter);
    expect(viewPanelState().mode).toBe('expanded');
  });

  it('sorts pinned cards, or keeps the order they were pinned', () => {
    const items = [
      { card: { ...bolt, cmc: 1, prices: { usd: '1.00' } } },
      { card: { ...counter, cmc: 2, prices: { usd: '0.50' } } },
      { card: { ...sol, cmc: 1, prices: { usd: '3.00' } } },
    ];
    expect(sortPinned(items, 'added').map((p) => p.card.name)).toEqual(['Lightning Bolt', 'Counterspell', 'Sol Ring']);
    expect(sortPinned(items, 'name').map((p) => p.card.name)).toEqual(['Counterspell', 'Lightning Bolt', 'Sol Ring']);
    expect(sortPinned(items, 'mv').map((p) => p.card.name)).toEqual(['Lightning Bolt', 'Sol Ring', 'Counterspell']);
    expect(sortPinned(items, 'price').map((p) => p.card.name)).toEqual(['Sol Ring', 'Lightning Bolt', 'Counterspell']);
  });
});
