import { useState } from 'react';
import {
  SCRYFALL_TAGS, setAllScryfallTagsHidden, setScryfallTagHidden, setScryfallTagsOn, useScryfallTagStatus, useScryfallTagVisibility,
} from '../lib/scryfallTags';
import { Modal } from './Modal';

/**
 * Turn Scryfall oracle tags on or off, and pick which ones are shown. Off or hidden tags stay attached
 * to the cards but are ignored: they don't show, group, sort or match searches.
 */
export function ScryfallTagsModal({ onClose }: { onClose: () => void }) {
  const { on, hidden } = useScryfallTagVisibility();
  const status = useScryfallTagStatus();
  const shownCount = SCRYFALL_TAGS.length - SCRYFALL_TAGS.filter((t) => hidden.has(t.label)).length;

  return (
    <Modal onClose={onClose} title="Scryfall oracle tags">
      <div className="group-tags-modal stag-settings">
        <p className="muted small help">
          Oracle tags are automatic tags from Scryfall Tagger, such as <span className="scryfall-name">◆ ramp</span>,{' '}
          <span className="scryfall-name">◆ removal</span> and <span className="scryfall-name">◆ board wipe</span>. They come
          with the app, so turning them on sends nothing anywhere. When they’re off, or a tag is hidden, it stays attached to
          the cards but Grimoire ignores it: it doesn’t show on cards, become a section when grouping by tag, count in draw
          odds or match tag searches. Your own tags are never affected.
        </p>
        <label className="stag-toggle">
          <input type="checkbox" checked={on} onChange={(e) => setScryfallTagsOn(e.target.checked)} />
          <span><b>Use Scryfall oracle tags</b></span>
        </label>
        {on && status.state === 'updating' && <p className="muted small">Loading tags…</p>}
        {on && status.state === 'error' && <p className="warn-text small">The tags couldn’t be loaded. Reload the page to try again.</p>}
        <div className={on ? '' : 'stag-off'} aria-disabled={!on}>
          <div className="group-tags-tools small">
            <span className="muted">{shownCount} of {SCRYFALL_TAGS.length} shown</span>
            <button type="button" className="link-btn small" disabled={!on} onClick={() => setAllScryfallTagsHidden(false)}>Show all</button>
            <button type="button" className="link-btn small" disabled={!on} onClick={() => setAllScryfallTagsHidden(true)}>Hide all</button>
          </div>
          <ul className="group-tags-list">
            {SCRYFALL_TAGS.map((t) => (
              <li key={t.otag}>
                <label title={`Scryfall: otag:${t.otag}`}>
                  <input type="checkbox" disabled={!on} checked={!hidden.has(t.label)} onChange={(e) => setScryfallTagHidden(t.label, !e.target.checked)} />
                  <span className="scryfall-name">◆ {t.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <p className="muted tiny">
          The bracket estimate always checks extra turns and land denial, whichever tags are shown. Typing{' '}
          <code>otag:</code> in the main search still asks Scryfall directly.
        </p>
        <div className="group-tags-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

/** A small button that opens the oracle tag settings. */
export function ManageScryfallTags({ label, className = 'link-btn small', title }: { label?: string; className?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const { on } = useScryfallTagVisibility();
  return (
    <>
      <button type="button" className={className} title={title ?? 'Turn Scryfall oracle tags on or off, or hide some of them'}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        {label ?? (on ? '◆ Oracle tags' : '◆ Turn on oracle tags')}
      </button>
      {open && <ScryfallTagsModal onClose={() => setOpen(false)} />}
    </>
  );
}
