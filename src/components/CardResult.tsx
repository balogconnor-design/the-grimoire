import type { ReactNode } from 'react';
import type { Card } from '../types';
import type { Subject } from '../lib/query';
import { cardImage, cardPrice, formatUSD } from '../lib/rules';
import { printBadges } from '../lib/collection';
import { TagList, type TagScope } from './TagEditor';

/** A search-result card tile with ownership + tag info and quick actions. */
export function CardResult({ card, subject, onOpen, onTag, onTagClick, onCollect, topRight, badge }: {
  card: Card;
  subject: Subject;
  onOpen: () => void;
  onTag: () => void;
  onTagClick: (scope: TagScope, tag: string) => void;
  onCollect: () => void;
  topRight?: ReactNode;
  badge?: ReactNode;
}) {
  const owned = subject.ownedQty ?? 0;
  const decks = subject.decks ?? [];
  const img = cardImage(card, 'normal');
  const alt = printBadges(card)[0];
  return (
    <div className="result-card">
      <button className="result-img-btn" onClick={onOpen} title={card.name}>
        {img ? <img src={img} alt={card.name} loading="lazy" /> : <div className="card-img-missing">{card.name}</div>}
      </button>
      <div className="result-badges">
        {badge}
        {owned > 0 && <span className="owned-badge" title="Copies in your collection (any print)">✓ {owned} owned</span>}
        {decks.length > 0 && <span className="decks-badge" title={decks.join('\n')}>{decks.length} deck{decks.length === 1 ? '' : 's'}</span>}
        {alt && <span className="print-badge">{alt}</span>}
      </div>
      {topRight}
      <div className="result-actions">
        <button className="mini-btn" onClick={onTag} title="Tag this card" aria-label={`Tag ${card.name}`}>🏷</button>
        <button className="mini-btn" onClick={onCollect} title="Add to collection" aria-label={`Add ${card.name} to collection`}>◈+</button>
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
