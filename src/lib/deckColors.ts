import type { Card, Deck } from '../types';
import { isLand, parseSymbols } from './rules';

/**
 * Deck colours for the library tiles: what the deck actually casts. Only front-face casting costs of
 * main-deck cards count (commander included). Back faces, costs in rules text and colour identity are
 * ignored; legality, search limits and the basic land adder still use colour identity.
 */
export const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;
export type ColorPipCounts = Record<(typeof WUBRG)[number], number>;

/** The cost printed on the card's front: split and adventure cards keep both halves (both are on the front). */
export function frontCost(c: Card): string {
  return c.mana_cost ? c.mana_cost : c.card_faces?.[0]?.mana_cost ?? '';
}

/** Coloured pips in the main deck's front-face costs. Hybrid and Phyrexian pips count for each colour in them. */
export function frontPips(deck: Deck): ColorPipCounts {
  const pips: ColorPipCounts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const e of deck.entries) {
    if (e.board !== 'main' || isLand(e.card)) continue;
    for (const sym of parseSymbols(frontCost(e.card))) {
      for (const c of new Set(sym.split('/'))) if (c in pips) pips[c as keyof ColorPipCounts] += e.qty;
    }
  }
  return pips;
}

/** Smallest share of the bar for any colour that's present, so a single splash pip still shows. */
export const MIN_SHARE = 0.15;

/**
 * Bar widths: each colour's share of the pips, with every present colour at least MIN_SHARE. Colours
 * below it are raised to it and the rest share what's left in proportion to their pips, repeated until
 * none is below (always possible: 5 × 15% = 75%). WUBRG order. Empty when there are no coloured pips.
 */
export function colorShares(pips: ColorPipCounts, min = MIN_SHARE): { color: string; share: number }[] {
  const present = WUBRG.filter((c) => pips[c] > 0);
  if (!present.length) return [];
  const fixed = new Set<string>();
  let shares = new Map<string, number>();
  for (;;) {
    const free = present.filter((c) => !fixed.has(c));
    const left = 1 - fixed.size * min;
    const freePips = free.reduce((n, c) => n + pips[c], 0);
    shares = new Map(present.map((c) => [c, fixed.has(c) ? min : (pips[c] / freePips) * left]));
    const under = free.filter((c) => shares.get(c)! < min - 1e-9);
    if (!under.length) break;
    under.forEach((c) => fixed.add(c));
  }
  return present.map((color) => ({ color, share: shares.get(color)! }));
}

const VAR: Record<string, string> = { W: 'var(--mtg-w)', U: 'var(--mtg-u)', B: 'var(--mtg-b)', R: 'var(--mtg-r)', G: 'var(--mtg-g)' };
/** Half-width of the blend between two neighbouring colours, as a fraction of the bar. */
const BLEND = 0.04;

/** CSS background for the bar: solid bands that blend smoothly where they meet; grey when there are no coloured pips. */
export function colorBarBackground(shares: { color: string; share: number }[]): string {
  if (!shares.length) return 'var(--mtg-c)';
  if (shares.length === 1) return VAR[shares[0].color];
  const stops: string[] = [];
  let at = 0;
  shares.forEach(({ color, share }, i) => {
    const start = i === 0 ? 0 : Math.min(at + BLEND, at + share / 2);
    const end = i === shares.length - 1 ? 1 : Math.max(at + share - BLEND, at + share / 2);
    stops.push(`${VAR[color]} ${(start * 100).toFixed(1)}%`, `${VAR[color]} ${(end * 100).toFixed(1)}%`);
    at += share;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
