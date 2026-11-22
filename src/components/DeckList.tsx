import { entrySorter, groupByColors, SORT_OPTIONS, type SortBy } from '../lib/deckGroups';
import { useEffect, useMemo, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Board, Card, Deck, DeckEntry, DeckFilter, TypeCategory } from '../types';
import { getFormat } from '../lib/formats';
import {
  boardCount, boardEntries, boardPrice, canBeCommander, cardImage, cardPrice, COLOR_NAMES, commanderEntry,
  entryCategory, formatUSD, frontTypeLine, manaCost, matchesFilter, sortEntries, TYPE_ORDER, type Validation,
} from '../lib/rules';
import { addCard, clearCommander, moveEntry, removeEntry, setCommander, setMainTag, setQty, toggleEntryFavorite } from '../lib/actions';
import { looksLikeQuery, parseQuery } from '../lib/query';
import { useGlobalTags, usePool, useSubjects } from '../lib/hooks';
import { nameKey } from '../lib/ownership';
import { CardModal } from './CardModal';
import { ColorPips, ManaCost, ManaSymbol } from './Mana';
import { BasicLandAdder } from './BasicLandAdder';
import { TagModal } from './TagModal';
import { AddToCollectionModal } from './CollectionModals';
import { SavedSearches } from './SavedSearches';
import { FavStar, TagList, SCOPE_META, type TagScope } from './TagEditor';
import { useToast } from './Toast';
import { hideArt, hoverArt, hoverArtProps } from './HoverArt';
import { pinOnRightClick } from '../lib/viewPanel';
import { ENTRY_DRAG, isCardDrag, readCardDrag } from '../lib/dnd';
import { ManageScryfallTags } from './ScryfallTagSettings';
import { useScryfallTags, useScryfallTagStatus } from '../lib/scryfallTags';
import { defaultGroupTags, entryTags, groupByManaValue, groupByTag, mainGroup, OTHER_GROUP } from '../lib/deckTags';
import { GroupTagsModal, readGroupTags, saveGroupTags } from './GroupTagsModal';

interface Props {
  deck: Deck;
  validation: Validation;
  filter: DeckFilter;
  setFilter: (f: DeckFilter) => void;
  board: Board;
  setBoard: (b: Board) => void;
}

const BOARD_LABEL: Record<Board, string> = { main: 'Main', side: 'Sideboard', maybe: 'Maybeboard' };

