import type { Deck, DeckSnapshot } from '../types';
import { recordChanges } from './deckHistory';
import { uid } from './rules';
import { getDeck, snapshotsT, transact } from './store';

/** Default snapshot name: today's date and time, e.g. "Snapshot 21 Nov 2026, 14:05". */
export function defaultSnapshotName(now = new Date()): string {
  return `Snapshot ${now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

function snapshotOf(deck: Deck, name: string): DeckSnapshot {
  const now = Date.now();
  return { id: uid(), deckId: deck.id, name, entries: structuredClone(deck.entries), commanderUid: deck.commanderUid, createdAt: now, updatedAt: now };
}

/** Save the deck's current cards as a named snapshot. */
export async function saveSnapshot(deckId: string, name?: string): Promise<DeckSnapshot | undefined> {
  const deck = getDeck(deckId);
  if (!deck) return undefined;
  const snap = snapshotOf(deck, name?.trim() || defaultSnapshotName());
  await snapshotsT.put(snap, false);
  return snap;
}

export const deckSnapshots = (all: DeckSnapshot[], deckId: string) => all.filter((s) => s.deckId === deckId);

export function renameSnapshot(id: string, name: string) {
  const n = name.trim();
  if (n) snapshotsT.update(id, (s) => { s.name = n; });
}

export const deleteSnapshot = (id: string) => snapshotsT.remove(id);

/**
 * Put the deck's cards back to a snapshot. The current cards are saved as a snapshot first
 * ("Before restoring …"), so a restore can itself be undone. Name, format, notes and tags are kept.
 * Both writes happen in one transaction.
 */
export async function restoreSnapshot(snapId: string): Promise<void> {
  const snap = snapshotsT.get(snapId);
  const deck = snap && getDeck(snap.deckId);
  if (!snap || !deck) return;
  const backup = snapshotOf(deck, `Before restoring “${snap.name}”`);
  const next: Deck = { ...deck, entries: structuredClone(snap.entries), commanderUid: snap.commanderUid };
  next.changelog = recordChanges(deck, next, { note: `Restored snapshot “${snap.name}”` });
  await transact(['decks', 'decksnaps'], async (tx) => {
    tx.put('decksnaps', backup, false);
    tx.put('decks', next);
  });
}
