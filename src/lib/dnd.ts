import type { Card } from '../types';

// Drag and drop of search results onto a deck list. The card snapshot travels in the drag data
// under our own type, so drops from other pages or apps are ignored.
const CARD_TYPE = 'application/x-grimoire-card';

export function setCardDrag(dt: DataTransfer, card: Card) {
  dt.setData(CARD_TYPE, JSON.stringify(card));
  dt.setData('text/plain', card.name);
  dt.effectAllowed = 'copy';
}

/**
 * Use a copy of the card image at its on-screen size as the drag picture. Given the <img> itself,
 * Firefox draws it at the image file's full size (488×680), which is far bigger than the tile.
 */
export function setDragPreview(dt: DataTransfer, img: HTMLImageElement) {
  const w = Math.min(img.clientWidth || 140, 180);
  const h = Math.round(w * (img.clientHeight && img.clientWidth ? img.clientHeight / img.clientWidth : 680 / 488));
  // Wrapped in a div: browsers draw an element at its laid-out size, but a bare <img> at its file size.
  const ghost = document.createElement('div');
  const pic = img.cloneNode() as HTMLImageElement;
  pic.removeAttribute('loading');
  Object.assign(pic.style, { display: 'block', width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px' });
  Object.assign(ghost.style, { position: 'fixed', top: '-10000px', left: '-10000px', width: `${w}px`, height: `${h}px`, pointerEvents: 'none' });
  ghost.appendChild(pic);
  document.body.appendChild(ghost);
  dt.setDragImage(ghost, w / 2, h / 3);
  // The browser snapshots the drag picture right away; the copy can go on the next frame.
  setTimeout(() => ghost.remove(), 0);
}

/** True while a Grimoire card is being dragged (the data itself is only readable on drop). */
export const isCardDrag = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes(CARD_TYPE);

export function readCardDrag(dt: DataTransfer | null): Card | null {
  try {
    const raw = dt?.getData(CARD_TYPE);
    const card = raw ? (JSON.parse(raw) as Card) : null;
    return card && typeof card.id === 'string' && typeof card.name === 'string' ? card : null;
  } catch {
    return null;
  }
}

/**
 * Deck rows drag their entry id under their own type (moving between tag groups, onto the commander
 * slot, or onto the view panel to pin it). Kept apart from search drags so the deck list never adds
 * a copy of a card dragged out of itself.
 */
export const ENTRY_DRAG = 'application/x-grimoire-entry';
export const isEntryDrag = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes(ENTRY_DRAG);
export const readEntryDrag = (dt: DataTransfer | null) => dt?.getData(ENTRY_DRAG) || null;
