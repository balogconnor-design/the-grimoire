import type { DragEvent, ReactNode } from 'react';
import type { Card } from '../types';
import type { Subject } from '../lib/query';
import { cardImage, cardPrice, formatUSD } from '../lib/rules';
import { setCardDrag } from '../lib/dnd';
import { TagList, type TagScope } from './TagEditor';

/** A search-result card tile with ownership + tag info and quick actions. */
export function CardResult({ card, subject, onOpen, onTag, onTagClick, onCollect, addButton, badge, draggable }: {
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
}) {
  const owned = subject.ownedQty ?? 0;
  const decks = subject.decks ?? [];
  const img = cardImage(card, 'normal');
  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    setCardDrag(e.dataTransfer, card);
    const pic = e.currentTarget.querySelector('img');
    if (pic) e.dataTransfer.setDragImage(pic, pic.clientWidth / 2, pic.clientHeight / 3);
  };
  return (
    <div className={`result-card ${draggable ? 'is-draggable' : ''}`}>
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
        <div className="result-actions">
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
          { scope: 'card', tags: subject.cardTags ?? [] },
          { scope: 'collection', tags: subject.collectionTags ?? [] },
          { scope: 'deck', tags: subject.deckTags ?? [] },
        ]}
        max={3}
        onTagClick={onTagClick}
      />
    </div>
  );
}
