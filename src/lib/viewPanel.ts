import { useSyncExternalStore, type MouseEvent } from 'react';
import type { Card, DeckEntry } from '../types';
import { entrySorter, type SortBy } from './deckGroups';

/**
 * The deck page's view panel, under Card Search.
 *
 * - Unpinned (the default): right-click a card anywhere on the deck page and it shows in the panel,
 *   replacing whatever was there.
 * - Pinned (the panel's pin button, the card window's Pin button, or dragging a card onto the panel):
 *   the panel keeps a list of cards. Right-clicking another card adds it to the list instead of
 *   replacing; there is no limit. Each card can be removed; closing the panel clears the list.
 *
 * Cards are kept once per name (a second right-click on the same card just brings it to the front).
 * Only the deck page shows the panel; elsewhere right-click keeps the browser's own menu. Leaving the
 * deck page clears the panel. Expanded / collapsed / hidden is remembered in this browser.
 */
export interface Pinned { card: Card; entryUid?: string }
export type ViewMode = 'expanded' | 'collapsed' | 'hidden';
/** Order of the pinned cards: as pinned, or any of the deck list's sorts. */
export type PinSort = 'added' | SortBy;

/** Sort the pinned cards (ties by name); 'added' keeps the order they were pinned. */
export function sortPinned(items: Pinned[], by: PinSort): Pinned[] {
  if (by === 'added') return items;
  const cmp = entrySorter(by);
  const asEntry = (p: Pinned) => ({ card: p.card }) as DeckEntry;
  return [...items].sort((a, b) => cmp(asEntry(a), asEntry(b)));
}

export interface ViewState {
  /** The cards in the panel, in the order they were added (one when unpinned). */
  items: Pinned[];
  /** True once the panel is pinned: right-clicks add to the list instead of replacing it. */
  pinned: boolean;
  /** Name of the card shown in the single-card view. */
  focus: string | null;
  mode: ViewMode;
}

const MODE_KEY = 'grimoire.viewMode';
function readMode(): ViewMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'collapsed' || m === 'hidden' ? m : 'expanded';
  } catch { return 'expanded'; }
}

let state: ViewState = { items: [], pinned: false, focus: null, mode: readMode() };
let hosts = 0;
const listeners = new Set<() => void>();
const set = (patch: Partial<ViewState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** True while a page with a view panel (the deck page) is open. */
export const canPin = () => hosts > 0;

/** Adding a card brings a collapsed or hidden panel back so you can see it. */
const shown = (): Partial<ViewState> => (state.mode === 'expanded' ? {} : { mode: 'expanded' });

function withCard(items: Pinned[], card: Card, entryUid?: string): Pinned[] {
  const i = items.findIndex((p) => p.card.name === card.name);
  if (i < 0) return [...items, { card, entryUid }];
  // Already there: keep its place; a deck card (with its entry) wins over a search result.
  const next = items.slice();
  next[i] = { card: entryUid || !items[i].entryUid ? card : items[i].card, entryUid: entryUid ?? items[i].entryUid };
  return next;
}

/** Right-click: show the card (unpinned) or add it to the pinned list. */
export function showCard(card: Card, entryUid?: string) {
  if (!canPin()) return;
  set({ items: state.pinned ? withCard(state.items, card, entryUid) : [{ card, entryUid }], focus: card.name, ...shown() });
}

/**
 * Pin the panel and add the card (the card window's Pin button, or a card dropped on the panel).
 * A card already on show in an unpinned panel is kept, as the first pinned card.
 */
export function pinCard(card: Card, entryUid?: string) {
  if (!canPin()) return;
  set({ items: withCard(state.items, card, entryUid), pinned: true, focus: card.name, ...shown() });
}

/** The panel's pin button. Unpinning keeps only the card on show. */
export function setPinned(on: boolean) {
  if (on) { set({ pinned: true }); return; }
  const keep = state.items.find((p) => p.card.name === state.focus) ?? state.items[0];
  set({ pinned: false, items: keep ? [keep] : [], focus: keep?.card.name ?? null });
}

/** Take one card out of the panel; the panel closes when the last one goes. */
export function removeCard(name: string) {
  const i = state.items.findIndex((p) => p.card.name === name);
  if (i < 0) return;
  const items = state.items.filter((_, j) => j !== i);
  const focus = state.focus === name ? (items[Math.min(i, items.length - 1)]?.card.name ?? null) : state.focus;
  set({ items, focus, pinned: items.length ? state.pinned : false });
}

export function focusCard(name: string) { set({ focus: name }); }

/** Close the panel: clears every card and unpins it. */
export function closeView() { set({ items: [], pinned: false, focus: null }); }

export function setViewMode(mode: ViewMode) {
  set({ mode });
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* session only */ }
}

/** The deck page registers itself while mounted; leaving it clears the panel. */
export function hostViewPanel(): () => void {
  hosts++;
  set({});
  return () => { hosts--; set(hosts ? {} : { items: [], pinned: false, focus: null }); };
}

export function useViewPanel(): ViewState { return useSyncExternalStore(subscribe, () => state); }
export function useCanPin(): boolean { return useSyncExternalStore(subscribe, () => hosts > 0); }
/** Current state, outside React. */
export const viewPanelState = () => state;

/** onContextMenu handler for anything that shows a card: shows it on the deck page, leaves the browser menu elsewhere. */
export const pinOnRightClick = (card: Card | null | undefined, entryUid?: string, before?: () => void) => (e: MouseEvent) => {
  if (!card || !canPin()) return;
  e.preventDefault();
  before?.();
  showCard(card, entryUid);
};
