import { describe, expect, it } from 'vitest';
import type { CollectionItem, Deck, DeckEntry } from '../src/types';
import { computePool, ownedPriceSkips } from '../src/lib/ownership';
import { boardPrice, entryPrice } from '../src/lib/rules';
import { card } from './helpers';

const sol = card('Sol Ring', { prices: { usd: '2.00' } });
const bolt = card('Lightning Bolt', { prices: { usd: '1.00' } });
const entry = (uid: string, c = sol, qty = 1, over: Partial<DeckEntry> = {}): DeckEntry => ({ uid, qty, board: 'main', card: c, ...over });
const deck = (entries: DeckEntry[]): Deck => ({ id: 'd1', name: 'D', format: 'modern', status: 'in-progress', entries, createdAt: 0, updatedAt: 0 });
const owned = (c = sol, qty = 1): CollectionItem => ({ id: `i-${c.name}`, card: c, finish: 'nonfoil', qty, tags: [], favorite: false, allocations: {} });
const skipsFor = (d: Deck, items: CollectionItem[]) => ownedPriceSkips(d, computePool([d], items, false).byDeck.get(d.id));

describe('leaving owned cards out of the deck price', () => {
  it('counts every card unless it is marked', () => {
    const d = deck([entry('a'), entry('b', bolt)]);
    expect(skipsFor(d, [owned()]).size).toBe(0);
    expect(boardPrice(d, 'main', skipsFor(d, [owned()]))).toBe(3);
  });

  it('leaves out the owned copies of a marked card', () => {
    const d = deck([entry('a', sol, 1, { skipOwnedPrice: true }), entry('b', bolt)]);
    const skips = skipsFor(d, [owned()]);
    expect(skips.get('a')).toBe(1);
    expect(boardPrice(d, 'main', skips)).toBe(1);
    expect(entryPrice(d.entries[0], skips)).toBe(0);
  });

  it('only leaves out as many copies as you own', () => {
    const d = deck([entry('a', bolt, 4, { skipOwnedPrice: true })]);
    const skips = skipsFor(d, [owned(bolt, 1)]);
    expect(skips.get('a')).toBe(1);
    expect(boardPrice(d, 'main', skips)).toBe(3);
  });

  it('does nothing for cards you do not own, or in the maybeboard', () => {
    const d = deck([entry('a', sol, 1, { skipOwnedPrice: true }), entry('m', bolt, 1, { board: 'maybe', skipOwnedPrice: true })]);
    expect(skipsFor(d, [owned(bolt)]).size).toBe(0);
    expect(boardPrice(d, 'maybe', skipsFor(d, [owned(bolt)]))).toBe(1);
  });

  it('shares the owned copies between main and sideboard entries of the same card', () => {
    const d = deck([entry('a', bolt, 1, { skipOwnedPrice: true }), entry('s', bolt, 1, { board: 'side', skipOwnedPrice: true })]);
    const skips = skipsFor(d, [owned(bolt, 1)]);
    expect([...skips.values()].reduce((n, v) => n + v, 0)).toBe(1);
  });
});
