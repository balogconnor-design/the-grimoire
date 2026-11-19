import { useEffect, useRef, useState, type FormEvent } from 'react';
import { onCardSearchRequest } from '../lib/searchBus';
import type { Card } from '../types';
import type { SortOrder } from '../lib/scryfall';
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

  const run = async (q = query) => {
    if (!q.trim()) return;
    setLoading(true);
    setError('');
    try {
      const r = await hybridSearch(q, (c) => subjectFor(c), { order });
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
  const apply = (q: string) => { setQuery(q); void run(q); };
  // 'Search' buttons in import results pre-fill this search.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => onCardSearchRequest((q) => applyRef.current(q)), []);
  const onTagClick = (scope: TagScope, t: string) => apply(`${SCOPE_META[scope].key}:${quoteTag(t)}`);
  const clear = () => { setQuery(''); setResults(null); setTotal(null); setNext(undefined); setError(''); setWarnings([]); };

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
          {results && <button type="button" className="btn btn-ghost" onClick={clear}>Clear</button>}
        </div>
        <div className="search-options">
          <SavedSearches query={query} onApply={apply} />
          <select className="input input-sm" value={order} onChange={(e) => setOrder(e.target.value as SortOrder)} aria-label="Sort by">
            <option value="name">Sort: Name</option>
            <option value="edhrec">Sort: Popularity (EDHREC)</option>
            <option value="usd">Sort: Price</option>
            <option value="released">Sort: Release date</option>
            <option value="cmc">Sort: Mana value</option>
          </select>
          <span className="muted small">
            Scryfall syntax plus your own data: <code>tag:</code> <code>is:owned</code> <code>is:fav</code> <code>status:sell</code> <code>deck:</code>
          </span>
        </div>
      </form>

      {(error || warnings.length > 0 || results) && (
        <div className="results-meta">
          {error ? <span className="error-text">{error}</span> : (
            <>
              {results && <span>{localOnly ? `${results.length} of your cards` : total != null ? `${total.toLocaleString()} cards` : `${results.length} matching so far`}</span>}
              {localOnly && <span className="muted"> · searched your collection & decks (no Scryfall terms)</span>}
              {local && !localOnly && <span className="muted"> · filtered by <code>{local}</code></span>}
              {warnings.map((w) => <div key={w} className="warn-text">{w}</div>)}
            </>
          )}
        </div>
      )}

      {results && results.length > 0 && (
        <div className="results-grid">
          {results.map((c) => (
            <CardResult
              key={c.id} card={c} subject={subjectFor(c)} onOpen={() => setOpen(c)} onTag={() => setTagging(c)}
              onCollect={() => setCollecting(c)} onTagClick={onTagClick}
            />
          ))}
        </div>
      )}
      {loading && <div className="loading">Searching…</div>}
      {!loading && next && <button className="btn btn-ghost load-more" onClick={more}>Load more results</button>}
      {!loading && results?.length === 0 && !error && <div className="empty">No cards match that search.</div>}

      {open && <CardModal card={open} onClose={() => setOpen(null)} />}
      {tagging && <TagModal card={tagging} context={{ kind: 'search' }} onClose={() => setTagging(null)} />}
      {collecting && <AddToCollectionModal card={collecting} onClose={() => setCollecting(null)} />}
    </section>
  );
}
