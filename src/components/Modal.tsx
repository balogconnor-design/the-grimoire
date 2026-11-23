import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Stack of open modals so Escape (and the phone's back button) only closes the top-most one when modals nest.
const stack: { close: () => void }[] = [];

/*
 * The back button / back gesture closes the top window instead of leaving the page under it. Every
 * open window owns one history entry (same URL, so the hash router doesn't notice). Windows closed
 * some other way (✕, Escape) give their entries back with history.go(-n). Syncing waits a tick, so a
 * window swapped for another in one render (the card window stepping to the next card) keeps its entry.
 */
const KEY = 'grimoireModal';
let owned = 0; // history entries the open windows hold
let pendingPops = 0; // our own history.go calls whose popstate hasn't arrived yet
let scheduled = false;
const depthOf = (state: unknown) => (state && typeof state === 'object' ? Number((state as Record<string, unknown>)[KEY]) || 0 : 0);

function sync() {
  if (pendingPops) return; // runs again once our own back step lands
  // Navigating while a window was open (e.g. opening a deck from it) puts a new entry on top: ours are buried, let them go.
  if (depthOf(history.state) !== owned) owned = 0;
  const want = stack.length;
  while (owned < want) {
    owned += 1;
    history.pushState({ ...(history.state ?? {}), [KEY]: owned }, '');
  }
  if (owned > want) {
    pendingPops += 1;
    history.go(want - owned);
    owned = want;
  }
}
function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; sync(); }, 0);
}
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    if (pendingPops) { pendingPops -= 1; scheduleSync(); return; }
    const depth = depthOf(e.state);
    if (depth >= owned) return;
    // The user went back: close the windows above that entry, top-most first.
    const closing = stack.slice(depth).reverse();
    owned = depth;
    for (const m of closing) m.close();
    scheduleSync();
  });
}

export function Modal({
  onClose, children, wide, title,
}: { onClose: () => void; children: ReactNode; wide?: boolean; title?: string }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const token = useRef({ close: () => closeRef.current() });
  useEffect(() => {
    const me = token.current;
    stack.push(me);
    scheduleSync();
    return () => { stack.splice(stack.indexOf(me), 1); scheduleSync(); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stack[stack.length - 1] === token.current && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-close icon-btn" onClick={onClose} aria-label="Close">✕</button>
        {title && <h2 className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
