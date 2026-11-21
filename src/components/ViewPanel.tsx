import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { Board, Card, Deck } from '../types';
import {
  closeView, focusCard, pinCard, removeCard, setPinned, setViewMode, sortPinned, useViewPanel, type Pinned, type PinSort,
} from '../lib/viewPanel';
import { isCardDrag, isEntryDrag, readCardDrag, readEntryDrag } from '../lib/dnd';
import { SORT_OPTIONS } from '../lib/deckGroups';
import { addCard } from '../lib/actions';
import { useSubjects } from '../lib/hooks';
import { requestCardSearch } from '../lib/searchBus';
import { CardView } from './CardModal';
import { CardResult } from './CardResult';
import { CardResultRow } from './CardResultRow';
import { TagModal } from './TagModal';
import { AddToCollectionModal } from './CollectionModals';
import { SCOPE_META, type TagScope } from './TagEditor';
import { Chevron } from './SearchPanel';
import { useToast } from './Toast';

/** How the pinned cards are shown: one at a time, or all of them as tiles or rows. */
type PinView = 'card' | 'grid' | 'list' | 'details';
const PIN_VIEWS: { value: PinView; label: string; icon: string; title: string }[] = [
  { value: 'card', label: 'Card', icon: '▢', title: 'One card at a time, with everything the card window shows' },
  { value: 'grid', label: 'Grid', icon: '▦', title: 'Card pictures, the size of the search results' },
  { value: 'list', label: 'List', icon: '☰', title: 'Compact rows (picture on hover)' },
  { value: 'details', label: 'Details', icon: '▤', title: 'Rows with rules text and tags' },
];
const PIN_SORTS: { value: PinSort; label: string }[] = [{ value: 'added', label: 'Order pinned' }, ...SORT_OPTIONS];

const VIEW_KEY = 'grimoire.pinView';
const SORT_KEY = 'grimoire.pinSort';
const read = <T extends string>(key: string, ok: readonly T[], fallback: T): T => {
  try { const v = localStorage.getItem(key) as T | null; return v && ok.includes(v) ? v : fallback; } catch { return fallback; }
};
const save = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* session only */ } };

/** Grid and list views render this many more cards each time the end scrolls into sight. */
const CHUNK = 48;

const BOARD_NAME: Record<Board, { full: string; short: string }> = {
  main: { full: 'main deck', short: 'in deck' },
  side: { full: 'sideboard', short: 'in side' },
  maybe: { full: 'maybeboard', short: 'in maybe' },
};

/** A small pushpin, filled when the panel is pinned. */
function PinIcon({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

/** Drag and drop onto the panel (or its rail): pins the card. Deck rows and search results both work. */
function useDropToPin(deck: Deck) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => isCardDrag(e.dataTransfer) || isEntryDrag(e.dataTransfer);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); },
      onDrop: (e: DragEvent) => {
        setOver(false);
        const card = readCardDrag(e.dataTransfer);
        const uid = card ? null : readEntryDrag(e.dataTransfer);
        const entry = uid ? deck.entries.find((x) => x.uid === uid) : undefined;
        if (!card && !entry) return;
        e.preventDefault();
        e.stopPropagation();
        if (card) pinCard(card);
        else if (entry) pinCard(entry.card, entry.uid);
      },
    },
  };
}

/** True while a card (search result or deck row) is being dragged anywhere on the page. */
function useCardDragging(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const start = (e: globalThis.DragEvent) => { if (isCardDrag(e.dataTransfer) || isEntryDrag(e.dataTransfer)) setOn(true); };
    const end = () => setOn(false);
    window.addEventListener('dragstart', start);
    window.addEventListener('dragend', end, true);
    window.addEventListener('drop', end, true);
    return () => {
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragend', end, true);
      window.removeEventListener('drop', end, true);
    };
  }, []);
  return on;
}

/**
 * The deck page's view panel, under Card Search. Unpinned it shows the last card you right-clicked;
 * pinned it keeps every card you right-click, drag onto it, or pin from the card window, shown one
 * at a time (Card) or all together (Grid, List, Details) in the chosen order. Collapses and hides like
 * Card Search; dragging a card out of it onto the deck list adds a copy.
 */
