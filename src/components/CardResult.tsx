import type { DragEvent, ReactNode } from 'react';
import type { Card } from '../types';
import type { Subject } from '../lib/query';
import { cardImage, cardPrice, formatUSD } from '../lib/rules';
import { setCardDrag, setDragPreview } from '../lib/dnd';
import { setCardFavorite } from '../lib/actions';
import { pinOnRightClick } from '../lib/viewPanel';
import { TagList, type TagScope } from './TagEditor';

/** A search-result card tile with ownership + tag info and quick actions. */
export function CardResult({ card, subject, onOpen, onTag, onTagClick, onCollect, addButton, badge, draggable, dim, onRemove }: {
  card: Card;
  subject: Subject;
  onOpen: () => void;
  onTag: () => void;
  onTagClick: (scope: TagScope, tag: string) => void;
  onCollect: () => void;
  /** Quick-add button, shown in the bottom-left corner of the card image. */
  addButton?: ReactNode;
  badge?: ReactNode;
  /** Let the card be dragged onto a deck list. */
  draggable?: boolean;
  /** Shown greyed out (e.g. already in the deck), still usable. */
  dim?: boolean;
  /** Shows a remove button (the view panel's pinned cards). */
  onRemove?: () => void;
}) {
  const owned = subject.ownedQty ?? 0;
  const decks = subject.decks ?? [];
  const img = cardImage(card, 'normal');
  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    setCardDrag(e.dataTransfer, card);
    const pic = e.currentTarget.querySelector('img');
    if (pic) setDragPreview(e.dataTransfer, pic);
  };
  return (
    <div className={`result-card ${draggable ? 'is-draggable' : ''} ${dim ? 'is-dim' : ''}`} title={dim ? 'Already in this deck' : undefined} onContextMenu={pinOnRightClick(card)}>
      <div className="result-art" draggable={draggable || undefined} onDragStart={draggable ? onDragStart : undefined}>
        <button className="result-img-btn" onClick={onOpen} title={draggable ? `${card.name} — drag onto the deck list to add it` : card.name}>
          {img ? <img src={img} alt={card.name} loading="lazy" draggable={false} /> : <div className="card-img-missing">{card.name}</div>}
        </button>
        <div className="result-badges">
          {badge}
          {owned > 0 && <span className="owned-badge" title="Copies in your collection (any print)">✓ {owned} owned</span>}
          {decks.length > 0 && <span className="decks-badge" title={decks.join('\n')}>{decks.length} deck{decks.length === 1 ? '' : 's'}</span>}
        </div>
        {addButton}
        <button
          className={`result-fav ${subject.favorite ? 'on' : ''}`} aria-pressed={!!subject.favorite}
          title={subject.favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={subject.favorite ? `Unfavorite ${card.name}` : `Favorite ${card.name}`}
          onClick={() => setCardFavorite(card, !subject.favorite)}
        >{subject.favorite ? '★' : '☆'}</button>
        <div className="result-actions">
          {onRemove && <button className="mini-btn mini-remove" onClick={onRemove} title="Remove from the view panel" aria-label={`Remove ${card.name} from the view panel`}>✕</button>}
          <button className="mini-btn" onClick={onTag} title="Tag this card" aria-label={`Tag ${card.name}`}>🏷</button>
          <button className="mini-btn" onClick={onCollect} title="Add to collection" aria-label={`Add ${card.name} to collection`}>◈+</button>
        </div>
      </div>
      <div className="result-foot">
        <span className="truncate">{card.name}</span>
        <span className="price">{formatUSD(cardPrice(card))}</span>
      </div>
      <TagList
        groups={[
          { scope: 'global', tags: subject.globalTags ?? [] },
          { scope: 'card', tags: subject.cardTags ?? [] },
          { scope: 'collection', tags: subject.collectionTags ?? [] },
          { scope: 'deck', tags: subject.deckTags ?? [] },
          { scope: 'scryfall', tags: subject.scryfallTags ?? [] },
        ]}
        max={3}
        onTagClick={onTagClick}
      />
    </div>
  );
}
