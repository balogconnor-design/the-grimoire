import { describe, expect, it } from 'vitest';
import type { Card, DeckEntry } from '../src/types';
import { computeColorStats, computeCurve, computeManaBase, computeManaProducers, isLand, isMdfcLand, landManaColors, manaProducer } from '../src/lib/rules';
import { card, readFixture } from './helpers';

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

describe('mana producers', () => {
  // Real Scryfall oracle text (trimmed), so the parser is tested against actual wording.
  const fixture: Card[] = JSON.parse(readFixture('mana-producers.json')).map((c: Partial<Card> & { name: string }) => card(c.name, c));
  const byName = (name: string) => fixture.find((c) => c.name.startsWith(name))!;
  const prod = (name: string) => manaProducer(entry(byName(name)));

  it('reads gross and net mana, kind and colors', () => {
    expect(prod('Sol Ring')).toMatchObject({ kind: 'rock', gross: 2, net: 2, colors: ['C'], anyColor: false });
    expect(prod('Thran Dynamo')).toMatchObject({ gross: 3, net: 3, colors: ['C'] });
    expect(prod('Gilded Lotus')).toMatchObject({ gross: 3, net: 3, anyColor: true });
    expect(prod('Llanowar Elves')).toMatchObject({ kind: 'dork', gross: 1, net: 1, colors: ['G'] });
    expect(prod('Palladium Myr')).toMatchObject({ kind: 'dork', gross: 2, colors: ['C'] });
    expect(prod('Talisman of Creativity')).toMatchObject({ gross: 1, net: 1, colors: ['U', 'R', 'C'] });
    expect(prod('Wild Growth')).toMatchObject({ kind: 'other', gross: 1, colors: ['G'] });
  });

  it('notes filters with what they convert into', () => {
    expect(prod('Izzet Signet')).toMatchObject({ gross: 2, net: 1, colors: ['U', 'R'], filter: { from: '{1}', into: '{U}{R}' } });
    expect(prod('Celestial Prism')).toMatchObject({ gross: 1, net: -1, anyColor: true, filter: { from: '{2}', into: '1 of any color' } });
    expect(prod('Sol Ring')!.filter).toBeUndefined();
  });

  it('marks "for each" producers as variable', () => {
    expect(prod('Priest of Titania')).toMatchObject({ gross: null, net: null, colors: ['G'] });
    expect(prod('Elvish Archdruid')).toMatchObject({ gross: null, net: null });
  });

  it('leaves out rituals, Treasure makers, land ramp, one-shot sources, planeswalkers and lands', () => {
    for (const name of ['Dark Ritual', 'Smothering Tithe', 'Cultivate', 'Lotus Petal', 'Jeweled Lotus', "Mishra's Bauble",
      'Chandra, Torch of Defiance', 'Cryptolith Rite', 'Cabal Stronghold', 'Sink into Stupor']) {
      expect(prod(name), name).toBeNull();
    }
  });

  it('summarises counts, net total and fixing', () => {
    const sum = computeManaProducers([
      entry(byName('Sol Ring')), entry(byName('Izzet Signet'), 2), entry(byName('Birds of Paradise')),
      entry(byName('Priest of Titania')), entry(byName('Dark Ritual')),
    ]);
    expect(sum.count).toBe(5);
    expect(sum.byKind).toEqual({ rock: 3, dork: 2, other: 0 });
    expect(sum.netTotal).toBe(2 + 2 * 1 + 1);
    expect(sum.variable).toBe(1);
    expect(sum.fixing).toMatchObject({ U: 3, R: 2 + 1, G: 2, W: 1 });
    expect(sum.colorlessOnly).toBe(1);
    expect(sum.producers.map((p) => p.mv)).toEqual([...sum.producers.map((p) => p.mv)].sort((a, b) => a - b)); // sorted by MV
  });
});
