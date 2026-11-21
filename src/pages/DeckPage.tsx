import { ViewPanel } from '../components/ViewPanel';
import { hostViewPanel, usePinned } from '../lib/viewPanel';
import { useEffect, useMemo, useState } from 'react';
import type { Board, DeckFilter } from '../types';
import { useDeck, updateDeck, deleteDeck } from '../lib/store';
import { FORMATS, getFormat } from '../lib/formats';
import { boardCount, boardPrice, commanderEntry, formatUSD, validateDeck } from '../lib/rules';
import { refreshPrices, setDeckTags, toggleDeckFavorite } from '../lib/actions';
import { useAllDeckTags } from '../lib/hooks';
import { FavStar, TagEditor } from '../components/TagEditor';
import { SearchPanel, type SearchMode } from '../components/SearchPanel';
import { DeckList } from '../components/DeckList';
import { DeckDetails } from '../components/DeckDetails';
import { ImportExportModal } from '../components/ImportExportModal';
import { ColorPips } from '../components/Mana';
import { navigate } from '../lib/router';
import { clearPendingImport, onCardSearchRequest, peekPendingImport, requestCardSearch } from '../lib/searchBus';
import { Modal } from '../components/Modal';
import { ImportResultView } from '../components/ImportResult';
import { CompareModal, DeckHistoryModal } from '../components/DeckHistory';

const DAY = 24 * 60 * 60 * 1000;
type MobileTab = 'search' | 'deck' | 'details';

