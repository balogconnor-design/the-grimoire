import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { Card } from '../types';
import type { Subject } from '../lib/query';
import { collectionT, decksT, globalTagsT } from '../lib/store';
import { SCOPE_META, type TagScope } from './TagEditor';

interface TagGroup { tag: string; scopes: Set<TagScope>; cards: Card[] }

/**
 * Every tag you've put on cards (global tags, card tags in any deck, collection tags), each one opening into
 * the cards that carry it. Shown in place of search results.
 */
export function TagBrowser({ subjectFor, renderCard, onSearch }: {
  subjectFor: (c: Card) => Subject;
  renderCard: (c: Card) => ReactNode;
  onSearch: (query: string) => void;
}) {
  const items = collectionT.useAll();
  const decks = decksT.useAll();
  const globalRows = globalTagsT.useAll();
  const [open, setOpen] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => {
    // One card per name, as in a collection-only search.
    const pool = new Map<string, Card>();
    items.forEach((i) => pool.has(i.card.name) || pool.set(i.card.name, i.card));
    decks.forEach((d) => d.entries.forEach((e) => pool.has(e.card.name) || pool.set(e.card.name, e.card)));
    const m = new Map<string, TagGroup>();
    const add = (tag: string, scope: TagScope, card: Card) => {
      const key = tag.toLowerCase();
      if (!m.has(key)) m.set(key, { tag: key, scopes: new Set(), cards: [] });
      const g = m.get(key)!;
      g.scopes.add(scope);
      if (!g.cards.includes(card)) g.cards.push(card);
    };
    // Globally tagged cards count even if you don't own them or use them in a deck yet.
    globalRows.forEach((r) => r.card && !pool.has(r.id) && pool.set(r.id, r.card));
    for (const card of pool.values()) {
      const s = subjectFor(card);
      s.globalTags?.forEach((t) => add(t, 'global', card));
      s.cardTags?.forEach((t) => add(t, 'card', card));
      s.collectionTags?.forEach((t) => add(t, 'collection', card));
      s.scryfallTags?.forEach((t) => add(t, 'scryfall', card));
    }
    for (const g of m.values()) g.cards.sort((a, b) => a.name.localeCompare(b.name));
    return [...m.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  }, [items, decks, globalRows, subjectFor]);

  const shown = filter.trim() ? groups.filter((g) => g.tag.includes(filter.trim().toLowerCase())) : groups;
  const toggle = (t: string) => setOpen((o) => (o.includes(t) ? o.filter((x) => x !== t) : [...o, t]));
  const scopeOf = (g: TagGroup): TagScope => (g.scopes.has('global') ? 'global' : g.scopes.has('card') ? 'card' : g.scopes.has('collection') ? 'collection' : 'scryfall');
  const q = (t: string) => `#${/\s/.test(t) ? `"${t}"` : t}`;

  if (!groups.length) {
    return (
      <div className="empty">
        No tagged cards yet. Use 🏷 on a card to tag it, then search tags with <code>#tagname</code>.
      </div>
    );
  }

  return (
    <div className="tag-browser">
      <div className="search-options">
        <span className="muted small">{groups.length} tag{groups.length === 1 ? '' : 's'} on your cards · click to show its cards</span>
        {groups.length > 12 && (
          <input className="input input-sm" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tags…" aria-label="Filter tags" />
        )}
        {open.length > 0 && <button type="button" className="link-btn small" onClick={() => setOpen([])}>Collapse all</button>}
      </div>
      <div className="tag-browser-list">
        {shown.map((g) => {
          const scope = scopeOf(g);
          const on = open.includes(g.tag);
          return (
            <button
              key={g.tag} type="button" aria-pressed={on} aria-expanded={on} onClick={() => toggle(g.tag)}
              className={`tag tag-${scope} tag-click tag-pick ${on ? 'chip-on' : ''}`}
              title={[...g.scopes].map((s) => SCOPE_META[s].label).join(' · ')}
            >
              <span className="tag-icon" aria-hidden>{SCOPE_META[scope].icon}</span>
              {g.tag}
              <span className="tag-count">{g.cards.length}</span>
            </button>
          );
        })}
      </div>
      {open.map((t) => {
        const g = groups.find((x) => x.tag === t);
        if (!g) return null;
        return (
          <section key={t} className="tag-group">
            <div className="tag-group-head">
              <h3>{SCOPE_META[scopeOf(g)].icon} {g.tag}</h3>
              <span className="muted small">{g.cards.length} card{g.cards.length === 1 ? '' : 's'}</span>
              <button type="button" className="link-btn small" onClick={() => onSearch(q(g.tag))}>Search <code>{q(g.tag)}</code></button>
              <button type="button" className="link-btn small tag-group-close" onClick={() => toggle(t)} aria-label={`Close ${g.tag}`}>✕</button>
            </div>
            <div className="results-grid">{g.cards.map((c) => <Fragment key={c.id}>{renderCard(c)}</Fragment>)}</div>
          </section>
        );
      })}
    </div>
  );
}
