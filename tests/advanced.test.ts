import { describe, expect, it } from 'vitest';
import { buildAdvanced, countAdvanced, EMPTY_ADV, type Adv } from '../src/lib/advanced';
import { liftScryfallTags } from '../src/lib/query';
import { scryfallOtagFor } from '../src/lib/scryfallTags';
import { splitForScryfall } from '../src/lib/query';

const adv = (over: Partial<Adv>): Adv => ({ ...EMPTY_ADV, ...over });

describe('advanced search builder', () => {
  it('builds nothing from an empty form', () => {
    expect(buildAdvanced(EMPTY_ADV)).toBe('');
    expect(countAdvanced(EMPTY_ADV)).toBe(0);
  });

  it('covers the Scryfall advanced search fields', () => {
    const q = buildAdvanced(adv({
      name: 'lightning bolt',
      oracle: 'deals 3 damage',
      types: [{ value: 'Instant', mode: 'is' }, { value: 'Sorcery', mode: 'is' }, { value: 'Kindred', mode: 'not' }],
      typesAny: true,
      colors: ['R', 'G'], colorMode: 'atmost',
      identity: ['R'],
      mana: '{R} ',
      stats: [{ stat: 'mv', op: '<=', value: '1' }, { stat: 'pow', op: '>', value: 'tou' }],
      games: ['paper', 'mtgo'],
      formats: [{ status: 'f', format: 'modern' }, { status: 'banned', format: 'pauper' }],
      sets: ['lea', '2xm'], block: 'zendikar', rarities: ['common'],
      criteria: { reprint: 'is', funny: 'not' },
      prices: [{ currency: 'usd', op: '>=', value: '1' }, { currency: 'eur', op: '<', value: '5' }],
      artist: 'Christopher Rush', flavor: 'thunder', lore: 'Jaya', lang: 'any', extras: true,
    }));
    expect(q).toBe([
      'name:lightning name:bolt', 'o:"deals 3 damage"', '(t:Instant or t:Sorcery)', '-t:Kindred', 'c<=rg', 'id<=r', 'm:{R}',
      'mv<=1', 'pow>tou', '(game:paper or game:mtgo)', 'f:modern', 'banned:pauper', '(s:lea or s:2xm)', 'b:zendikar',
      'r:common', 'is:reprint', '-is:funny', 'usd>=1', 'eur<5', 'a:"Christopher Rush"', 'ft:thunder', 'lore:Jaya',
      'lang:any', 'include:extras',
    ].join(' '));
  });

  it('handles colorless and all-types matching', () => {
    expect(buildAdvanced(adv({ colors: ['C'], identity: ['C'] }))).toBe('c=c id=c');
    expect(buildAdvanced(adv({ types: [{ value: 'Legendary', mode: 'is' }, { value: 'Creature', mode: 'is' }] }))).toBe('t:Legendary t:Creature');
  });

  it('keeps collection filters local and the rest for Scryfall', () => {
    const q = buildAdvanced(adv({ games: ['paper', 'arena'], criteria: { foil: 'not' }, owned: 'owned', tags: ['staple'] }));
    const split = splitForScryfall(q);
    expect(split.error).toBeUndefined();
    expect(split.remote).toContain('game:paper');
    expect(split.remote).toContain('game:arena');
    expect(split.remote).toContain('-is:foil');
    expect(split.local).toBe('is:owned #staple');
  });

  it('matches selected tags all, any or none, quoting tags with spaces', () => {
    expect(buildAdvanced(adv({ tags: ['ramp', 'card draw'] }))).toBe('#ramp #"card draw"');
    expect(buildAdvanced(adv({ tags: ['ramp', 'removal'], tagMode: 'any' }))).toBe('(#ramp or #removal)');
    expect(buildAdvanced(adv({ tags: ['ramp'], tagMode: 'any' }))).toBe('#ramp');
    expect(buildAdvanced(adv({ tags: ['ramp', 'staple'], tagMode: 'none' }))).toBe('-#ramp -#staple');
    expect(countAdvanced(adv({ tags: ['ramp', 'staple'] }))).toBe(2);
  });

  it('sends a Scryfall tag picked with All to Scryfall (otag:) and keeps your own tags local', () => {
    const lifted = liftScryfallTags(buildAdvanced(adv({ tags: ['mana rock', 'staple'] })), scryfallOtagFor);
    expect(lifted).toEqual({ otags: ['mana-rock'], rest: '#staple' });
  });

  it('counts set filters, including result options', () => {
    expect(countAdvanced(adv({ colors: ['W', 'U'], rarities: ['rare', 'mythic'], unique: 'prints' }))).toBe(3);
  });
});
