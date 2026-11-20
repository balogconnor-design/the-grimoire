import { useState, type KeyboardEvent } from 'react';

/** global = on the card everywhere · deck = tags on a deck · card = a card's tags inside one deck · collection = tags on owned lots */
export type TagScope = 'global' | 'deck' | 'card' | 'collection';

export const SCOPE_META: Record<TagScope, { icon: string; label: string; key: string }> = {
  global: { icon: '✦', label: 'Global tag (every deck)', key: 'gtag' },
  deck: { icon: '▣', label: 'Deck tag', key: 'decktag' },
  card: { icon: '#', label: 'Card tag (this deck)', key: 'cardtag' },
  collection: { icon: '◈', label: 'Collection tag', key: 'coltag' },
};

export interface TagSuggestionGroup {
  label: string;
  tags: string[];
}

interface Props {
  scope: TagScope;
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: TagSuggestionGroup[];
  placeholder?: string;
  autoFocus?: boolean;
}

export const cleanTag = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 40);

export function Tag({ scope, children, onRemove, onClick, small }: {
  scope: TagScope; children: string; onRemove?: () => void; onClick?: () => void; small?: boolean;
}) {
  const meta = SCOPE_META[scope];
  const cls = `tag tag-${scope} ${small ? 'tag-sm' : ''} ${onClick ? 'tag-click' : ''}`;
  const body = (
    <>
      <span className="tag-icon" aria-hidden>{meta.icon}</span>
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} title={`${meta.label} — search ${meta.key}:${children}`} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {body}
    </button>
  ) : (
    <span className={cls} title={meta.label}>
      {body}
      {onRemove && (
        <button type="button" className="tag-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove ${meta.label.toLowerCase()} ${children}`}>✕</button>
      )}
    </span>
  );
}

export function TagEditor({ scope, tags, onChange, suggestions = [], placeholder = 'Add tag…', autoFocus }: Props) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const t = cleanTag(raw);
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };
  const q = cleanTag(text);
  const seen = new Set<string>();
  const groups = suggestions
    .map((g) => ({
      ...g,
      tags: g.tags.filter((t) => {
        if (tags.includes(t) || seen.has(t) || (q && !t.includes(q))) return false;
        seen.add(t);
        return true;
      }),
    }))
    .filter((g) => g.tags.length);

  return (
    <div className="tag-editor">
      <div className={`tag-input-row scope-${scope}`}>
        {tags.map((t) => <Tag key={t} scope={scope} onRemove={() => onChange(tags.filter((x) => x !== t))}>{t}</Tag>)}
        <input
          className="tag-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          onBlur={() => text.trim() && add(text)} placeholder={placeholder} autoFocus={autoFocus}
          aria-label={`Add ${SCOPE_META[scope].label.toLowerCase()}`}
        />
      </div>
      {groups.map((g) => (
        <div key={g.label} className="tag-suggest">
          <span className="muted tiny-label">{g.label}</span>
          {g.tags.map((t) => (
            <button key={t} type="button" className={`tag tag-${scope} tag-suggestion`} onMouseDown={(e) => e.preventDefault()} onClick={() => add(t)}>
              + {t}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Compact read-only list of tags across scopes; clicking a tag runs a search for it. */
export function TagList({ groups, max = 4, onTagClick }: {
  groups: { scope: TagScope; tags: string[] }[];
  max?: number;
  onTagClick?: (scope: TagScope, tag: string) => void;
}) {
  const flat = groups.flatMap((g) => g.tags.map((t) => ({ scope: g.scope, t })));
  if (!flat.length) return null;
  return (
    <span className="tag-list">
      {flat.slice(0, max).map(({ scope, t }) => (
        <Tag key={`${scope}:${t}`} scope={scope} small onClick={onTagClick ? () => onTagClick(scope, t) : undefined}>{t}</Tag>
      ))}
      {flat.length > max && <span className="muted tiny-label" title={flat.slice(max).map((x) => x.t).join(', ')}>+{flat.length - max}</span>}
    </span>
  );
}

export function TagLegend() {
  return (
    <div className="tag-legend">
      {(Object.keys(SCOPE_META) as TagScope[]).map((s) => (
        <span key={s} className={`tag tag-${s} tag-sm`}><span className="tag-icon" aria-hidden>{SCOPE_META[s].icon}</span>{SCOPE_META[s].label}</span>
      ))}
    </div>
  );
}

export function FavStar({ on, onToggle, size = 'sm', label = 'favorite' }: { on: boolean; onToggle: () => void; size?: 'sm' | 'md'; label?: string }) {
  return (
    <button
      type="button" className={`fav-star ${on ? 'on' : ''} ${size}`} aria-pressed={on}
      title={on ? `Remove ${label}` : `Mark as ${label}`} aria-label={on ? `Remove ${label}` : `Mark as ${label}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >{on ? '★' : '☆'}</button>
  );
}