type GroupBy = 'type' | 'tag' | 'mv' | 'identity' | 'color' | 'none';
const GROUP_BY_KEY = 'grimoire.deckGroupBy';
type DeckView = 'list' | 'grid' | 'table';
const VIEW_KEY = 'grimoire.deckView';
const SORT_KEY = 'grimoire.deckSort';
const DECK_VIEWS: { value: DeckView; label: string; icon: string }[] = [
  { value: 'list', label: 'List', icon: '☰' }, { value: 'grid', label: 'Grid', icon: '▦' }, { value: 'table', label: 'Table', icon: '▤' },
];
const readSetting = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
  try { const v = localStorage.getItem(k) as T | null; return v && allowed.includes(v) ? v : fallback; } catch { return fallback; }
};
const saveSetting = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* only this session remembers */ } };
/** Table columns; widths you drag are saved in this browser and shared by every group's table. */
const TABLE_COLS: { key: string; label: string; num?: boolean; title?: string }[] = [
  { key: 'qty', label: 'Qty', num: true }, { key: 'card', label: 'Card' }, { key: 'cost', label: 'Cost' }, { key: 'type', label: 'Type' },
  { key: 'tags', label: 'Tags' }, { key: 'price', label: 'Price', num: true }, { key: 'own', label: 'Own', title: 'Owned' },
];
const COL_KEY = 'grimoire.deckTableCols';
const COL_MIN = 32;
const COL_MAX = 640;
const readColWidths = (): Record<string, number> => {
  try {
    const v = JSON.parse(localStorage.getItem(COL_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter(([, w]) => typeof w === 'number' && w >= COL_MIN && w <= COL_MAX)) as Record<string, number>;
  } catch { return {}; }
};
const saveColWidths = (w: Record<string, number>) => { try { localStorage.setItem(COL_KEY, JSON.stringify(w)); } catch { /* only this session remembers */ } };
/** Tiles narrower than this show the card picture on hover too (it's hard to read small). */
const GRID_HOVER_BELOW = 170;

function readGroupBy(): GroupBy {
  try {
    const v = localStorage.getItem(GROUP_BY_KEY);
    return v === 'tag' || v === 'mv' || v === 'identity' || v === 'color' || v === 'none' ? v : 'type';
  } catch {
    return 'type';
  }
}

export function DeckList({ deck, validation, filter, setFilter, board, setBoard }: Props) {
  const fmt = getFormat(deck.format);
  const [dragOver, setDragOver] = useState(false);
  const [dragTab, setDragTab] = useState<Board | null>(null);
  const [open, setOpen] = useState<DeckEntry | null>(null);
  const [showBasics, setShowBasics] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [tagging, setTagging] = useState<DeckEntry | null>(null);
  const [buying, setBuying] = useState<{ entry: DeckEntry; qty: number } | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const toast = useToast();
  const cmd = commanderEntry(deck);
  const pool = usePool();
  const coverage = pool.byDeck.get(deck.id);
  const subjects = useSubjects();
  const globalTags = useGlobalTags();
  const stags = useScryfallTags();
  const stagStatus = useScryfallTagStatus();
  const [groupBy, setGroupByState] = useState<GroupBy>(readGroupBy);
  const [view, setViewState] = useState<DeckView>(() => readSetting(VIEW_KEY, ['list', 'grid', 'table'] as const, 'list'));
  const setView = (v: DeckView) => { setViewState(v); saveSetting(VIEW_KEY, v); };
  const [sortBy, setSortByState] = useState<SortBy>(() => readSetting(SORT_KEY, SORT_OPTIONS.map((o) => o.value), 'mv'));
  const [colWidths, setColWidths] = useState<Record<string, number>>(readColWidths);
  const setSortBy = (v: SortBy) => { setSortByState(v); saveSetting(SORT_KEY, v); };
  const setGroupBy = (g: GroupBy) => {
    setGroupByState(g);
    try { localStorage.setItem(GROUP_BY_KEY, g); } catch { /* storage unavailable: only this session remembers */ }
  };
  const [dragUid, setDragUid] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const [cmdDrop, setCmdDrop] = useState(false);

  // Typed query syntax (t:, tag:, is:fav…) runs through the local search engine; plain text stays a substring filter.
  const text = filter.text ?? '';
  const isQuery = looksLikeQuery(text);
  const parsed = useMemo(() => (isQuery ? parseQuery(text) : null), [isQuery, text]);
  const textFilter: DeckFilter = isQuery ? { ...filter, text: undefined } : filter;

  // Graph filters in the details panel describe the main deck; jump there when one is applied.
  useEffect(() => {
    if (filter.cmc != null || filter.type || filter.color || filter.producer) setBoard('main');
  }, [filter.cmc, filter.type, filter.color, filter.producer]);

  const entries = useMemo(
    () => boardEntries(deck, board)
      .filter((e) => matchesFilter(deck, e, textFilter))
      .filter((e) => !favOnly || e.favorite)
      .filter((e) => !parsed || parsed.test(subjects(e.card, { deckId: deck.id, entry: e })))
      .sort(sortEntries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deck, board, filter, parsed, subjects, favOnly],
  );
  const queryWarnings = parsed?.warnings ?? [];
  const onTagClick = (scope: TagScope, t: string) => setFilter({ ...filter, text: `${SCOPE_META[scope].key}:${/\s/.test(t) ? `"${t}"` : t}` });

  // Grouping by tag uses the tags chosen for this deck (saved in this browser), else the deck's most common ones.
  const [customTags, setCustomTags] = useState<string[] | null>(() => readGroupTags(deck.id));
  const [pickingTags, setPickingTags] = useState(false);
  const baseSrc = useMemo(() => ({ global: globalTags, scryfall: stags }), [globalTags, stags]);
  const defaultTags = useMemo(() => defaultGroupTags(deck, baseSrc), [deck, baseSrc]);
  const tagSrc = useMemo(() => ({ ...baseSrc, chosen: customTags ?? defaultTags }), [baseSrc, customTags, defaultTags]);
  const chooseTags = (tags: string[] | null) => { saveGroupTags(deck.id, tags); setCustomTags(tags); };
  const groups = useMemo((): { type: string; entries: DeckEntry[]; scryfall?: boolean }[] => {
    const sorter = entrySorter(sortBy);
    // No grouping: one list, the commander first.
    if (groupBy === 'none') {
      if (!entries.length) return [];
      const cmdFirst = (e: DeckEntry) => (e.uid === cmd?.uid ? 0 : 1);
      return [{ type: 'All cards', entries: [...entries].sort((a, b) => cmdFirst(a) - cmdFirst(b) || sorter(a, b)) }];
    }
    return grouped().map((g) => ({ ...g, entries: [...g.entries].sort(sorter) }));
  }, [entries, deck, groupBy, tagSrc, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps
  function grouped(): { type: string; entries: DeckEntry[]; scryfall?: boolean }[] {
    if (groupBy === 'identity' || groupBy === 'color') return groupByColors(deck, entries, groupBy).map((g) => ({ type: g.key, entries: g.entries }));
    if (groupBy === 'tag') return groupByTag(deck, entries, tagSrc).map((g) => ({ type: g.key, entries: g.entries, scryfall: g.scryfall }));
    if (groupBy === 'mv') return groupByManaValue(deck, entries).map((g) => ({ type: g.key, entries: g.entries }));
    const m = new Map<TypeCategory, DeckEntry[]>();
    for (const e of entries) {
      const t = entryCategory(deck, e);
      if (!m.has(t)) m.set(t, []);
      m.get(t)!.push(e);
    }
    return TYPE_ORDER.filter((t) => m.has(t)).map((t) => ({ type: t, entries: m.get(t)! }));
  }

  // Tag view: drag a row onto another tag it has to list it there (its main tag in this deck).
  const dragging = dragUid ? deck.entries.find((e) => e.uid === dragUid) : undefined;
  const dragTags = dragging ? entryTags(dragging, tagSrc).all : [];
  const canDropOn = (group: string) => groupBy === 'tag' && !!dragging && dragTags.includes(group) && mainGroup(deck, dragging, tagSrc) !== group;

  // Commander formats: drag a main-deck card (or a search result) onto the commander slot to make it the commander.
  const isCmdCandidate = (e: DeckEntry) => fmt.hasCommander && board === 'main' && e.uid !== cmd?.uid && canBeCommander(e.card, fmt);
  const draggingCandidate = !!dragging && isCmdCandidate(dragging);
  const makeCommander = (card: Card) => {
    if (!canBeCommander(card, fmt)) { toast(`${card.name} can't be ${fmt.id === 'oathbreaker' ? 'an Oathbreaker' : 'a commander'} in ${fmt.name}.`, 'error'); return; }
    toast(setCommander(deck.id, card), 'success');
  };
  const onCmdDragOver = (ev: DragEvent) => {
    const fromSearch = isCardDrag(ev.dataTransfer);
    if (!fromSearch && !(draggingCandidate && Array.from(ev.dataTransfer.types).includes(ENTRY_DRAG))) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = fromSearch ? 'copy' : 'move';
    if (dragOver) setDragOver(false);
    if (!cmdDrop) setCmdDrop(true);
  };
  const onCmdDragLeave = (ev: DragEvent) => {
    if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setCmdDrop(false);
  };
  const onCmdDrop = (ev: DragEvent) => {
    setCmdDrop(false);
    const card = readCardDrag(ev.dataTransfer) ?? (draggingCandidate ? dragging!.card : null);
    if (!card) return;
    ev.preventDefault();
    ev.stopPropagation();
    setDragOver(false);
    setDragUid(null);
    setDropGroup(null);
    makeCommander(card);
  };

  const hasFilter = filter.cmc != null || !!filter.type || !!filter.color || !!filter.producer || !!filter.text || favOnly;
  const shown = entries.reduce((n, e) => n + e.qty, 0);

  // Drop a search result on the list to add it to the board shown, or on a board tab to add it there.
  const onDragOver = (e: DragEvent, tab?: Board) => {
    if (!isCardDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
    if (tab !== undefined ? dragTab !== tab : dragTab !== null) setDragTab(tab ?? null);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setDragOver(false); setDragTab(null); }
  };
  const onDrop = (e: DragEvent, tab?: Board) => {
    setDragOver(false);
    setDragTab(null);
    const card = readCardDrag(e.dataTransfer);
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    const to = tab ?? board;
    toast(addCard(deck.id, card, 1, to), 'success');
    if (to !== board) setBoard(to);
  };

  /** What every view needs to know about a row. */
  const rowInfo = (e: DeckEntry) => {
    const own = board === 'maybe' ? undefined : coverage?.needs.get(nameKey(e.card));
    const ownState = !own ? 'skip' : own.missing === 0 ? 'full' : own.missing < own.need ? 'part' : 'none';
    const ownTitle = !own ? '' : own.missing === 0
      ? `Owned — ${own.manual ? `${own.manual} committed to this deck` : 'covered from your shared pool'}`
      : `${own.need - own.missing}/${own.need} available for this deck (shared pool) — ${own.missing} missing`;
    return { problems: validation.entryProblems[e.uid], isCmd: e.uid === cmd?.uid, price: cardPrice(e.card), ownState, ownTitle };
  };
  const ownMark = (state: string, title: string) => state === 'skip' ? null : (
    <span className={`own-mark ${state}`} title={title} aria-label={title}>{state === 'full' ? '✓' : state === 'part' ? '◐' : '○'}</span>
  );
  /**
   * Rows can be dragged (same in every view): onto the view panel to pin the card, onto another of
   * the card's tags when grouping by tag, and onto the commander slot when the card can be the commander.
   */
  const regroupDrag = (e: DeckEntry, isCmd: boolean) => {
    return {
      draggable: true,
      onDragStart: (ev: DragEvent) => {
        ev.dataTransfer.setData(ENTRY_DRAG, e.uid);
        ev.dataTransfer.setData('text/plain', e.card.name);
        ev.dataTransfer.effectAllowed = 'copyMove';
        hideArt();
        // The commander only goes to the view panel; it never regroups.
        if (!isCmd) setDragUid(e.uid);
      },
      onDragEnd: () => { setDragUid(null); setDropGroup(null); setCmdDrop(false); },
    };
  };
  const dragTitle = (e: DeckEntry, isCmd: boolean) => {
    if (isCmd) return undefined;
    const regroup = groupBy === 'tag' && entryTags(e, tagSrc).all.length > 1;
    const toCmd = isCmdCandidate(e);
    if (regroup && toCmd) return 'Drag onto another of its tags to list it there, or onto the commander slot';
    if (regroup) return 'Drag onto another of its tags to list it there, or onto the view panel to pin it';
    if (toCmd) return `Drag onto the ${fmt.id === 'oathbreaker' ? 'Oathbreaker' : 'commander'} slot to make it your ${fmt.id === 'oathbreaker' ? 'Oathbreaker' : 'commander'}`;
    return undefined;
  };

  /** Grid: full card pictures, several per row. The picture shows on hover only when tiles are small. */
  const renderGrid = (list: DeckEntry[]) => (
    <div className="entry-grid">
      {list.map((e) => {
        const { problems, isCmd, price, ownState, ownTitle } = rowInfo(e);
        const img = cardImage(e.card, 'normal');
        return (
          <div key={e.uid} className={`grid-tile ${problems ? 'has-problem' : ''} ${dragUid === e.uid ? 'dragging' : ''}`}
            {...regroupDrag(e, isCmd)}
            onContextMenu={pinOnRightClick(e.card, e.uid, hideArt)}
            onMouseMove={(ev) => { if (ev.currentTarget.clientWidth < GRID_HOVER_BELOW) hoverArt(e.card, ev.clientX, ev.clientY); }}
            onMouseLeave={hideArt}
            title={`${e.card.name}${problems ? `\n⚠ ${problems.join('\n')}` : ''}`}>
            <button type="button" className="grid-img-btn" onClick={() => { hideArt(); setOpen(e); }} aria-label={`Open ${e.card.name}`}>
              {img ? <img src={img} alt={e.card.name} loading="lazy" draggable={false} /> : <span className="card-img-missing">{e.card.name}</span>}
            </button>
            <span className="grid-badges">
              {e.qty > 1 && <span className="grid-qty">{e.qty}×</span>}
              {isCmd && <span className="grid-cmd" title="Commander">★</span>}
              {problems && <span className="grid-problem">⚠</span>}
            </span>
            <span className="grid-own">{ownMark(ownState, ownTitle)}</span>
            <div className="grid-actions">
              <button className="mini-btn" onClick={() => setQty(deck.id, e.uid, e.qty - 1)} aria-label={`Remove one ${e.card.name}`} title="Remove one">−</button>
              <button className="mini-btn" onClick={() => setQty(deck.id, e.uid, e.qty + 1)} disabled={isCmd} aria-label={`Add one ${e.card.name}`} title="Add one">+</button>
              <span className="grid-price">{formatUSD(price != null ? price * e.qty : null)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  /** Drag a header's right edge to resize that column (all groups' tables share the widths). */
  const startResize = (key: string) => (ev: ReactPointerEvent<HTMLSpanElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    const handle = ev.currentTarget;
    const th = handle.parentElement as HTMLElement;
    const startX = ev.clientX;
    const startW = th.getBoundingClientRect().width;
    handle.setPointerCapture(ev.pointerId);
    let latest = startW;
    const move = (m: PointerEvent) => {
      latest = Math.round(Math.min(COL_MAX, Math.max(COL_MIN, startW + m.clientX - startX)));
      setColWidths((w) => ({ ...w, [key]: latest }));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setColWidths((w) => { const next = { ...w, [key]: latest }; saveColWidths(next); return next; });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  const resetColumn = (key: string) => setColWidths((w) => { const next = { ...w }; delete next[key]; saveColWidths(next); return next; });

  /** Table: one row per card with more columns; up to 3 tags. */
  const renderTable = (list: DeckEntry[]) => (
    <table className="color-table deck-table">
      <thead>
        <tr>
          {TABLE_COLS.map((c) => (
            <th key={c.key} className={c.num ? 'num' : undefined} title={c.title} style={colWidths[c.key] ? { width: colWidths[c.key] } : undefined}>
              {c.label}
              <span className="col-resizer" role="separator" aria-orientation="vertical" aria-label={`Resize the ${c.label} column`}
                title="Drag to resize · double-click to reset" onPointerDown={startResize(c.key)} onDoubleClick={() => resetColumn(c.key)}
                onClick={(ev) => ev.stopPropagation()} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {list.map((e) => {
          const { problems, isCmd, price, ownState, ownTitle } = rowInfo(e);
          return (
            <tr key={e.uid} className={`clickable ${problems ? 'has-problem' : ''}`} {...hoverArtProps(e.card)} {...regroupDrag(e, isCmd)}
              onContextMenu={pinOnRightClick(e.card, e.uid, hideArt)} onClick={() => { hideArt(); setOpen(e); }}>
              <td className="num">{e.qty}</td>
              <td>
                <span className="deck-table-name">
                  {isCmd && <span className="cmd-star" title="Commander">★</span>}
                  <span className="truncate">{e.card.name}</span>
                  {problems && <span className="problem-icon" title={problems.join('\n')}>⚠</span>}
                </span>
              </td>
              <td><ManaCost cost={manaCost(e.card)} size={13} /></td>
              <td className="deck-table-type"><span className="truncate">{frontTypeLine(e.card)}</span></td>
              <td onClick={(ev) => ev.stopPropagation()}>
                <TagList groups={[{ scope: 'global', tags: globalTags.get(e.card.name) ?? [] }, { scope: 'card', tags: e.tags ?? [] }, { scope: 'scryfall', tags: entryTags(e, tagSrc).scryfall }]} max={3} onTagClick={onTagClick} />
              </td>
              <td className="num">{formatUSD(price != null ? price * e.qty : null)}</td>
              <td>{ownMark(ownState, ownTitle)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <section
      className={`panel deck-list-panel ${dragOver ? 'drop-target' : ''}`}
      onDragOver={(e) => onDragOver(e)} onDragLeave={onDragLeave} onDrop={(e) => onDrop(e)}
    >
      {fmt.hasCommander && (
        <div className={`commander-showcase ${cmd ? '' : 'empty'} ${draggingCandidate ? 'cmd-drop-ok' : ''} ${cmdDrop ? 'cmd-drop-hover' : ''}`}
          onDragOver={onCmdDragOver} onDragLeave={onCmdDragLeave} onDrop={onCmdDrop}>
          {cmdDrop && <div className="cmd-drop-hint">Drop to make it your {fmt.id === 'oathbreaker' ? 'Oathbreaker' : 'commander'}</div>}
          {cmd ? (
            <>
              <img className="commander-art" src={cardImage(cmd.card, 'art_crop')} alt="" />
              <div className="commander-overlay">
                <div className="commander-label">★ {fmt.id === 'oathbreaker' ? 'Oathbreaker' : 'Commander'}</div>
                <button className="commander-name" onClick={() => setOpen(cmd)}>{cmd.card.name}</button>
                <div className="commander-meta">
                  <ManaCost cost={manaCost(cmd.card)} size={16} />
                  <span className="commander-type">{cmd.card.type_line}</span>
                </div>
                <div className="commander-identity">
                  <span className="label">Color identity</span>
                  <ColorPips colors={cmd.card.color_identity} size={20} />
                </div>
              </div>
            </>
          ) : (
            <div className="commander-empty">
              <span className="commander-label">★ No commander selected</span>
              <span className="muted small">
                Drag a legendary creature here from search or the deck list, open it and click <b>Set as Commander</b>, or use ★ on a deck row.
                Its color identity will then limit search results and basic lands.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Pinned to the top of the panel while the cards scroll. */}
      <div className="panel-controls">
      <div className="board-tabs" role="tablist">
        {(['main', 'side', 'maybe'] as Board[]).map((b) => (
          <button
            key={b} role="tab" aria-selected={board === b} className={`tab ${board === b ? 'active' : ''} ${dragTab === b ? 'drop-hover' : ''}`} onClick={() => setBoard(b)}
            onDragOver={(e) => { e.stopPropagation(); onDragOver(e, b); }} onDrop={(e) => onDrop(e, b)}
          >
            {BOARD_LABEL[b]} <span className="tab-count">{boardCount(deck, b)}</span>
          </button>
        ))}
        <span className="board-price">{formatUSD(boardPrice(deck, board))}</span>
      </div>

      <div className="list-toolbar">
        <input
          className="input input-sm" placeholder="Filter… (text, or t:creature cardtag:ramp is:owned)" value={filter.text ?? ''}
          onChange={(e) => setFilter({ ...filter, text: e.target.value || undefined })} aria-label="Filter deck list"
        />
        <SavedSearches query={filter.text ?? ''} onApply={(q) => setFilter({ ...filter, text: q })} />
        <label className="group-by">
          <span className="muted">Group by:</span>
          <select className="input input-sm group-by-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label="Group cards by">
            <option value="type">Type</option>
            <option value="tag">Tag</option>
            <option value="mv">Mana value</option>
            <option value="identity">Color identity</option>
            <option value="color">Color</option>
            <option value="none">None</option>
          </select>
          {groupBy === 'tag' && (
            <button type="button" className="icon-btn sm group-tags-btn" title="Choose which tags become sections" aria-label="Choose tags to group by" onClick={() => setPickingTags(true)}>⚙</button>
          )}
          {groupBy === 'tag' && customTags && (
            <button type="button" className="link-btn small" title="Go back to the deck's most common tags" onClick={() => chooseTags(null)}>Reset tags</button>
          )}
          {groupBy === 'tag' && <ManageScryfallTags />}
        </label>
        <label className="group-by">
          <span className="muted">Sort:</span>
          <select className="input input-sm group-by-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} aria-label="Sort cards by">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className="status-toggle view-switch" role="radiogroup" aria-label="Show the deck as">
          {DECK_VIEWS.map((v) => (
            <button key={v.value} type="button" role="radio" aria-checked={view === v.value} title={v.label}
              className={`seg ${view === v.value ? 'on' : ''}`} onClick={() => setView(v.value)}><span aria-hidden>{v.icon}</span> {v.label}</button>
          ))}
        </div>
        <button className={`chip ${favOnly ? 'chip-gold' : ''}`} onClick={() => setFavOnly((f) => !f)} aria-pressed={favOnly} title="Show favorites only">★</button>
        {board === 'main' && (
          <button className={`btn btn-sm ${showBasics ? 'btn-primary' : ''}`} onClick={() => setShowBasics((s) => !s)}>
            + Basic lands
          </button>
        )}
      </div>
      </div>

      {dragOver && <div className="drop-hint">Drop to add to {BOARD_LABEL[dragTab ?? board]}</div>}

      {showBasics && board === 'main' && <BasicLandAdder deck={deck} onDone={() => setShowBasics(false)} />}

      {coverage && coverage.totalNeed > 0 && board !== 'maybe' && (
        <div className="own-summary">
          <span className={`own-dot ${coverage.complete ? 'full' : coverage.covered ? 'part' : 'none'}`} aria-hidden />
          <span>
            <b>{coverage.covered}/{coverage.totalNeed}</b> cards owned
            {coverage.missing > 0 && <span className="muted"> · {coverage.missing} missing (~{formatUSD(coverage.missingCost)})</span>}
          </span>
        </div>
      )}
      {queryWarnings.length > 0 && <div className="warn-text small">{queryWarnings.join(' · ')}</div>}
      {groupBy === 'tag' && stagStatus.state === 'error' && (
        <div className="muted small">Scryfall tags couldn't be loaded. Reload the page to try again.</div>
      )}

      {hasFilter && (
        <div className="active-filters">
          <span className="muted small">Showing {shown} card{shown === 1 ? '' : 's'}:</span>
          {filter.cmc != null && (
            <button className="chip chip-on" onClick={() => setFilter({ ...filter, cmc: undefined })}>
              Mana value {filter.cmc === 7 ? '7+' : filter.cmc} ✕
            </button>
          )}
          {filter.type && (
            <button className="chip chip-on" onClick={() => setFilter({ ...filter, type: undefined })}>{filter.type} ✕</button>
          )}
          {filter.color && (
            <button className="chip chip-on" onClick={() => setFilter({ ...filter, color: undefined })}>
              <ManaSymbol symbol={filter.color} size={13} /> {COLOR_NAMES[filter.color]} ✕
            </button>
          )}
          {filter.producer && (
            <button className="chip chip-on" onClick={() => setFilter({ ...filter, producer: undefined })}>
              {{ all: 'Mana producers', rock: 'Mana rocks', dork: 'Mana dorks', other: 'Other mana producers' }[filter.producer]} ✕
            </button>
          )}
          {filter.text && (
            <button className="chip chip-on" onClick={() => setFilter({ ...filter, text: undefined })}>“{filter.text}” ✕</button>
          )}
          {favOnly && <button className="chip chip-on" onClick={() => setFavOnly(false)}>★ Favorites ✕</button>}
          <button className="link-btn small" onClick={() => { setFilter({}); setFavOnly(false); }}>Clear all</button>
        </div>
      )}

      <div className="deck-groups" onMouseLeave={hideArt}>
        {groups.length === 0 && (
          <div className="empty">
            {hasFilter ? 'No cards match the current filter.' : board === 'main' ? 'Your deck is empty. Search for cards to add them.' : `Nothing in the ${BOARD_LABEL[board].toLowerCase()} yet.`}
          </div>
        )}
        {groups.map((g) => {
          const count = g.entries.reduce((n, e) => n + e.qty, 0);
          const price = g.entries.reduce((n, e) => n + (cardPrice(e.card) ?? 0) * e.qty, 0);
          const isCollapsed = collapsed.has(g.type);
          const droppable = canDropOn(g.type);
          const isTagGroup = groupBy === 'tag' && !['Commander', 'Lands', 'Untagged', OTHER_GROUP].includes(g.type);
          return (
            <div
              key={g.type}
              className={`deck-group ${droppable ? 'tag-drop-ok' : ''} ${droppable && dropGroup === g.type ? 'tag-drop-hover' : ''}`}
              onDragOver={(ev) => {
                if (!droppable || !Array.from(ev.dataTransfer.types).includes(ENTRY_DRAG)) return;
                ev.preventDefault();
                ev.stopPropagation();
                ev.dataTransfer.dropEffect = 'move';
                if (dropGroup !== g.type) setDropGroup(g.type);
              }}
              onDrop={(ev) => {
                if (!droppable || !dragUid) return;
                ev.preventDefault();
                ev.stopPropagation();
                setMainTag(deck.id, dragUid, g.type);
                setDragUid(null);
                setDropGroup(null);
              }}
            >
              {groupBy !== 'none' && <button
                className="group-head"
                onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.type)) n.delete(g.type); else n.add(g.type); return n; })}
                aria-expanded={!isCollapsed}
              >
                <span className="caret">{isCollapsed ? '▸' : '▾'}</span>
                <span className="group-name">
                  {isTagGroup && <span className={`tag-icon group-tag-icon ${g.scryfall ? 'scryfall' : ''}`} aria-hidden>{g.scryfall ? SCOPE_META.scryfall.icon : SCOPE_META.card.icon}</span>}
                  {g.type === 'Commander' && fmt.id === 'oathbreaker' ? 'Oathbreaker' : isTagGroup ? g.type.replace(/^./, (c) => c.toUpperCase()) : g.type}
                </span>
                <span className="group-count">{count}</span>
                <span className="group-price">{formatUSD(price)}</span>
              </button>}
              {!isCollapsed && view === 'grid' && renderGrid(g.entries)}
              {!isCollapsed && view === 'table' && renderTable(g.entries)}
              {!isCollapsed && view === 'list' && (
                <ul className="entries">
                  {g.entries.map((e) => {
                    const problems = validation.entryProblems[e.uid];
                    const isCmd = e.uid === cmd?.uid;
                    const p = cardPrice(e.card);
                    const own = board === 'maybe' ? undefined : coverage?.needs.get(nameKey(e.card));
                    const ownState = !own ? 'skip' : own.missing === 0 ? 'full' : own.missing < own.need ? 'part' : 'none';
                    const ownTitle = !own ? '' : own.missing === 0
                      ? `Owned — ${own.manual ? `${own.manual} committed to this deck` : 'covered from your shared pool'}`
                      : `${own.need - own.missing}/${own.need} available for this deck (shared pool) — ${own.missing} missing`;
                    return (
                      <li
                        key={e.uid}
                        className={`entry ${problems ? 'has-problem' : ''} ${dragUid === e.uid ? 'dragging' : ''}`}
                        {...hoverArtProps(e.card)}
                        onContextMenu={pinOnRightClick(e.card, e.uid, hideArt)}
                        {...regroupDrag(e, isCmd)}
                        title={dragTitle(e, isCmd)}
                      >
                        <div className="qty-ctrl">
                          <button className="icon-btn sm" onClick={() => setQty(deck.id, e.uid, e.qty - 1)} aria-label="Remove one">−</button>
                          <span className="qty">{e.qty}</span>
                          <button className="icon-btn sm" onClick={() => setQty(deck.id, e.uid, e.qty + 1)} disabled={isCmd} aria-label="Add one">+</button>
                        </div>
                        <div className="entry-main">
                          <button className="entry-name" onClick={() => { hideArt(); setOpen(e); }}>
                            {ownState !== 'skip' && (
                              <span className={`own-mark ${ownState}`} title={ownTitle} aria-label={ownTitle}>
                                {ownState === 'full' ? '✓' : ownState === 'part' ? '◐' : '○'}
                              </span>
                            )}
                            {isCmd && <span className="cmd-star" title="Commander">★</span>}
                            <span className="truncate">{e.card.name}</span>
                            {e.favorite && <span className="fav-inline" title="Favorite">★</span>}
                            {problems && <span className="problem-icon" title={problems.join('\n')}>⚠</span>}
                          </button>
                          <TagList groups={[{ scope: 'global', tags: globalTags.get(e.card.name) ?? [] }, { scope: 'card', tags: e.tags ?? [] }, { scope: 'scryfall', tags: entryTags(e, tagSrc).scryfall }]} max={3} onTagClick={onTagClick} />
                        </div>
                        <ManaCost cost={manaCost(e.card)} size={14} />
                        <span className="entry-price" title={p != null && e.qty > 1 ? `${formatUSD(p)} each` : undefined}>
                          {formatUSD(p != null ? p * e.qty : null)}
                        </span>
                        <div className="entry-actions">
                          <FavStar on={!!e.favorite} onToggle={() => toggleEntryFavorite(deck.id, e.uid)} />
                          <button className="icon-btn sm" title="Tag (card tags for this deck)" aria-label={`Tag ${e.card.name}`} onClick={() => { hideArt(); setTagging(e); }}>🏷</button>
                          {own && own.missing > 0 && (
                            <button
                              className="icon-btn sm" title={`Mark ${own.missing} as purchased / owned — adds this print to your collection`}
                              aria-label={`Mark ${e.card.name} owned`} onClick={() => { hideArt(); setBuying({ entry: e, qty: own.missing }); }}
                            >🛒</button>
                          )}
                          {fmt.hasCommander && board === 'main' && !isCmd && canBeCommander(e.card, fmt) && (
                            <button className="icon-btn sm" title="Set as commander" onClick={() => makeCommander(e.card)}>★</button>
                          )}
                          {isCmd && (
                            <button className="icon-btn sm" title="Unset commander" onClick={() => clearCommander(deck.id)}>☆</button>
                          )}
                          <select
                            className="move-select" value="" aria-label="Move to board"
                            onChange={(ev) => { moveEntry(deck.id, e.uid, ev.target.value as Board); toast(`Moved ${e.card.name} to ${BOARD_LABEL[ev.target.value as Board]}`); }}
                          >
                            <option value="" disabled>⇄</option>
                            {(['main', 'side', 'maybe'] as Board[]).filter((b) => b !== board).map((b) => (
                              <option key={b} value={b}>Move to {BOARD_LABEL[b]}</option>
                            ))}
                          </select>
                          <button className="icon-btn sm danger" title="Remove" onClick={() => removeEntry(deck.id, e.uid)}>🗑</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {pickingTags && (
        <GroupTagsModal deck={deck} src={baseSrc} selected={tagSrc.chosen} defaults={defaultTags}
          onApply={(tags) => { chooseTags(tags); setPickingTags(false); }} onClose={() => setPickingTags(false)} />
      )}

      {open && (
        <CardModal card={open.card} deckId={deck.id} entryUid={open.uid} onClose={() => setOpen(null)}
          siblings={groups.flatMap((g) => g.entries).map((x) => ({ card: x.card, entryUid: x.uid }))} />
      )}
      {tagging && <TagModal card={tagging.card} context={{ kind: 'deck', deckId: deck.id }} onClose={() => setTagging(null)} />}
      {buying && <AddToCollectionModal card={buying.entry.card} deckId={deck.id} qty={buying.qty} onClose={() => setBuying(null)} />}
    </section>
  );
}
