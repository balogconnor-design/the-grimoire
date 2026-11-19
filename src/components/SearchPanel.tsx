import { useEffect, useRef, useMemo, useState, type FormEvent } from 'react';
import { onCardSearchRequest } from '../lib/searchBus';
import type { Card, Deck } from '../types';
import type { SortOrder } from '../lib/scryfall';
import { getFormat } from '../lib/formats';
import { deckIdentity } from '../lib/rules';
import { addCard } from '../lib/actions';
import { hybridMore, hybridSearch } from '../lib/search';
import { useSubjects } from '../lib/hooks';
import { CardModal } from './CardModal';
import { CardResult } from './CardResult';
import { TagModal } from './TagModal';
import { AddToCollectionModal } from './CollectionModals';
import { SavedSearches } from './SavedSearches';
import { SCOPE_META, type TagScope } from './TagEditor';
import { ColorPips, ManaSymbol } from './Mana';
import { useToast } from './Toast';

interface Adv {
  colors: string[];
  colorMode: 'including' | 'exactly' | 'atmost';
  type: string;
  oracle: string;
  mvOp: '=' | '<=' | '>=';
  mv: string;
  rarity: string;
  set: string;
  maxPrice: string;
}

const EMPTY_ADV: Adv = { colors: [], colorMode: 'including', type: '', oracle: '', mvOp: '=', mv: '', rarity: '', set: '', maxPrice: '' };

const quote = (s: string) => (/\s/.test(s) ? `"${s.replace(/"/g, '')}"` : s);

function buildAdvanced(a: Adv): string {
  const parts: string[] = [];
  const colored = a.colors.filter((c) => c !== 'C').join('').toLowerCase();
  if (colored) parts.push(`c${a.colorMode === 'including' ? '>=' : a.colorMode === 'exactly' ? '=' : '<='}${colored}`);
  else if (a.colors.includes('C')) parts.push('c:c');
  a.type.trim().split(/\s+/).filter(Boolean).forEach((t) => parts.push(`t:${quote(t)}`));
  if (a.oracle.trim()) parts.push(`o:${quote(a.oracle.trim())}`);
  if (a.mv.trim()) parts.push(`mv${a.mvOp}${a.mv.trim()}`);
  if (a.rarity) parts.push(`r:${a.rarity}`);
  if (a.set.trim()) parts.push(`s:${a.set.trim()}`);
  if (a.maxPrice.trim()) parts.push(`usd<=${a.maxPrice.trim()}`);
  return parts.join(' ');
}

