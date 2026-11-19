import type { Card, CollectionItem, Deck, WatchItem } from '../types';
import { cardPrice, isBasicLand } from './rules';
import { finishPrice } from './collection';

/** Decks match the collection by card name: any print you own counts. */
export const nameKey = (card: Card) => card.name;

export interface CardNeed {
  name: string;
  card: Card; // a representative print from the deck
  need: number;
  manual: number; // copies explicitly committed to this deck
  auto: number; // copies handed out from the free pool
  missing: number;
}

export interface DeckCoverage {
  deck: Deck;
  needs: Map<string, CardNeed>;
  totalNeed: number;
  covered: number;
  missing: number;
  missingCost: number;
  complete: boolean;
}

export interface PoolResult {
  byDeck: Map<string, DeckCoverage>;
  owned: Map<string, number>;
  order: Deck[];
  fullyCovered: number;
  allBuildable: boolean;
  shortfall: { name: string; card: Card; missing: number }[];
}

/** Cards a deck needs, by name: main + sideboard (maybeboard is "considering", not needed). */
export function deckNeeds(deck: Deck, ignoreBasics: boolean): Map<string, { card: Card; need: number }> {
  const m = new Map<string, { card: Card; need: number }>();
  for (const e of deck.entries) {
    if (e.board === 'maybe') continue;
    if (ignoreBasics && isBasicLand(e.card)) continue;
    const k = nameKey(e.card);
    const cur = m.get(k);
    if (cur) cur.need += e.qty;
    else m.set(k, { card: e.card, need: e.qty });
  }
  return m;
}

export function ownedByName(items: CollectionItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(nameKey(i.card), (m.get(nameKey(i.card)) ?? 0) + i.qty);
  return m;
}

/**
 * One shared pool: every deck is built at the same time from the same copies.
 * Manual allocations are honoured first; the remaining free copies go to decks in a
 * stable priority order (decks with manual allocations, then favourites, then most
 * recently edited) so the "decks covered" count doesn't jump around.
 */
export function computePool(decks: Deck[], items: CollectionItem[], ignoreBasics: boolean): PoolResult {
  const owned = ownedByName(items);
  const deckIds = new Set(decks.map((d) => d.id));

  // manual[name][deckId] = copies committed
  const manual = new Map<string, Map<string, number>>();
  const hasManual = new Set<string>();
  for (const i of items) {
    for (const [deckId, n] of Object.entries(i.allocations)) {
      if (!deckIds.has(deckId) || n <= 0) continue;
      const k = nameKey(i.card);
      if (!manual.has(k)) manual.set(k, new Map());
      manual.get(k)!.set(deckId, (manual.get(k)!.get(deckId) ?? 0) + n);
      hasManual.add(deckId);
    }
  }

  const order = [...decks].sort((a, b) =>
    Number(hasManual.has(b.id)) - Number(hasManual.has(a.id))
    || Number(!!b.favorite) - Number(!!a.favorite)
    || b.updatedAt - a.updatedAt);

  const needsByDeck = new Map(order.map((d) => [d.id, deckNeeds(d, ignoreBasics)]));

  // Free pool = owned minus copies manually committed (only up to what each deck needs).
  const free = new Map(owned);
  const manualUsed = new Map<string, Map<string, number>>();
  for (const [k, perDeck] of manual) {
    for (const [deckId, n] of perDeck) {
      const need = needsByDeck.get(deckId)?.get(k)?.need ?? 0;
      const use = Math.min(n, need);
      if (!manualUsed.has(k)) manualUsed.set(k, new Map());
      manualUsed.get(k)!.set(deckId, use);
      // Committed copies beyond the deck's need are still committed (unavailable to others).
      free.set(k, (free.get(k) ?? 0) - n);
    }
  }

  const byDeck = new Map<string, DeckCoverage>();
  const shortfall = new Map<string, { name: string; card: Card; missing: number }>();
  let fullyCovered = 0;
  for (const deck of order) {
    const needs = new Map<string, CardNeed>();
    let totalNeed = 0, covered = 0, missing = 0, missingCost = 0;
    for (const [k, { card, need }] of needsByDeck.get(deck.id)!) {
      const man = manualUsed.get(k)?.get(deck.id) ?? 0;
      const avail = Math.max(0, free.get(k) ?? 0);
      const auto = Math.min(need - man, avail);
      free.set(k, avail - auto);
      const miss = need - man - auto;
      needs.set(k, { name: k, card, need, manual: man, auto, missing: miss });
      totalNeed += need;
      covered += man + auto;
      missing += miss;
      if (miss > 0) {
        missingCost += (cardPrice(card) ?? 0) * miss;
        const s = shortfall.get(k) ?? { name: k, card, missing: 0 };
        s.missing += miss;
        shortfall.set(k, s);
      }
    }
    const complete = missing === 0;
    if (complete) fullyCovered++;
    byDeck.set(deck.id, { deck, needs, totalNeed, covered, missing, missingCost, complete });
  }

  return {
    byDeck, owned, order, fullyCovered,
    allBuildable: shortfall.size === 0,
    shortfall: [...shortfall.values()].sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name)),
  };
}

