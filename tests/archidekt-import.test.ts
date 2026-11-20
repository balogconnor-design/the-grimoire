import { describe, expect, it } from 'vitest';
import { parseDecklist } from '../src/lib/actions';
import { parseCollectionList } from '../src/lib/collection';
import { categoryMeaning, splitListMarkup } from '../src/lib/listMarkup';

// Archidekt's default text export: `1x Name (set) 123 *F* [Category,...] ^Label,#color^`
const ARCHIDEKT = [
  '1x Jhoira, Ageless Innovator (dmu) 202 [Commander{top}]',
  '1x Sol Ring (c21) 263 *F* [Ramp,Artifact] ^Buy,#0066ff^',
  '1x Tony Stark // The Invincible Iron Man (msh) 80 [Draw]',
  '1x Academy Ruins (trc) 512 [Land]',
  '1x Lightning Bolt (clu) 141 [Removal,Burn{noPrice}]',
  '1x Doubling Season (a25) 155 [Maybeboard{noDeck}{noPrice}]',
  '1x Swords to Plowshares (sta) 10 [Sideboard{noDeck}{noPrice}]',
  '1x Wurmcoil Engine (som) 223 [Upgrades{noDeck}]',
].join('\n');

describe('splitListMarkup', () => {
  it('strips categories and color labels and reads their flags', () => {
    expect(splitListMarkup('1x Sol Ring (c21) 263 *F* [Ramp,Burn{noPrice}] ^Buy,#0066ff^')).toEqual({
      line: '1x Sol Ring (c21) 263 *F*',
      categories: [{ name: 'Ramp', flags: [] }, { name: 'Burn', flags: ['noprice'] }],
    });
  });

  it('leaves plain lines alone', () => {
    expect(splitListMarkup('4 Lightning Bolt (M10) 146')).toEqual({ line: '4 Lightning Bolt (M10) 146', categories: [] });
  });

  it('skips card-type categories as tags', () => {
    expect(categoryMeaning([{ name: 'Land', flags: [] }, { name: 'Card Draw', flags: [] }]).tags).toEqual(['card draw']);
  });
});

describe('parseDecklist: Archidekt export', () => {
  const lines = parseDecklist(ARCHIDEKT);
  const by = (name: string) => lines.find((l) => l.name === name)!;

  it('reads every card name, set and collector number', () => {
    expect(lines.map((l) => l.name)).toEqual([
      'Jhoira, Ageless Innovator', 'Sol Ring', 'Tony Stark // The Invincible Iron Man', 'Academy Ruins',
      'Lightning Bolt', 'Doubling Season', 'Swords to Plowshares', 'Wurmcoil Engine',
    ]);
    expect(by('Sol Ring')).toMatchObject({ qty: 1, set: 'c21', collector: '263' });
  });

  it('[Commander] sets the commander, without a tag', () => {
    expect(by('Jhoira, Ageless Innovator')).toMatchObject({ commander: true, board: 'main' });
    expect(by('Jhoira, Ageless Innovator').tags).toBeUndefined();
  });

  it('other categories become card tags; card types do not', () => {
    expect(by('Sol Ring').tags).toEqual(['ramp']);
    expect(by('Lightning Bolt').tags).toEqual(['removal', 'burn']);
    expect(by('Academy Ruins').tags).toBeUndefined();
  });

  it('Maybeboard, Sideboard and {noDeck} categories pick the board', () => {
    expect(by('Doubling Season').board).toBe('maybe');
    expect(by('Swords to Plowshares').board).toBe('side');
    expect(by('Wurmcoil Engine')).toMatchObject({ board: 'maybe', tags: ['upgrades'] });
    expect(by('Sol Ring').board).toBe('main');
  });
});

describe('parseCollectionList: Archidekt export', () => {
  it('reads names, printings and foil, ignoring categories', () => {
    const [jhoira, sol] = parseCollectionList(ARCHIDEKT);
    expect(jhoira).toMatchObject({ qty: 1, name: 'Jhoira, Ageless Innovator', set: 'dmu', cn: '202' });
    expect(sol).toMatchObject({ qty: 1, name: 'Sol Ring', set: 'c21', cn: '263', finish: 'foil' });
  });
});
