import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck, DeckEntry } from '../src/types';
import { csvColumn } from '../src/lib/scryfall';
import { parseQuery } from '../src/lib/query';
import { deckmatesByTag, deckTagCounts, defaultGroupTags, entryTags, groupByManaValue, groupByTag, mainGroup, type TagSources } from '../src/lib/deckTags';
import { readFileSync } from 'node:fs';
import { clearOldDownloads, indexTagData, loadScryfallTags, SCRYFALL_TAGS, scryfallTagsOf, setScryfallTagsForTests } from '../src/lib/scryfallTags';
import { db } from '../src/lib/store';
import { basic, card, freshDb } from './helpers';

describe('csvColumn', () => {
  it('reads one column, with quoted commas, quotes and two-faced names', () => {
    const csv = 'set,name,cmc\r\nC21,Sol Ring,1.0\r\nKHM,"Birgi, God of Storytelling // Harnfel, Horn of Bounty",3.0\r\nTST,"The ""Quoted"" One",2\r\n';
    expect(csvColumn(csv, 'name')).toEqual(['Sol Ring', 'Birgi, God of Storytelling // Harnfel, Horn of Bounty', 'The "Quoted" One']);
    expect(csvColumn(csv, 'nope')).toEqual([]);
  });
});

// A small deck: commander, a ramp rock that also draws, a removal spell, a land with a Scryfall tag, a vanilla card.
function sampleDeck(): Deck {
  const e = (uid: string, c: ReturnType<typeof card>, over: Partial<DeckEntry> = {}): DeckEntry => ({ uid, qty: 1, board: 'main', card: c, ...over });
  const entries = [
    e('cmd', card('Jhoira, Ageless Innovator', { type_line: 'Legendary Creature — Human Artificer' })),
    e('rock', card('Mind Stone', { cmc: 2 })),
    e('bolt', card('Lightning Bolt', { cmc: 1, type_line: 'Instant' })),
    e('ruins', card('Academy Ruins', { cmc: 0, type_line: 'Legendary Land' })),
    e('isl', basic('Island')),
    e('vanilla', card('Grizzly Bears', { cmc: 2, type_line: 'Creature — Bear' })),
  ];
  return { id: 'd', name: 'D', format: 'commander', status: 'in-progress', createdAt: 0, updatedAt: 0, entries, commanderUid: 'cmd' };
}

const src = (global: Record<string, string[]> = {}): TagSources => ({
  global: new Map(Object.entries(global)),
  scryfall: new Map([
    ['Mind Stone', ['ramp', 'mana rock', 'draw']],
    ['Lightning Bolt', ['removal', 'burn']],
    ['Academy Ruins', ['recursion']],
    ['Jhoira, Ageless Innovator', ['ramp']],
  ]),
});

describe('grouping a deck by tag', () => {
  it('commander first, then Scryfall tags in priority order, lands, untagged', () => {
    const d = sampleDeck();
    const groups = groupByTag(d, d.entries, src());
    expect(groups.map((g) => [g.key, g.entries.map((e) => e.uid)])).toEqual([
      ['Commander', ['cmd']],
      ['ramp', ['rock']],
      ['removal', ['bolt']],
      ['Lands', ['ruins', 'isl']],
      ['Untagged', ['vanilla']],
    ]);
  });

  it('Scryfall tags win over your own tags and sort before them', () => {
    const d = sampleDeck();
    d.entries.find((e) => e.uid === 'bolt')!.tags = ['interaction'];
    d.entries.find((e) => e.uid === 'rock')!.tags = ['artifact'];
    const s = src({ 'Grizzly Bears': ['beater'] });
    expect(mainGroup(d, d.entries.find((e) => e.uid === 'bolt')!, s)).toBe('removal');
    expect(mainGroup(d, d.entries.find((e) => e.uid === 'rock')!, s)).toBe('ramp');
    // Your own tag is used when the card has no Scryfall tag.
    expect(groupByTag(d, d.entries, s).map((g) => g.key)).toEqual(['Commander', 'ramp', 'removal', 'beater', 'Lands']);
  });

  it('lands stay under Lands unless you tagged them', () => {
    const d = sampleDeck();
    const ruins = d.entries.find((e) => e.uid === 'ruins')!;
    expect(mainGroup(d, ruins, src())).toBe('Lands'); // has the Scryfall tag "recursion"
    ruins.tags = ['utility land'];
    expect(mainGroup(d, ruins, src())).toBe('utility land');
    ruins.mainTag = 'recursion';
    expect(mainGroup(d, ruins, src())).toBe('recursion');
  });

  it('a section for a Scryfall tag is a Scryfall section even when you also use that tag', () => {
    const d = sampleDeck();
    d.entries.find((e) => e.uid === 'vanilla')!.tags = ['ramp'];
    const ramp = groupByTag(d, d.entries, src()).find((g) => g.key === 'ramp')!;
    expect(ramp.scryfall).toBe(true);
    expect(ramp.entries.map((e) => e.uid).sort()).toEqual(['rock', 'vanilla']);
  });

  it('a dragged main tag is used while the card still has it', () => {
    const d = sampleDeck();
    const rock = d.entries.find((e) => e.uid === 'rock')!;
    rock.mainTag = 'draw';
    expect(mainGroup(d, rock, src())).toBe('draw');
    rock.mainTag = 'gone';
    expect(mainGroup(d, rock, src())).toBe('ramp');
  });

  it('Scryfall tags already among your own tags are not repeated', () => {
    const d = sampleDeck();
    const rock = d.entries.find((e) => e.uid === 'rock')!;
    rock.tags = ['ramp'];
    expect(entryTags(rock, src())).toEqual({ own: ['ramp'], scryfall: ['mana rock', 'draw'], all: ['ramp', 'mana rock', 'draw'] });
  });

  it('groups by mana value with lands last', () => {
    const d = sampleDeck();
    expect(groupByManaValue(d, d.entries).map((g) => g.key)).toEqual(['Commander', 'Mana value 1', 'Mana value 2', 'Lands']);
  });
});

