import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import type { Board, Deck, DeckEntry, DeckFilter, TypeCategory } from '../types';
import { getFormat } from '../lib/formats';
import {
  boardCount, boardEntries, boardPrice, canBeCommander, cardImage, cardPrice, COLOR_NAMES, commanderEntry,
  entryCategory, formatUSD, manaCost, matchesFilter, sortEntries, TYPE_ORDER, type Validation,
} from '../lib/rules';
import { addCard, clearCommander, moveEntry, removeEntry, setCommander, setQty, toggleEntryFavorite } from '../lib/actions';
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
import { isCardDrag, readCardDrag } from '../lib/dnd';

interface Props {
  deck: Deck;
  validation: Validation;
  filter: DeckFilter;
  setFilter: (f: DeckFilter) => void;
  board: Board;
  setBoard: (b: Board) => void;
}

const BOARD_LABEL: Record<Board, string> = { main: 'Main', side: 'Sideboard', maybe: 'Maybeboard' };

export function DeckList({ deck, validation, filter, setFilter, board, setBoard }: Props) {
  const fmt = getFormat(deck.format);
  const [dragOver, setDragOver] = useState(false);
  const [dragTab, setDragTab] = useState<Board | null>(null);
  const [open, setOpen] = useState<DeckEntry | null>(null);
  const [preview, setPreview] = useState<{ src: string; x: number; y: number } | null>(null);
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

  // Typed query syntax (t:, tag:, is:fav…) runs through the local search engine; plain text stays a substring filter.
  const text = filter.text ?? '';
  const isQuery = looksLikeQuery(text);
  const parsed = useMemo(() => (isQuery ? parseQuery(text) : null), [isQuery, text]);
  const textFilter: DeckFilter = isQuery ? { ...filter, text: undefined } : filter;

  // Graph filters in the details panel describe the main deck; jump there when one is applied.
  useEffect(() => {
    if (filter.cmc != null || filter.type || filter.color) setBoard('main');
  }, [filter.cmc, filter.type, filter.color]);

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

  const groups = useMemo(() => {
    const m = new Map<TypeCategory, DeckEntry[]>();
    for (const e of entries) {
      const t = entryCategory(deck, e);
      if (!m.has(t)) m.set(t, []);
      m.get(t)!.push(e);
    }
    return TYPE_ORDER.filter((t) => m.has(t)).map((t) => ({ type: t, entries: m.get(t)! }));
  }, [entries, deck]);

  const hasFilter = filter.cmc != null || !!filter.type || !!filter.color || !!filter.text || favOnly;
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

  const showPreview = (e: MouseEvent, entry: DeckEntry) => {
    const src = cardImage(entry.card, 'normal');
    if (!src) return;
    const x = Math.min(e.clientX + 24, window.innerWidth - 270);
    const y = Math.min(Math.max(e.clientY - 170, 8), window.innerHeight - 360);
    setPreview({ src, x, y });
  };

  return (
    <section
      className={`panel deck-list-panel ${dragOver ? 'drop-target' : ''}`}
      onDragOver={(e) => onDragOver(e)} onDragLeave={onDragLeave} onDrop={(e) => onDrop(e)}
    >
      {fmt.hasCommander && (
        <div className={`commander-showcase ${cmd ? '' : 'empty'}`}>
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
                Open a legendary creature from search and click <b>Set as Commander</b>, or use ★ on a deck row.
                Its color identity will then limit search results and basic lands.
              </span>
            </div>
          )}
        </div>
      )}

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

      {dragOver && <div className="drop-hint">Drop to add to {BOARD_LABEL[dragTab ?? board]}</div>}

      <div className="list-toolbar">
        <input
          className="input input-sm" placeholder="Filter… (text, or t:creature cardtag:ramp is:owned)" value={filter.text ?? ''}
          onChange={(e) => setFilter({ ...filter, text: e.target.value || undefined })} aria-label="Filter deck list"
        />
        <SavedSearches query={filter.text ?? ''} onApply={(q) => setFilter({ ...filter, text: q })} />
        <button className={`chip ${favOnly ? 'chip-gold' : ''}`} onClick={() => setFavOnly((f) => !f)} aria-pressed={favOnly} title="Show favorites only">★</button>
        {board === 'main' && (
          <button className={`btn btn-sm ${showBasics ? 'btn-primary' : ''}`} onClick={() => setShowBasics((s) => !s)}>
            + Basic lands
          </button>
        )}
      </div>

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
          {filter.text && (
            <button className="chip chip-on" onClick={() => setFilter({ ...filter, text: undefined })}>“{filter.text}” ✕</button>
          )}
          {favOnly && <button className="chip chip-on" onClick={() => setFavOnly(false)}>★ Favorites ✕</button>}
          <button className="link-btn small" onClick={() => { setFilter({}); setFavOnly(false); }}>Clear all</button>
        </div>
      )}

      <div className="deck-groups" onMouseLeave={() => setPreview(null)}>
        {groups.length === 0 && (
          <div className="empty">
            {hasFilter ? 'No cards match the current filter.' : board === 'main' ? 'Your deck is empty. Search for cards to add them.' : `Nothing in the ${BOARD_LABEL[board].toLowerCase()} yet.`}
          </div>
        )}
        {groups.map((g) => {
          const count = g.entries.reduce((n, e) => n + e.qty, 0);
          const price = g.entries.reduce((n, e) => n + (cardPrice(e.card) ?? 0) * e.qty, 0);
          const isCollapsed = collapsed.has(g.type);
          return (
            <div key={g.type} className="deck-group">
              <button
                className="group-head"
                onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.type)) n.delete(g.type); else n.add(g.type); return n; })}
                aria-expanded={!isCollapsed}
              >
                <span className="caret">{isCollapsed ? '▸' : '▾'}</span>
                <span className="group-name">{g.type === 'Commander' && fmt.id === 'oathbreaker' ? 'Oathbreaker' : g.type}</span>
                <span className="group-count">{count}</span>
                <span className="group-price">{formatUSD(price)}</span>
              </button>
              {!isCollapsed && (
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
                        className={`entry ${problems ? 'has-problem' : ''}`}
                        onMouseMove={(ev) => showPreview(ev, e)}
                        onMouseLeave={() => setPreview(null)}
                      >
                        <div className="qty-ctrl">
                          <button className="icon-btn sm" onClick={() => setQty(deck.id, e.uid, e.qty - 1)} aria-label="Remove one">−</button>
                          <span className="qty">{e.qty}</span>
                          <button className="icon-btn sm" onClick={() => setQty(deck.id, e.uid, e.qty + 1)} disabled={isCmd} aria-label="Add one">+</button>
                        </div>
                        <div className="entry-main">
                          <button className="entry-name" onClick={() => { setPreview(null); setOpen(e); }}>
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
                          <TagList groups={[{ scope: 'global', tags: globalTags.get(e.card.name) ?? [] }, { scope: 'card', tags: e.tags ?? [] }]} max={3} onTagClick={onTagClick} />
                        </div>
                        <ManaCost cost={manaCost(e.card)} size={14} />
                        <span className="entry-price" title={p != null && e.qty > 1 ? `${formatUSD(p)} each` : undefined}>
                          {formatUSD(p != null ? p * e.qty : null)}
                        </span>
                        <div className="entry-actions">
                          <FavStar on={!!e.favorite} onToggle={() => toggleEntryFavorite(deck.id, e.uid)} />
                          <button className="icon-btn sm" title="Tag (card tags for this deck)" aria-label={`Tag ${e.card.name}`} onClick={() => { setPreview(null); setTagging(e); }}>🏷</button>
                          {own && own.missing > 0 && (
                            <button
                              className="icon-btn sm" title={`Mark ${own.missing} as purchased / owned — adds this print to your collection`}
                              aria-label={`Mark ${e.card.name} owned`} onClick={() => { setPreview(null); setBuying({ entry: e, qty: own.missing }); }}
                            >🛒</button>
                          )}
                          {fmt.hasCommander && board === 'main' && !isCmd && canBeCommander(e.card, fmt) && (
                            <button className="icon-btn sm" title="Set as commander" onClick={() => toast(setCommander(deck.id, e.card), 'success')}>★</button>
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

      {preview && (
        <img className="hover-preview" src={preview.src} style={{ left: preview.x, top: preview.y }} alt="" />
      )}

      {open && (
        <CardModal card={open.card} deckId={deck.id} entryUid={open.uid} onClose={() => setOpen(null)} />
      )}
      {tagging && <TagModal card={tagging.card} context={{ kind: 'deck', deckId: deck.id }} onClose={() => setTagging(null)} />}
      {buying && <AddToCollectionModal card={buying.entry.card} deckId={deck.id} qty={buying.qty} onClose={() => setBuying(null)} />}
    </section>
  );
}
