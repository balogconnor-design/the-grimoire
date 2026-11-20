import type { Card } from '../types';

// Drag and drop of search results onto a deck list. The card snapshot travels in the drag data
// under our own type, so drops from other pages or apps are ignored.
const CARD_TYPE = 'application/x-grimoire-card';

export function setCardDrag(dt: DataTransfer, card: Card) {
  dt.setData(CARD_TYPE, JSON.stringify(card));
  dt.setData('text/plain', card.name);
  dt.effectAllowed = 'copy';
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
