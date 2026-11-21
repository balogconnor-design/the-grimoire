import { useSyncExternalStore, type MouseEvent } from 'react';
import type { Card } from '../types';

/**
 * The deck page's view panel: right-click a card anywhere on the deck page (or use Pin in the card
 * window) and it stays on show under Card Search until another card is pinned or the panel is closed.
 * Only the deck page shows the panel; elsewhere right-click keeps the browser's own menu.
 */
export interface Pinned { card: Card; entryUid?: string }

let pinned: Pinned | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** True while a page with a view panel (the deck page) is open. */
export const canPin = () => hosts > 0;

export function pinCard(card: Card, entryUid?: string) {
  if (!canPin()) return;
  pinned = { card, entryUid };
  emit();
}
export function unpinCard() { pinned = null; emit(); }

/** The deck page registers itself while mounted; leaving it clears the panel. */
export function hostViewPanel(): () => void {
  hosts++;
  emit();
  return () => { hosts--; if (!hosts) pinned = null; emit(); };
}

export function usePinned(): Pinned | null { return useSyncExternalStore(subscribe, () => pinned); }
export function useCanPin(): boolean { return useSyncExternalStore(subscribe, () => hosts > 0); }

/** onContextMenu handler for anything that shows a card: pins it on the deck page, leaves the browser menu elsewhere. */
export const pinOnRightClick = (card: Card | null | undefined, entryUid?: string, before?: () => void) => (e: MouseEvent) => {
  if (!card || !canPin()) return;
  e.preventDefault();
  before?.();
  pinCard(card, entryUid);
};
