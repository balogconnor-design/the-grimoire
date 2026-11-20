import { useMemo, useState } from 'react';
import type { Card } from '../types';
import { looksLikeQuery, parseQuery } from '../lib/query';
import { useFavoriteCards, useSubjects } from '../lib/hooks';
import { CardResult } from '../components/CardResult';
import { CardModal } from '../components/CardModal';
import { TagModal } from '../components/TagModal';
import { AddToCollectionModal } from '../components/CollectionModals';
import { SCOPE_META, type TagScope } from '../components/TagEditor';

/** Every favorite card, whether you own a copy or not. */
export function FavoritesTab() {
  const favorites = useFavoriteCards();
  const subjectFor = useSubjects();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Card | null>(null);
  const [tagging, setTagging] = useState<Card | null>(null);
  const [collecting, setCollecting] = useState<Card | null>(null);

  // Plain text filters by name; search syntax (t:, #tag, is:owned…) runs through the local engine.
  const shown = useMemo(() => {
    const q = query.trim();
    if (!q) return favorites;
    if (looksLikeQuery(q)) {
      const parsed = parseQuery(q);
      return favorites.filter((c) => parsed.test(subjectFor(c)));
    }
    return favorites.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  }, [favorites, query, subjectFor]);
  const owned = favorites.filter((c) => (subjectFor(c).ownedQty ?? 0) > 0).length;
  const onTagClick = (scope: TagScope, t: string) => setQuery(`${SCOPE_META[scope].key}:${/\s/.test(t) ? `"${t}"` : t}`);

  return (
    <div className="favorites-tab">
      <div className="library-toolbar">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden>⌕</span>
          <input
            className="input library-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter favorites… e.g. sol ring, t:creature, #ramp, is:owned" aria-label="Filter favorites"
          />
        </div>
        <span className="muted small">
          {favorites.length} favorite card{favorites.length === 1 ? '' : 's'} · {owned} owned · {favorites.length - owned} not owned
        </span>
      </div>

      {favorites.length === 0 ? (
        <div className="empty">
          No favorite cards yet. Use ☆ on any card (in search results or the card view) to add it here, whether you own it or not.
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">No favorites match that filter.</div>
      ) : (
        <div className="results-grid">
          {shown.map((c) => (
            <CardResult
              key={c.id} card={c} subject={subjectFor(c)} onOpen={() => setOpen(c)} onTag={() => setTagging(c)}
              onCollect={() => setCollecting(c)} onTagClick={onTagClick}
            />
          ))}
        </div>
      )}

      {open && <CardModal card={open} onClose={() => setOpen(null)} />}
      {tagging && <TagModal card={tagging} context={{ kind: 'search' }} onClose={() => setTagging(null)} />}
      {collecting && <AddToCollectionModal card={collecting} onClose={() => setCollecting(null)} />}
    </div>
  );
}
