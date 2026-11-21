import type { Deck, DeckEntry } from '../types';
import { commanderEntry, TYPE_ORDER, typeCategory } from './rules';
import { entryTags, type TagSources } from './deckTags';

/** Natural log of n!, summed directly (n stays small: a deck is at most a few hundred cards). */
const logFactCache: number[] = [0];
function logFact(n: number): number {
  for (let i = logFactCache.length; i <= n; i++) logFactCache[i] = logFactCache[i - 1] + Math.log(i);
  return logFactCache[n];
}
function logChoose(n: number, k: number): number {
  return k < 0 || k > n ? -Infinity : logFact(n) - logFact(k) - logFact(n - k);
}

/** Hypergeometric P(X = k): exactly k hits when drawing `draws` cards from `population` holding `hits`. */
export function exactly(population: number, hits: number, draws: number, k: number): number {
  if (population <= 0) return 0;
  const n = Math.min(draws, population);
  return Math.exp(logChoose(hits, k) + logChoose(population - hits, n - k) - logChoose(population, n));
}

/** P(X ≥ k): at least k hits among `draws` cards. */
export function atLeast(population: number, hits: number, draws: number, k: number): number {
  if (k <= 0) return 1;
  const n = Math.min(draws, population);
  if (hits < k || n < k) return 0;
  let below = 0;
  for (let i = 0; i < k; i++) below += exactly(population, hits, n, i);
  return Math.min(1, Math.max(0, 1 - below));
}

/** Cards seen by your Nth turn: a 7-card hand plus one draw a turn, skipping the first draw on the play. */
export function cardsSeen(turn: number, onDraw: boolean): number {
  return 7 + Math.max(0, turn - 1) + (onDraw && turn >= 1 ? 1 : 0);
}

export interface OddsGroup {
  kind: 'type' | 'tag';
  key: string;
  count: number;
}

/**
 * The library you draw from (main deck minus the commander, who starts in the command zone)
 * and how many copies of each card type and tag it holds. Types follow the Card types panel
 * (one primary type per card); tags count every tag a card has (yours and Scryfall's), most first.
 */
export function oddsGroups(deck: Deck, src: TagSources): { library: number; types: OddsGroup[]; tags: OddsGroup[] } {
  const cmd = commanderEntry(deck)?.uid;
  const lib: DeckEntry[] = deck.entries.filter((e) => e.board === 'main' && e.uid !== cmd);
  const types = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const e of lib) {
    const t = typeCategory(e.card);
    types.set(t, (types.get(t) ?? 0) + e.qty);
    for (const tag of entryTags(e, src).all) tags.set(tag, (tags.get(tag) ?? 0) + e.qty);
  }
  return {
    library: lib.reduce((n, e) => n + e.qty, 0),
    types: TYPE_ORDER.filter((t) => types.has(t)).map((t) => ({ kind: 'type' as const, key: t, count: types.get(t)! })),
    tags: [...tags].map(([key, count]) => ({ kind: 'tag' as const, key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
  };
}

/** The first and last "by card N" choices: the opening hand up to turn 14 on the play. */
export const SEEN_MIN = 7;
export const SEEN_MAX = 20;

/** When you reach your Nth card, e.g. 7 → "opening hand", 9 → "turn 3 on the play, turn 2 on the draw". */
export function turnHint(seen: number): string {
  if (seen <= 7) return 'opening hand';
  return `turn ${seen - 6} on the play, turn ${seen - 7} on the draw`;
}
