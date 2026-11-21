import { useEffect, useRef, useMemo, useState, type FormEvent } from 'react';
import { onCardSearchRequest } from '../lib/searchBus';
import type { Board, Card, Deck } from '../types';
import { SORT_ORDERS, type SortOrder } from '../lib/scryfall';
import { buildAdvanced, countAdvanced, EMPTY_ADV, type Adv } from '../lib/advanced';
import { AdvancedSearch } from './AdvancedSearch';
import { TagBrowser } from './TagBrowser';
import { getFormat } from '../lib/formats';
import { deckIdentity } from '../lib/rules';
import { addCard } from '../lib/actions';
import { appendResults, hybridMore, hybridSearch } from '../lib/search';
import { useSubjects } from '../lib/hooks';
import { CardModal } from './CardModal';
import { CardResult } from './CardResult';
import { TagModal } from './TagModal';
import { AddToCollectionModal } from './CollectionModals';
import { SavedSearches } from './SavedSearches';
import { SCOPE_META, type TagScope } from './TagEditor';
import { ColorPips } from './Mana';
import { useToast } from './Toast';

/** Quick searches for the most played cards (Scryfall's EDHREC order) within the deck's colours and format. */
const POPULAR = {
  staples: { label: '★ Popular staples', query: '-t:land', title: 'Most played nonland cards in your colours (by EDHREC popularity)' },
  lands: { label: '★ Popular lands', query: 't:land -t:basic', title: 'Most played nonbasic lands in your colours (by EDHREC popularity)' },
} as const;

const BOARD_NAME: Record<Board, { full: string; short: string }> = {
  main: { full: 'main deck', short: 'in deck' },
  side: { full: 'sideboard', short: 'in side' },
  maybe: { full: 'maybeboard', short: 'in maybe' },
};

