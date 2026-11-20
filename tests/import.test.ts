import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../src/types';
import { card, freshDb, hasFixture, readFixture } from './helpers';

// Mocked Scryfall layer: a tiny card "database". No network.
const { cards, collectionMisses } = vi.hoisted(() => ({ cards: new Map<string, Card>(), collectionMisses: new Set<string>() }));

vi.mock('../src/lib/scryfall', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/lib/scryfall')>();
  const byName = (name: string) => cards.get(name.toLowerCase());
  return {
    ...orig,
    // Like the real endpoint: name identifiers for full "A // B" names of two-faced cards are not found.
    getCollection: vi.fn(async (ids: Record<string, string>[]) => {
      const found: Card[] = [];
      const notFound: unknown[] = [];
      for (const id of ids) {
        const c = id.collector_number
          ? [...cards.values()].find((x) => x.set === id.set && x.collector_number === id.collector_number)
          : id.name.includes(' // ') || collectionMisses.has(id.name.toLowerCase()) ? undefined : byName(id.name);
        if (c) found.push(c); else notFound.push(id);
      }
      return { found, notFound };
    }),
    getNamed: vi.fn(async (name: string) => {
      const c = byName(name);
      if (!c) throw new orig.ScryfallError('No card found', 404);
      return c;
    }),
  };
});

const scryfall = await import('../src/lib/scryfall');
const { importDecklist, importNewDeck, exportDecklist, parseDecklist, newDeck, ImportError } = await import('../src/lib/actions');
const { decksT, saveDeck } = await import('../src/lib/store');
const { lookupLines } = await import('../src/lib/cardLookup');

const addCard = (c: Card) => { cards.set(c.name.toLowerCase(), c); return c; };

beforeEach(async () => {
  await freshDb();
  cards.clear();
  collectionMisses.clear();
  vi.mocked(scryfall.getNamed).mockClear();
});

describe('importDecklist matching', () => {
  it('matches a line the collection lookup misses but exact-name lookup finds (full "A // B" name)', async () => {
    addCard(card('Sol Ring'));
    const tony = addCard(card('Tony Stark // The Invincible Iron Man', { layout: 'modal_dfc', card_faces: [{ name: 'Tony Stark' }, { name: 'The Invincible Iron Man' }] }));
    const d = newDeck('T', 'commander');
    await saveDeck(d);

    const r = await importDecklist(d.id, '1 Sol Ring\n1 Tony Stark // The Invincible Iron Man\n', 'replace');
    expect(r).toMatchObject({ added: 2, matchedLines: 2, missing: [], lines: 2, cards: 2 });
    expect(scryfall.getNamed).toHaveBeenCalledWith('Tony Stark // The Invincible Iron Man', undefined); // full name, not the front face
    expect(decksT.get(d.id)!.entries.map((e) => e.card.id)).toContain(tony.id);
  });

  it('lists a line neither lookup finds as missing, and the counts add up', async () => {
    addCard(card('Sol Ring'));
    const d = newDeck('T', 'commander');
    await saveDeck(d);
    const r = await importDecklist(d.id, '1 Sol Ring\n3 Not A Real Card\n', 'replace');
    expect(r.missing).toEqual([{ name: 'Not A Real Card', qty: 3 }]);
    expect(r.added + r.missing.reduce((n, m) => n + m.qty, 0)).toBe(r.cards);
    expect(r.matchedLines + r.missing.length).toBe(r.lines);
  });

  it('imports the default printing: set and collector number in the list are ignored', async () => {
    const sol = addCard(card('Sol Ring', { set: 'c21', collector_number: '263' }));
    const d = newDeck('T', 'commander');
    await saveDeck(d);
    const r = await importDecklist(d.id, '1 Sol Ring (ZZZ) 999\n', 'replace');
    expect(r.added).toBe(1);
    expect(vi.mocked(scryfall.getCollection).mock.lastCall![0]).toEqual([{ name: 'Sol Ring' }]);
    expect(decksT.get(d.id)!.entries[0].card.id).toBe(sol.id);
  });
});

describe('lookupLines (collection lists keep printings)', () => {
  it('a collector number only matches when the set matches too', async () => {
    // The batch lookup returns a card with the same collector number from a different set and a different name.
    addCard(card('Other Card', { set: 'abc', collector_number: '42' }));
    const target = addCard(card('Wanted Card', { set: 'xyz', collector_number: '7' }));
    vi.mocked(scryfall.getCollection).mockResolvedValueOnce({ found: [cards.get('other card')!], notFound: [] });
    const r = await lookupLines([{ name: 'Wanted Card', set: 'xyz', collector: '42' }]);
    expect(r.missing).toEqual([]);
    expect(r.matched[0].card.id).toBe(target.id); // found by the exact-name retry, not the wrong-set card
  });

  it('sends set and collector number when the line has them', async () => {
    addCard(card('Sol Ring', { set: 'c21', collector_number: '263' }));
    await lookupLines([{ name: 'Sol Ring', set: 'c21', collector: '263' }]);
    expect(vi.mocked(scryfall.getCollection).mock.lastCall![0]).toEqual([{ set: 'c21', collector_number: '263' }]);
  });
});

