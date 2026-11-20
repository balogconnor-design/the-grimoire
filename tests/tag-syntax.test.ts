import { describe, expect, it } from 'vitest';
import { looksLikeQuery, parseQuery, splitForScryfall, type Subject } from '../src/lib/query';
import { card } from './helpers';

const subject = (over: Partial<Subject>): Subject => ({ card: card('Cultivate'), ...over });

describe('#tag search syntax', () => {
  it('matches a tag in any scope', () => {
    const q = parseQuery('#ramp');
    expect(q.test(subject({ cardTags: ['ramp'] }))).toBe(true);
    expect(q.test(subject({ collectionTags: ['Ramp'] }))).toBe(true);
    expect(q.test(subject({ deckTags: ['ramp'] }))).toBe(true);
    expect(q.test(subject({ cardTags: ['draw'] }))).toBe(false);
  });

  it('supports quotes, negation and OR', () => {
    expect(parseQuery('#"card draw"').test(subject({ cardTags: ['card draw'] }))).toBe(true);
    expect(parseQuery('-#ramp').test(subject({ cardTags: ['ramp'] }))).toBe(false);
    expect(parseQuery('#ramp or #draw').test(subject({ collectionTags: ['draw'] }))).toBe(true);
  });

  it('stays local when mixed with Scryfall terms', () => {
    expect(splitForScryfall('t:creature #ramp')).toEqual({ remote: 't:creature', local: '#ramp' });
    expect(splitForScryfall('#ramp')).toEqual({ remote: '', local: '#ramp' });
  });

  it('counts as query syntax in the deck list filter', () => {
    expect(looksLikeQuery('#ramp')).toBe(true);
    expect(looksLikeQuery('-#ramp')).toBe(true);
    expect(looksLikeQuery('sol ring')).toBe(false);
  });
});
