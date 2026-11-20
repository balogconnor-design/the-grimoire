import type { Card, CollectionItem, Condition, Deck, Finish, Intent, PriceSnapshot, SaleRecord, WatchItem } from '../types';
import { getCollection } from './scryfall';
import { lookupLines } from './cardLookup';
import { splitListMarkup } from './listMarkup';
import { cardPrice, uid } from './rules';
import { collectionT, decksT, getSettings, pricesT, setSettings, transact, watchT, type Tx } from './store';

// ---------- Constants ----------

export const CONDITIONS: { id: Condition; label: string; mult: number }[] = [
  { id: 'NM', label: 'Near Mint', mult: 1 },
  { id: 'LP', label: 'Lightly Played', mult: 0.85 },
  { id: 'MP', label: 'Moderately Played', mult: 0.7 },
  { id: 'HP', label: 'Heavily Played', mult: 0.5 },
  { id: 'DMG', label: 'Damaged', mult: 0.35 },
];

export const SOURCES = [
  'TCGplayer', 'Card Kingdom', 'Star City Games', 'Mana Pool', 'CoolStuffInc', 'ChannelFireball',
  'eBay', 'Amazon', 'Cardmarket', 'Local game store', 'Opened (booster/precon)', 'Trade', 'Gift',
];

export const INTENTS: { id: Intent; label: string; short: string }[] = [
  { id: 'hold', label: 'Hold', short: 'Hold' },
  { id: 'sell', label: 'Sell', short: 'Sell' },
  { id: 'trade', label: 'Trade', short: 'Trade' },
  { id: 'sell-trade', label: 'Sell or trade', short: 'Sell/Trade' },
  { id: 'buy', label: 'Buy more', short: 'Buy' },
];
export const intentLabel = (i?: Intent) => INTENTS.find((x) => x.id === i)?.short ?? '';
export const isForSale = (i?: Intent) => i === 'sell' || i === 'trade' || i === 'sell-trade';

