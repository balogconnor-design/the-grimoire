import type { Deck, DeckEntry } from '../types';
import { commanderEntry, isLand, sortEntries } from './rules';
import { byTagPriority, isScryfallTagLabel } from './scryfallTags';

/** Tag lookups the deck views need: global tags and Scryfall tags, both by card name. */
export interface TagSources {
  global: Map<string, string[]>;
  scryfall: Map<string, string[]>;
}

/**
 * A deck entry's tags. `own` = tags you made (this deck's card tags, then global tags);
 * `scryfall` = automatic ones not already among them (for showing as chips).
 * `all` = every tag, Scryfall's first (in priority order), then yours.
 */
export function entryTags(e: DeckEntry, src: TagSources): { own: string[]; scryfall: string[]; all: string[] } {
  const own = [...new Set([...(e.tags ?? []), ...(src.global.get(e.card.name) ?? [])])];
  const auto = src.scryfall.get(e.card.name) ?? [];
  const scryfall = auto.filter((t) => !own.includes(t));
  return { own, scryfall, all: [...new Set([...auto, ...own])] };
}

export const COMMANDER_GROUP = 'Commander';
export const LANDS_GROUP = 'Lands';
export const UNTAGGED_GROUP = 'Untagged';

/**
 * The group a card is listed under when the deck is grouped by tag:
 * - the commander gets its own group;
 * - the tag you dragged it to (`mainTag`), while the card still has that tag;
 * - lands go under Lands unless you tagged them yourself (Scryfall tags would scatter them);
 * - otherwise its first Scryfall tag (in Scryfall-tag priority order), then your own first tag;
 * - anything else: Untagged.
 */
export function mainGroup(deck: Deck, e: DeckEntry, src: TagSources): string {
  if (e.uid === commanderEntry(deck)?.uid) return COMMANDER_GROUP;
  const { own, all } = entryTags(e, src);
  if (e.mainTag && all.includes(e.mainTag)) return e.mainTag;
  if (isLand(e.card)) return own[0] ?? LANDS_GROUP;
  return all[0] ?? UNTAGGED_GROUP;
}

/** Group entries by main tag: Commander, Scryfall tags (priority order), your tags (A–Z), Lands, Untagged. */
export function groupByTag(deck: Deck, entries: DeckEntry[], src: TagSources): { key: string; entries: DeckEntry[]; scryfall: boolean }[] {
  const m = new Map<string, DeckEntry[]>();
  for (const e of entries) {
    const g = mainGroup(deck, e, src);
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(e);
  }
  const fixed = [COMMANDER_GROUP, LANDS_GROUP, UNTAGGED_GROUP];
  const keys = [...m.keys()].filter((k) => !fixed.includes(k));
  const auto = keys.filter(isScryfallTagLabel).sort(byTagPriority);
  const mine = keys.filter((k) => !isScryfallTagLabel(k)).sort((a, b) => a.localeCompare(b));
  return [COMMANDER_GROUP, ...auto, ...mine, LANDS_GROUP, UNTAGGED_GROUP]
    .filter((k) => m.has(k))
    .map((k) => ({ key: k, entries: m.get(k)!.sort(sortEntries), scryfall: auto.includes(k) }));
}

/** Group entries by mana value: Commander, 0 … 7+ (spells), then Lands. */
export function groupByManaValue(deck: Deck, entries: DeckEntry[]): { key: string; entries: DeckEntry[] }[] {
  const cmd = commanderEntry(deck)?.uid;
  const m = new Map<string, DeckEntry[]>();
  for (const e of entries) {
    const k = e.uid === cmd ? COMMANDER_GROUP : isLand(e.card) ? LANDS_GROUP : `Mana value ${Math.min(Math.floor(e.card.cmc ?? 0), 7)}${(e.card.cmc ?? 0) >= 7 ? '+' : ''}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(e);
  }
  const mv = [...m.keys()].filter((k) => k.startsWith('Mana value')).sort((a, b) => parseInt(a.slice(11), 10) - parseInt(b.slice(11), 10));
  return [COMMANDER_GROUP, ...mv, LANDS_GROUP].filter((k) => m.has(k)).map((k) => ({ key: k, entries: m.get(k)!.sort(sortEntries) }));
}

/**
 * For each tag a card has, the other cards in the deck (main deck and commander, one per name) with
 * that tag. Tags with no other cards are kept with an empty list.
 */
export function deckmatesByTag(deck: Deck, cardName: string, tags: string[], src: TagSources): { tag: string; entries: DeckEntry[] }[] {
  const pool = new Map<string, DeckEntry>();
  for (const e of deck.entries) if (e.board === 'main' && e.card.name !== cardName && !pool.has(e.card.name)) pool.set(e.card.name, e);
  const tagged = [...pool.values()].map((e) => ({ e, tags: entryTags(e, src).all }));
  return tags.map((tag) => ({
    tag,
    entries: tagged.filter((x) => x.tags.includes(tag)).map((x) => x.e).sort((a, b) => a.card.name.localeCompare(b.card.name)),
  }));
}
