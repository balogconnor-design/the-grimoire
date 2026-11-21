import type { DragEvent, MouseEvent, ReactNode } from 'react';
import type { Card } from '../types';
import type { Subject } from '../lib/query';
import { cardPrice, formatUSD, frontTypeLine } from '../lib/rules';
import { setCardDrag } from '../lib/dnd';
import { setCardFavorite } from '../lib/actions';
import { ManaCost } from './Mana';
import { hideArt, hoverArtProps } from './HoverArt';
import { pinOnRightClick } from '../lib/viewPanel';
import { TagList, type TagScope } from './TagEditor';

export type ResultView = 'grid' | 'list' | 'details';
export const RESULT_VIEWS: { value: ResultView; label: string; icon: string }[] = [
  { value: 'grid', label: 'Grid', icon: '▦' },
  { value: 'list', label: 'List', icon: '☰' },
  { value: 'details', label: 'Details', icon: '▤' },
];
const VIEW_KEY = 'grimoire.searchView';
export function readResultView(): ResultView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'list' || v === 'details' ? v : 'grid';
  } catch { return 'grid'; }
}
export function saveResultView(v: ResultView) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable: only this session remembers */ }
}

/** Grid / List / Details switch shown above search results. */
export function ResultViewSwitch({ value, onChange }: { value: ResultView; onChange: (v: ResultView) => void }) {
  return (
    <div className="status-toggle view-switch" role="radiogroup" aria-label="Show results as">
      {RESULT_VIEWS.map((v) => (
        <button key={v.value} type="button" role="radio" aria-checked={value === v.value} title={v.label}
          className={`seg ${value === v.value ? 'on' : ''}`} onClick={() => { saveResultView(v.value); onChange(v.value); }}>
          <span aria-hidden>{v.icon}</span> {v.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A search result as a row: List (compact: cost, name, type, first Scryfall tag, price) or Details
 * (taller, uniform rows with rules text and tags). The card picture shows on hover; click opens the
 * card view; on the deck page the row drags onto the deck list like a grid tile.
 */
export function CardResultRow({ card, subject, view, onOpen, onTag, onTagClick, onCollect, addButton, badge, draggable, dim, onRemove, onRightClick }: {
  card: Card;
  subject: Subject;
  view: 'list' | 'details';
  onOpen: () => void;
  onTag: () => void;
  onTagClick: (scope: TagScope, tag: string) => void;
  onCollect: () => void;
  addButton?: ReactNode;
  badge?: ReactNode;
  draggable?: boolean;
  dim?: boolean;
  /** Shows a remove button (the view panel's pinned cards). */
  onRemove?: () => void;
  /** Replaces the usual right-click (show in the view panel). */
  onRightClick?: (e: MouseEvent) => void;
}) {
  const owned = subject.ownedQty ?? 0;
  const decks = subject.decks ?? [];
  const firstScryfall = subject.scryfallTags?.[0];
  const cost = card.mana_cost || card.card_faces?.[0]?.mana_cost;
  const onDragStart = (e: DragEvent) => { hideArt(); setCardDrag(e.dataTransfer, card); };
  const oracle = card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text).filter(Boolean).join(' // ') ?? '';
  const stats = card.power != null ? `${card.power}/${card.toughness}` : card.loyalty != null ? `Loyalty ${card.loyalty}` : '';

  return (
    <div
      className={`result-row ${view} ${draggable ? 'is-draggable' : ''} ${dim ? 'is-dim' : ''}`}
      draggable={draggable || undefined} onDragStart={draggable ? onDragStart : undefined}
      title={dim ? 'Already in this deck' : undefined}
      {...hoverArtProps(card)}
      onContextMenu={onRightClick ?? pinOnRightClick(card, undefined, hideArt)}
    >
      <div className="row-main">
        <button className="row-name" onClick={() => { hideArt(); onOpen(); }} title={draggable ? `${card.name}: click to view, drag onto the deck list to add` : card.name}>
          <span className="truncate">{card.name}</span>
        </button>
        <span className="row-cost"><ManaCost cost={cost} size={view === 'details' ? 16 : 14} /></span>
      </div>
      <div className="row-meta">
        <span className="row-type truncate">{frontTypeLine(card)}{view === 'details' && stats ? ` · ${stats}` : ''}</span>
        {view === 'list' && firstScryfall && (
          <button type="button" className="tag-chip scryfall row-tag" onClick={() => onTagClick('scryfall', firstScryfall)}>{firstScryfall}</button>
        )}
      </div>
      {view === 'details' && oracle && <div className="row-oracle">{oracle}</div>}
      {view === 'details' && (
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
      )}
      <div className="row-side">
        <span className="price">{formatUSD(cardPrice(card))}</span>
        <span className="row-badges">
          {badge}
          {owned > 0 && <span className="owned-badge" title="Copies in your collection (any print)">✓ {owned}</span>}
          {view === 'details' && decks.length > 0 && <span className="decks-badge" title={decks.join('\n')}>{decks.length} deck{decks.length === 1 ? '' : 's'}</span>}
        </span>
        <span className="row-actions-inline">
          <button className={`icon-btn sm ${subject.favorite ? 'fav-on' : ''}`} aria-pressed={!!subject.favorite}
            title={subject.favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={subject.favorite ? `Unfavorite ${card.name}` : `Favorite ${card.name}`}
            onClick={() => setCardFavorite(card, !subject.favorite)}>{subject.favorite ? '★' : '☆'}</button>
          {view === 'details' && <button className="icon-btn sm" onClick={onTag} title="Tag this card" aria-label={`Tag ${card.name}`}>🏷</button>}
          {view === 'details' && <button className="icon-btn sm" onClick={onCollect} title="Add to collection" aria-label={`Add ${card.name} to collection`}>◈+</button>}
          {addButton}
          {onRemove && <button className="icon-btn sm danger row-remove" onClick={onRemove} title="Remove from the view panel" aria-label={`Remove ${card.name} from the view panel`}>✕</button>}
        </span>
      </div>
    </div>
  );
}
