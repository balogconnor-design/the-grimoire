import { describe, expect, it } from 'vitest';
import type { Card, Deck, DeckEntry } from '../src/types';
import { atLeast, cardsSeen, exactly, oddsGroups, turnHint } from '../src/lib/drawOdds';
import type { TagSources } from '../src/lib/deckTags';
import { card } from './helpers';

describe('hypergeometric odds', () => {
  it('matches known values', () => {
    // 17 lands in 40, opening 7: P(at least 2) = 1 − (C(23,7) + 17·C(23,6)) / C(40,7) ≈ 0.8948
    expect(atLeast(40, 17, 7, 2)).toBeCloseTo(0.8948, 3);
    // 1 copy in 99, 7 cards: 7/99
    expect(atLeast(99, 1, 7, 1)).toBeCloseTo(7 / 99, 10);
    // 4 copies in 60, opening 7: ≈ 0.3995
    expect(atLeast(60, 4, 7, 1)).toBeCloseTo(0.3995, 3);
  });

  it('sums exact outcomes to 1', () => {
    let total = 0;
    for (let k = 0; k <= 7; k++) total += exactly(99, 36, 7, k);
    expect(total).toBeCloseTo(1, 10);
  });

  it('handles edges', () => {
    expect(atLeast(99, 0, 7, 1)).toBe(0);
    expect(atLeast(99, 2, 7, 3)).toBe(0);
    expect(atLeast(5, 5, 7, 5)).toBe(1); // drawing past the library end
    expect(atLeast(0, 0, 7, 1)).toBe(0);
    expect(atLeast(99, 10, 7, 0)).toBe(1);
  });

  it('counts cards seen by turn', () => {
    expect(cardsSeen(1, false)).toBe(7);
    expect(cardsSeen(1, true)).toBe(8);
    expect(cardsSeen(4, false)).toBe(10);
    expect(cardsSeen(4, true)).toBe(11);
  });
});

describe('odds groups', () => {
  let n = 0;
  const e = (c: Card, qty = 1, extra: Partial<DeckEntry> = {}): DeckEntry => ({ uid: `u${++n}`, qty, board: 'main', card: c, ...extra });
  const forest = card('Forest', { type_line: 'Basic Land — Forest', cmc: 0 });
  const sol = card('Sol Ring', { type_line: 'Artifact', cmc: 1 });
  const elf = card('Llanowar Elves', { type_line: 'Creature — Elf Druid', cmc: 1 });
  const cmdr = card('Omnath', { type_line: 'Legendary Creature — Elemental', cmc: 4 });
  const cmdEntry = e(cmdr);
  const deck: Deck = {
    id: 'd', name: 'Test', format: 'commander', commanderUid: cmdEntry.uid, createdAt: 0, updatedAt: 0,
    entries: [cmdEntry, e(forest, 30), e(sol, 1, { tags: ['ramp'] }), e(elf), e(card('Side Card'), 1, { board: 'side' })],
  } as Deck;
  const src: TagSources = { global: new Map(), scryfall: new Map([['Sol Ring', ['ramp', 'mana rock']], ['Llanowar Elves', ['ramp', 'mana dork']]]) };

  it('leaves out the commander and other boards, counts types and every tag', () => {
    const g = oddsGroups(deck, src);
    expect(g.library).toBe(32);
    expect(g.types.map((t) => [t.key, t.count])).toEqual([['Creature', 1], ['Artifact', 1], ['Land', 30]]);
    expect(g.tags.map((t) => [t.key, t.count])).toEqual([['ramp', 2], ['mana dork', 1], ['mana rock', 1]]);
  });
});

describe('turn hints', () => {
  it('match cardsSeen on the play and on the draw', () => {
    expect(turnHint(7, false)).toBe('opening hand');
    expect(turnHint(7, true)).toBe('opening hand');
    expect(turnHint(8, false)).toBe('turn 2');
    expect(turnHint(8, true)).toBe('turn 1');
    for (let t = 2; t <= 10; t++) {
      expect(turnHint(cardsSeen(t, false), false)).toBe('turn ' + t);
      expect(turnHint(cardsSeen(t, true), true)).toBe('turn ' + t);
    }
  });
});