export const FINISH_LABEL: Record<Finish, string> = { nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched' };

export const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => dateKey(new Date());

// ---------- Pricing ----------

const num = (s?: string | null) => (s ? parseFloat(s) : null);

export function finishPrice(card: Card, finish: Finish): number | null {
  if (finish === 'foil') return num(card.prices?.usd_foil);
  if (finish === 'etched') return num(card.prices?.usd_etched);
  return num(card.prices?.usd);
}

export function defaultFinish(card: Card): Finish {
  const f = card.finishes ?? [];
  if (!f.length || f.includes('nonfoil')) return 'nonfoil';
  return f.includes('foil') ? 'foil' : 'etched';
}

export function availableFinishes(card: Card): Finish[] {
  const f = (card.finishes ?? []).filter((x): x is Finish => x === 'nonfoil' || x === 'foil' || x === 'etched');
  return f.length ? f : ['nonfoil', 'foil'];
}

/** Current per-copy value (optionally condition-adjusted). */
export function itemUnitValue(item: Pick<CollectionItem, 'card' | 'finish' | 'condition'>, adjust = getSettings().conditionAdjust): number | null {
  const p = finishPrice(item.card, item.finish);
  if (p == null) return null;
  if (!adjust || !item.condition) return p;
  return p * (CONDITIONS.find((c) => c.id === item.condition)?.mult ?? 1);
}

export interface PL {
  value: number; // current value of the copies that have a price
  cost: number; // purchase cost of copies with a known purchase price
  /** P/L only over copies that have BOTH a purchase price and a current price. */
  pl: number;
  plBase: number;
  pct: number | null;
  priced: number; // copies with a current price
  costed: number; // copies with a purchase price
  qty: number;
}

export function computePL(items: CollectionItem[], adjust = getSettings().conditionAdjust): PL {
  const r: PL = { value: 0, cost: 0, pl: 0, plBase: 0, pct: null, priced: 0, costed: 0, qty: 0 };
  for (const i of items) {
    const v = itemUnitValue(i, adjust);
    r.qty += i.qty;
    if (v != null) { r.value += v * i.qty; r.priced += i.qty; }
    if (i.purchasePrice != null) { r.cost += i.purchasePrice * i.qty; r.costed += i.qty; }
    if (v != null && i.purchasePrice != null) {
      r.pl += (v - i.purchasePrice) * i.qty;
      r.plBase += i.purchasePrice * i.qty;
    }
  }
  r.pct = r.plBase > 0 ? (r.pl / r.plBase) * 100 : null;
  return r;
}

export function itemPL(i: CollectionItem) {
  const v = itemUnitValue(i);
  if (v == null || i.purchasePrice == null) return { diff: null, pct: null };
  const diff = (v - i.purchasePrice) * i.qty;
  return { diff, pct: i.purchasePrice > 0 ? ((v - i.purchasePrice) / i.purchasePrice) * 100 : null };
}

/** Strength of a percentage move, for styling: strong ≥ 25%, mild ≥ 2%. */
export function moveClass(pct: number | null | undefined): string {
  if (pct == null || Math.abs(pct) < 2) return 'flat';
  if (pct >= 25) return 'gain-strong';
  if (pct > 0) return 'gain';
  if (pct <= -25) return 'loss-strong';
  return 'loss';
}

// ---------- Print identification ----------

/** Badges for notable treatments: showcase, borderless, extended art, etc. */
export function printBadges(card: Card): string[] {
  const out: string[] = [];
  const fe = card.frame_effects ?? [];
  if (card.border_color === 'borderless') out.push('Borderless');
  if (fe.includes('showcase')) out.push('Showcase');
  if (fe.includes('extendedart')) out.push('Extended');
  if (fe.includes('inverted')) out.push('Inverted');
  if (card.full_art && !card.type_line?.includes('Basic')) out.push('Full art');
  if (card.promo_types?.includes('serialized')) out.push('Serialized');
  else if (card.promo_types?.includes('textured')) out.push('Textured');
  else if (card.promo_types?.includes('galaxyfoil')) out.push('Galaxy');
  else if (card.promo_types?.includes('surgefoil')) out.push('Surge');
  else if (card.promo) out.push('Promo');
  if (card.lang && card.lang !== 'en') out.push(card.lang.toUpperCase());
  return out;
}

const ALT_ART = new Set(['Borderless', 'Showcase', 'Extended', 'Inverted', 'Full art']);
/** Alternate frame/art treatments (not foil-only stamps like Surge/Galaxy, not language). */
export const isAltArt = (card: Card) => printBadges(card).some((b) => ALT_ART.has(b));

// ---------- Collection actions ----------

export interface NewItemInput {
  card: Card;
  finish?: Finish;
  qty?: number;
  condition?: Condition;
  purchasePrice?: number;
  acquiredAt?: string;
  source?: string;
  tags?: string[];
  intent?: Intent;
  targetPrice?: number;
  allocations?: Record<string, number>;
  notes?: string;
  favorite?: boolean;
}

export function makeItem(input: NewItemInput): CollectionItem {
  const now = Date.now();
  return {
    id: uid(),
    card: input.card,
    finish: input.finish ?? defaultFinish(input.card),
    qty: Math.max(1, input.qty ?? 1),
    condition: input.condition,
    purchasePrice: input.purchasePrice,
    acquiredAt: input.acquiredAt,
    source: input.source,
    tags: input.tags ?? [],
    favorite: input.favorite ?? false,
    intent: input.intent,
    targetPrice: input.targetPrice,
    allocations: input.allocations ?? {},
    notes: input.notes,
    addedAt: now,
    updatedAt: now,
  };
}

/** Same lot = same print, finish, condition, price, date, source. Merging keeps the inventory tidy. */
function sameLot(a: CollectionItem, b: CollectionItem) {
  return a.card.id === b.card.id && a.finish === b.finish && a.condition === b.condition
    && a.purchasePrice === b.purchasePrice && a.acquiredAt === b.acquiredAt && a.source === b.source;
}

export interface AddOpts {
  /** Write ledger rows for these copies (default true). */
  log?: boolean;
  kind?: 'bought' | 'received';
  /** Extra fields for every ledger row (group, counterparty, venue…). */
  tx?: Partial<SaleRecord>;
  purchasedDeckId?: string;
}

/** Add lots (merging into matching existing lots) and their ledger rows, in one transaction. */
export function addItems(inputs: NewItemInput[], opts: AddOpts = {}): Promise<number> {
  return transact(['collection', 'sales'], (tx) => addItemsTx(tx, inputs, opts));
}

/** addItems inside a caller's transaction (which must include 'collection' and 'sales'). */
export async function addItemsTx(tx: Tx, inputs: NewItemInput[], opts: AddOpts = {}): Promise<number> {
  const existing = await tx.getAll<CollectionItem>('collection');
  const out = new Map<string, CollectionItem>();
  const txs: SaleRecord[] = [];
  const now = Date.now();
  let added = 0;
  for (const input of inputs) {
    const item = makeItem(input);
    if (opts.purchasedDeckId) item.purchasedDeckId = opts.purchasedDeckId;
    added += item.qty;
    const same = (x: CollectionItem) => sameLot(x, item) && x.purchasedDeckId === item.purchasedDeckId;
    const match = [...out.values()].find(same) ?? existing.find(same);
    let lotId = item.id;
    if (match) {
      const base = out.get(match.id) ?? structuredClone(match);
      base.qty += item.qty;
      base.tags = [...new Set([...base.tags, ...item.tags])];
      for (const [d, n] of Object.entries(item.allocations)) base.allocations[d] = (base.allocations[d] ?? 0) + n;
      out.set(base.id, base);
      lotId = base.id;
    } else {
      out.set(item.id, item);
    }
    if (opts.log !== false) {
      txs.push({
        id: uid(), kind: opts.kind ?? 'bought', card: item.card, finish: item.finish, qty: item.qty, price: item.purchasePrice,
        date: item.acquiredAt ?? today(), channel: item.source, condition: item.condition, lotId,
        purchasedDeckId: item.purchasedDeckId, notes: item.notes, ...opts.tx, createdAt: now, updatedAt: now,
      });
    }
  }
  for (const item of out.values()) tx.put('collection', item);
  for (const r of txs) tx.put('sales', r, false);
  return added;
}

/** One-time: write a "bought" ledger row for every lot that predates the ledger. */
export async function backfillLedger() {
  if (getSettings().ledgerBackfilled) return;
  await transact(['collection', 'sales', 'meta'], (tx) => backfillLedgerTx(tx));
}

/** backfillLedger inside a caller's transaction (needs 'collection', 'sales', 'meta'). Reads settings from the transaction. */
export async function backfillLedgerTx(tx: Tx) {
  const settings = await tx.getSettings();
  if (settings.ledgerBackfilled) return;
  const logged = new Set((await tx.getAll<SaleRecord>('sales')).map((s) => s.lotId).filter(Boolean));
  const now = Date.now();
  for (const i of await tx.getAll<CollectionItem>('collection')) {
    if (logged.has(i.id)) continue;
    tx.put<SaleRecord>('sales', {
      id: uid(), kind: 'bought', card: i.card, finish: i.finish, qty: i.qty, price: i.purchasePrice,
      date: i.acquiredAt ?? dateKey(new Date(i.addedAt)), channel: i.source, condition: i.condition, lotId: i.id,
      notes: 'Recorded from existing collection', createdAt: now, updatedAt: now,
    }, false);
  }
  tx.putSettings({ ...settings, ledgerBackfilled: true });
}

// ---------- List parsing (shared by "paste a list" and purchased decks) ----------

export interface ListLine { qty: number; name: string; set?: string; cn?: string; finish?: Finish }

export function parseCollectionList(text: string): ListLine[] {
  const out: ListLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    if (/^(commanders?|deck|main(board)?|side(board)?|maybe(board)?|considering|companion)[:\s]*$/i.test(line)) continue;
    line = splitListMarkup(line.replace(/^SB:\s*/i, '').replace(/\*CMDR\*/gi, '')).line; // drops Archidekt's [categories] and ^labels^
    let finish: Finish | undefined;
    if (/\*F\*|\(foil\)|\bfoil$/i.test(line)) finish = 'foil';
    if (/\*E\*|\(etched\)/i.test(line)) finish = 'etched';
    line = line.replace(/\*F\*|\*E\*|\(foil\)|\(etched\)|\bfoil$/gi, '').replace(/#\S+/g, '').trim();
    const m = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★-]+))?)?\s*$/);
    if (m) out.push({ qty: parseInt(m[1], 10), name: m[2].trim(), set: m[3]?.toLowerCase(), cn: m[4], finish });
    else out.push({ qty: 1, name: line, finish });
  }
  return out;
}

