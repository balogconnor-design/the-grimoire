import type { Card } from '../types';
import { getCollection, getNamed, ScryfallError, type CollectionIdentifier } from './scryfall';

/** One parsed list line, as far as card lookup is concerned. */
export interface LookupLine {
  name: string;
  set?: string;
  collector?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Does this card satisfy the line? By name (full "A // B" name, either face's name, or a
 * front-face name for a two-faced card), or by collector number, which only counts when the
 * set matches too (collector numbers repeat across sets).
 */
export function lineMatches(line: LookupLine, c: Card): boolean {
  const n = norm(line.name);
  const names = [c.name, ...(c.card_faces?.map((f) => f.name) ?? [])].map(norm);
  if (names.includes(n) || norm(c.name).startsWith(n + ' //')) return true;
  return !!line.collector && !!line.set && c.collector_number === line.collector && c.set.toLowerCase() === line.set.toLowerCase();
}

export function identifierFor(l: LookupLine): CollectionIdentifier {
  return l.set && l.collector ? { set: l.set, collector_number: l.collector } : l.set ? { name: l.name, set: l.set } : { name: l.name };
}

async function namedOrNull(name: string, set?: string): Promise<Card | null> {
  try {
    return await getNamed(name, set);
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Look up list lines on Scryfall.
 * 1. One batched POST /cards/collection for every line (75 per request).
 * 2. Every line that came back unmatched is retried with an exact-name lookup (/cards/named),
 *    the same call the add-card flow uses. /cards/collection does not match full "A // B" names
 *    of two-faced cards (e.g. "Tony Stark // The Invincible Iron Man"), but /cards/named does.
 *    The full name is sent as written. Requests go through the shared Scryfall throttle.
 * Returns each line's card (matched) or the line itself (missing), in input order.
 */
export async function lookupLines<L extends LookupLine>(lines: L[]): Promise<{ matched: { line: L; card: Card }[]; missing: L[] }> {
  const results: (Card | null)[] = lines.map(() => null);
  if (!lines.length) return { matched: [], missing: [] };

  const { found } = await getCollection(lines.map(identifierFor));
  // Scryfall returns found cards in request order, skipping misses: claim them line by line.
  const pool = [...found];
  lines.forEach((line, i) => {
    const idx = pool.findIndex((c) => lineMatches(line, c));
    if (idx !== -1) results[i] = pool.splice(idx, 1)[0];
  });

  const cache = new Map<string, Card | null>();
  for (let i = 0; i < lines.length; i++) {
    if (results[i]) continue;
    const line = lines[i];
    const key = `${norm(line.name)}|${line.set ?? ''}`;
    if (!cache.has(key)) {
      let card = await namedOrNull(line.name, line.set);
      if (!card && line.set) card = await namedOrNull(line.name); // set code may be wrong or unknown to Scryfall
      cache.set(key, card);
    }
    const card = cache.get(key);
    if (card && lineMatches(line, card)) results[i] = card;
  }

  const matched: { line: L; card: Card }[] = [];
  const missing: L[] = [];
  lines.forEach((line, i) => {
    const card = results[i];
    if (card) matched.push({ line, card });
    else missing.push(line);
  });
  return { matched, missing };
}