describe('grouping by chosen tags', () => {
  it('counts tags per main-deck card (commander left out), most common first', () => {
    const d = sampleDeck();
    d.entries.find((e) => e.uid === 'bolt')!.tags = ['ramp'];
    expect(deckTagCounts(d, src()).map((t) => [t.tag, t.count])).toEqual([
      ['ramp', 2], ['mana rock', 1], ['draw', 1], ['removal', 1], ['recursion', 1], ['burn', 1], // ties in priority order
    ]);
    expect(defaultGroupTags(d, src(), 2)).toEqual(['ramp', 'mana rock']);
  });

  it('uses only chosen tags, in Scryfall priority order; others go under Other, lands under Lands', () => {
    const d = sampleDeck();
    const chosen = { ...src(), chosen: ['draw', 'burn'] };
    const rock = d.entries.find((e) => e.uid === 'rock')!; // ramp, mana rock, draw
    const bolt = d.entries.find((e) => e.uid === 'bolt')!; // removal, burn
    expect(mainGroup(d, rock, chosen)).toBe('draw');
    expect(mainGroup(d, bolt, chosen)).toBe('burn');
    expect(groupByTag(d, d.entries, chosen).map((g) => g.key)).toEqual(['Commander', 'draw', 'burn', 'Lands', 'Other']);
  });

  it('keeps a dragged main tag only while it is chosen', () => {
    const d = sampleDeck();
    const rock = d.entries.find((e) => e.uid === 'rock')!;
    rock.mainTag = 'mana rock';
    expect(mainGroup(d, rock, { ...src(), chosen: ['mana rock', 'ramp'] })).toBe('mana rock');
    expect(mainGroup(d, rock, { ...src(), chosen: ['ramp'] })).toBe('ramp');
  });
});

describe('deckmatesByTag', () => {
  it('lists the other main-deck cards for each tag', () => {
    const d = sampleDeck();
    const mates = deckmatesByTag(d, 'Mind Stone', ['ramp', 'draw'], src());
    expect(mates.map((m) => [m.tag, m.entries.map((e) => e.card.name)])).toEqual([
      ['ramp', ['Jhoira, Ageless Innovator']],
      ['draw', []],
    ]);
  });
});

describe('searching Scryfall tags locally', () => {
  const subject = { card: card('Mind Stone'), scryfallTags: ['ramp', 'mana rock'] };
  it('#tag, tag:, stag: and otag: (label or Scryfall name)', () => {
    expect(parseQuery('#ramp').test(subject)).toBe(true);
    expect(parseQuery('stag:"mana rock"').test(subject)).toBe(true);
    expect(parseQuery('otag:mana-rock').test(subject)).toBe(true);
    expect(parseQuery('stag:removal').test(subject)).toBe(false);
    expect(parseQuery('gtag:ramp').test(subject)).toBe(false); // global tags only
    expect(parseQuery('is:tagged').test(subject)).toBe(true);
  });
});

describe('bundled Scryfall tags', () => {
  beforeEach(async () => { await freshDb(); });

  it('ships all 40 tags, each with cards, in the agreed priority order', async () => {
    const data = JSON.parse(readFileSync(new URL('../src/data/scryfall-tags.json', import.meta.url), 'utf8'));
    expect(SCRYFALL_TAGS).toHaveLength(40);
    expect(data.tags).toEqual(SCRYFALL_TAGS.map((t) => t.otag));
    data.cards.forEach((list: number[]) => expect(list.length).toBeGreaterThan(0));
    expect(SCRYFALL_TAGS.slice(0, 4).map((t) => t.label)).toEqual(['ramp', 'mana rock', 'mana dork', 'cost reducer']);
    expect(SCRYFALL_TAGS.map((t) => t.label)).toEqual(expect.arrayContaining(['artifact removal', 'enchantment removal', 'evasion', 'typal', 'landfall', 'blink', 'fog']));
  });

  it('loads without touching the network and tags real cards', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await loadScryfallTags();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(scryfallTagsOf('Sol Ring')).toEqual(expect.arrayContaining(['ramp', 'mana rock']));
    expect(scryfallTagsOf('Swords to Plowshares')).toContain('removal');
    fetchSpy.mockRestore();
  });

  it('indexes card lists into tags in priority order', () => {
    const m = indexTagData({ generated: 'x', tags: ['draw', 'ramp'], names: ['A', 'B'], cards: [[0, 1], [0]] });
    expect(m.get('A')).toEqual(['ramp', 'draw']); // ramp comes before draw in the priority order
    expect(m.get('B')).toEqual(['draw']);
  });

  it('clears the per-tag lists older versions downloaded', async () => {
    const d = await db();
    await d.put('meta', { key: 'stag:ramp', value: { names: ['X'], fetchedAt: 1 } });
    await d.put('meta', { key: 'settings', value: {} });
    await clearOldDownloads();
    expect(await d.get('meta', 'stag:ramp')).toBeUndefined();
    expect(await d.get('meta', 'settings')).toBeDefined();
  });
});
