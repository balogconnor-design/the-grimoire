import type { Card, Deck, DeckEntry } from '../types';
import { cardPrice, commanderEntry, frontTypeLine, isLand, sortEntries, typeCategory, TYPE_ORDER } from './rules';
import { COMMANDER_GROUP, LANDS_GROUP } from './deckTags';

/**
 * Deck list grouping by colour and the sort orders inside groups.
 * Colour names follow MTG convention: guilds (two colours), shards and wedges (three), the
 * four-colour Nephilim names, and Five-Color.
 */
const WUBRG = ['W', 'U', 'B', 'R', 'G'];
const key = (colors: string[]) => WUBRG.filter((c) => colors.includes(c)).join('');

/** Name and display order for every colour combination. */
const COMBOS: [string, string][] = [
  ['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'],
  ['WU', 'Azorius'], ['UB', 'Dimir'], ['BR', 'Rakdos'], ['RG', 'Gruul'], ['WG', 'Selesnya'],
  ['WB', 'Orzhov'], ['UR', 'Izzet'], ['BG', 'Golgari'], ['WR', 'Boros'], ['UG', 'Simic'],
  ['WUG', 'Bant'], ['WUB', 'Esper'], ['UBR', 'Grixis'], ['BRG', 'Jund'], ['WRG', 'Naya'],
  ['WBG', 'Abzan'], ['WUR', 'Jeskai'], ['UBG', 'Sultai'], ['WBR', 'Mardu'], ['URG', 'Temur'],
  ['UBRG', 'Glint-Eye (no white)'], ['WBRG', 'Dune-Brood (no blue)'], ['WURG', 'Ink-Treader (no black)'],
  ['WUBG', 'Witch-Maw (no red)'], ['WUBR', 'Yore-Tiller (no green)'],
  ['WUBRG', 'Five-Color'],
];
const COMBO_NAME = new Map(COMBOS);
const COMBO_ORDER = new Map(COMBOS.map(([k], i) => [k, i]));
export const COLORLESS_GROUP = 'Colorless';

/** "Azorius", "Jund", "Colorless"… for a set of colours. */
export const colorGroupName = (colors: string[]): string => COMBO_NAME.get(key(colors)) ?? COLORLESS_GROUP;

/** A card's colours as printed on its front (colour identity is a separate grouping). */
const frontColors = (c: Card) => c.colors ?? c.card_faces?.[0]?.colors ?? [];

/**
 * Group by colour identity or by colour: the commander first, then each combination in the usual
 * order (mono, guilds, shards and wedges, four-colour, five), then colorless. Grouped by colour,
 * lands (which have no colour) get their own section.
 */
export function groupByColors(deck: Deck, entries: DeckEntry[], mode: 'identity' | 'color', sort: (a: DeckEntry, b: DeckEntry) => number = sortEntries): { key: string; entries: DeckEntry[] }[] {
  const cmd = commanderEntry(deck)?.uid;
  const m = new Map<string, DeckEntry[]>();
  const comboKey = new Map<string, string>();
  for (const e of entries) {
    let name: string;
    if (e.uid === cmd) name = COMMANDER_GROUP;
    else if (mode === 'color' && isLand(e.card)) name = LANDS_GROUP;
    else {
      const colors = mode === 'identity' ? e.card.color_identity ?? [] : frontColors(e.card);
      name = colorGroupName(colors);
      comboKey.set(name, key(colors));
    }
    if (!m.has(name)) m.set(name, []);
    m.get(name)!.push(e);
  }
  const order = (name: string) => (name === COMMANDER_GROUP ? -1 : name === COLORLESS_GROUP ? 900 : name === LANDS_GROUP ? 1000 : COMBO_ORDER.get(comboKey.get(name) ?? '') ?? 800);
  return [...m.keys()].sort((a, b) => order(a) - order(b)).map((k) => ({ key: k, entries: m.get(k)!.sort(sort) }));
}

// ---------- Sorting inside groups ----------

export type SortBy = 'name' | 'mv' | 'price' | 'type' | 'color' | 'rarity';
export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'mv', label: 'Mana value' },
  { value: 'name', label: 'Name' },
  { value: 'price', label: 'Price (high first)' },
  { value: 'type', label: 'Type' },
  { value: 'color', label: 'Color' },
  { value: 'rarity', label: 'Rarity (mythic first)' },
];
const RARITY = ['mythic', 'rare', 'uncommon', 'common', 'special', 'bonus'];
const byName = (a: DeckEntry, b: DeckEntry) => a.card.name.localeCompare(b.card.name);
const colorRank = (c: Card) => {
  const k = key(frontColors(c));
  return k ? COMBO_ORDER.get(k) ?? 800 : isLand(c) ? 1000 : 900;
};

/** A comparator for entries: the chosen order, ties broken by name. */
export function entrySorter(by: SortBy): (a: DeckEntry, b: DeckEntry) => number {
  switch (by) {
    case 'name': return byName;
    case 'price': return (a, b) => (cardPrice(b.card) ?? -1) - (cardPrice(a.card) ?? -1) || byName(a, b);
    case 'type': return (a, b) => TYPE_ORDER.indexOf(typeCategory(a.card)) - TYPE_ORDER.indexOf(typeCategory(b.card)) || frontTypeLine(a.card).localeCompare(frontTypeLine(b.card)) || byName(a, b);
    case 'color': return (a, b) => colorRank(a.card) - colorRank(b.card) || byName(a, b);
    case 'rarity': return (a, b) => {
      const r = (e: DeckEntry) => { const i = RARITY.indexOf(e.card.rarity); return i < 0 ? 99 : i; };
      return r(a) - r(b) || byName(a, b);
    };
    default: return sortEntries; // mana value, then name
  }
}