/** Look up a pasted list on Scryfall. */
export async function resolveCardList(text: string): Promise<{ lines: { card: Card; finish: Finish; qty: number }[]; missing: string[] }> {
  const parsed = parseCollectionList(text);
  if (!parsed.length) return { lines: [], missing: [] };
  const { matched, missing } = await lookupLines(parsed.map((l) => ({ ...l, collector: l.cn })));
  return {
    lines: matched.map(({ line: l, card }) => ({ card, qty: l.qty, finish: l.finish && availableFinishes(card).includes(l.finish) ? l.finish : defaultFinish(card) })),
    missing: missing.map((l) => l.name),
  };
}

export const updateItem = (id: string, fn: (d: CollectionItem) => CollectionItem | void) => collectionT.update(id, fn);
export const deleteItems = (ids: string[]) => collectionT.removeMany(ids);

export async function bulkUpdate(ids: string[], fn: (d: CollectionItem) => void) {
  const set = new Set(ids);
  const rows = collectionT.all().filter((i) => set.has(i.id)).map((i) => {
    const d = structuredClone(i);
    fn(d);
    return d;
  });
  await collectionT.putMany(rows);
}

/** Collection tags apply to every lot you own of a card (any print). */
export async function setCollectionTagsForCard(cardName: string, add: string[], remove: string[] = []) {
  const rows = collectionT.all().filter((i) => i.card.name === cardName).map((i) => ({
    ...i, tags: [...new Set([...i.tags.filter((t) => !remove.includes(t)), ...add])],
  }));
  await collectionT.putMany(rows);
}

