import type { Deck } from '../types';

/**
 * Commander Brackets (beta), as of Wizards' February 9, 2026 update:
 *   1 Exhibition – no Game Changers, no mass land denial, no extra-turn cards, no two-card combos
 *   2 Core       – no Game Changers, no mass land denial, extra turns in low quantity (not chained), no two-card combos
 *   3 Upgraded   – up to 3 Game Changers, no mass land denial, extra turns limited, no early-game two-card combos
 *   4 Optimized  – no limits
 *   5 cEDH       – no limits (decided by intent and competitive tuning, not by cards)
 * Tutor limits were removed in October 2025. Brackets are about intent, so cards only give a floor:
 * the lowest bracket the deck's cards allow. Two-card combos are checked later (Commander Spellbook).
 */
export const BRACKETS = [
  { n: 1, name: 'Exhibition' },
  { n: 2, name: 'Core' },
  { n: 3, name: 'Upgraded' },
  { n: 4, name: 'Optimized' },
  { n: 5, name: 'cEDH' },
] as const;
export type BracketNumber = 1 | 2 | 3 | 4 | 5;

export const BRACKET_GC_LIMIT = 3;
/** More extra-turn cards than this reads as "high quantity" (Brackets 2–3 expect a few, not chained). */
export const BRACKET_EXTRA_TURN_LIMIT = 2;

export const bracketName = (n: number) => BRACKETS.find((b) => b.n === n)?.name ?? '';

export interface BracketReason { bracket: BracketNumber; text: string }
export interface BracketEstimate {
  /** Lowest bracket the cards allow (1 means 1 or 2: cards can't tell those apart). */
  floor: BracketNumber;
  gameChangers: string[];
  massLandDenial: string[];
  extraTurns: string[];
  /** Single-target land destruction: no bracket rule, listed for information. */
  landDestruction: string[];
  reasons: BracketReason[];
}

const names = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));

/** Flag the main deck's cards (commander included) against the bracket rules. */
export function estimateBracket(deck: Deck, scryfallTags: Map<string, string[]>): BracketEstimate {
  const main = deck.entries.filter((e) => e.board === 'main');
  const tagged = (label: string) => main.filter((e) => (scryfallTags.get(e.card.name) ?? []).includes(label)).map((e) => e.card.name);
  const gameChangers = names(main.filter((e) => e.card.game_changer).map((e) => e.card.name));
  const massLandDenial = names(tagged('mass land denial'));
  const extraTurns = names(tagged('extra turn'));
  const landDestruction = names(tagged('land destruction')).filter((n) => !massLandDenial.includes(n));

  const reasons: BracketReason[] = [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (gameChangers.length > BRACKET_GC_LIMIT) {
    reasons.push({ bracket: 4, text: `${plural(gameChangers.length, 'Game Changer')}: Bracket 3 allows up to ${BRACKET_GC_LIMIT}` });
  } else if (gameChangers.length) {
    reasons.push({ bracket: 3, text: `${plural(gameChangers.length, 'Game Changer')}: none allowed in Brackets 1–2` });
  }
  if (massLandDenial.length) {
    reasons.push({ bracket: 4, text: `Mass land denial (${massLandDenial.length}): only allowed in Bracket 4 and up` });
  }
  if (extraTurns.length > BRACKET_EXTRA_TURN_LIMIT) {
    reasons.push({ bracket: 4, text: `${plural(extraTurns.length, 'extra-turn card')}: Brackets 2–3 expect only a few, never chained` });
  } else if (extraTurns.length) {
    reasons.push({ bracket: 2, text: `${plural(extraTurns.length, 'extra-turn card')}: none in Bracket 1; fine in 2–3 if not chained` });
  }
  const floor = Math.max(1, ...reasons.map((r) => r.bracket)) as BracketNumber;
  return { floor, gameChangers, massLandDenial, extraTurns, landDestruction, reasons: reasons.sort((a, b) => b.bracket - a.bracket) };
}

/** A saved target bracket, or undefined when it isn't a whole number 1–5. */
export function cleanTargetBracket(v: unknown): BracketNumber | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? (v as BracketNumber) : undefined;
}
