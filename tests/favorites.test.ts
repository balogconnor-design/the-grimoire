import { beforeEach, describe, expect, it } from 'vitest';
import { addItems } from '../src/lib/collection';
import { newDeck, setCardFavorite, setGlobalTags } from '../src/lib/actions';
import { parseBackup } from '../src/lib/backup';
import { collectionT, decksT, globalTagsT, saveDeck } from '../src/lib/store';
import { card, freshDb } from './helpers';

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => { await freshDb(); });

describe('card favorites', () => {
  it('favorites a card you do not own, keeping a snapshot to list it', async () => {
    const sol = card('Sol Ring');
    setCardFavorite(sol, true);
    await settle();
    expect(globalTagsT.get('Sol Ring')).toMatchObject({ favorite: true, tags: [], card: { name: 'Sol Ring' } });
  });

  it('keeps global tags and favorite together, and drops the row when both are gone', async () => {
    const sol = card('Sol Ring');
    setGlobalTags(sol, ['staple']);
    setCardFavorite(sol, true);
    await settle();
    expect(globalTagsT.get('Sol Ring')).toMatchObject({ favorite: true, tags: ['staple'] });
    setCardFavorite(sol, false);
    await settle();
    expect(globalTagsT.get('Sol Ring')?.favorite).toBeUndefined();
    expect(globalTagsT.get('Sol Ring')?.tags).toEqual(['staple']);
    setGlobalTags(sol, []);
    await settle();
    expect(globalTagsT.get('Sol Ring')).toBeUndefined();
  });

  it('unfavoriting clears the star on collection lots and deck rows too', async () => {
    const sol = card('Sol Ring');
    await addItems([{ card: sol, qty: 1 }]);
    collectionT.update(collectionT.all()[0].id, (d) => { d.favorite = true; });
    const d = newDeck('Deck', 'commander');
    d.entries.push({ uid: 'e1', qty: 1, board: 'main', card: sol, favorite: true });
    await saveDeck(d);
    setCardFavorite(sol, false);
    await settle();
    expect(collectionT.all()[0].favorite).toBe(false);
    expect(decksT.all()[0].entries[0].favorite).toBe(false);
  });

  it('backups keep favorite-only rows', () => {
    const raw = { app: 'deckforge', version: 1, globalTags: [{ id: 'Sol Ring', card: card('Sol Ring'), tags: [], favorite: true, updatedAt: 1 }, { id: 'Empty', tags: [] }] };
    const { backup, summary } = parseBackup(JSON.stringify(raw));
    expect(backup.globalTags).toHaveLength(1);
    expect(backup.globalTags[0].favorite).toBe(true);
    expect(summary.dropped.globalTags).toBe(1);
  });
});
