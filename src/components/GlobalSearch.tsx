import { useEffect, useRef, useState, type FormEvent } from 'react';
import { onCardSearchRequest } from '../lib/searchBus';
import type { Card } from '../types';
import { SORT_ORDERS, type SortOrder } from '../lib/scryfall';
import { buildAdvanced, countAdvanced, EMPTY_ADV, type Adv } from '../lib/advanced';
import { AdvancedSearch } from './AdvancedSearch';
import { TagBrowser } from './TagBrowser';
import { hybridMore, hybridSearch } from '../lib/search';
import { useSubjects } from '../lib/hooks';
import { CardResult } from './CardResult';
import { CardModal } from './CardModal';
import { TagModal } from './TagModal';
import { AddToCollectionModal } from './CollectionModals';
import { SavedSearches } from './SavedSearches';
import { SCOPE_META, type TagScope } from './TagEditor';

const quoteTag = (t: string) => (/\s/.test(t) ? `"${t}"` : t);

/** Deck- and collection-agnostic card search for the main page. */
export function GlobalSearch() {
  const subjectFor = useSubjects();
  const [query, setQuery] = useState('');
  const [adv, setAdv] = useState<Adv>(EMPTY_ADV);
  const [showAdv, setShowAdv] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [order, setOrder] = useState<SortOrder>('name');
  const [results, setResults] = useState<Card[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<string>();
  const [local, setLocal] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Card | null>(null);
  const [tagging, setTagging] = useState<Card | null>(null);
  const [collecting, setCollecting] = useState<Card | null>(null);

  const advQuery = buildAdvanced(adv);
  const fullQuery = [query.trim(), advQuery].filter(Boolean).join(' ');
  const advCount = countAdvanced(adv);

  const run = async (q = fullQuery) => {
    if (!q.trim()) return;
    setShowTags(false);
    setLoading(true);
    setError('');
    try {
      const r = await hybridSearch(q, (c) => subjectFor(c), { order, dir: adv.dir, unique: adv.unique });
      setResults(r.cards);
      setTotal(r.total);
      setNext(r.next);
      setLocal(r.local);
      setLocalOnly(r.localOnly);
      setWarnings(r.warnings);
    } catch (e) {
      setError((e as Error).message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const more = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const r = await hybridMore(next, local, (c) => subjectFor(c));
      setResults((xs) => [...(xs ?? []), ...r.cards]);
      setNext(r.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void run(); };
  const apply = (q: string) => { setQuery(q); void run([q.trim(), advQuery].filter(Boolean).join(' ')); };
  // 'Search' buttons in import results pre-fill this search.
  // Run exactly what was asked for: advanced filters could hide the card being looked for.
  const applyRaw = (q: string) => { setQuery(q); void run(q); };
  const applyRef = useRef(applyRaw);
  applyRef.current = applyRaw;
  useEffect(() => onCardSearchRequest((q) => applyRef.current(q)), []);
  const onTagClick = (scope: TagScope, t: string) => apply(`${SCOPE_META[scope].key}:${quoteTag(t)}`);
  const renderCard = (c: Card) => (
    <CardResult
      key={c.id} card={c} subject={subjectFor(c)} onOpen={() => setOpen(c)} onTag={() => setTagging(c)}
      onCollect={() => setCollecting(c)} onTagClick={onTagClick}
    />
  );
  const clear = () => { setQuery(''); setAdv(EMPTY_ADV); setResults(null); setTotal(null); setNext(undefined); setError(''); setWarnings([]); };

  return (
    <section className="panel global-search">
      <form className="search-form" onSubmit={onSubmit}>
        <div className="search-row">
          <div className="search-wrap">
            <span className="search-icon" aria-hidden>⌕</span>
            <input
              className="input library-search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder='Search every card… e.g. t:dragon usd<5, tag:ramp, is:owned status:sell' aria-label="Search all cards"
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>Search</button>
          {(results || advCount > 0) && <button type="button" className="btn btn-ghost" onClick={clear}>Clear</button>}
        </div>
        <div className="search-options">
          <button type="button" className={`chip ${showAdv ? 'chip-on' : ''}`} onClick={() => setShowAdv((v) => !v)} aria-expanded={showAdv}>
            ⚙ Advanced{advCount > 0 && <span className="adv-count">{advCount}</span>}
          </button>
          <SavedSearches query={query} onApply={apply} />
          <button type="button" className={`chip ${showTags ? 'chip-on' : ''}`} onClick={() => setShowTags((v) => !v)} aria-pressed={showTags}>
            🏷 All tags
          </button>
          <select className="input input-sm" value={order} onChange={(e) => setOrder(e.target.value as SortOrder)} aria-label="Sort by">
            {SORT_ORDERS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
          </select>
          <span className="muted small">
            Scryfall syntax plus your own data: <code>#tag</code> <code>is:owned</code> <code>is:fav</code> <code>status:sell</code> <code>deck:</code>
          </span>
        </div>
        {showAdv && <AdvancedSearch value={adv} onChange={setAdv} />}
        {advQuery && <div className="query-preview" title="Query being searched"><code>{fullQuery}</code></div>}
      </form>

      {showTags ? (
        <TagBrowser subjectFor={(c) => subjectFor(c)} renderCard={renderCard} onSearch={apply} />
      ) : (<>
      {(error || warnings.length > 0 || results) && (
        <div className="results-meta">
          {error ? <span className="error-text">{error}</span> : (
            <>
              {results && <span>{localOnly ? `${results.length} of your cards` : total != null ? `${total.toLocaleString()} cards` : `${results.length} matching so far`}</span>}
              {localOnly && <span className="muted"> · searched your collection, decks and tagged cards (no Scryfall terms)</span>}
              {local && !localOnly && <span className="muted"> · filtered by <code>{local}</code></span>}
              {warnings.map((w) => <div key={w} className="warn-text">{w}</div>)}
            </>
          )}
        </div>
      )}

      {results && results.length > 0 && (
        <div className="results-grid">
          {results.map(renderCard)}
        </div>
      )}
      {loading && <div className="loading">Searching…</div>}
      {!loading && next && <button className="btn btn-ghost load-more" onClick={more}>Load more results</button>}
      {!loading && results?.length === 0 && !error && <div className="empty">No cards match that search.</div>}
      </>)}

      {open && <CardModal card={open} onClose={() => setOpen(null)} />}
      {tagging && <TagModal card={tagging} context={{ kind: 'search' }} onClose={() => setTagging(null)} />}
      {collecting && <AddToCollectionModal card={collecting} onClose={() => setCollecting(null)} />}
    </section>
  );
}