export const allocatedQty =(i: CollectionItem) => Object.values(i.allocations).reduce((a, b) => a + b, 0);
export const freeQty = (i: CollectionItem) => Math.max(0, i.qty - allocatedQty(i));

/** Trim allocations so they never exceed the copies in the lot. */
export function clampAllocations(i: CollectionItem) {
  let over = allocatedQty(i) - i.qty;
  if (over <= 0) return;
  for (const d of Object.keys(i.allocations)) {
    if (over <= 0) break;
    const cut = Math.min(over, i.allocations[d]);
    i.allocations[d] -= cut;
    over -= cut;
    if (i.allocations[d] <= 0) delete i.allocations[d];
  }
}

// ---------- Sales / trades ----------

export const isDisposal = (s: Pick<SaleRecord, 'kind'>) => s.kind === 'sold' || s.kind === 'traded';
export const isAcquisition = (s: Pick<SaleRecord, 'kind'>) => s.kind === 'bought' || s.kind === 'received';

export interface DisposeLine { itemId: string; qty: number; price: number }
export type DisposeMeta = Partial<Pick<SaleRecord, 'venue' | 'channel' | 'counterparty' | 'notes' | 'groupId' | 'groupLabel'>> & { kind: 'sold' | 'traded'; date: string };

/** Sell / trade away copies from one or more lots. Writes a ledger row per lot and shrinks (or removes) the lots. */
export function disposeLots(lines: DisposeLine[], meta: DisposeMeta): Promise<number> {
  return transact(['collection', 'sales'], (tx) => disposeLotsTx(tx, lines, meta));
}

/** disposeLots inside a caller's transaction (which must include 'collection' and 'sales'). */
export async function disposeLotsTx(tx: Tx, lines: DisposeLine[], meta: DisposeMeta): Promise<number> {
  const now = Date.now();
  const recs: SaleRecord[] = [];
  const keep: CollectionItem[] = [];
  const drop: string[] = [];
  const remaining = new Map<string, CollectionItem>();
  let moved = 0;
  for (const l of lines) {
    const item = remaining.get(l.itemId) ?? (await tx.get<CollectionItem>('collection', l.itemId));
    if (!item || item.qty <= 0) continue;
    const qty = Math.min(item.qty, Math.max(1, Math.floor(l.qty)));
    moved += qty;
    recs.push({
      id: uid(), kind: meta.kind, card: item.card, finish: item.finish, qty, price: l.price, costBasis: item.purchasePrice,
      date: meta.date, venue: meta.venue, channel: meta.channel, counterparty: meta.counterparty, notes: meta.notes,
      groupId: meta.groupId, groupLabel: meta.groupLabel, condition: item.condition, acquiredAt: item.acquiredAt,
      source: item.source, lotId: item.id, purchasedDeckId: item.purchasedDeckId, createdAt: now, updatedAt: now,
    });
    item.qty -= qty;
    // Sell unallocated copies first; only release deck allocations if needed.
    clampAllocations(item);
    remaining.set(item.id, item);
  }
  for (const item of remaining.values()) {
    if (item.qty <= 0) drop.push(item.id); else keep.push(item);
  }
  for (const r of recs) tx.put('sales', r, false);
  for (const id of drop) tx.delete('collection', id);
  for (const item of keep) tx.put('collection', item);
  return moved;
}

