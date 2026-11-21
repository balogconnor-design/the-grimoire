import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A Metrics section that folds away to its heading. Each section has a starting state; once you open
 * or close one yourself, that choice is remembered in this browser (for every deck). A section can
 * also be driven automatically (Requirements opens when the deck stops meeting them).
 */
const KEY = 'grimoire.metricsOpen';
const OLD_KEY = 'grimoire.metricsCollapsed'; // before 2026-11-21: ids of folded sections

function readChoices(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, boolean> | null;
    if (v && typeof v === 'object') return v;
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? '[]') as string[];
    return Object.fromEntries((Array.isArray(old) ? old : []).map((id) => [id, false]));
  } catch { return {}; }
}
function saveChoice(id: string, open: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readChoices(), [id]: open }));
    localStorage.removeItem(OLD_KEY);
  } catch { /* storage unavailable: only this session remembers */ }
}

export interface CollapsibleProps {
  /** Remembers the open/closed choice; omit for sections that shouldn't remember (they follow `auto`). */
  id?: string;
  title: ReactNode;
  titleHint?: string;
  /** Starting state until you open or close it yourself. */
  defaultOpen?: boolean;
  /** Header text on the right, shown open or closed (e.g. "54 mana symbols"). */
  meta?: ReactNode;
  /** Header text on the right, only while closed (e.g. the total price). */
  closedMeta?: ReactNode;
  /** Shown under the heading while closed (e.g. a colour bar or buttons). */
  closedBody?: ReactNode;
  /** Header controls on the right, only while open (e.g. ↻ Refresh). */
  right?: ReactNode;
  /**
   * Drive the section from outside: when this value changes, the section opens (true) or closes
   * (false). You can still open or close it yourself in between.
   */
  auto?: boolean;
  /** Bump to open the section (e.g. after a button in the closed view was used). */
  openSignal?: number;
  className?: string;
  children: ReactNode;
}

export function Collapsible({ id, title, titleHint, defaultOpen = true, meta, closedMeta, closedBody, right, auto, openSignal, className = '', children }: CollapsibleProps) {
  const [open, setOpen] = useState(() => {
    if (auto !== undefined) return auto;
    const c = id ? readChoices()[id] : undefined;
    return c ?? defaultOpen;
  });
  const lastAuto = useRef(auto);
  useEffect(() => {
    if (auto !== undefined && auto !== lastAuto.current) setOpen(auto);
    lastAuto.current = auto;
  }, [auto]);
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== undefined && openSignal !== lastSignal.current) setOpen(true);
    lastSignal.current = openSignal;
  }, [openSignal]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (id && auto === undefined) saveChoice(id, next);
  };
  return (
    <div className={`detail-section collapsible ${open ? 'open' : 'closed'} ${className}`}>
      <div className="section-head">
        <button type="button" className="collapse-head" onClick={toggle} aria-expanded={open} title={titleHint}>
          <span className="collapse-caret" aria-hidden>{open ? '▾' : '▸'}</span>
          <h3>{title}</h3>
        </button>
        {(meta != null || (!open && closedMeta != null)) && (
          <span className="section-meta">
            {meta}
            {!open && closedMeta != null && <>{meta != null && ' · '}{closedMeta}</>}
          </span>
        )}
        {open && right}
      </div>
      {open ? children : closedBody != null && <div className="collapse-closed-body">{closedBody}</div>}
    </div>
  );
}

/** A smaller fold-away heading inside a section (e.g. "In this deck" in Combos). Remembered like sections. */
export function SubCollapsible({ id, title, meta, defaultOpen = true, children }: {
  id: string; title: ReactNode; meta?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readChoices()[id] ?? defaultOpen);
  return (
    <div className="panel-block">
      <button type="button" className="panel-subhead sub-collapse" aria-expanded={open}
        onClick={() => { setOpen(!open); saveChoice(id, !open); }}>
        <span className="panel-subhead-title"><span className="collapse-caret" aria-hidden>{open ? '▾' : '▸'}</span> {title}</span>
        {meta != null && <span className="muted small">{meta}</span>}
      </button>
      {open && children}
    </div>
  );
}
