import type { DragEvent, ReactNode } from 'react';
import type { Card } from '../types';
import { setCardDrag } from '../lib/dnd';
import { hideArt, hoverArtProps } from './HoverArt';
import { pinOnRightClick } from '../lib/viewPanel';

/**
 * A card named in a panel (Deck Details, EDHREC…), behaving like a search result: click to open the
 * card view, drag onto the deck list to add it, rest the pointer on it to see the art.
 * `card` may be missing while its data is still loading: then it only opens (via onOpen) and can't be dragged yet.
 */
export function CardLink({ card, name, onOpen, className = '', children, draggable = true, entryUid }: {
  card?: Card | null;
  name: string;
  onOpen: () => void;
  className?: string;
  children?: ReactNode;
  /** Off where there is no deck list to drop onto (Collection pages). */
  draggable?: boolean;
  /** The deck row this card is, so the view panel opens it as that row (printing, tags). */
  entryUid?: string;
}) {
  const canDrag = draggable && !!card;
  const onDragStart = (e: DragEvent) => {
    hideArt();
    if (canDrag && card) setCardDrag(e.dataTransfer, card);
    else e.preventDefault();
  };
  return (
    <button
      type="button"
      {...hoverArtProps(card)}
      className={`card-link ${canDrag ? 'is-draggable' : ''} ${className}`}
      draggable={canDrag || undefined}
      onDragStart={onDragStart}
      onClick={(e) => { e.stopPropagation(); hideArt(); onOpen(); }}
      onContextMenu={pinOnRightClick(card, entryUid, hideArt)}
      title={canDrag ? `${name}: click to view, drag onto the deck list to add` : `${name}: click to view`}
    >
      {children ?? <span className="card-link-name">{name}</span>}
    </button>
  );
}
