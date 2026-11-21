import type { Card } from '../types';
import { getCollection } from './scryfall';

/**
 * Scryfall cards for names that come from elsewhere (EDHREC suggestions, Commander Spellbook combos),
 * so they can be opened, dragged and shown on hover like search results. Kept in memory for the visit.
 */
const cache = new Map<string, Card | null>();

/** A looked-up card: undefined = not looked up yet, null = Scryfall didn't find it. */
export const cardByName = (name: string): Card | null | undefined => cache.get(name);

/** Look up names on Scryfall (75 per request), skipping names already looked up. */
export async function loadCardsByName(names: string[]): Promise<void> {
  const todo = [...new Set(names)].filter((n) => !cache.has(n));
  if (!todo.length) return;
  const { found } = await getCollection(todo.map((name) => ({ name })));
  const byName = new Map<string, Card>();
  for (const c of found) {
    byName.set(c.name, c);
    for (const f of c.card_faces ?? []) if (f.name && !byName.has(f.name)) byName.set(f.name, c);
  }
  for (const n of todo) cache.set(n, byName.get(n) ?? byName.get(n.split(' // ')[0]) ?? null);
}

/** Tests: forget every lookup. */
export function resetCardsByNameForTests() { cache.clear(); }
