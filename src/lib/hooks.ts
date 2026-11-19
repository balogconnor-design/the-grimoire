import { useMemo } from 'react';
import type { Card, CollectionItem, Deck, DeckEntry, Finish } from '../types';
import type { Subject } from './query';
import { collectionT, decksT, useSettings } from './store';
import { computePool, nameKey, ownedByName, type PoolResult } from './ownership';

export function usePool(): PoolResult {
  const decks = decksT.useAll();
  const items = collectionT.useAll();
  const { ignoreBasics } = useSettings();
  return useMemo(() => computePool(decks, items, ignoreBasics), [decks, items, ignoreBasics]);
}

export function useOwnedByName(): Map<string, number> {
  const items = collectionT.useAll();
  return useMemo(() => ownedByName(items), [items]);
}

/** card name -> names of decks it appears in (any board). */
export function useDecksByCard(): Map<string, Deck[]> {
  const decks = decksT.useAll();
  return useMemo(() => {
    const m = new Map<string, Deck[]>();
    for (const d of decks) {
      for (const n of new Set(d.entries.map((e) => e.card.name))) {
        if (!m.has(n)) m.set(n, []);
        m.get(n)!.push(d);
      }
    }
    return m;
  }, [decks]);
}

/** Lots of this card (any print) in the collection. */
export function useLotsFor(card: Card | null | undefined): CollectionItem[] {
  const items = collectionT.useAll();
  return useMemo(() => (card ? items.filter((i) => nameKey(i.card) === nameKey(card)) : []), [items, card]);
}

export interface SubjectOpts {
  deckId?: string; // deck context: card tags / deck tags come from this deck only
  entry?: DeckEntry;
  item?: CollectionItem;
  finish?: Finish;
}

/** Builds search Subjects for any card, with tags from every scope, so one query works everywhere. */
export function useSubjects(): (card: Card, opts?: SubjectOpts) => Subject {
  const items = collectionT.useAll();
  const decks = decksT.useAll();
  return useMemo(() => {
    const lots = new Map<string, CollectionItem[]>();
    for (const i of items) {
      const k = nameKey(i.card);
      if (!lots.has(k)) lots.set(k, []);
      lots.get(k)!.push(i);
    }
    const inDecks = new Map<string, { deck: Deck; entries: DeckEntry[] }[]>();
    for (const d of decks) {
      const per = new Map<string, DeckEntry[]>();
      for (const e of d.entries) {
        if (!per.has(e.card.name)) per.set(e.card.name, []);
        per.get(e.card.name)!.push(e);
      }
      for (const [n, entries] of per) {
        if (!inDecks.has(n)) inDecks.set(n, []);
        inDecks.get(n)!.push({ deck: d, entries });
      }
    }
    return (card: Card, opts: SubjectOpts = {}): Subject => {
      const myLots = lots.get(nameKey(card)) ?? [];
      const uses = inDecks.get(card.name) ?? [];
      const scoped = opts.deckId ? uses.filter((u) => u.deck.id === opts.deckId) : uses;
      const deckEntries = opts.entry ? [opts.entry] : scoped.flatMap((u) => u.entries);
      const uniq = (xs: string[]) => [...new Set(xs)];
      return {
        card,
        finish: opts.item?.finish ?? opts.finish,
        item: opts.item,
        entry: opts.entry,
        favorite: opts.item ? opts.item.favorite
          : opts.entry ? !!opts.entry.favorite
            : myLots.some((i) => i.favorite) || deckEntries.some((e) => e.favorite),
        collectionTags: opts.item ? opts.item.tags : uniq(myLots.flatMap((i) => i.tags)),
        cardTags: uniq(deckEntries.flatMap((e) => e.tags ?? [])),
        deckTags: opts.deckId
          ? decks.find((d) => d.id === opts.deckId)?.tags ?? []
          : uniq(uses.flatMap((u) => u.deck.tags ?? [])),
        ownedQty: myLots.reduce((n, i) => n + i.qty, 0),
        decks: uses.map((u) => u.deck.name),
      };
    };
  }, [items, decks]);
}

export function useAllCollectionTags(): string[] {
  const items = collectionT.useAll();
  return useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((i) => i.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [items]);
}

export function useAllCardTags(): string[] {
  const decks = decksT.useAll();
  return useMemo(() => {
    const counts = new Map<string, number>();
    decks.forEach((d) => d.entries.forEach((e) => e.tags?.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1))));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [decks]);
}

export function useAllDeckTags(): string[] {
  const decks = decksT.useAll();
  return useMemo(() => [...new Set(decks.flatMap((d) => d.tags ?? []))].sort((a, b) => a.localeCompare(b)), [decks]);
}
