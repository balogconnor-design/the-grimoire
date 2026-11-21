import { useMemo, useState } from 'react';
import type { Deck } from '../types';
import { deckTagCounts, DEFAULT_GROUP_TAGS, type TagSources } from '../lib/deckTags';
import { Modal } from './Modal';

/** The tags chosen for grouping a deck by tag, saved per deck in this browser (null = use the default). */
const KEY = (deckId: string) => `grimoire.groupTags.${deckId}`;
export function readGroupTags(deckId: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(deckId)) ?? 'null');
    return Array.isArray(v) && v.every((t) => typeof t === 'string') ? v : null;
  } catch { return null; }
}
export function saveGroupTags(deckId: string, tags: string[] | null) {
  try {
    if (tags) localStorage.setItem(KEY(deckId), JSON.stringify(tags));
    else localStorage.removeItem(KEY(deckId));
  } catch { /* storage unavailable: only this session remembers */ }
}

/**
 * Choose which tags become sections when the deck list is grouped by tag. Lists every tag in the
 * deck with its card count, most common first; the current selection is ticked.
 */
export function GroupTagsModal({ deck, src, selected, defaults, onApply, onClose }: {
  deck: Deck;
  src: TagSources;
  selected?: string[];
  defaults: string[];
  onApply: (tags: string[]) => void;
  onClose: () => void;
}) {
  const counts = useMemo(() => deckTagCounts(deck, src), [deck, src]);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(selected ?? defaults));
  const toggle = (t: string) => setTicked((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  return (
    <Modal onClose={onClose} title="Group by tags">
      <div className="group-tags-modal">
        <h2 className="modal-title">Group by tags</h2>
        <p className="muted small help">
          Tick the tags that should become sections in the deck list. Each card is listed under the first ticked tag it has
          (Scryfall’s tags in their usual order, then yours); cards with none of them go under <b>Other</b>, and lands stay
          under <b>Lands</b>. You can still drag a card onto another of its ticked tags.
        </p>
        {counts.length === 0 ? <p className="muted">No cards in this deck have tags yet.</p> : (
          <>
            <div className="group-tags-tools small">
              <span className="muted">{ticked.size} ticked</span>
              <button type="button" className="link-btn small" onClick={() => setTicked(new Set(defaults))}>Most common {Math.min(DEFAULT_GROUP_TAGS, counts.length)}</button>
              <button type="button" className="link-btn small" onClick={() => setTicked(new Set(counts.map((c) => c.tag)))}>All</button>
              <button type="button" className="link-btn small" onClick={() => setTicked(new Set())}>None</button>
            </div>
            <ul className="group-tags-list">
              {counts.map((c) => (
                <li key={c.tag}>
                  <label>
                    <input type="checkbox" checked={ticked.has(c.tag)} onChange={() => toggle(c.tag)} />
                    <span className={c.scryfall ? 'scryfall-name' : ''}>{c.scryfall ? '◆ ' : ''}{c.tag}</span>
                    <span className="count small">{c.count} card{c.count === 1 ? '' : 's'}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="group-tags-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={ticked.size === 0}
            onClick={() => onApply(counts.map((c) => c.tag).filter((t) => ticked.has(t)))}>Group by selected tags</button>
        </div>
      </div>
    </Modal>
  );
}
