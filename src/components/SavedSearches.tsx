import { useEffect, useRef, useState, type FormEvent } from 'react';
import { searchesT } from '../lib/store';
import { uid } from '../lib/rules';

/**
 * Favourite search terms, shared across main search, deck search, deck list filter
 * and collection search. Collection-only terms (tag:, is:fav, status:…) are applied
 * locally wherever the query runs against Scryfall.
 */
export function SavedSearches({ query, onApply }: { query: string; onApply: (q: string) => void }) {
  const saved = searchesT.useAll();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const already = saved.find((s) => s.query === q);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!q) return;
    const now = Date.now();
    await searchesT.put({ id: uid(), name: name.trim() || q, query: q, createdAt: now, updatedAt: now });
    setName('');
  };

  return (
    <div className="saved-searches" ref={ref}>
      <button type="button" className={`chip ${already ? 'chip-gold' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Saved searches">
        {already ? '★' : '☆'} Saved{saved.length ? ` (${saved.length})` : ''}
      </button>
      {open && (
        <div className="saved-pop" role="dialog" aria-label="Saved searches">
          {q && !already && (
            <form className="saved-save" onSubmit={save}>
              <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this search (optional)" autoFocus />
              <button className="btn btn-sm btn-primary" type="submit">★ Save</button>
              <code className="saved-q">{q}</code>
            </form>
          )}
          {saved.length === 0 ? (
            <div className="muted small saved-empty">No saved searches yet. Type a search, then save it here to reuse it anywhere.</div>
          ) : (
            <ul className="saved-list">
              {saved.map((s) => (
                <li key={s.id}>
                  <button type="button" className="saved-apply" onClick={() => { onApply(s.query); setOpen(false); }}>
                    <span className="truncate">{s.name}</span>
                    {s.name !== s.query && <code className="truncate muted">{s.query}</code>}
                  </button>
                  <button type="button" className="icon-btn sm danger" onClick={() => searchesT.remove(s.id)} aria-label={`Delete saved search ${s.name}`}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
