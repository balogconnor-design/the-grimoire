import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Stack of open modals so Escape only closes the top-most one when modals nest.
const stack: object[] = [];

export function Modal({
  onClose, children, wide, title,
}: { onClose: () => void; children: ReactNode; wide?: boolean; title?: string }) {
  const token = useRef({});
  useEffect(() => {
    const me = token.current;
    stack.push(me);
    return () => { stack.splice(stack.indexOf(me), 1); };
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
