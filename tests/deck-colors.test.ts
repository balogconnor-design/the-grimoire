import { describe, expect, it } from 'vitest';
import type { Card, Deck, DeckEntry } from '../src/types';
import { colorBarBackground, colorShares, frontCost, frontPips, type ColorPipCounts } from '../src/lib/deckColors';
import { card } from './helpers';

const pips = (p: Partial<ColorPipCounts>): ColorPipCounts => ({ W: 0, U: 0, B: 0, R: 0, G: 0, ...p });
let n = 0;
const e = (c: Card, qty = 1, board: DeckEntry['board'] = 'main'): DeckEntry => ({ uid: `d${++n}`, qty, board, card: c });
const deckOf = (entries: DeckEntry[]): Deck => ({ id: 'd', name: 'D', format: 'commander', status: 'in-progress', entries, createdAt: 0, updatedAt: 0 } as Deck);

describe('front-face pips', () => {
  it('uses the front face of double-faced cards but both halves of split cards', () => {
    const esika = card('Esika, God of the Tree // The Prismatic Bridge', {
      layout: 'modal_dfc', mana_cost: undefined,
      card_faces: [{ name: 'Esika', mana_cost: '{1}{G}{G}' }, { name: 'The Prismatic Bridge', mana_cost: '{W}{U}{B}{R}{G}' }],
    });
    expect(frontCost(esika)).toBe('{1}{G}{G}');
    const fireIce = card('Fire // Ice', { layout: 'split', mana_cost: '{1}{R} // {1}{U}' });
    expect(frontCost(fireIce)).toBe('{1}{R} // {1}{U}');
  });

  it('counts main-deck spells only, hybrid and Phyrexian for each colour, ignoring rules text and lands', () => {
    const d = deckOf([
      e(card('Counterspell', { mana_cost: '{U}{U}', oracle_text: '{R}: ignored' }), 2),
      e(card('Kitchen Finks', { mana_cost: '{1}{G/W}{G/W}' })),
      e(card('Birthing Pod', { mana_cost: '{3}{G/P}' })),
      e(card('Steam Vents', { type_line: 'Land', mana_cost: '' })),
      e(card('Lightning Bolt', { mana_cost: '{R}' }), 1, 'side'),
      e(card('Sol Ring', { mana_cost: '{1}' })),
    ]);
    expect(frontPips(d)).toEqual({ W: 2, U: 4, B: 0, R: 0, G: 3 });
  });
});

describe('colour bar shares', () => {
  const pct = (s: { color: string; share: number }[]) => s.map((x) => [x.color, Math.round(x.share * 100)]);

  it('weights by pips with a 15% minimum for any colour present', () => {
    expect(pct(colorShares(pips({ U: 40, R: 1 })))).toEqual([['U', 85], ['R', 15]]);
    expect(pct(colorShares(pips({ U: 30, B: 10, R: 1 })))).toEqual([['U', 64], ['B', 21], ['R', 15]]);
    expect(pct(colorShares(pips({ W: 20, G: 20 })))).toEqual([['W', 50], ['G', 50]]);
  });

  it('always adds up to the whole bar, even with five colours and tiny splashes', () => {
    const five = colorShares(pips({ W: 100, U: 1, B: 1, R: 1, G: 1 }));
    expect(five.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 10);
    expect(pct(five)).toEqual([['W', 40], ['U', 15], ['B', 15], ['R', 15], ['G', 15]]);
  });

  it('keeps WUBRG order and is empty (grey) with no coloured pips', () => {
    expect(colorShares(pips({ G: 5, W: 5 })).map((x) => x.color)).toEqual(['W', 'G']);
    expect(colorShares(pips({}))).toEqual([]);
    expect(colorBarBackground([])).toBe('var(--mtg-c)');
    expect(colorBarBackground([{ color: 'U', share: 1 }])).toBe('var(--mtg-u)');
    expect(colorBarBackground(colorShares(pips({ U: 1, R: 1 })))).toMatch(/^linear-gradient\(90deg, var\(--mtg-u\) 0\.0%, var\(--mtg-u\) 46\.0%, var\(--mtg-r\) 54\.0%, var\(--mtg-r\) 100\.0%\)$/);
  });
});
