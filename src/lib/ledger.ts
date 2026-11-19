import type { Card, CollectionItem, Condition, Deck, DeckEntry, Finish, PurchasedDeck, SaleRecord, SaleVenue, TxKind } from '../types';
import {
  addItemsTx, defaultFinish, disposeLotsTx, FINISH_LABEL, finishPrice, freeQty, isDisposal, itemUnitValue, splitCost, splitTotal, today,
  type DisposeLine, type NewItemInput,
} from './collection';
import { collectionT, transact } from './store';
import { isBasicLand, uid } from './rules';
import { download } from './backup';
import { nameKey } from './ownership';

// ---------- Where a sale / trade happened ----------

export const VENUES: { id: SaleVenue; label: string }[] = [
  { id: 'online', label: 'Online' },
  { id: 'in-person', label: 'In person' },
  { id: 'other', label: 'Other' },
];
export const ONLINE_RETAILERS = [
  'TCGplayer', 'Card Kingdom', 'Star City Games', 'Mana Pool', 'CoolStuffInc', 'ChannelFireball', 'eBay', 'Amazon', 'Cardmarket',
  'Facebook / social media', 'Discord',
];
export const IN_PERSON_PLACES = ['Local game store', 'Store buylist', 'Convention / event', 'Trade night', 'Private sale'];

export const KIND_LABEL: Record<TxKind, string> = { bought: 'Bought', received: 'Received in trade', sold: 'Sold', traded: 'Traded away' };

export interface Where { venue?: SaleVenue; channel?: string; counterparty?: string }

export function whereLabel(s: Where): string {
  const v = VENUES.find((x) => x.id === s.venue)?.label;
  return [v, s.channel, s.counterparty && `with ${s.counterparty}`].filter(Boolean).join(' · ');
}

// ---------- Card-for-card trades ----------

export interface TradeGive { itemId: string; qty: number; value: number }
export interface TradeGet { card: Card; finish: Finish; qty: number; value: number; condition?: Condition }

const describe = (name: string, qty: number) => (qty > 1 ? `${qty}× ${name}` : name);

/**
 * Give lots away, receive cards (and/or cash) back. What you receive is split across what you
 * gave in proportion to its value, so each given card's realized gain/loss is meaningful.
 * Received cards enter the collection with their trade value as cost basis.
 */
export async function recordTrade(t: { give: TradeGive[]; get: TradeGet[]; cash: number; date: string; counterparty?: string; notes?: string } & Where) {
  const groupId = uid();
  const giveItems = t.give.map((g) => ({ g, item: collectionT.get(g.itemId)! })).filter((x) => x.item);
  const received = t.get.reduce((s, x) => s + x.value * x.qty, 0) + t.cash;
  const shares = splitTotal(received, giveItems.map(({ g }) => ({ weight: g.value, qty: g.qty })));
  const who = t.counterparty ? ` with ${t.counterparty}` : '';
  const gotNames = [...t.get.map((x) => describe(x.card.name, x.qty)), ...(t.cash > 0 ? [`$${t.cash.toFixed(2)}`] : [])];
  const gaveNames = [...giveItems.map(({ g, item }) => describe(item.card.name, g.qty)), ...(t.cash < 0 ? [`$${(-t.cash).toFixed(2)}`] : [])];
  const label = `Trade${who}`;
  const extra = t.notes ? ` — ${t.notes}` : '';

  // Both sides of the trade commit together or not at all.
  await transact(['collection', 'sales'], async (tx) => {
    await disposeLotsTx(tx, giveItems.map(({ g }, i) => ({ itemId: g.itemId, qty: g.qty, price: g.qty ? shares[i] / g.qty : 0 })), {
      kind: 'traded', date: t.date, venue: t.venue, channel: t.channel, counterparty: t.counterparty, groupId, groupLabel: label,
      notes: `Traded ${t.date}${who} for ${gotNames.join(', ') || 'nothing'}${extra}`,
    });
    if (t.get.length) {
      await addItemsTx(tx, t.get.map((x) => ({
        card: x.card, finish: x.finish, qty: x.qty, condition: x.condition, purchasePrice: x.value, acquiredAt: t.date, source: 'Trade',
        notes: `Traded ${t.date}${who} for ${gaveNames.join(', ')}`,
      })), { kind: 'received', tx: { venue: t.venue, channel: t.channel, counterparty: t.counterparty, groupId, groupLabel: label, notes: `Traded ${t.date}${who} for ${gaveNames.join(', ')}${extra}` } });
    }
  });
}

// ---------- Purchased decks ----------

export interface DeckCardLine { card: Card; finish: Finish; qty: number }

