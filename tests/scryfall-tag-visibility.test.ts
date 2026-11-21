import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Deck, DeckEntry } from '../src/types';
import { liftScryfallTags, parseQuery } from '../src/lib/query';
import { deckTagCounts, groupByTag } from '../src/lib/deckTags';
import {
  isScryfallTagLabel, loadScryfallTags, scryfallOtagFor, scryfallTagsOf, setAllScryfallTagsHidden, setScryfallTagHidden,
  setScryfallTagsForTests, setScryfallTagsOn, shownScryfallTags, SCRYFALL_TAGS, watchScryfallTagSettings,
} from '../src/lib/scryfallTags';
import { getSettings, loadSettings } from '../src/lib/store';
import { card, freshDb } from './helpers';

const LISTS = { ramp: ['Mind Stone'], 'mana-rock': ['Mind Stone'], removal: ['Lightning Bolt'] };

function deck(): Deck {
  const e = (uid: string, c: ReturnType<typeof card>, over: Partial<DeckEntry> = {}): DeckEntry => ({ uid, qty: 1, board: 'main', card: c, ...over });
  return {
    id: 'd', name: 'D', format: 'commander', status: 'in-progress', createdAt: 0, updatedAt: 0,
    entries: [e('rock', card('Mind Stone', { cmc: 2 }), { tags: ['artifact'] }), e('bolt', card('Lightning Bolt', { cmc: 1, type_line: 'Instant' }))],
  };
}
// What the deck views pass around: the shown tags only (as useScryfallTags returns them).
const shownMap = () => new Map(['Mind Stone', 'Lightning Bolt'].map((n) => [n, scryfallTagsOf(n)] as [string, string[]]).filter(([, l]) => l.length));
const src = () => ({ global: new Map<string, string[]>(), scryfall: shownMap() });

describe('Scryfall tags are opt-in', () => {
  it('are off with default settings', () => {
    expect(shownScryfallTags({}).size).toBe(0);
    expect(shownScryfallTags({ scryfallTags: true }).size).toBe(SCRYFALL_TAGS.length);
  });

  it('when off, cards have none, nothing groups by them and tag searches stay local', () => {
    setScryfallTagsForTests(LISTS, { scryfallTags: false });
    expect(scryfallTagsOf('Mind Stone')).toEqual([]);
    expect(isScryfallTagLabel('ramp')).toBe(false);
    expect(scryfallOtagFor('ramp')).toBeUndefined();
    expect(liftScryfallTags('#ramp', scryfallOtagFor)).toEqual({ otags: [], rest: '#ramp' });
    const d = deck();
    expect(groupByTag(d, d.entries, src()).map((g) => g.key)).toEqual(['artifact', 'Untagged']);
    expect(parseQuery('stag:ramp').test({ card: card('Mind Stone'), scryfallTags: scryfallTagsOf('Mind Stone') })).toBe(false);
  });
});

describe('hiding Scryfall tags one by one', () => {
  beforeEach(() => setScryfallTagsForTests(LISTS, { scryfallTags: true, hiddenScryfallTags: ['ramp'] }));

  it('drops only the hidden tag from cards, counts and grouping', () => {
    expect(scryfallTagsOf('Mind Stone')).toEqual(['mana rock']);
    expect(scryfallTagsOf('Lightning Bolt')).toEqual(['removal']);
    expect(isScryfallTagLabel('ramp')).toBe(false);
    expect(isScryfallTagLabel('mana rock')).toBe(true);
    const d = deck();
    expect(deckTagCounts(d, src()).map((t) => t.tag)).not.toContain('ramp');
    expect(groupByTag(d, d.entries, src()).map((g) => g.key)).toEqual(['mana rock', 'removal']);
  });

  it('a hidden tag is not sent to Scryfall from #tag, but other tags are', () => {
    expect(liftScryfallTags('#ramp #removal', scryfallOtagFor)).toEqual({ otags: ['removal'], rest: '#ramp' });
  });

  it('your own tag with the same name as a hidden one counts as yours', () => {
    const d = deck();
    d.entries[1].tags = ['ramp'];
    const counts = deckTagCounts(d, src());
    expect(counts.find((t) => t.tag === 'ramp')).toEqual({ tag: 'ramp', count: 1, scryfall: false });
  });
});

describe('Scryfall tag settings', () => {
  let stop: () => void = () => {};
  beforeEach(async () => {
    await freshDb();
    await loadSettings();
    stop = watchScryfallTagSettings();
  });
  afterEach(() => stop());

  it('turning on loads the bundled tags; hiding and showing apply straight away and are saved', async () => {
    setScryfallTagsOn(true);
    await loadScryfallTags();
    expect(scryfallTagsOf('Sol Ring')).toEqual(expect.arrayContaining(['ramp', 'mana rock']));

    setScryfallTagHidden('ramp', true);
    expect(getSettings().hiddenScryfallTags).toEqual(['ramp']);
    expect(scryfallTagsOf('Sol Ring')).not.toContain('ramp');
    expect(scryfallTagsOf('Sol Ring')).toContain('mana rock');

    setAllScryfallTagsHidden(true);
    expect(scryfallTagsOf('Sol Ring')).toEqual([]);
    setAllScryfallTagsHidden(false);
    expect(scryfallTagsOf('Sol Ring')).toContain('ramp');

    // Off keeps the hidden list for next time.
    setScryfallTagHidden('mana rock', true);
    setScryfallTagsOn(false);
    expect(scryfallTagsOf('Sol Ring')).toEqual([]);
    setScryfallTagsOn(true);
    expect(scryfallTagsOf('Sol Ring')).toContain('ramp');
    expect(scryfallTagsOf('Sol Ring')).not.toContain('mana rock');

    await loadSettings(); // saved to IndexedDB, not only in memory
    expect(getSettings()).toMatchObject({ scryfallTags: true, hiddenScryfallTags: ['mana rock'] });
  });
});