export function DeckPage({ id }: { id: string }) {
  const deck = useDeck(id);
  const [filter, setFilter] = useState<DeckFilter>({});
  // The board shown in the deck list; search adds (+ and drag and drop) go to it.
  const [board, setBoard] = useState<Board>('main');
  const [ie, setIe] = useState<'import' | 'export' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState(false);
  // Compare window: open with an optional starting B side ('snap:<id>' / 'deck:<id>').
  const [compare, setCompare] = useState<{ initial?: string } | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('deck');
  // Card Search can be hidden to give the deck list and Metrics more room (remembered in this browser).
  const [searchMode, setSearchModeState] = useState<SearchMode>(() => {
    try {
      const m = localStorage.getItem('grimoire.searchMode');
      if (m === 'expanded' || m === 'collapsed' || m === 'hidden') return m;
      return localStorage.getItem('grimoire.searchHidden') === '1' ? 'hidden' : 'expanded';
    } catch { return 'expanded'; }
  });
  const setSearchMode = (m: SearchMode) => {
    setSearchModeState(m);
    try { localStorage.setItem('grimoire.searchMode', m); localStorage.removeItem('grimoire.searchHidden'); } catch { /* session only */ }
  };
  const searchHidden = searchMode === 'hidden';
  const pinned = usePinned();
  useEffect(() => hostViewPanel(), []);
  const validation = useMemo(() => (deck ? validateDeck(deck) : null), [deck]);
  const allDeckTags = useAllDeckTags();
  // Result of a main-menu import that created this deck (only shown when cards were missing).
  const [imported, setImported] = useState(() => peekPendingImport(id));
  const closeImported = () => { clearPendingImport(id); setImported(undefined); };
  // A 'Search' request (from an import result) should show the search column on phones.
  useEffect(() => onCardSearchRequest(() => setMobileTab('search')), []);

  // Refresh stale prices once when the deck is opened.
  useEffect(() => {
    if (deck && deck.entries.length && (!deck.pricesUpdatedAt || Date.now() - deck.pricesUpdatedAt > DAY)) {
      refreshPrices(deck.id).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!deck || !validation) {
    return (
      <div className="page-center">
        <p>Deck not found.</p>
        <button className="btn" onClick={() => navigate('/')}>Back to library</button>
      </div>
    );
  }

  const fmt = getFormat(deck.format);
  const count = boardCount(deck, 'main');
  const cmd = commanderEntry(deck);
  const setFilterAndShow = (f: DeckFilter) => {
    setFilter(f);
    if (f.cmc != null || f.type || f.color) setMobileTab('deck');
  };

  return (
    <div className="deck-page">
      <header className="deck-header">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>← Library</button>
        <FavStar on={!!deck.favorite} onToggle={() => toggleDeckFavorite(deck.id)} size="md" label="favorite deck" />
        <input
          className="deck-name-input" value={deck.name} aria-label="Deck name"
          onChange={(e) => updateDeck(deck.id, (d) => { d.name = e.target.value; })}
        />
        {cmd && <ColorPips colors={cmd.card.color_identity} size={18} />}
        <select
          className="input input-sm" value={deck.format} aria-label="Format"
          onChange={(e) => updateDeck(deck.id, (d) => { d.format = e.target.value; })}
        >
          {(['Commander', 'Constructed', 'Digital', 'Other'] as const).map((g) => (
            <optgroup key={g} label={g}>
              {FORMATS.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </optgroup>
          ))}
        </select>
        <div className="status-toggle" role="radiogroup" aria-label="Deck status">
          {(['in-progress', 'finished'] as const).map((s) => (
            <button
              key={s} role="radio" aria-checked={deck.status === s}
              className={`seg ${deck.status === s ? 'on' : ''}`}
              onClick={() => updateDeck(deck.id, (d) => { d.status = s; })}
            >
              {s === 'in-progress' ? 'In progress' : 'Finished'}
            </button>
          ))}
        </div>
        <div className="header-stats">
          <span className={`header-count ${fmt.exact && count === fmt.deckSize ? 'done' : ''} ${fmt.exact && count > fmt.deckSize ? 'over' : ''}`}>
            {count}/{fmt.deckSize}
          </span>
          <span className="header-price">{formatUSD(boardPrice(deck, 'main'))}</span>
          <span className={`legal-dot ${validation.legal ? 'ok' : 'bad'}`} title={validation.legal ? 'Deck is legal' : 'Deck has issues — see Metrics'} />
        </div>
        <div className="header-actions">
          <button className="btn btn-sm" onClick={() => setHistory(true)} title="Changelog and snapshots">History</button>
          <button className="btn btn-sm" onClick={() => setCompare({})} title="Compare with a snapshot or another deck">Compare</button>
          <button className="btn btn-sm" onClick={() => setIe('import')}>Import</button>
          <button className="btn btn-sm" onClick={() => setIe('export')}>Export</button>
          {confirmDelete ? (
            <>
              <span className="small">Delete this deck?</span>
              <button className="btn btn-sm btn-danger" onClick={async () => { await deleteDeck(deck.id); navigate('/'); }}>Delete</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
            </>
          ) : (
            <button className="btn btn-sm btn-danger-outline" onClick={() => setConfirmDelete(true)}>🗑 Delete deck</button>
          )}
        </div>
      </header>
      <div className="deck-tags-row">
        <span className="label">▣ Deck tags</span>
        <TagEditor
          scope="deck" tags={deck.tags ?? []} onChange={(t) => setDeckTags(deck.id, t)} placeholder="Add deck tag… (cedh, budget, tribal)"
          suggestions={[{ label: 'Your deck tags', tags: allDeckTags }]}
        />
      </div>

      <nav className="mobile-tabs">
        {(['search', 'deck', 'details'] as MobileTab[]).map((t) => (
          <button key={t} className={`tab ${mobileTab === t ? 'active' : ''}`} onClick={() => setMobileTab(t)}>
            {t === 'search' ? 'Search' : t === 'deck' ? `Deck (${count})` : 'Metrics'}
          </button>
        ))}
      </nav>

      <div className={`deck-workspace show-${mobileTab} search-${searchMode} ${pinned ? 'has-view' : ''}`}>
        <div className="col col-search">
          {searchHidden ? (
            <button type="button" className="search-rail" onClick={() => setSearchMode('collapsed')} title="Show Card Search" aria-label="Show Card Search">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4" /></svg><span className="search-rail-label">Card Search</span>
            </button>
          ) : <SearchPanel deck={deck} board={board} mode={searchMode} onMode={setSearchMode} />}
          <ViewPanel deck={deck} />
        </div>
        <div className="col col-deck"><DeckList deck={deck} validation={validation} filter={filter} setFilter={setFilter} board={board} setBoard={setBoard} /></div>
        <div className="col col-details"><DeckDetails deck={deck} validation={validation} filter={filter} setFilter={setFilterAndShow} /></div>
      </div>

      {history && <DeckHistoryModal deck={deck} onClose={() => setHistory(false)} onCompare={(snapId) => { setHistory(false); setCompare({ initial: `snap:${snapId}` }); }} />}
      {compare && <CompareModal deck={deck} initial={compare.initial} onClose={() => setCompare(null)} />}
      {ie && <ImportExportModal deck={deck} initialTab={ie} onClose={() => setIe(null)} />}
      {imported && imported.missing.length > 0 && (
        <Modal onClose={closeImported} title="Import result">
          <ImportResultView result={imported} onSearch={(name) => { closeImported(); requestCardSearch(name); }} />
          <div className="ie-actions"><button className="btn btn-primary" onClick={closeImported}>Done</button></div>
        </Modal>
      )}
    </div>
  );
}
