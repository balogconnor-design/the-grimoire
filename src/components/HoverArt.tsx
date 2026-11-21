import { useEffect, useSyncExternalStore, type MouseEvent } from 'react';
import type { Card } from '../types';
import { cardImage } from '../lib/rules';

/**
 * Card art that pops up beside the pointer when you rest it on a card name (desktop only; CSS hides it
 * on touch screens). One layer for the whole app: `<HoverArtLayer />` is mounted once in App, and any
 * list spreads `hoverArtProps(card)` onto the element that names the card.
 *
 * - It waits HOVER_DELAY_MS before showing, so sweeping the mouse across a list doesn't flash art.
 *   Once art is showing, moving onto another card swaps it straight away (no second wait).
 * - It is placed on whichever side of the pointer has room and kept inside the window.
 */
export const HOVER_DELAY_MS = 400;
/** Grace period after leaving a card in which the next card still shows without the delay. */
const WARM_MS = 300;
export const ART_W = 250;
export const ART_H = Math.round((ART_W * 680) / 488);
const GAP = 24;
const MARGIN = 8;

/** Where the art goes for a pointer at (x, y) in a window of the given size: right of the pointer, or left when there's no room. */
export function placeArt(x: number, y: number, viewW: number, viewH: number, w = ART_W, h = ART_H): { left: number; top: number } {
  const right = x + GAP;
  const left = right + w <= viewW - MARGIN ? right : x - GAP - w >= MARGIN ? x - GAP - w : Math.max(MARGIN, viewW - MARGIN - w);
  const top = Math.min(Math.max(y - h / 2, MARGIN), Math.max(MARGIN, viewH - MARGIN - h));
  return { left, top };
}

interface State { src: string; left: number; top: number }
let state: State | null = null;
let pending: { src: string; x: number; y: number } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let warmUntil = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

function show(src: string, x: number, y: number) {
  state = { src, ...placeArt(x, y, window.innerWidth, window.innerHeight) };
  emit();
}

/** Point at a card: shows its art after the delay (or right away if art was just showing). */
export function hoverArt(card: Card, x: number, y: number) {
  const src = cardImage(card, 'normal');
  if (!src) return hideArt();
  if (state || Date.now() < warmUntil) {
    clearTimeout(timer);
    pending = null;
    show(src, x, y);
    return;
  }
  if (pending?.src === src) { pending = { src, x, y }; return; } // waiting: just track the pointer
  clearTimeout(timer);
  pending = { src, x, y };
  timer = setTimeout(() => { if (pending) show(pending.src, pending.x, pending.y); pending = null; }, HOVER_DELAY_MS);
}

/** Pointer left the card (or it was clicked or dragged): hide the art and cancel a pending one. */
export function hideArt() {
  clearTimeout(timer);
  pending = null;
  if (state) {
    warmUntil = Date.now() + WARM_MS;
    state = null;
    emit();
  }
}

/** Mouse handlers for any element that names a card. */
export function hoverArtProps(card: Card | null | undefined) {
  if (!card) return {};
  return {
    onMouseEnter: (e: MouseEvent) => hoverArt(card, e.clientX, e.clientY),
    onMouseMove: (e: MouseEvent) => hoverArt(card, e.clientX, e.clientY),
    onMouseLeave: hideArt,
    onMouseDown: hideArt,
  };
}

/** The single art layer, mounted once in App. Hides on scroll, key presses, drags and route changes. */
export function HoverArtLayer() {
  const art = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    const off = () => hideArt();
    window.addEventListener('scroll', off, true);
    window.addEventListener('keydown', off);
    window.addEventListener('hashchange', off);
    window.addEventListener('blur', off);
    window.addEventListener('dragstart', off, true);
    return () => {
      window.removeEventListener('scroll', off, true);
      window.removeEventListener('keydown', off);
      window.removeEventListener('hashchange', off);
      window.removeEventListener('blur', off);
      window.removeEventListener('dragstart', off, true);
    };
  }, []);
  if (!art) return null;
  return <img className="hover-preview" src={art.src} style={{ left: art.left, top: art.top, width: ART_W }} alt="" />;
}

/** Tests: reset the layer. */
export function resetHoverArtForTests() { clearTimeout(timer); state = null; pending = null; warmUntil = 0; }
export const hoverArtStateForTests = () => state;