export function ViewPanel({ deck, board = 'main' }: { deck: Deck; board?: Board }) {
  const { items, pinned, focus, mode } = useViewPanel();
  const drop = useDropToPin(deck);
  const dragging = useCardDragging();
  const [view, setViewState] = useState<PinView>(() => read(VIEW_KEY, PIN_VIEWS.map((v) => v.value), 'card'));
  const [sort, setSortState] = useState<PinSort>(() => read(SORT_KEY, PIN_SORTS.map((s) => s.value), 'added'));
  const setView = (v: PinView) => { setViewState(v); save(VIEW_KEY, v); };
  const setSort = (s: PinSort) => { setSortState(s); save(SORT_KEY, s); };
  const [tagging, setTagging] = useState<Card | null>(null);
  const [collecting, setCollecting] = useState<Card | null>(null);
  const subjects = useSubjects();
  const toast = useToast();

  const sorted = useMemo(() => sortPinned(items, sort), [items, sort]);
  const index = Math.max(0, sorted.findIndex((p) => p.card.name === focus));
  const current = sorted[index];

  // Infinite scroll: render the grid / list in chunks, adding more as the end comes into sight.
  const [limit, setLimit] = useState(CHUNK);
  const sentinel = useRef<HTMLDivElement>(null);
  const many = sorted.length > limit;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !many) return;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) setLimit((l) => l + CHUNK); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [many, limit, view, mode]);

  const inDeck = useMemo(() => {
    const m = new Map<string, number>();
    deck.entries.forEach((e) => e.board === board && m.set(e.card.name, (m.get(e.card.name) ?? 0) + e.qty));
    return m;
  }, [deck.entries, board]);

  if (!items.length) {
    // Nothing on show: while a card is dragged, offer a place to drop it.
    if (!dragging) return null;
    return (
      <div className={`view-drop-zone ${drop.over ? 'drop-on' : ''}`} {...drop.props} aria-label="Drop here to pin to the view panel">
        <PinIcon on={drop.over} /> Drop here to pin to the view panel
      </div>
    );
  }

  if (mode === 'hidden') {
    return (
      <button
        type="button" className={`view-rail ${drop.over ? 'drop-on' : ''}`} {...drop.props}
        onClick={() => setViewMode('expanded')} title="Show the view panel" aria-label="Show the view panel"
      >
        <PinIcon on={pinned} /><span className="view-rail-label">View</span><span className="tab-count">{items.length}</span>
      </button>
    );
  }

  const collapsed = mode === 'collapsed';
  const target = BOARD_NAME[board];
  const step = (dir: -1 | 1) => {
    if (sorted.length < 2) return;
    focusCard(sorted[(index + dir + sorted.length) % sorted.length].card.name);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!pinned || view !== 'card' || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target as HTMLElement;
    if (!e.currentTarget.contains(el) || el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  };
  const onTagClick = (scope: TagScope, t: string) => { requestCardSearch(`${SCOPE_META[scope].key}:${/\s/.test(t) ? `"${t}"` : t}`); };
  const open = (c: Card) => { focusCard(c.name); setView('card'); };
  /** Right-clicking a card that is already in the panel takes it out (with Undo, as there's no confirmation). */
  const removeByRightClick = (name: string) => (e: MouseEvent) => {
    e.preventDefault();
    const undo = removeCard(name);
    if (undo) toast(`Removed ${name} from the view panel`, 'info', { label: 'Undo', run: undo });
  };
  // Card view: right-click the card picture to remove it. Cards named inside the details (deckmates
  // and so on) keep their own right-click, which adds them.
  const onCardViewContextMenu = (e: MouseEvent) => {
    if (e.defaultPrevented || !current) return;
    if ((e.target as HTMLElement).closest('.card-modal-image img, .card-modal-image .card-img-missing')) removeByRightClick(current.card.name)(e);
  };

  const cardProps = (p: Pinned) => {
    const c = p.card;
    const n = inDeck.get(c.name);
    return {
      card: c, subject: subjects(c, { deckId: deck.id }), draggable: true,
      onOpen: () => open(c), onTag: () => setTagging(c), onCollect: () => setCollecting(c), onTagClick,
      onRemove: () => { removeCard(c.name); },
      onRightClick: removeByRightClick(c.name),
      badge: n ? <span className="in-deck-badge">{n} {target.short}</span> : null,
      addButton: (
        <button className="quick-add" title={`Add 1 to ${target.full}`} aria-label={`Add ${c.name} to ${target.full}`}
          onClick={() => toast(addCard(deck.id, c, 1, board), 'success')}>+</button>
      ),
    };
  };
  const shown = sorted.slice(0, limit);

  return (
    <section
      className={`panel view-panel ${collapsed ? 'collapsed' : ''} ${pinned ? 'is-pinned' : ''} ${drop.over ? 'drop-on' : ''}`}
      aria-label="View panel" tabIndex={-1} onKeyDown={onKeyDown} {...drop.props}
    >
      <div className="panel-controls">
      <div className="panel-head">
        <h2>View{pinned && <span className="tab-count" title={`${items.length} pinned`}>{items.length}</span>}</h2>
        {!collapsed && <span className="muted small view-hint">{pinned ? 'Right-click or drag to add · right-click here to remove' :'Right-click a card to show it · pin to keep several'}</span>}
        <span className="panel-head-tools">
          <button
            type="button" className={`icon-btn sm view-tool-btn view-pin-btn ${pinned ? 'on' : ''}`} aria-pressed={pinned}
            onClick={() => setPinned(!pinned)}
            title={pinned ? (items.length > 1 ? 'Unpin: keep only the card on show; right-click replaces it again' : 'Unpin: right-click replaces the card again') : 'Pin: right-click more cards to add them'}
            aria-label={pinned ? 'Unpin the view panel' : 'Pin the view panel'}
          ><PinIcon on={pinned} /></button>
          {!collapsed && (
            <button type="button" className="icon-btn sm view-tool-btn" onClick={() => setViewMode('collapsed')} title="Collapse the view panel" aria-label="Collapse the view panel"><Chevron dir="down" /></button>
          )}
          {collapsed && (
            <>
              <button type="button" className="icon-btn sm view-tool-btn" onClick={() => setViewMode('expanded')} title="Expand the view panel" aria-label="Expand the view panel"><Chevron dir="up" /></button>
              <button type="button" className="icon-btn sm view-tool-btn" onClick={() => setViewMode('hidden')} title="Hide the view panel for more room" aria-label="Hide the view panel"><Chevron dir="left" /></button>
            </>
          )}
          <button type="button" className="icon-btn sm view-tool-btn" onClick={closeView} aria-label="Close the view panel" title={pinned ? 'Close (removes every pinned card)' : 'Close'}>✕</button>
        </span>
      </div>

      {!collapsed && pinned && (
        <div className="pin-toolbar">
          <div className="status-toggle view-switch" role="radiogroup" aria-label="Show pinned cards as">
            {PIN_VIEWS.map((v) => (
              <button key={v.value} type="button" role="radio" aria-checked={view === v.value} title={v.title}
                className={`seg ${view === v.value ? 'on' : ''}`} onClick={() => setView(v.value)}>
                <span aria-hidden>{v.icon}</span> {v.label}
              </button>
            ))}
          </div>
          <select className="input input-sm" value={sort} onChange={(e) => setSort(e.target.value as PinSort)} aria-label="Sort pinned cards">
            {PIN_SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
          </select>
        </div>
      )}
      {!collapsed && pinned && view === 'card' && current && (
            <div className="pin-step">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => step(-1)} disabled={sorted.length < 2} aria-label="Previous pinned card" title="Previous (←)">‹</button>
              <span className="muted small">{index + 1} of {sorted.length}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => step(1)} disabled={sorted.length < 2} aria-label="Next pinned card" title="Next (→)">›</button>
              <button type="button" className="btn btn-ghost btn-sm pin-remove" onClick={() => removeCard(current.card.name)}
                aria-label={`Remove ${current.card.name} from the view panel`} title="Remove this card from the view panel">✕ Remove</button>
            </div>
      )}
      </div>

      {!collapsed && (!pinned || view === 'card') && current && (
        <div className="pin-card-view" onContextMenu={onCardViewContextMenu}>
          <CardView key={`${current.card.name}|${current.entryUid ?? ''}`} card={current.card} deckId={deck.id} entryUid={current.entryUid} />
        </div>
      )}

      {!collapsed && pinned && view !== 'card' && (
        <>
          {view === 'grid'
            ? <div className="results-grid">{shown.map((p) => <CardResult key={p.card.name} {...cardProps(p)} />)}</div>
            : <div className={`results-list ${view}`}>{shown.map((p) => <CardResultRow key={p.card.name} {...cardProps(p)} view={view} />)}</div>}
          {many && <div ref={sentinel} className="loading">Loading more…</div>}
        </>
      )}

      {tagging && <TagModal card={tagging} context={{ kind: 'deck', deckId: deck.id }} onClose={() => setTagging(null)} />}
      {collecting && <AddToCollectionModal card={collecting} deckId={deck.id} onClose={() => setCollecting(null)} />}
    </section>
  );
}
