import type { Deck, DeckEntry } from '../types';
import { commanderEntry, isLand, sortEntries } from './rules';
import { byTagPriority } from './scryfallTags';

/** Tag lookups the deck views need: global tags and Scryfall tags, both by card name. */
export interface TagSources {
  global: Map<string, string[]>;
  scryfall: Map<string, string[]>;
}

/**
 * A deck entry's tags. `own` = tags you made (this deck's card tags, then global tags);
 * `scryfall` = automatic ones not already among them. `all` = own first, then Scryfall.
 */
export function entryTags(e: DeckEntry, src: TagSources): { own: string[]; scryfall: string[]; all: string[] } {
  const own = [...new Set([...(e.tags ?? []), ...(src.global.get(e.card.name) ?? [])])];
  const scryfall = (src.scryfall.get(e.card.name) ?? []).filter((t) => !own.includes(t));
  return { own, scryfall, all: [...own, ...scryfall] };
}

export const COMMANDER_GROUP = 'Commander';
export const LANDS_GROUP = 'Lands';
export const UNTAGGED_GROUP = 'Untagged';

/**
 * The group a card is listed under when the deck is grouped by tag:
 * - the commander gets its own group;
 * - the tag you dragged it to (`mainTag`), while the card still has that tag;
 * - otherwise your own first tag, then its first Scryfall tag (in Scryfall-tag priority order);
 * - lands with no tag of yours and no chosen tag go under Lands (Scryfall tags would scatter them);
 * - anything else: Untagged.
 */
export function mainGroup(deck: Deck, e: DeckEntry, src: TagSources): string {
  if (e.uid === commanderEntry(deck)?.uid) return COMMANDER_GROUP;
  const { own, all } = entryTags(e, src);
  if (e.mainTag && all.includes(e.mainTag)) return e.mainTag;
  if (own.length) return own[0];
  if (isLand(e.card)) return LANDS_GROUP;
  return all[0] ?? UNTAGGED_GROUP;
}

/** Group entries by main tag: Commander, your tags (A–Z), Scryfall tags (priority order), Lands, Untagged. */
export function groupByTag(deck: Deck, entries: DeckEntry[], src: TagSources): { key: string; entries: DeckEntry[]; scryfall: boolean }[] {
  const m = new Map<string, DeckEntry[]>();
  for (const e of entries) {
    const g = mainGroup(deck, e, src);
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(e);
  }
  const fixed = [COMMANDER_GROUP, LANDS_GROUP, UNTAGGED_GROUP];
  const ownTags = new Set(entries.flatMap((e) => entryTags(e, src).own));
  const keys = [...m.keys()].filter((k) => !fixed.includes(k));
  const mine = keys.filter((k) => ownTags.has(k)).sort((a, b) => a.localeCompare(b));
  const auto = keys.filter((k) => !ownTags.has(k)).sort(byTagPriority);
  return [COMMANDER_GROUP, ...mine, ...auto, LANDS_GROUP, UNTAGGED_GROUP]
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