/** Lines for an app deck (main + side; maybeboard isn't part of the deck). */
export function deckLines(deck: Deck, skipBasics: boolean): DeckCardLine[] {
  return deck.entries
    .filter((e) => e.board !== 'maybe' && !(skipBasics && isBasicLand(e.card)))
    .map((e: DeckEntry) => ({ card: e.card, finish: defaultFinish(e.card), qty: e.qty }));
}

/** Record a whole deck bought at once: per-card cost basis = deck price split by market value. */
export async function buyDeck(input: {
  name: string; lines: DeckCardLine[]; price?: number; date: string; source?: string; condition?: Condition; notes?: string;
  deckId?: string; createDeck?: boolean; commit: boolean;
}): Promise<PurchasedDeck> {
  const now = Date.now();
  let deckId = input.deckId;
  const newDeck: Deck | undefined = !deckId && input.createDeck ? {
    id: uid(), name: input.name, format: 'commander', status: 'finished', createdAt: now, updatedAt: now,
    entries: input.lines.map((l) => ({ uid: uid(), qty: l.qty, board: 'main', card: l.card })),
  } : undefined;
  if (newDeck) deckId = newDeck.id;
  const value = input.lines.reduce((s, l) => s + (finishPrice(l.card, l.finish) ?? 0) * l.qty, 0);
  // Per-copy cost basis in whole cents that adds up exactly to the deck price.
  const groups = input.price != null ? splitCost(input.price, input.lines.map((l) => ({ weight: finishPrice(l.card, l.finish) ?? 0, qty: l.qty }))) : null;
  const pd: PurchasedDeck = {
    id: uid(), name: input.name, deckId, purchasePrice: input.price, acquiredAt: input.date, source: input.source, notes: input.notes,
    cardsAtPurchase: input.lines.reduce((n, l) => n + l.qty, 0), valueAtPurchase: value, status: 'owned', createdAt: now, updatedAt: now,
  };
  const items: NewItemInput[] = input.lines.flatMap((l, i) => (groups ? groups[i] : [{ qty: l.qty, each: undefined }]).map((g) => ({
    card: l.card, finish: l.finish, qty: g.qty, condition: input.condition, acquiredAt: input.date, source: input.source,
    purchasePrice: g.each, allocations: input.commit && deckId ? { [deckId]: g.qty } : {},
  })));
  await transact(['decks', 'owneddecks', 'collection', 'sales'], async (tx) => {
    if (newDeck) tx.put('decks', newDeck);
    tx.put('owneddecks', pd);
    await addItemsTx(tx, items, { purchasedDeckId: pd.id, tx: { groupId: pd.id, groupLabel: `Deck: ${input.name}` } });
  });
  return pd;
}

export const lotsOfPurchasedDeck = (items: CollectionItem[], pdId: string) => items.filter((i) => i.purchasedDeckId === pdId);

/**
 * The lots that make up an app deck you built from your collection: copies committed to the deck
 * first, then free (uncommitted) copies. Returns what's missing too.
 */
export function lotsForDeck(deck: Deck, items: CollectionItem[], skipBasics: boolean): { lines: DisposeLine[]; missing: { name: string; qty: number }[] } {
  const need = new Map<string, number>();
  for (const e of deck.entries) {
    if (e.board === 'maybe' || (skipBasics && isBasicLand(e.card))) continue;
    need.set(nameKey(e.card), (need.get(nameKey(e.card)) ?? 0) + e.qty);
  }
  const lines: DisposeLine[] = [];
  const missing: { name: string; qty: number }[] = [];
  for (const [name, n] of need) {
    let want = n;
    const lots = items.filter((i) => nameKey(i.card) === name);
    const take = (lot: CollectionItem, max: number) => {
      const q = Math.min(want, max);
      if (q <= 0) return;
      const existing = lines.find((l) => l.itemId === lot.id);
      if (existing) existing.qty += q; else lines.push({ itemId: lot.id, qty: q, price: 0 });
      want -= q;
    };
    for (const lot of lots) take(lot, lot.allocations[deck.id] ?? 0);
    for (const lot of lots) {
      const already = lines.find((l) => l.itemId === lot.id)?.qty ?? 0;
      take(lot, Math.min(freeQty(lot), lot.qty - already));
    }
    if (want > 0) missing.push({ name, qty: want });
  }
  return { lines, missing };
}

