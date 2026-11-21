import type { Deck } from '../types';
import { COMBO_TAG_LABEL, type Combo, type ComboTag } from '../../shared/spellbook';

/**
 * Commander Brackets (beta), as of Wizards' February 9, 2026 update:
 *   1 Exhibition – no Game Changers, no mass land denial, no extra-turn cards, no two-card combos
 *   2 Core       – no Game Changers, no mass land denial, extra turns in low quantity (not chained), no two-card combos
 *   3 Upgraded   – up to 3 Game Changers, no mass land denial, extra turns limited, no early-game two-card combos
 *   4 Optimized  – no limits
 *   5 cEDH       – no limits (decided by intent and competitive tuning, not by cards)
 * Tutor limits were removed in October 2025. Brackets are about intent, so cards only give a floor:
 * the lowest bracket the deck's cards allow. Combos come from a Commander Spellbook check (optional):
 * Spellbook rates each combo with a bracket-named tag, mapped to a bracket by COMBO_TAG_BRACKET.
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

/**
 * The lowest bracket a combo fits, from Commander Spellbook's tag. Exhibition and Core fit Brackets 1–2;
 * Powerful and Spicy (two-card combos that need setup or come late) fit Bracket 3; Ruthless (early,
 * cheap two-card wins and infinites such as Thassa's Oracle + Demonic Consultation) needs Bracket 4.
 * Oddball is treated like Core. Banned combos use a banned card, which the legality check already flags.
 */
export const COMBO_TAG_BRACKET: Record<ComboTag, BracketNumber | null> = { E: 1, C: 2, O: 2, P: 3, S: 3, R: 4, B: null };

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
  /** Combos from the last Commander Spellbook check that raise the floor, highest first. */
  combos: { combo: Combo; bracket: BracketNumber }[];
  reasons: BracketReason[];
}

const names = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));

/** Flag the main deck's cards (commander included) against the bracket rules. */
export function estimateBracket(deck: Deck, scryfallTags: Map<string, string[]>, checkedCombos: Combo[] = []): BracketEstimate {
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
  const combos = checkedCombos
    .map((combo) => ({ combo, bracket: combo.tag ? COMBO_TAG_BRACKET[combo.tag] : null }))
    .filter((c): c is { combo: Combo; bracket: BracketNumber } => c.bracket != null && c.bracket > 1)
    .sort((a, b) => b.bracket - a.bracket);
  for (const b of [4, 3, 2] as const) {
    const at = combos.filter((c) => c.bracket === b);
    if (!at.length) continue;
    const tags = [...new Set(at.map((c) => COMBO_TAG_LABEL[c.combo.tag!]))].join(' / ');
    const why = b === 4 ? 'early two-card combos need Bracket 4 and up' : b === 3 ? 'two-card combos fit from Bracket 3' : 'fine from Bracket 2';
    reasons.push({ bracket: b, text: `${plural(at.length, 'combo')} Commander Spellbook rates ${tags}: ${why}` });
  }
  const floor = Math.max(1, ...reasons.map((r) => r.bracket)) as BracketNumber;
  return { floor, gameChangers, massLandDenial, extraTurns, landDestruction, combos, reasons: reasons.sort((a, b) => b.bracket - a.bracket) };
}

/** A saved target bracket, or undefined when it isn't a whole number 1–5. */
export function cleanTargetBracket(v: unknown): BracketNumber | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? (v as BracketNumber) : undefined;
}
