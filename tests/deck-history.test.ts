import { beforeEach, describe, expect, it } from 'vitest';
import type { Deck, DeckEntry } from '../src/types';
import { compareEntries, describeSession, diffEntries, recordChanges, SESSION_GAP } from '../src/lib/deckHistory';
import { restoreSnapshot, saveSnapshot } from '../src/lib/deckSnapshots';
import { addCard, moveEntry, newDeck, setCommander, setQty } from '../src/lib/actions';
import { makeBackup, parseBackup, restoreBackup } from '../src/lib/backup';
import { db, decksT, deleteDeck, getDeck, saveDeck, snapshotsT } from '../src/lib/store';
import { card, freshDb } from './helpers';

let n = 0;
const entry = (name: string, qty = 1, board: DeckEntry['board'] = 'main'): DeckEntry => ({ uid: `u${++n}`, qty, board, card: card(name) });
const deckWith = (entries: DeckEntry[], over: Partial<Deck> = {}): Deck => ({ ...newDeck('Test', 'commander'), entries, ...over });

describe('diffEntries', () => {
  it('counts per card name and board, ignoring printing swaps', () => {
    const before = [entry('Sol Ring'), entry('Island', 10), entry('Mind Stone')];
    const after = [{ ...entry('Sol Ring'), card: card('Sol Ring', { set: 'c21' }) }, entry('Island', 12), entry('Mind Stone', 1, 'side')];
    expect(diffEntries(before, after)).toEqual([
      { name: 'Island', board: 'main', delta: 2 },
      { name: 'Mind Stone', board: 'main', delta: -1 },
      { name: 'Mind Stone', board: 'side', delta: 1 },
    ]);
  });
});

describe('recordChanges', () => {
  const t0 = 1_000_000_000_000;
  it('groups changes within 30 minutes into one session and nets them out', () => {
    const d0 = deckWith([]);
    const d1 = { ...d0, entries: [entry('Sol Ring')] };
    d1.changelog = recordChanges(d0, d1, { now: t0 });
    const d2 = { ...d1, entries: [...d1.entries, entry('Mind Stone')] };
    d2.changelog = recordChanges(d1, d2, { now: t0 + SESSION_GAP - 1 });
    expect(d2.changelog).toHaveLength(1);
    expect(d2.changelog[0].items.map((i) => i.name)).toEqual(['Mind Stone', 'Sol Ring']);
    // Removing Sol Ring again cancels its add.
    const d3 = { ...d2, entries: d2.entries.filter((e) => e.card.name !== 'Sol Ring') };
    d3.changelog = recordChanges(d2, d3, { now: t0 + SESSION_GAP });
    expect(d3.changelog[0].items).toEqual([{ name: 'Mind Stone', board: 'main', delta: 1 }]);
    // Removing Mind Stone too empties the session, which disappears.
    const d4 = { ...d3, entries: [] };
    expect(recordChanges(d3, d4, { now: t0 + SESSION_GAP + 5 })).toEqual([]);
  });

  it('starts a new session after a 30-minute gap, and for every note', () => {
    const d0 = deckWith([]);
    const d1 = { ...d0, entries: [entry('Sol Ring')] };
    d1.changelog = recordChanges(d0, d1, { now: t0 });
    const d2 = { ...d1, entries: [...d1.entries, entry('Mind Stone')] };
    d2.changelog = recordChanges(d1, d2, { now: t0 + SESSION_GAP + 1 });
    expect(d2.changelog).toHaveLength(2);
    const d3 = { ...d2, entries: [...d2.entries, entry('Arcane Signet')] };
    d3.changelog = recordChanges(d2, d3, { now: t0 + SESSION_GAP + 2, note: 'Imported a list' });
    expect(d3.changelog).toHaveLength(3);
    expect(d3.changelog[2].note).toBe('Imported a list');
    // ...and nothing merges into a noted session.
    const d4 = { ...d3, entries: [...d3.entries, entry('Fellwar Stone')] };
    expect(recordChanges(d3, d4, { now: t0 + SESSION_GAP + 3 })).toHaveLength(4);
  });

  it('records commander changes and keeps the original "from" when merging', () => {
    const a = entry('Atraxa');
    const b = entry('Kenrith');
    const d0 = deckWith([a, b]);
    const d1 = { ...d0, commanderUid: a.uid };
    d1.changelog = recordChanges(d0, d1, { now: t0 });
    expect(d1.changelog[0].commander).toEqual({ from: undefined, to: 'Atraxa' });
    const d2 = { ...d1, commanderUid: b.uid };
    d2.changelog = recordChanges(d1, d2, { now: t0 + 1 });
    expect(d2.changelog[0].commander).toEqual({ from: undefined, to: 'Kenrith' });
  });

  it('leaves the changelog alone when no cards changed', () => {
    const d0 = deckWith([entry('Sol Ring')]);
    d0.changelog = recordChanges(undefined, d0, { now: t0 });
    const d1 = { ...d0, name: 'Renamed' };
    expect(recordChanges(d0, d1, { now: t0 + 1 })).toBe(d0.changelog);
  });
});