/** Kept for single-lot callers. */
export async function recordSale(itemId: string, s: { kind: 'sold' | 'traded'; qty: number; price: number; date: string; channel?: string; notes?: string }) {
  await disposeLots([{ itemId, qty: s.qty, price: s.price }], { kind: s.kind, date: s.date, channel: s.channel, notes: s.notes });
}

/**
 * Split a total across lines in proportion to weight × qty (per-copy market value); even split per
 * copy when nothing is priced. Returns each line's share of the total (not per copy).
 */
export function splitTotal(total: number, lines: { weight: number; qty: number }[]): number[] {
  const w = lines.reduce((s, l) => s + Math.max(0, l.weight) * l.qty, 0);
  const n = lines.reduce((s, l) => s + l.qty, 0);
  return lines.map((l) => (w > 0 ? (total * Math.max(0, l.weight) * l.qty) / w : n ? (total * l.qty) / n : 0));
}

/**
 * Split a total price into exact per-copy cents across lines (weighted like splitTotal).
 * Per-copy prices are rounded to the cent; the rounding remainder goes on the line with the
 * largest value. Each line returns one or two groups of copies so the grand total is exact,
 * e.g. 3 copies sharing a 1-cent remainder become 2 at $x and 1 at $x+0.01.
 */
export function splitCost(total: number, lines: { weight: number; qty: number }[]): { qty: number; each: number }[][] {
  const totalCents = Math.max(0, Math.round(total * 100));
  const shares = splitTotal(totalCents, lines);
  let big = -1;
  lines.forEach((l, i) => { if (l.qty > 0 && (big === -1 || shares[i] > shares[big])) big = i; });
  const attempt = (round: (n: number) => number) => {
    const each = lines.map((l, i) => (l.qty > 0 ? Math.max(0, round(shares[i] / l.qty)) : 0));
    const sum = lines.reduce((s, l, i) => s + each[i] * Math.max(0, l.qty), 0);
    return { each, bigTotal: big === -1 ? 0 : each[big] * lines[big].qty + (totalCents - sum) };
  };
  // Nearest-cent rounding keeps the remainder small; if it would push the biggest line below
  // zero (only with a tiny total), round every line down instead so the remainder is positive.
  let { each, bigTotal } = attempt(Math.round);
  if (bigTotal < 0) ({ each, bigTotal } = attempt(Math.floor));
  const out = lines.map((l, i) => (l.qty > 0 ? [{ qty: l.qty, each: each[i] }] : []));
  if (big !== -1) {
    const q = lines[big].qty;
    const baseEach = Math.floor(bigTotal / q);
    const extra = bigTotal - baseEach * q; // 0..q-1 cents
    out[big] = extra === 0 ? [{ qty: q, each: baseEach }] : [{ qty: q - 1, each: baseEach }, { qty: 1, each: baseEach + extra }];
  }
  return out.map((g) => g.map((x) => ({ qty: x.qty, each: x.each / 100 })));
}

/** Trades are not earnings: they're excluded from realized P/L unless asked for, and summarized separately. */
export interface PLOpts { includeTrades?: boolean }

export function realizedPL(sales: SaleRecord[], opts: PLOpts = {}) {
  let proceeds = 0, cost = 0, pl = 0, base = 0, count = 0, copies = 0;
  for (const s of sales) {
    if (!(opts.includeTrades ? isDisposal(s) : s.kind === 'sold')) continue;
    count++;
    copies += s.qty;
    const price = s.price ?? 0;
    proceeds += price * s.qty;
    if (s.costBasis != null) {
      cost += s.costBasis * s.qty;
      pl += (price - s.costBasis) * s.qty;
      base += s.costBasis * s.qty;
    }
  }
  return { proceeds, cost, pl, pct: base > 0 ? (pl / base) * 100 : null, count, copies, trades: tradeTotals(sales) };
}

