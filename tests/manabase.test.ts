import { describe, expect, it } from 'vitest';
import type { Card, DeckEntry } from '../src/types';
import { computeColorStats, computeCurve, computeManaBase, isLand, isMdfcLand, landManaColors } from '../src/lib/rules';
import { card } from './helpers';

let n = 0;
const entry = (c: Card, qty = 1): DeckEntry => ({ uid: `e${++n}`, qty, board: 'main', card: c });

const island = card('Island', { type_line: 'Basic Land — Island', cmc: 0, produced_mana: ['U'] });
const mountain = card('Mountain', { type_line: 'Basic Land — Mountain', cmc: 0, produced_mana: ['R'] });
const bolt = card('Lightning Bolt', { type_line: 'Instant', cmc: 1, mana_cost: '{R}', colors: ['R'] });
const counter = card('Counterspell', { type_line: 'Instant', cmc: 2, mana_cost: '{U}{U}', colors: ['U'] });

// Shaped like Scryfall's modal_dfc objects: no top-level mana_cost, faces carry the costs.
const sink = card('Sink into Stupor // Soporific Springs', {
  layout: 'modal_dfc',
  cmc: 3,
  type_line: 'Instant // Land',
  colors: ['U'],
  produced_mana: ['U'],
  card_faces: [
    { name: 'Sink into Stupor', mana_cost: '{1}{U}{U}', type_line: 'Instant', colors: ['U'] },
    { name: 'Soporific Springs', mana_cost: '', type_line: 'Land', oracle_text: 'As Soporific Springs enters, you may pay 3 life.\n{T}: Add {U}.' },
  ],
});
const pathway = card('Riverglide Pathway // Lavaglide Pathway', {
  layout: 'modal_dfc',
  cmc: 0,
  type_line: 'Land // Land',
  produced_mana: ['U', 'R'],
  card_faces: [
    { name: 'Riverglide Pathway', type_line: 'Land', oracle_text: '{T}: Add {U}.' },
    { name: 'Lavaglide Pathway', type_line: 'Land', oracle_text: '{T}: Add {R}.' },
  ],
});

describe('MDFC lands', () => {
  it('recognises spell // land MDFCs but not land // land ones', () => {
    expect(isMdfcLand(sink)).toBe(true);
    expect(isLand(sink)).toBe(false);
    expect(isMdfcLand(pathway)).toBe(false);
    expect(isLand(pathway)).toBe(true);
    expect(isMdfcLand(counter)).toBe(false);
  });

  it('falls back to the land face text when produced_mana is missing', () => {
    expect(landManaColors({ ...sink, produced_mana: undefined })).toEqual(['U']);
  });

  it('keeps them as spells but reports them as separate sources', () => {
    const entries = [entry(island, 10), entry(mountain, 5), entry(sink, 2), entry(counter, 4), entry(bolt, 4)];
    const blue = computeColorStats(entries).find((s) => s.color === 'U')!;
    expect(blue.sources).toBe(10);
    expect(blue.mdfcSources).toBe(2);
    expect(blue.mdfcNames).toEqual(['2× Sink into Stupor // Soporific Springs']);
    expect(blue.pips).toBe(4 * 2 + 2 * 2); // Counterspell + Sink's front face
    expect(blue.cards).toBe(6);
    expect(computeCurve(entries)[3]).toBe(2); // still on the curve
  });

  it('counts them as full sources in the mana base check, outside the land count', () => {
    const mb = computeManaBase([entry(island, 10), entry(mountain, 5), entry(sink, 3), entry(counter, 4), entry(bolt, 4)]);
    expect(mb.lands).toBe(15);
    expect(mb.mdfcLands).toBe(3);
    const blue = mb.rows.find((r) => r.color === 'U')!;
    expect(blue.sources).toBe(10);
    expect(blue.mdfcSources).toBe(3);
    expect(blue.sourcePct).toBeCloseTo((13 / 18) * 100);
    expect(blue.coverage).toBeCloseTo((10 / 15) * 100);
  });

  it('still flags a color as critical when only MDFCs make it', () => {
    const mb = computeManaBase([entry(mountain, 10), entry(sink, 4), entry(counter, 4), entry(bolt, 4)]);
    const blue = mb.rows.find((r) => r.color === 'U')!;
    expect(blue.status).toBe('critical');
    expect(mb.worst?.color).toBe('U');
  });
});
