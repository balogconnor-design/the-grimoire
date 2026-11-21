import type { Deck } from '../types';
import { unpinCard, usePinned } from '../lib/viewPanel';
import { CardView } from './CardModal';

/**
 * The deck page's view panel, under Card Search: the last card you right-clicked (or pinned from the
 * card window), with everything the card window shows. Drag its picture onto the deck list to add a
 * copy; the card stays here until another is pinned or the panel is closed.
 */
export function ViewPanel({ deck }: { deck: Deck }) {
  const pinned = usePinned();
  if (!pinned) return null;
  return (
    <section className="panel view-panel" aria-label="View panel">
      <div className="panel-head">
        <h2>View</h2>
        <span className="muted small view-hint">Right-click any card to show it here</span>
        <button type="button" className="icon-btn sm" onClick={unpinCard} aria-label="Close the view panel" title="Close">✕</button>
      </div>
      <CardView key={pinned.entryUid ?? pinned.card.id} card={pinned.card} deckId={deck.id} entryUid={pinned.entryUid} />
    </section>
  );
}