describe('importNewDeck (main-menu import)', () => {
  it('names the deck after its commander and sets the commander', async () => {
    addCard(card('Jhoira, Ageless Innovator', { type_line: 'Legendary Creature — Human Artificer', color_identity: ['U', 'R'] }));
    addCard(card('Sol Ring'));
    const { deck, result } = await importNewDeck({ text: 'Commander\n1 Jhoira, Ageless Innovator\n\nDeck\n1 Sol Ring\n', format: 'commander' });
    expect(deck.name).toBe('Jhoira, Ageless Innovator');
    expect(deck.entries.find((e) => e.uid === deck.commanderUid)?.card.name).toBe('Jhoira, Ageless Innovator');
    expect(result.added).toBe(2);
  });

  it('falls back to the file name, then "Imported deck"', async () => {
    addCard(card('Sol Ring'));
    expect((await importNewDeck({ text: '1 Sol Ring', format: 'commander', fileName: 'My Artifacts.txt' })).deck.name).toBe('My Artifacts');
    expect((await importNewDeck({ text: '1 Sol Ring', format: 'commander' })).deck.name).toBe('Imported deck');
  });

  it('creates nothing when no card lines parse', async () => {
    await expect(importNewDeck({ text: '\n// just a comment\n', format: 'commander' })).rejects.toBeInstanceOf(ImportError);
    expect(decksT.all()).toHaveLength(0);
  });

  it('deletes the new deck when zero cards match, and reports the missing list', async () => {
    const err = await importNewDeck({ text: '1 Nothing Here\n2 Also Nothing', format: 'commander' }).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.result.missing).toHaveLength(2);
    expect(decksT.all()).toHaveLength(0);
  });
});

describe.skipIf(!hasFixture('jhoira-artifacts.txt'))('Jhoira fixture through the menu import', () => {
  it('imports all 100 cards (two-faced cards included) and round-trips names and quantities', async () => {
    const text = readFixture('jhoira-artifacts.txt');
    const lines = parseDecklist(text);
    for (const l of lines) {
      if (cards.has(l.name.toLowerCase())) continue;
      const faces = l.name.includes(' // ') ? l.name.split(' // ').map((name) => ({ name })) : undefined;
      addCard(card(l.name, {
        card_faces: faces,
        set: l.set ?? 'tst',
        ...(l.collector ? { collector_number: l.collector } : {}),
        type_line: l.commander ? 'Legendary Creature — Human Artificer' : l.name === 'Island' || l.name === 'Mountain' ? `Basic Land — ${l.name}` : 'Artifact',
      }));
    }
    const { deck, result } = await importNewDeck({ text, format: 'commander', fileName: 'jhoira-artifacts.txt' });
    expect(deck.name).toBe('Jhoira, Ageless Innovator');
    expect(result.missing).toEqual([]);
    expect(result.added).toBe(100);

    const qty = (t: string) => {
      const m = new Map<string, number>();
      for (const l of parseDecklist(t)) m.set(l.name, (m.get(l.name) ?? 0) + l.qty);
      return m;
    };
    const exported = exportDecklist(decksT.get(deck.id)!, true);
    expect(qty(exported)).toEqual(qty(text)); // names and quantities; printings are default on import by design
  });
});

describe('Archidekt export through the deck import', () => {
  it('sets the commander and brings categories in as card tags', async () => {
    addCard(card('Jhoira, Ageless Innovator', { type_line: 'Legendary Creature — Human Artificer' }));
    addCard(card('Sol Ring'));
    const d = newDeck('T', 'commander');
    await saveDeck(d);
    const r = await importDecklist(d.id, '1x Jhoira, Ageless Innovator (dmu) 202 [Commander{top}]\n1x Sol Ring (c21) 263 [Ramp,Artifact] ^Buy,#0066ff^\n', 'replace');
    expect(r).toMatchObject({ added: 2, missing: [] });
    const saved = decksT.get(d.id)!;
    const sol = saved.entries.find((e) => e.card.name === 'Sol Ring')!;
    expect(sol.tags).toEqual(['ramp']);
    expect(saved.entries.find((e) => e.uid === saved.commanderUid)?.card.name).toBe('Jhoira, Ageless Innovator');
  });
});
