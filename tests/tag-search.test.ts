import { describe, expect, it } from 'vitest';
import { liftScryfallTags } from '../src/lib/query';
import { scryfallOtagFor } from '../src/lib/scryfallTags';
import { appendResults } from '../src/lib/search';
import { card } from './helpers';

const lift = (q: string) => liftScryfallTags(q, scryfallOtagFor);

describe('Scryfall tags in the main search', () => {
  it('sends #tag, tag: and stag: for Scryfall tags to Scryfall as otag:', () => {
    expect(lift('#ramp')).toEqual({ otags: ['ramp'], rest: '' });
    expect(lift('t:creature #"mana dork" is:fav')).toEqual({ otags: ['mana-dork'], rest: 't:creature is:fav' });
    expect(lift('stag:mana-rock tag:draw')).toEqual({ otags: ['mana-rock', 'draw'], rest: '' });
    expect(lift('#"board wipe"').otags).toEqual(['boardwipe']);
  });

  it('leaves your own tags, negations, partial matches and OR groups alone', () => {
    expect(lift('#staple')).toEqual({ otags: [], rest: '#staple' });
    expect(lift('-#ramp t:artifact')).toEqual({ otags: [], rest: '-#ramp t:artifact' });
    expect(lift('#ram')).toEqual({ otags: [], rest: '#ram' });
    expect(lift('(#ramp or #draw)').otags).toEqual([]);
    expect(lift('gtag:ramp').otags).toEqual([]); // explicitly your global tag
  });

  it('keeps OR groups in the rest in brackets', () => {
    expect(lift('#ramp (t:elf or t:goblin)')).toEqual({ otags: ['ramp'], rest: '(t:elf or t:goblin)' });
  });
});

describe('appendResults', () => {
  const a = card('Sol Ring', { id: 'a' });
  const b = card('Sol Ring', { id: 'b' });
  const c = card('Mind Stone', { id: 'c' });
  it('skips names already shown, or printings when showing every printing', () => {
    expect(appendResults([a], [b, c]).map((x) => x.id)).toEqual(['a', 'c']);
    expect(appendResults([a], [b, c], 'prints').map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});