// ---------- Buy list ----------

export interface BuyLine {
  name: string;
  card: Card;
  need: number; // copies required (sum or max across decks)
  owned: number;
  buy: number;
  unit: number | null;
  decks: { deck: Deck; need: number; missing: number }[];
}

/**
 * sum: build every deck at once — buy the shared-pool shortfall.
 * max: you move cards between decks — you only need the most any single deck uses.
 */
export function buildBuyList(decks: Deck[], items: CollectionItem[], mode: 'sum' | 'max', ignoreBasics: boolean, pool?: PoolResult): BuyLine[] {
  const owned = ownedByName(items);
  const p = pool ?? computePool(decks, items, ignoreBasics);
  const perName = new Map<string, BuyLine>();
  for (const deck of decks) {
    for (const [k, { card, need }] of deckNeeds(deck, ignoreBasics)) {
      const line = perName.get(k) ?? { name: k, card, need: 0, owned: owned.get(k) ?? 0, buy: 0, unit: null, decks: [] };
      line.need = mode === 'sum' ? line.need + need : Math.max(line.need, need);
      const missing = p.byDeck.get(deck.id)?.needs.get(k)?.missing ?? 0;
      line.decks.push({ deck, need, missing });
      // Prefer the cheapest print any deck has chosen for the estimate.
      const cp = cardPrice(card);
      if (cp != null && (line.unit == null || cp < line.unit)) { line.unit = cp; line.card = card; }
      perName.set(k, line);
    }
  }
  const out: BuyLine[] = [];
  for (const line of perName.values()) {
    line.buy = mode === 'sum'
      ? line.decks.reduce((n, d) => n + d.missing, 0)
      : Math.max(0, line.need - line.owned);
    if (line.buy > 0) out.push(line);
  }
  return out.sort((a, b) => (b.unit ?? 0) * b.buy - (a.unit ?? 0) * a.buy || a.name.localeCompare(b.name));
}

export interface WantLine {
  kind: 'watch' | 'buy-intent';
  id: string;
  card: Card;
  finish: WatchItem['finish'];
  qty: number;
  unit: number | null;
  target?: number;
  hit: boolean;
}

/** Watchlist + collection lots marked "Buy more", with buy-target status. */
export function wantList(watch: WatchItem[], items: CollectionItem[]): WantLine[] {
  const w: WantLine[] = watch.map((x) => {
    const unit = finishPrice(x.card, x.finish);
    return { kind: 'watch', id: x.id, card: x.card, finish: x.finish, qty: x.qty, unit, target: x.targetPrice, hit: x.targetPrice != null && unit != null && unit <= x.targetPrice };
  });
  const b: WantLine[] = items.filter((i) => i.intent === 'buy').map((i) => {
    const unit = finishPrice(i.card, i.finish);
    return { kind: 'buy-intent', id: i.id, card: i.card, finish: i.finish, qty: 1, unit, target: i.targetPrice, hit: i.targetPrice != null && unit != null && unit <= i.targetPrice };
  });
  return [...w, ...b];
}

/** Commit enough free copies to cover a deck: writes manual allocations for everything it can cover. */
export function planAllocation(deck: Deck, items: CollectionItem[], pool: PoolResult): CollectionItem[] {
  const cov = pool.byDeck.get(deck.id);
  if (!cov) return [];
  const changed = new Map<string, CollectionItem>();
  // How many copies of each name are free (not committed to any deck)?
  for (const [k, n] of cov.needs) {
    let want = n.need - n.manual;
    if (want <= 0) continue;
    const lots = items.filter((i) => nameKey(i.card) === k);
    for (const lot of lots) {
      if (want <= 0) break;
      const cur = changed.get(lot.id) ?? structuredClone(lot);
      const committed = Object.values(cur.allocations).reduce((a, b) => a + b, 0);
      const take = Math.min(want, cur.qty - committed);
      if (take <= 0) continue;
      cur.allocations[deck.id] = (cur.allocations[deck.id] ?? 0) + take;
      want -= take;
      changed.set(lot.id, cur);
    }
  }
  return [...changed.values()];
}

export function releaseAllocation(deckId: string, items: CollectionItem[]): CollectionItem[] {
  return items.filter((i) => i.allocations[deckId]).map((i) => {
    const allocations = { ...i.allocations };
    delete allocations[deckId];
    return { ...i, allocations };
  });
}