/** Sell a whole deck for one price; each card's share follows its market value. Notes: "Sold with deck <name>". */
export async function sellDeck(input: {
  name: string; lines: DisposeLine[]; price: number; date: string; notes?: string; purchasedDeckId?: string;
} & Where): Promise<number> {
  const weights = input.lines.map((l) => {
    const item = collectionT.get(l.itemId);
    return { weight: item ? itemUnitValue(item, false) ?? 0 : 0, qty: l.qty };
  });
  const shares = splitTotal(input.price, weights);
  const groupId = input.purchasedDeckId ?? uid();
  return transact(['collection', 'sales', 'owneddecks'], async (tx) => {
    const moved = await disposeLotsTx(tx, input.lines.map((l, i) => ({ ...l, price: l.qty ? shares[i] / l.qty : 0 })), {
      kind: 'sold', date: input.date, venue: input.venue, channel: input.channel, counterparty: input.counterparty,
      groupId, groupLabel: `Deck: ${input.name}`, notes: `Sold with deck ${input.name}${input.notes ? ` — ${input.notes}` : ''}`,
    });
    const pd = input.purchasedDeckId ? await tx.get<PurchasedDeck>('owneddecks', input.purchasedDeckId) : undefined;
    if (pd) {
      tx.put<PurchasedDeck>('owneddecks', {
        ...pd, status: 'sold',
        sold: { date: input.date, price: input.price, venue: input.venue, channel: input.channel, counterparty: input.counterparty, notes: input.notes },
      });
    }
    return moved;
  });
}

// ---------- Period summaries ----------

