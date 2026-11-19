import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionItem } from '../src/types';
import { addItems, disposeLots } from '../src/lib/collection';
import { makeBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import { buyDeck } from '../src/lib/ledger';
import {
  collectionT, db, decksT, deleteDeck, getSettings, onSaveError, ownedDecksT, pricesT, saveDeck, salesT, searchesT, setSettings, watchT,
} from '../src/lib/store';
import { newDeck } from '../src/lib/actions';
import { card, freshDb } from './helpers';

/** Make IDBObjectStore.put throw for one store, as if the disk write failed partway through. */
function failPutsTo(storeName: string) {
  const proto = globalThis.IDBObjectStore.prototype;
  const orig = proto.put;
  return vi.spyOn(proto, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === storeName) throw new DOMException('Simulated write failure', 'UnknownError');
    return orig.apply(this, args);
  });
}

const dbRows = async <T,>(store: string) => (await (await db()).getAll(store)) as T[];

let errors: string[] = [];
let unsub: () => void = () => undefined;
beforeEach(async () => {
  await freshDb();
  errors = [];
  unsub = onSaveError((m) => errors.push(m));
});
afterEach(() => {
  vi.restoreAllMocks();
  unsub();
});

describe('atomic multi-store writes', () => {
  it('disposeLots leaves no partial state when a write fails partway', async () => {
    await addItems([{ card: card('Sol Ring'), qty: 4, purchasePrice: 1 }]);
    const lot = collectionT.all()[0];
    const salesBefore = await dbRows('sales');
    expect(salesBefore).toHaveLength(1); // the "bought" row

    const spy = failPutsTo('collection'); // the sale row is queued first, then the lot update fails
    await expect(disposeLots([{ itemId: lot.id, qty: 2, price: 3 }], { kind: 'sold', date: '2026-11-19' })).rejects.toThrow();
    spy.mockRestore();

    expect(await dbRows('sales')).toHaveLength(1);
    expect((await dbRows<CollectionItem>('collection'))[0].qty).toBe(4);
    expect(salesT.all()).toHaveLength(1);
    expect(collectionT.get(lot.id)?.qty).toBe(4);
    expect(errors).toHaveLength(1);
  });

  it('addItems leaves no partial state when a write fails partway', async () => {
    const spy = failPutsTo('sales'); // lots are queued first, then the ledger write fails
    await expect(addItems([{ card: card('Arcane Signet'), qty: 2 }, { card: card('Mind Stone') }])).rejects.toThrow();
    spy.mockRestore();

    expect(await dbRows('collection')).toHaveLength(0);
    expect(await dbRows('sales')).toHaveLength(0);
    expect(collectionT.all()).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('a successful disposeLots updates the database and the screen together', async () => {
    await addItems([{ card: card('Sol Ring'), qty: 4, purchasePrice: 1 }]);
    const lot = collectionT.all()[0];
    expect(await disposeLots([{ itemId: lot.id, qty: 4, price: 3 }], { kind: 'sold', date: '2026-11-19' })).toBe(4);
    expect(await dbRows('collection')).toHaveLength(0);
    expect(collectionT.all()).toHaveLength(0);
    expect(salesT.all().map((s) => s.kind).sort()).toEqual(['bought', 'sold']);
  });

  it('deleteDeck releases allocations in the same transaction', async () => {
    const d = newDeck('Test', 'commander');
    await saveDeck(d);
    await addItems([{ card: card('Sol Ring'), qty: 1, allocations: { [d.id]: 1 } }]);
    await deleteDeck(d.id);
    expect(decksT.all()).toHaveLength(0);
    expect((await dbRows<CollectionItem>('collection'))[0].allocations).toEqual({});
  });

  it('buyDeck cost basis adds up exactly to the deck price', async () => {
    const lines = [
      { card: card('A', { prices: { usd: '9.99' } }), finish: 'nonfoil' as const, qty: 1 },
      { card: card('B', { prices: { usd: '3.33' } }), finish: 'nonfoil' as const, qty: 1 },
      { card: card('C', { prices: { usd: '0.10' } }), finish: 'nonfoil' as const, qty: 3 },
    ];
    await buyDeck({ name: 'Precon', lines, price: 49.99, date: '2026-11-19', commit: false, createDeck: true });
    const total = collectionT.all().reduce((s, i) => s + Math.round((i.purchasePrice ?? 0) * 100) * i.qty, 0);
    expect(total).toBe(4999);
    expect(ownedDecksT.all()).toHaveLength(1);
    expect(decksT.all()).toHaveLength(1);
  });

  it('a failed single-store save is reported and the table reloads from the database', async () => {
    const d = newDeck('Saved name', 'commander');
    await saveDeck(d);
    const spy = failPutsTo('decks');
    await expect(saveDeck({ ...d, name: 'Never saved' })).rejects.toThrow();
    spy.mockRestore();
    expect(decksT.get(d.id)?.name).toBe('Saved name');
    expect(errors).toHaveLength(1);
  });
});

describe('backup round trip', () => {
  it('export → parse → restore gives the same counts', async () => {
    const d = newDeck('Deck', 'commander');
    d.entries.push({ uid: 'e1', qty: 1, board: 'main', card: card('Sol Ring') });
    await saveDeck(d);
    await addItems([{ card: card('Sol Ring'), qty: 3, allocations: { [d.id]: 1 } }, { card: card('Mind Stone'), qty: 1 }]);
    const lot = collectionT.all().find((i) => i.card.name === 'Mind Stone')!;
    await disposeLots([{ itemId: lot.id, qty: 1, price: 2 }], { kind: 'traded', date: '2026-11-01' });
    await watchT.put({ id: 'w1', card: card('Mana Crypt'), finish: 'nonfoil', qty: 1, addedAt: 1, updatedAt: 1 });
    await pricesT.put({ id: '2026-11-18', prices: { x: [1, null, null] }, createdAt: 1, updatedAt: 1 });
    await searchesT.put({ id: 's1', name: 'Rocks', query: 't:artifact', createdAt: 1, updatedAt: 1 });
    setSettings({ ignoreBasics: false });

    const before = { decks: decksT.all().length, collection: collectionT.all().length, sales: salesT.all().length, watch: watchT.all().length };
    const text = JSON.stringify(makeBackup());
    const { backup, summary } = parseBackup(text);
    expect(summary.droppedTotal).toBe(0);

    await freshDb();
    expect(collectionT.all()).toHaveLength(0);
    await restoreBackup(backup);
    const after = { decks: decksT.all().length, collection: collectionT.all().length, sales: salesT.all().length, watch: watchT.all().length };
    expect(after).toEqual(before);
    expect(pricesT.all()).toHaveLength(1);
    expect(searchesT.all()).toHaveLength(1);
    expect(getSettings().ignoreBasics).toBe(false);

    // And it is really in the database, not only in memory.
    expect(await dbRows('collection')).toHaveLength(before.collection);
    expect(await dbRows('sales')).toHaveLength(before.sales);
  });

  it('restores a backup made before this change (v1, no ledger rows) and backfills the ledger', async () => {
    const legacy = {
      app: 'deckforge', version: 1, exportedAt: '2026-01-01T00:00:00.000Z',
      decks: [{ id: 'd1', name: 'Old deck', format: 'commander', status: 'finished', entries: [{ uid: 'u1', qty: 1, board: 'main', card: card('Sol Ring') }], createdAt: 1, updatedAt: 1 }],
      collection: [{ id: 'c1', card: card('Sol Ring'), finish: 'nonfoil', qty: 2, tags: [], favorite: false, allocations: { d1: 1 }, addedAt: 1, updatedAt: 1 }],
      watchlist: [], sales: [], prices: [], searches: [],
      settings: { buyListMode: 'sum', ignoreBasics: true, conditionAdjust: false },
    };
    const { backup, summary } = parseBackup(JSON.stringify(legacy));
    expect(summary.droppedTotal).toBe(0);
    await restoreBackup(backup);
    expect(decksT.all()).toHaveLength(1);
    expect(collectionT.all()[0].qty).toBe(2);
    expect(salesT.all()).toHaveLength(1);
    expect(salesT.all()[0].kind).toBe('bought');
    expect(getSettings().ledgerBackfilled).toBe(true);
  });

  it('drops invalid nested records, clamps allocations, and counts what was dropped', () => {
    const good = card('Sol Ring');
    const raw = {
      app: 'deckforge', version: 1,
      decks: [
        { id: 'd1', name: 'Deck', entries: [{ uid: 'a', qty: 1, board: 'main', card: good }, { uid: 'b', qty: 1, board: 'main', card: { id: 'x', name: 'No set' } }], commanderUid: 'b' },
        { name: 'no id', entries: [] },
      ],
      collection: [
        { id: 'c1', card: good, qty: 2, allocations: { d1: 2, d2: 2 } },
        { id: 'c2', card: good, qty: 0 },
        { id: 'c3', card: { id: 'y', name: 'Bad', set: 'tst' }, qty: 1 },
      ],
      sales: [
        { id: 's1', kind: 'sold', date: '2026-11-19', card: good, qty: 1 },
        { id: 's2', kind: 'gifted', date: '2026-11-19', card: good, qty: 1 },
        { id: 's3', kind: 'sold', date: '11/19/2026', card: good, qty: 1 },
      ],
    };
    const { backup, summary } = parseBackup(JSON.stringify(raw));
    expect(backup.decks).toHaveLength(1);
    expect(backup.decks[0].entries).toHaveLength(1);
    expect(backup.decks[0].commanderUid).toBeUndefined();
    expect(backup.collection.map((i) => i.id)).toEqual(['c1']);
    expect(Object.values(backup.collection[0].allocations).reduce((a, b) => a + b, 0)).toBe(2);
    expect(backup.sales.map((s) => s.id)).toEqual(['s1']);
    expect(summary.dropped).toMatchObject({ decks: 1, deckCards: 1, collection: 2, sales: 2, allocationsClamped: 1 });
    expect(summary.droppedTotal).toBe(6);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"app":"other","version":1}')).toThrow(/Grimoire backup/);
    expect(() => parseBackup('{"app":"deckforge","version":99}')).toThrow(/newer version/);
  });
});