/** Card search on the deck page. The + button and drag and drop add to the board shown in the deck list. */
export function SearchPanel({ deck, board = 'main' }: { deck: Deck; board?: Board }) {
  const fmt = getFormat(deck.format);
  const identity = deckIdentity(deck);
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [adv, setAdv] = useState<Adv>(EMPTY_ADV);
  const [showAdv, setShowAdv] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const [useIdentity, setUseIdentity] = useState(true);
  const [useLegal, setUseLegal] = useState(true);
  const [order, setOrder] = useState<SortOrder>('edhrec');
  const [results, setResults] = useState<Card[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Card | null>(null);
  const [tagging, setTagging] = useState<Card | null>(null);
  const [collecting, setCollecting] = useState<Card | null>(null);
  const [local, setLocal] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const subjects = useSubjects();
  const subjectFor = (c: Card) => subjects(c, { deckId: deck.id });

  const constraints = useMemo(() => {
    const c: string[] = [];
    if (useIdentity && identity) c.push(identity.length ? `id<=${identity.join('').toLowerCase()}` : 'id:c');
    if (useLegal && fmt.searchKey) c.push(`f:${fmt.searchKey}`);
    return c.join(' ');
  }, [useIdentity, identity, useLegal, fmt.searchKey]);

  const userQuery = [query.trim(), buildAdvanced(adv)].filter(Boolean).join(' ');
  const fullQuery = [userQuery, favOnly ? 'is:fav' : '', constraints].filter(Boolean).join(' ');

  const inDeck = useMemo(() => {
    const m = new Map<string, number>();
    deck.entries.forEach((e) => e.board === board && m.set(e.card.name, (m.get(e.card.name) ?? 0) + e.qty));
    return m;
  }, [deck.entries, board]);
  // Cards already in the deck (any board) are shown greyed out rather than hidden.
  const inAnyBoard = useMemo(() => new Set(deck.entries.map((e) => e.card.name)), [deck.entries]);

  const run = async (base = userQuery, extra = constraints, fav = favOnly, sortBy: SortOrder = order) => {
    const q = [base.trim(), fav ? 'is:fav' : ''].filter(Boolean).join(' ');
    if (!q && !extra.trim()) return;
    setShowTags(false);
    setLoading(true);
    setError('');
    try {
      const res = await hybridSearch(q, subjectFor, { order: sortBy, extra, dir: adv.dir, unique: adv.unique });
      setResults(res.cards);
      setTotal(res.total ?? null);
      setNext(res.next);
      setLocal(res.local);
      setWarnings(res.warnings);
    } catch (e) {
      setError((e as Error).message);
      setResults([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const res = await hybridMore(next, local, subjectFor);
      setResults((r) => appendResults(r, res.cards, adv.unique));
      setNext(res.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run();
  };

  const findCommander = () => {
    setQuery('is:commander');
    void run('is:commander', fmt.searchKey && useLegal ? `f:${fmt.searchKey}` : '');
  };

  const popular = (kind: keyof typeof POPULAR) => {
    const q = POPULAR[kind].query;
    setQuery(q);
    setOrder('edhrec');
    void run([q, buildAdvanced(adv)].filter(Boolean).join(' '), undefined, undefined, 'edhrec');
  };

  const apply = (q: string) => { setQuery(q); void run([q.trim(), buildAdvanced(adv)].filter(Boolean).join(' ')); };
  // 'Search' buttons in import results pre-fill this search.
  // Run exactly what was asked for: advanced filters could hide the card being looked for.
  const applyRaw = (q: string) => { setQuery(q); void run(q, undefined, false); };
  const applyRef = useRef(applyRaw);
  applyRef.current = applyRaw;
  useEffect(() => onCardSearchRequest((q) => applyRef.current(q)), []);
  const onTagClick = (scope: TagScope, t: string) => apply(`${SCOPE_META[scope].key}:${/\s/.test(t) ? `"${t}"` : t}`);

  const advCount = countAdvanced(adv);
  const target = BOARD_NAME[board];

  const renderCard = (c: Card, subject = subjectFor(c)) => {
    const n = inDeck.get(c.name);
    return (
      <CardResult
        key={c.id} card={c} subject={subject} draggable dim={inAnyBoard.has(c.name)}
        onOpen={() => setSelected(c)} onTag={() => setTagging(c)} onCollect={() => setCollecting(c)} onTagClick={onTagClick}
        badge={n ? <span className="in-deck-badge">{n} {target.short}</span> : null}
        addButton={
          <button className="quick-add" title={`Add 1 to ${target.full}`} aria-label={`Add ${c.name} to ${target.full}`} onClick={() => toast(addCard(deck.id, c, 1, board), 'success')}>+</button>
        }
      />
    );
  };

  return (
    <section className="panel search-panel">
      <div className="panel-head">
        <h2>Card Search</h2>
        <a className="muted small" href="https://scryfall.com/docs/syntax" target="_blank" rel="noreferrer">Syntax guide ↗</a>
      </div>

      <form onSubmit={onSubmit} className="search-form">
        <div className="search-row">
          <input
            className="input search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search Scryfall… e.g. t:creature o:"draw a card" mv<=3'
            aria-label="Scryfall search query"
          />
          <button className="btn btn-primary" type="submit" disabled={loading}>Search</button>
        </div>

        <div className="search-options">
          <button type="button" className={`chip ${showAdv ? 'chip-on' : ''}`} onClick={() => setShowAdv((s) => !s)} aria-expanded={showAdv}>
            ⚙ Advanced{advCount > 0 && <span className="adv-count">{advCount}</span>}
          </button>
          <SavedSearches query={query} onApply={apply} />
          <button type="button" className={`chip ${showTags ? 'chip-on' : ''}`} onClick={() => setShowTags((v) => !v)} aria-pressed={showTags}>🏷 Tags</button>
          <button
            type="button" className={`chip ${favOnly ? 'chip-gold' : ''}`} aria-pressed={favOnly} title="Only favorite cards (owned or not)"
            onClick={() => { const on = !favOnly; setFavOnly(on); if (on || userQuery || results.length) void run(undefined, undefined, on); }}
          >★ Favorites</button>
          {fmt.hasCommander && identity && (
            <label className={`chip ${useIdentity ? 'chip-on' : ''}`}>
              <input type="checkbox" checked={useIdentity} onChange={(e) => setUseIdentity(e.target.checked)} />
              Identity <ColorPips colors={identity} size={13} />
            </label>
          )}
          {fmt.searchKey && (
            <label className={`chip ${useLegal ? 'chip-on' : ''}`}>
              <input type="checkbox" checked={useLegal} onChange={(e) => setUseLegal(e.target.checked)} />
              Legal in {fmt.name.replace(' (EDH)', '')}
            </label>
          )}
          <select className="input input-sm" value={order} onChange={(e) => setOrder(e.target.value as SortOrder)} aria-label="Sort by">
            {SORT_ORDERS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
          </select>
          {fmt.hasCommander && !identity && (
            <button type="button" className="chip chip-gold" onClick={findCommander}>★ Find a commander</button>
          )}
          {fmt.hasCommander && (Object.keys(POPULAR) as (keyof typeof POPULAR)[]).map((k) => (
            <button key={k} type="button" className="chip chip-gold" title={POPULAR[k].title} onClick={() => popular(k)}>{POPULAR[k].label}</button>
          ))}
          {board !== 'main' && <span className="add-target" title="The + button and drag and drop add to the board shown in the deck list">Adding to the {target.full}</span>}
        </div>

        {showAdv && <AdvancedSearch value={adv} onChange={setAdv} />}

        {fullQuery && <div className="query-preview" title="Query sent to Scryfall"><code>{fullQuery}</code></div>}
      </form>

      {showTags ? (
        <TagBrowser subjectFor={(c) => subjects(c)} renderCard={(c) => renderCard(c, subjects(c))} onSearch={apply} />
      ) : (
        <>
          <div className="results-meta">
            {error ? <span className="error-text">{error}</span> : (
              <>
                {total != null ? <span>{total.toLocaleString()} cards</span> : results.length > 0 && <span>{results.length} matching so far</span>}
                {local && <span className="muted"> · filtered by <code>{local}</code></span>}
                {warnings.map((w) => <div key={w} className="warn-text">{w}</div>)}
              </>
            )}
          </div>

          <div className="results-grid">{results.map((c) => renderCard(c))}</div>

          {loading && <div className="loading">Searching Scryfall…</div>}
          {!loading && next && (
            <button className="btn btn-ghost load-more" onClick={loadMore}>Load more results</button>
          )}
          {!loading && total === 0 && !error && <div className="empty">No cards match that search.</div>}
          {!loading && total == null && !error && (
            <div className="empty search-hints">
              <p>Search the full Scryfall database, or your tagged cards with <code>#tag</code>. Try:</p>
              {['t:legendary t:creature', 'o:"draw a card" mv<=2', 't:instant o:counter', 'otag:ramp', 't:land o:"any color"'].map((ex) => (
                <button key={ex} className="chip" onClick={() => { setQuery(ex); void run(ex); }}>
                  <code>{ex}</code>
                </button>
              ))}
              <p className="muted small">Drag a card onto the deck list, or use its + button, to add it.</p>
            </div>
          )}
        </>
      )}

      {selected && <CardModal card={selected} deckId={deck.id} onClose={() => setSelected(null)} />}
      {tagging && <TagModal card={tagging} context={{ kind: 'deck', deckId: deck.id }} onClose={() => setTagging(null)} />}
      {collecting && <AddToCollectionModal card={collecting} deckId={deck.id} onClose={() => setCollecting(null)} />}
    </section>
  );
}