export type Period = 'week' | 'month' | 'quarter' | 'year';
export const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }, { id: 'quarter', label: 'Quarterly' }, { id: 'year', label: 'Yearly' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Sortable key + human label for the period a YYYY-MM-DD date falls in. Weeks start Monday. */
export function periodOf(date: string, p: Period): { key: string; label: string } {
  const [y, m, d] = date.split('-').map(Number);
  if (p === 'year') return { key: `${y}`, label: `${y}` };
  if (p === 'quarter') { const q = Math.floor((m - 1) / 3) + 1; return { key: `${y}-Q${q}`, label: `Q${q} ${y}` }; }
  if (p === 'month') return { key: `${y}-${pad(m)}`, label: `${MONTHS[m - 1]} ${y}` };
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  const k = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  return { key: k, label: `Week of ${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}` };
}

export interface PeriodRow {
  key: string; label: string;
  /** Earnings columns: sales only, unless includeTrades was passed. */
  sales: number; copiesOut: number; proceeds: number; cost: number; pl: number; pct: number | null; unknownCost: number;
  bought: number; copiesIn: number; spent: number;
  /** Trades in the period, both directions (kept out of the earnings columns by default). */
  trades: number; tradeCards: number; tradeValue: number;
  tradesIn: number; tradeCardsIn: number; tradeValueIn: number;
}

export interface SummaryOpts { includeTrades?: boolean }

export function summarizeByPeriod(txs: SaleRecord[], p: Period, opts: SummaryOpts = {}): PeriodRow[] {
  const m = new Map<string, PeriodRow & { base: number }>();
  for (const s of txs) {
    const { key, label } = periodOf(s.date, p);
    const r = m.get(key) ?? {
      key, label, sales: 0, copiesOut: 0, proceeds: 0, cost: 0, pl: 0, pct: null, unknownCost: 0, bought: 0, copiesIn: 0, spent: 0,
      trades: 0, tradeCards: 0, tradeValue: 0, tradesIn: 0, tradeCardsIn: 0, tradeValueIn: 0, base: 0,
    };
    const price = s.price ?? 0;
    if (s.kind === 'traded') {
      r.trades++;
      r.tradeCards += s.qty;
      r.tradeValue += price * s.qty;
    } else if (s.kind === 'received') {
      r.tradesIn++;
      r.tradeCardsIn += s.qty;
      r.tradeValueIn += price * s.qty;
    }
    if (s.kind === 'sold' || (opts.includeTrades && s.kind === 'traded')) {
      r.sales++;
      r.copiesOut += s.qty;
      r.proceeds += price * s.qty;
      if (s.costBasis != null) { r.cost += s.costBasis * s.qty; r.pl += (price - s.costBasis) * s.qty; r.base += s.costBasis * s.qty; }
      else r.unknownCost += s.qty;
    } else if (s.kind === 'bought') {
      r.bought++;
      r.copiesIn += s.qty;
      r.spent += price * s.qty;
    }
    m.set(key, r);
  }
  return [...m.values()].map(({ base, ...r }) => ({ ...r, pct: base > 0 ? (r.pl / base) * 100 : null })).sort((a, b) => b.key.localeCompare(a.key));
}

export const inRange = (date: string, from?: string, to?: string) => (!from || date >= from) && (!to || date <= to);

// ---------- CSV exports ----------

const csvCell = (v: unknown) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
const money = (n?: number | null) => (n == null ? '' : n.toFixed(2));
const rangeName = (from?: string, to?: string) => (from || to ? `${from ?? 'start'}_to_${to ?? today()}` : 'all-time');

export function transactionsToCSV(txs: SaleRecord[]): string {
  const head = [
    'Date', 'Type', 'Name', 'Set code', 'Collector number', 'Finish', 'Condition', 'Quantity', 'Price (each)', 'Total',
    'Cost basis (each)', 'Gain/loss ($)', 'Gain/loss (%)', 'Venue', 'Where', 'Counterparty', 'Acquired', 'Acquired from',
    'Group', 'Notes', 'Scryfall ID',
  ];
  const rows = txs.map((s) => {
    const disp = isDisposal(s);
    const diff = disp && s.costBasis != null && s.price != null ? (s.price - s.costBasis) * s.qty : null;
    const pct = disp && s.costBasis && s.price != null ? ((s.price - s.costBasis) / s.costBasis) * 100 : null;
    return [
      s.date, KIND_LABEL[s.kind], s.card.name, s.card.set.toUpperCase(), s.card.collector_number, FINISH_LABEL[s.finish],
      s.condition ?? '', s.qty, money(s.price), s.price != null ? money(s.price * s.qty) : '', disp ? money(s.costBasis) : '',
      money(diff), pct?.toFixed(1) ?? '', VENUES.find((v) => v.id === s.venue)?.label ?? '', s.channel ?? '', s.counterparty ?? '',
      s.acquiredAt ?? '', s.source ?? '', s.groupLabel ?? '', s.notes ?? '', s.card.id,
    ];
  });
  return toCSV([head, ...rows]);
}

export function summaryToCSV(txs: SaleRecord[], p: Period, opts: SummaryOpts = {}): string {
  const rows = summarizeByPeriod(txs, p, opts);
  const head = ['Period', opts.includeTrades ? 'Sales & trades' : 'Sales', 'Cards out', 'Proceeds', 'Cost basis', 'Realized gain/loss ($)', 'Realized gain/loss (%)', 'Cards with unknown cost', 'Purchases', 'Cards in', 'Spent'];
  const line = (r: Omit<PeriodRow, 'key' | 'trades' | 'tradeCards' | 'tradeValue' | 'tradesIn' | 'tradeCardsIn' | 'tradeValueIn'>) => [r.label, r.sales, r.copiesOut, money(r.proceeds), money(r.cost), money(r.pl), r.pct?.toFixed(1) ?? '', r.unknownCost, r.bought, r.copiesIn, money(r.spent)];
  const total = rows.reduce((t, r) => ({
    ...t, sales: t.sales + r.sales, copiesOut: t.copiesOut + r.copiesOut, proceeds: t.proceeds + r.proceeds, cost: t.cost + r.cost,
    pl: t.pl + r.pl, unknownCost: t.unknownCost + r.unknownCost, bought: t.bought + r.bought, copiesIn: t.copiesIn + r.copiesIn, spent: t.spent + r.spent,
  }), { label: 'TOTAL', sales: 0, copiesOut: 0, proceeds: 0, cost: 0, pl: 0, pct: null as number | null, unknownCost: 0, bought: 0, copiesIn: 0, spent: 0 });
  total.pct = total.cost > 0 ? (total.pl / total.cost) * 100 : null;
  const out: unknown[][] = [head, ...rows.map(line), [], line(total)];
  if (!opts.includeTrades) {
    const sum = (f: (r: PeriodRow) => number) => rows.reduce((n, r) => n + f(r), 0);
    out.push(
      [], ['Trades (not included above)', 'Trades', 'Cards', 'Trade value'],
      ['TRADED AWAY', sum((r) => r.trades), sum((r) => r.tradeCards), money(sum((r) => r.tradeValue))],
      ['RECEIVED IN TRADE', sum((r) => r.tradesIn), sum((r) => r.tradeCardsIn), money(sum((r) => r.tradeValueIn))],
    );
  }
  return toCSV(out);
}

export function exportTransactions(txs: SaleRecord[], what: 'purchased' | 'sold' | 'all' | 'inactive', from?: string, to?: string) {
  const pick = txs.filter((s) => inRange(s.date, from, to)).filter((s) =>
    what === 'purchased' ? s.kind === 'bought' || s.kind === 'received' : what === 'all' ? true : isDisposal(s));
  const name = what === 'purchased' ? 'cards-purchased' : what === 'sold' ? 'cards-sold' : what === 'inactive' ? 'sold-and-traded-cards' : 'transactions';
  download(`${name}-${rangeName(from, to)}.csv`, transactionsToCSV([...pick].sort((a, b) => a.date.localeCompare(b.date))), 'text/csv');
  return pick.length;
}

export function exportSummary(txs: SaleRecord[], p: Period, from?: string, to?: string) {
  download(`sale-earnings-${p}-${rangeName(from, to)}.csv`, summaryToCSV(txs.filter((s) => inRange(s.date, from, to)), p), 'text/csv');
}
