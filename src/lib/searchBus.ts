import type { ImportResult } from './actions';

// ---------- "Search for this card" requests ----------
// The import dialogs ask whichever card search is on screen (deck search panel or main-page
// search) to run a query, without the components needing to know about each other.

type Listener = (query: string) => void;
const listeners = new Set<Listener>();

export function onCardSearchRequest(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Pre-fill and run the visible card search. Returns false if no search is mounted. */
export function requestCardSearch(query: string): boolean {
  listeners.forEach((l) => l(query));
  return listeners.size > 0;
}

// ---------- Import result handed from the main-menu import to the new deck's page ----------

const pendingImports = new Map<string, ImportResult>();
export const setPendingImport = (deckId: string, r: ImportResult) => { pendingImports.set(deckId, r); };
export const peekPendingImport = (deckId: string) => pendingImports.get(deckId);
export const clearPendingImport = (deckId: string) => { pendingImports.delete(deckId); };