export function SearchPanel({ deck }: { deck: Deck }) {
  const fmt = getFormat(deck.format);
  const identity = deckIdentity(deck);
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [adv, setAdv] = useState<Adv>(EMPTY_ADV);
  const [showAdv, setShowAdv] = useState(false);
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
  const fullQuery = [userQuery, constraints].filter(Boolean).join(' ');

  const inDeck = useMemo(() => {
    const m = new Map<string, number>();
    deck.entries.forEach((e) => e.board === 'main' && m.set(e.card.name, (m.get(e.card.name) ?? 0) + e.qty));
    return m;
  }, [deck.entries]);

  const run = async (q = userQuery, extra = constraints) => {
    if (!q.trim() && !extra.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await hybridSearch(q, subjectFor, { order, extra });
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
      setResults((r) => [...r, ...res.cards]);
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

  const apply = (q: string) => { setQuery(q); void run(q); };
  // 'Search' buttons in import results pre-fill this search.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => onCardSearchRequest((q) => applyRef.current(q)), []);
  const onTagClick = (scope: TagScope, t: string) => apply(`${SCOPE_META[scope].key}:${/\s/.test(t) ? `"${t}"` : t}`);

  const toggleColor = (c: string) =>
    setAdv((a) => ({ ...a, colors: a.colors.includes(c) ? a.colors.filter((x) => x !== c) : [...a.colors, c] }));

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
          <button type="button" className={`chip ${showAdv ? 'chip-on' : ''}`} onClick={() => setShowAdv((s) => !s)}>
            ⚙ Advanced
          </button>
          <SavedSearches query={query} onApply={apply} />
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
            <option value="edhrec">Sort: Popularity (EDHREC)</option>
            <option value="name">Sort: Name</option>
            <option value="cmc">Sort: Mana value</option>
            <option value="usd">Sort: Price</option>
            <option value="released">Sort: Release date</option>
            <option value="rarity">Sort: Rarity</option>
            <option value="power">Sort: Power</option>
          </select>
          {fmt.hasCommander && !identity && (
            <button type="button" className="chip chip-gold" onClick={findCommander}>★ Find a commander</button>
          )}
        </div>

        {showAdv && (
          <div className="advanced">
            <div className="adv-field">
              <span className="label">Colors</span>
              <div className="adv-colors">
                {['W', 'U', 'B', 'R', 'G', 'C'].map((c) => (
                  <button
                    key={c} type="button" onClick={() => toggleColor(c)}
                    className={`pip-toggle ${adv.colors.includes(c) ? 'on' : ''}`} aria-pressed={adv.colors.includes(c)}
                  >
                    <ManaSymbol symbol={c} size={20} />
                  </button>
                ))}
                <select className="input input-sm" value={adv.colorMode} onChange={(e) => setAdv({ ...adv, colorMode: e.target.value as Adv['colorMode'] })}>
                  <option value="including">Including</option>
                  <option value="exactly">Exactly</option>
                  <option value="atmost">At most</option>
                </select>
              </div>
            </div>
            <label className="adv-field">
              <span className="label">Type</span>
              <input className="input" value={adv.type} onChange={(e) => setAdv({ ...adv, type: e.target.value })} placeholder="creature elf" />
            </label>
            <label className="adv-field">
              <span className="label">Rules text</span>
              <input className="input" value={adv.oracle} onChange={(e) => setAdv({ ...adv, oracle: e.target.value })} placeholder="draw a card" />
            </label>
            <div className="adv-field">
              <span className="label">Mana value</span>
              <div className="adv-inline">
                <select className="input input-sm" value={adv.mvOp} onChange={(e) => setAdv({ ...adv, mvOp: e.target.value as Adv['mvOp'] })}>
                  <option value="=">=</option>
                  <option value="<=">≤</option>
                  <option value=">=">≥</option>
                </select>
                <input className="input" type="number" min={0} value={adv.mv} onChange={(e) => setAdv({ ...adv, mv: e.target.value })} placeholder="any" />
              </div>
            </div>
            <label className="adv-field">
              <span className="label">Rarity</span>
              <select className="input" value={adv.rarity} onChange={(e) => setAdv({ ...adv, rarity: e.target.value })}>
                <option value="">Any</option>
                <option value="common">Common</option>
                <option value="uncommon">Uncommon</option>
                <option value="rare">Rare</option>
                <option value="mythic">Mythic</option>
              </select>
            </label>
            <label className="adv-field">
              <span className="label">Set code</span>
              <input className="input" value={adv.set} onChange={(e) => setAdv({ ...adv, set: e.target.value })} placeholder="e.g. mh3" />
            </label>
            <label className="adv-field">
              <span className="label">Max price (USD)</span>
              <input className="input" type="number" min={0} step="0.01" value={adv.maxPrice} onChange={(e) => setAdv({ ...adv, maxPrice: e.target.value })} placeholder="any" />
            </label>
            <div className="adv-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAdv(EMPTY_ADV)}>Clear</button>
              <button type="submit" className="btn btn-primary">Apply</button>
            </div>
          </div>
        )}

        {fullQuery && <div className="query-preview" title="Query sent to Scryfall"><code>{fullQuery}</code></div>}
      </form>

      <div className="results-meta">
        {error ? <span className="error-text">{error}</span> : (
          <>
            {total != null ? <span>{total.toLocaleString()} cards</span> : results.length > 0 && <span>{results.length} matching so far</span>}
            {local && <span className="muted"> · filtered by <code>{local}</code></span>}
            {warnings.map((w) => <div key={w} className="warn-text">{w}</div>)}
          </>
        )}
      </div>

      <div className="results-grid">
        {results.map((c) => {
          const n = inDeck.get(c.name);
          return (
            <CardResult
              key={c.id} card={c} subject={subjectFor(c)}
              onOpen={() => setSelected(c)} onTag={() => setTagging(c)} onCollect={() => setCollecting(c)} onTagClick={onTagClick}
              badge={n ? <span className="in-deck-badge">{n} in deck</span> : null}
              topRight={
                <button className="quick-add" title="Add 1 to main deck" aria-label={`Add ${c.name}`} onClick={() => toast(addCard(deck.id, c), 'success')}>+</button>
              }
            />
          );
        })}
      </div>

      {loading && <div className="loading">Searching Scryfall…</div>}
      {!loading && next && (
        <button className="btn btn-ghost load-more" onClick={loadMore}>Load more results</button>
      )}
      {!loading && total === 0 && !error && <div className="empty">No cards match that search.</div>}
      {!loading && total == null && !error && (
        <div className="empty search-hints">
          <p>Search the full Scryfall database. Try:</p>
          {['t:legendary t:creature', 'o:"draw a card" mv<=2', 't:instant o:counter', 'otag:ramp','t:land o:"any color"'].map((ex) => (
            <button key={ex} className="chip" onClick={() => { setQuery(ex); void run(ex); }}>
              <code>{ex}</code>
            </button>
          ))}
        </div>
      )}

      {selected && <CardModal card={selected} deckId={deck.id} onClose={() => setSelected(null)} />}
      {tagging && <TagModal card={tagging} context={{ kind: 'deck', deckId: deck.id }} onClose={() => setTagging(null)} />}
      {collecting && <AddToCollectionModal card={collecting} deckId={deck.id} onClose={() => setCollecting(null)} />}
    </section>
  );
}