describe('describeSession', () => {
  it('shows board moves as moves', () => {
    const lines = describeSession({
      id: 's', startedAt: 0, at: 0,
      items: [{ name: 'Sol Ring', board: 'main', delta: -2 }, { name: 'Sol Ring', board: 'side', delta: 1 }, { name: 'Island', board: 'main', delta: 3 }],
    });
    expect(lines).toEqual([
      { kind: 'move', name: 'Sol Ring', qty: 1, from: 'main', to: 'side' },
      { kind: 'add', name: 'Island', qty: 3, board: 'main' },
      { kind: 'remove', name: 'Sol Ring', qty: 1, board: 'main' },
    ]);
  });
});

describe('compareEntries', () => {
  it('splits into only A, only B, different counts and same', () => {
    const a = [entry('Sol Ring'), entry('Island', 10), entry('Mind Stone'), entry('Counterspell', 1, 'side')];
    const b = [entry('Sol Ring'), entry('Island', 12), entry('Arcane Signet')];
    const c = compareEntries(a, b);
    expect(c.onlyA.map((r) => r.name)).toEqual(['Mind Stone']);
    expect(c.onlyB.map((r) => r.name)).toEqual(['Arcane Signet']);
    expect(c.changed).toMatchObject([{ name: 'Island', a: 10, b: 12 }]);
    expect(c.same.map((r) => r.name)).toEqual(['Sol Ring']);
    expect(compareEntries(a, b, 'side').onlyA.map((r) => r.name)).toEqual(['Counterspell']);
  });
});

describe('changelog and snapshots in storage', () => {
  beforeEach(freshDb);

  it('every deck edit is logged', async () => {
    const d = newDeck('Logged', 'commander');
    await saveDeck(d);
    addCard(d.id, card('Sol Ring'));
    addCard(d.id, card('Atraxa, Praetors\' Voice', { type_line: 'Legendary Creature — Phyrexian Angel Horror' }));
    setCommander(d.id, getDeck(d.id)!.entries[1].card);
    moveEntry(d.id, getDeck(d.id)!.entries[0].uid, 'side');
    const log = getDeck(d.id)!.changelog!;
    expect(log).toHaveLength(1);
    expect(log[0].commander?.to).toBe('Atraxa, Praetors\' Voice');
    expect(describeSession(log[0]).map((l) => l.kind)).toEqual(['add', 'add']); // Sol Ring now only on the side: added there
    expect(log[0].items).toContainEqual({ name: 'Sol Ring', board: 'side', delta: 1 });
  });

  it('restoring a snapshot saves the current cards first and logs a noted session', async () => {
    const d = newDeck('Snappy', 'commander');
    await saveDeck(d);
    addCard(d.id, card('Sol Ring'));
    const snap = await saveSnapshot(d.id, 'v1');
    addCard(d.id, card('Mind Stone'));
    setQty(d.id, getDeck(d.id)!.entries[0].uid, 0); // remove Sol Ring
    await restoreSnapshot(snap!.id);

    expect(getDeck(d.id)!.entries.map((e) => e.card.name)).toEqual(['Sol Ring']);
    const names = snapshotsT.all().map((s) => s.name);
    expect(names).toContain('v1');
    expect(names).toContain('Before restoring “v1”');
    const last = getDeck(d.id)!.changelog!.at(-1)!;
    expect(last.note).toBe('Restored snapshot “v1”');
    expect(last.items).toEqual([{ name: 'Mind Stone', board: 'main', delta: -1 }, { name: 'Sol Ring', board: 'main', delta: 1 }]);
    // Survives a reload from the database.
    await decksT.load();
    await snapshotsT.load();
    expect(snapshotsT.all()).toHaveLength(2);
  });

  it('deleting a deck deletes its snapshots', async () => {
    const d = newDeck('Gone', 'commander');
    await saveDeck(d);
    await saveSnapshot(d.id);
    await deleteDeck(d.id);
    expect(snapshotsT.all()).toHaveLength(0);
    expect(await (await db()).getAll('decksnaps')).toHaveLength(0);
  });

  it('backups carry snapshots and changelogs; older backups restore without them', async () => {
    const d = newDeck('Backed up', 'commander');
    await saveDeck(d);
    addCard(d.id, card('Sol Ring'));
    await saveSnapshot(d.id, 'keep me');
    const { backup, summary } = parseBackup(JSON.stringify(makeBackup()));
    expect(summary.deckSnapshots).toBe(1);
    await freshDb();
    await restoreBackup(backup);
    expect(snapshotsT.all().map((s) => s.name)).toEqual(['keep me']);
    expect(getDeck(d.id)!.changelog).toHaveLength(1);

    const old = parseBackup(JSON.stringify({ app: 'deckforge', version: 1, decks: [{ ...d, entries: [] }], deckSnapshots: [{ id: 'x', deckId: 'no-such-deck', entries: [] }] }));
    expect(old.backup.deckSnapshots).toHaveLength(0);
    expect(old.summary.dropped.deckSnapshots).toBe(1);
  });
});