export interface TradeSide { count: number; cards: number; value: number }

/** Card-for-card trades, both directions: transactions, card count and total trade value. */
export function tradeTotals(sales: SaleRecord[]): { out: TradeSide; in: TradeSide; count: number } {
  const out = { count: 0, cards: 0, value: 0 };
  const inn = { count: 0, cards: 0, value: 0 };
  for (const s of sales) {
    const side = s.kind === 'traded' ? out : s.kind === 'received' ? inn : null;
    if (!side) continue;
    side.count++;
    side.cards += s.qty;
    side.value += (s.price ?? 0) * s.qty;
  }
  return { out, in: inn, count: out.count + inn.count };
}

export function spentOn(sales: SaleRecord[]) {
  let spent = 0, copies = 0, count = 0;
  for (const s of sales) {
    if (s.kind !== 'bought') continue;
    count++;
    copies += s.qty;
    spent += (s.price ?? 0) * s.qty;
  }
  return { spent, copies, count };
}

// ---------- Watchlist ----------

export async function addWatch(card: Card, opts: { finish?: Finish; qty?: number; targetPrice?: number; notes?: string } = {}) {
  const now = Date.now();
  const finish = opts.finish ?? defaultFinish(card);
  const existing = watchT.all().find((w) => w.card.id === card.id && w.finish === finish);
  if (existing) {
    await watchT.put({ ...existing, qty: existing.qty + (opts.qty ?? 1), targetPrice: opts.targetPrice ?? existing.targetPrice });
    return;
  }
  const w: WatchItem = { id: uid(), card, finish, qty: opts.qty ?? 1, targetPrice: opts.targetPrice, notes: opts.notes, addedAt: now, updatedAt: now };
  await watchT.put(w);
}

// ---------- Price refresh + snapshots ----------

const DAY = 24 * 60 * 60 * 1000;

function snapshotRow(card: Card): [number | null, number | null, number | null] {
  return [num(card.prices?.usd), num(card.prices?.usd_foil), num(card.prices?.usd_etched)];
}

/** Re-fetch every card in the collection, watchlist and decks; write today's price snapshot. */
export async function refreshCollectionPrices(onProgress?: (done: number, total: number) => void): Promise<number> {
  const items = collectionT.all();
  const watch = watchT.all();
  const decks = decksT.all();
  const ids = [...new Set([...items.map((i) => i.card.id), ...watch.map((w) => w.card.id), ...decks.flatMap((d) => d.entries.map((e) => e.card.id))])];
  if (!ids.length) return 0;
  const fresh = new Map<string, Card>();
  for (let i = 0; i < ids.length; i += 750) {
    const { found } = await getCollection(ids.slice(i, i + 750).map((id) => ({ id })));
    found.forEach((c) => fresh.set(c.id, c));
    onProgress?.(Math.min(ids.length, i + 750), ids.length);
  }
  // Re-read after the network round trips so edits made meanwhile aren't lost.
  await collectionT.putMany(collectionT.all().filter((i) => fresh.has(i.card.id)).map((i) => ({ ...i, card: fresh.get(i.card.id)! })), false);
  await watchT.putMany(watchT.all().filter((w) => fresh.has(w.card.id)).map((w) => ({ ...w, card: fresh.get(w.card.id)! })), false);
  // Decks: don't touch updatedAt (it drives deck priority in the shared pool).
  const now = Date.now();
  await decksT.putMany(decksT.all().filter((d) => d.entries.some((e) => fresh.has(e.card.id))).map((d) => ({
    ...d, pricesUpdatedAt: now, entries: d.entries.map((e) => (fresh.has(e.card.id) ? { ...e, card: fresh.get(e.card.id)! } : e)),
  })), false);
  await writeSnapshot([...fresh.values()]);
  setSettings({ lastCollectionRefresh: Date.now() });
  return fresh.size;
}

