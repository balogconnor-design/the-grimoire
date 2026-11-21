import { useEffect, useSyncExternalStore } from 'react';
import type { Deck } from '../types';
import type { Combo, ComboResult } from '../../shared/spellbook';
import { commanderEntry } from './rules';
import { isPortable } from './device';
import { db } from './store';

/**
 * Combo checks through Commander Spellbook (opt-in per check: the panel says the card names are sent).
 * The browser posts the deck's card names to The Grimoire's own /api/combos (a Cloudflare Pages
 * Function, see functions/api/combos.ts), which asks Spellbook. The last answer is saved per deck in
 * IndexedDB, with a signature of the deck's cards so the panel can tell when the deck has changed.
 */
export type { Combo, ComboResult, ComboTag } from '../../shared/spellbook';
export { COMBO_TAG_LABEL } from '../../shared/spellbook';

/** The proxy only exists on the website (and the dev/preview servers), not in the old portable build. */
export const combosAvailable = () => !isPortable();

export interface SavedCombos { result: ComboResult; signature: string; checkedAt: number }
export interface ComboState { state: 'idle' | 'checking' | 'error'; error?: string; saved?: SavedCombos }

const KEY = (deckId: string) => `combos:${deckId}`;
const states = new Map<string, ComboState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const IDLE: ComboState = { state: 'idle' };
const set = (deckId: string, s: ComboState) => { states.set(deckId, s); emit(); };

/** What gets sent: the commander, and the other main-deck card names (one each). */
export function comboRequest(deck: Deck): { commanders: string[]; main: string[] } {
  const cmd = commanderEntry(deck);
  const main = [...new Set(deck.entries.filter((e) => e.board === 'main' && e.uid !== cmd?.uid).map((e) => e.card.name))];
  return { commanders: cmd ? [cmd.card.name] : [], main };
}

/** Changes whenever the main deck's card names or the commander change. */
export function deckSignature(deck: Deck): string {
  const r = comboRequest(deck);
  return JSON.stringify([r.commanders, [...r.main].sort()]);
}

/** Read a deck's last saved check (once per deck per visit). */
async function loadSaved(deckId: string) {
  if (states.has(deckId)) return;
  states.set(deckId, IDLE);
  try {
    const row = (await (await db()).get('meta', KEY(deckId))) as { value?: SavedCombos } | undefined;
    if (row?.value && states.get(deckId) === IDLE) set(deckId, { state: 'idle', saved: row.value });
  } catch { /* nothing saved */ }
}

type Poster = (url: string, init: RequestInit) => Promise<Response>;
let poster: Poster = (url, init) => fetch(url, init);
/** Tests: replace the network. */
export function setCombosFetchForTests(p: Poster) { poster = p; }

/** Send the deck's card names to Commander Spellbook (through /api/combos) and save the answer. */
export async function checkCombos(deck: Deck): Promise<void> {
  const prev = states.get(deck.id) ?? IDLE;
  set(deck.id, { ...prev, state: 'checking', error: undefined });
  try {
    const res = await poster('/api/combos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(comboRequest(deck)),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `The combo check failed (${res.status})`);
    const saved: SavedCombos = { result: body as ComboResult, signature: deckSignature(deck), checkedAt: Date.now() };
    set(deck.id, { state: 'idle', saved });
    await (await db()).put('meta', { key: KEY(deck.id), value: saved }).catch(() => undefined);
  } catch (e) {
    const msg = e instanceof TypeError ? 'Couldn’t reach the combo service. Check your connection and try again.' : (e as Error).message;
    set(deck.id, { ...prev, state: 'error', error: msg });
  }
}

/** A deck's combo state, loading its last saved check the first time. */
export function useCombos(deckId: string): ComboState {
  useEffect(() => { void loadSaved(deckId); }, [deckId]);
  return useSyncExternalStore(subscribe, () => states.get(deckId) ?? IDLE);
}

/** Saved combos whose cards are all still in the deck (a check made before later edits may list removed cards). */
export function currentCombos(deck: Deck, saved: SavedCombos | undefined): Combo[] {
  if (!saved) return [];
  const names = new Set(deck.entries.filter((e) => e.board === 'main').flatMap((e) => [e.card.name, e.card.name.split(' // ')[0]]));
  return saved.result.included.filter((c) => c.cards.every((n) => names.has(n) || names.has(n.split(' // ')[0])));
}

/** Tests: forget everything held in memory. */
export function resetCombosForTests() { states.clear(); }
