import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onSaveError } from '../lib/store';

type Kind = 'info' | 'success' | 'error';
/** An optional button on the toast, e.g. Undo. */
export interface ToastAction { label: string; run: () => void }
interface ToastItem { id: number; message: string; kind: Kind; action?: ToastAction }

const ToastCtx = createContext<(message: string, kind?: Kind, action?: ToastAction) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const shown = useRef(new Set<string>());
  const push = useCallback((message: string, kind: Kind = 'info', action?: ToastAction) => {
    if (!message) return;
    // A failed save is reported by the store and often re-thrown to the caller: show it once.
    const key = `${kind}:${message}`;
    if (shown.current.has(key)) return;
    shown.current.add(key);
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, message, kind, action }]);
    setTimeout(() => {
      shown.current.delete(key);
      setItems((xs) => xs.filter((x) => x.id !== id));
    }, kind === 'error' || action ? 7000 : 3200);
  }, []);
  // Failed IndexedDB writes anywhere in the app surface here.
  useEffect(() => onSaveError((msg) => push(msg, 'error')), [push]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
            {t.action && (
              <button type="button" className="toast-action" onClick={() => { t.action!.run(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
