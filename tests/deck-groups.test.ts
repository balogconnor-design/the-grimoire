import { describe, expect, it } from 'vitest';
import type { Card, Deck, DeckEntry } from '../src/types';
import { colorGroupName, entrySorter, groupByColors } from '../src/lib/deckGroups';
import { card } from './helpers';

let n = 0;
const e = (c: Card, qty = 1): DeckEntry => ({ uid: `g${++n}`, qty, board: 'main', card: c });
const deckOf = (entries: DeckEntry[], commanderUid?: string): Deck =>
  ({ id: 'd', name: 'D', format: 'commander', status: 'in-progress', entries, commanderUid, createdAt: 0, updatedAt: 0 }) as Deck;

describe('colour group names', () => {
  it('uses mono, guild, shard/wedge, four-colour and five-colour names', () => {
    expect(colorGroupName(['U'])).toBe('Blue');
    expect(colorGroupName(['R', 'U'])).toBe('Izzet');
    expect(colorGroupName(['G', 'W'])).toBe('Selesnya');
    expect(colorGroupName(['W', 'U', 'B'])).toBe('Esper');
    expect(colorGroupName(['B', 'R', 'G'])).toBe('Jund');
    expect(colorGroupName(['W', 'B', 'G'])).toBe('Abzan');
    expect(colorGroupName(['U', 'B', 'R', 'G'])).toBe('Glint-Eye (no white)');
    expect(colorGroupName(['W', 'U', 'B', 'R', 'G'])).toBe('Five-Color');
    expect(colorGroupName([])).toBe('Colorless');
  });
});

describe('grouping by colour', () => {
  const cmdCard = card('Niv-Mizzet', { type_line: 'Legendary Creature', colors: ['U', 'R'], color_identity: ['U', 'R'] });
  const cmd = e(cmdCard);
  const bolt = e(card('Lightning Bolt', { type_line: 'Instant', colors: ['R'], color_identity: ['R'] }));
  const elec = e(card('Electrolyze', { type_line: 'Instant', colors: ['U', 'R'], color_identity: ['U', 'R'] }));
  const sol = e(card('Sol Ring', { type_line: 'Artifact', colors: [], color_identity: [] }));
  const isl = e(card('Island', { type_line: 'Basic Land — Island', colors: [], color_identity: ['U'] }), 10);
  const visions = e(card('Visions Card', { type_line: 'Artifact', colors: [], color_identity: ['U'] })); // colorless, blue identity
  const d = deckOf([cmd, bolt, elec, sol, isl, visions], cmd.uid);

  it('by identity: commander, mono, guilds…, colorless last; lands count by identity', () => {
    expect(groupByColors(d, d.entries, 'identity').map((g) => [g.key, g.entries.map((x) => x.card.name)])).toEqual([
      ['Commander', ['Niv-Mizzet']],
      ['Blue', ['Island', 'Visions Card']],
      ['Red', ['Lightning Bolt']],
      ['Izzet', ['Electrolyze']],
      ['Colorless', ['Sol Ring']],
    ]);
  });

  it('by colour: printed colours, colorless cards together, lands in their own section', () => {
    expect(groupByColors(d, d.entries, 'color').map((g) => g.key)).toEqual(['Commander', 'Red', 'Izzet', 'Colorless', 'Lands']);
  });
});

describe('sorting inside groups', () => {
  const a = e(card('Zed', { cmc: 1, prices: { usd: '5.00' }, rarity: 'common', type_line: 'Instant', colors: ['R'] }));
  const b = e(card('Abe', { cmc: 3, prices: { usd: '0.50' }, rarity: 'mythic', type_line: 'Creature — Elf', colors: ['G'] }));
  const c = e(card('Mid', { cmc: 2, prices: { usd: '2.00' }, rarity: 'rare', type_line: 'Artifact', colors: [] }));
  const names = (by: Parameters<typeof entrySorter>[0]) => [a, b, c].sort(entrySorter(by)).map((x) => x.card.name);
  it('sorts by each option', () => {
    expect(names('mv')).toEqual(['Zed', 'Mid', 'Abe']);
    expect(names('name')).toEqual(['Abe', 'Mid', 'Zed']);
    expect(names('price')).toEqual(['Zed', 'Mid', 'Abe']);
    expect(names('rarity')).toEqual(['Abe', 'Mid', 'Zed']);
    expect(names('type')).toEqual(['Abe', 'Zed', 'Mid']); // creature, instant, artifact (deck type order)
    expect(names('color')).toEqual(['Zed', 'Abe', 'Mid']); // red, green, colorless
  });
});