export async function writeSnapshot(cards: Card[]) {
  const id = today();
  const prev = pricesT.get(id);
  const prices = { ...(prev?.prices ?? {}) };
  for (const c of cards) prices[c.id] = snapshotRow(c);
  const now = Date.now();
  const snap: PriceSnapshot = { id, prices, createdAt: prev?.createdAt ?? now, updatedAt: now };
  await pricesT.put(snap, false);
}

/** Refresh at most once a day, on app start. */
export async function autoRefreshCollection() {
  const last = getSettings().lastCollectionRefresh ?? 0;
  if (Date.now() - last < DAY) return;
  if (!collectionT.all().length && !watchT.all().length && !decksT.all().some((d) => d.entries.length)) return;
  await refreshCollectionPrices().catch(() => undefined);
}

const FINISH_IDX: Record<Finish, 0 | 1 | 2> = { nonfoil: 0, foil: 1, etched: 2 };

/** Price of a card/finish on the newest snapshot at or before `daysAgo` days back. */
export function historicalPrice(snaps: PriceSnapshot[], cardId: string, finish: Finish, daysAgo: number): number | null {
  const cutoff = new Date(Date.now() - daysAgo * DAY);
  const key = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].id > key) continue;
    const row = snaps[i].prices[cardId];
    if (row) return row[FINISH_IDX[finish]];
  }
  return null;
}

/** % change in market price over the last `days` days, from our own snapshots. */
export function trendPct(snaps: PriceSnapshot[], card: Card, finish: Finish, days = 7): number | null {
  const now = finishPrice(card, finish);
  const then = historicalPrice(snaps, card.id, finish, days);
  if (now == null || then == null || then === 0) return null;
  return ((now - then) / then) * 100;
}

/** Like historicalPrice, but with the deck's price rule (non-foil, else foil, else etched). */
export function historicalCardPrice(snaps: PriceSnapshot[], cardId: string, daysAgo: number): number | null {
  const key = dateKey(new Date(Date.now() - daysAgo * DAY));
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].id > key) continue;
    const row = snaps[i].prices[cardId];
    if (row) return row[0] ?? row[1] ?? row[2];
  }
  return null;
}

export interface Delta { diff: number; pct: number | null; then: number; now: number }

/**
 * Main-board value now vs `days` ago, for the cards in the deck today — so the change is market
 * movement, not cards added or cut. Null until there's a snapshot that old.
 */
export function deckTrend(snaps: PriceSnapshot[], deck: Deck, days = 7): Delta | null {
  let then = 0, now = 0, any = false;
  for (const e of deck.entries) {
    if (e.board !== 'main') continue;
    const n = cardPrice(e.card);
    const t = historicalCardPrice(snaps, e.card.id, days);
    if (n == null || t == null) continue;
    any = true;
    now += n * e.qty;
    then += t * e.qty;
  }
  if (!any) return null;
  return { diff: now - then, pct: then > 0 ? ((now - then) / then) * 100 : null, then, now };
}

/** Value now vs `days` ago for a set of lots (exact print + finish). */
export function lotsTrend(snaps: PriceSnapshot[], items: CollectionItem[], days = 7): Delta | null {
  let then = 0, now = 0, any = false;
  for (const i of items) {
    const n = finishPrice(i.card, i.finish);
    const t = historicalPrice(snaps, i.card.id, i.finish, days);
    if (n == null || t == null) continue;
    any = true;
    now += n * i.qty;
    then += t * i.qty;
  }
  if (!any) return null;
  return { diff: now - then, pct: then > 0 ? ((now - then) / then) * 100 : null, then, now };
}

export function priceSeries(snaps: PriceSnapshot[], cardId: string, finish: Finish): { date: string; price: number }[] {
  const out: { date: string; price: number }[] = [];
  for (const s of snaps) {
    const p = s.prices[cardId]?.[FINISH_IDX[finish]];
    if (p != null) out.push({ date: s.id, price: p });
  }
  return out;
}

/** Collection market value per snapshot day, using today's quantities (unadjusted). */
export function valueSeries(snaps: PriceSnapshot[], items: CollectionItem[]): { date: string; price: number }[] {
  return snaps.map((s) => ({
    date: s.id,
    price: items.reduce((sum, i) => sum + (s.prices[i.card.id]?.[FINISH_IDX[i.finish]] ?? 0) * i.qty, 0),
  })).filter((p) => p.price > 0);
}
