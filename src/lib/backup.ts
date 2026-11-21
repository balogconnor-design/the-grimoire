import { cleanTargetBracket } from './bracket';
import type { Card, CollectionItem, Deck, GlobalCardTags, PriceSnapshot, PurchasedDeck, SaleRecord, SavedSearch, TxKind, WatchItem } from '../types';
import { allocatedQty, backfillLedgerTx, clampAllocations, FINISH_LABEL, intentLabel, itemPL, itemUnitValue, printBadges } from './collection';
import {
  collectionT, decksT, DEFAULT_SETTINGS, getSettings, globalTagsT, ownedDecksT, pricesT, salesT, searchesT, setSettings, transact, watchT, type Settings, type StoreName,
} from './store';
import { prefersShareSheet } from './device';

export type SaveResult = 'downloaded' | 'shared' | 'cancelled';

/**
 * Save a text file. On phones and tablets this opens the share sheet (Save to Files, Drive, AirDrop,
 * email...), which is more reliable there than a download, especially in the installed app; elsewhere,
 * or if sharing isn't possible, it downloads. Must be called straight from a click: the share sheet
 * needs the user's tap, so nothing may be awaited before calling this.
 */
export async function download(filename: string, text: string, type = 'text/plain'): Promise<SaveResult> {
  if (prefersShareSheet()) {
    const file = new File([text], filename, { type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      } catch (err) {
        if ((err as Error).name === 'AbortError') return 'cancelled';
        // Any other failure: fall back to a normal download below.
      }
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

const stamp = () => new Date().toISOString().slice(0, 10);

// ---------- Collection exports ----------

/** "4 Sol Ring (C21) 263 *F*" — readable by Moxfield, Archidekt and most collection tools. */
export function collectionToText(items: CollectionItem[]): string {
  return items.map((i) => {
    const f = i.finish === 'foil' ? ' *F*' : i.finish === 'etched' ? ' *E*' : '';
    return `${i.qty} ${i.card.name} (${i.card.set.toUpperCase()}) ${i.card.collector_number}${f}`;
  }).join('\n') + '\n';
}

const csvCell = (v: unknown) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function collectionToCSV(items: CollectionItem[], deckName: (id: string) => string): string {
  const head = [
    'Name', 'Set code', 'Set name', 'Collector number', 'Finish', 'Treatment', 'Language', 'Quantity', 'Condition',
    'Purchase price (each)', 'Acquired', 'Source', 'Current price (each)', 'Current value', 'P/L ($)', 'P/L (%)',
    'Status', 'Target price', 'Tags', 'Favorite', 'Allocated', 'Allocated to', 'Notes', 'Scryfall ID',
  ];
  const rows = items.map((i) => {
    const unit = itemUnitValue(i);
    const pl = itemPL(i);
    return [
      i.card.name, i.card.set.toUpperCase(), i.card.set_name, i.card.collector_number, FINISH_LABEL[i.finish],
      printBadges(i.card).join(' '), i.card.lang ?? 'en', i.qty, i.condition ?? '',
      i.purchasePrice?.toFixed(2) ?? '', i.acquiredAt ?? '', i.source ?? '', unit?.toFixed(2) ?? '',
      unit != null ? (unit * i.qty).toFixed(2) : '', pl.diff?.toFixed(2) ?? '', pl.pct?.toFixed(1) ?? '',
      intentLabel(i.intent), i.targetPrice?.toFixed(2) ?? '', i.tags.join('; '), i.favorite ? 'yes' : '',
      allocatedQty(i) || '', Object.entries(i.allocations).map(([d, n]) => `${deckName(d)} ×${n}`).join('; '),
      i.notes ?? '', i.card.id,
    ];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function exportCollection(items: CollectionItem[], format: 'text' | 'csv', deckName: (id: string) => string) {
  if (format === 'text') download(`collection-${stamp()}.txt`, collectionToText(items));
  else download(`collection-${stamp()}.csv`, collectionToCSV(items, deckName), 'text/csv');
}

// ---------- Full backup / restore ----------

// Internal key: renaming it makes old backups unreadable. Keep "deckforge".
const BACKUP_APP = 'deckforge';
export const BACKUP_VERSION = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  decks: Deck[];
  collection: CollectionItem[];
  watchlist: WatchItem[];
  sales: SaleRecord[];
  prices: PriceSnapshot[];
  searches: SavedSearch[];
  ownedDecks: PurchasedDeck[];
  /** Global card tags. Missing from backups made before global tags existed. */
  globalTags: GlobalCardTags[];
  settings: Partial<Settings>;
}

export function makeBackup(): Backup {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    decks: decksT.all(),
    collection: collectionT.all(),
    watchlist: watchT.all(),
    sales: salesT.all(),
    prices: pricesT.all(),
    searches: searchesT.all(),
    ownedDecks: ownedDecksT.all(),
    globalTags: globalTagsT.all(),
    settings: { ...getSettings() },
  };
}

/** Save a full backup file. The "last backup" date only moves if the file was actually saved. */
export async function downloadBackup(): Promise<SaveResult> {
  const result = await download(`grimoire-backup-${stamp()}.json`, JSON.stringify(makeBackup()), 'application/json');
  if (result !== 'cancelled') setSettings({ lastBackupAt: Date.now() });
  return result;
}

/** Records dropped (or repaired) while reading a backup because they were incomplete or invalid. */
export interface DroppedCounts {
  decks: number;
  deckCards: number;
  collection: number;
  watchlist: number;
  sales: number;
  prices: number;
  searches: number;
  ownedDecks: number;
  globalTags: number;
  /** Lots whose deck allocations added up to more than the lot's quantity (trimmed, not dropped). */
  allocationsClamped: number;
}

export interface BackupSummary {
  exportedAt: string;
  decks: number;
  collection: number;
  copies: number;
  watchlist: number;
  sales: number;
  prices: number;
  searches: number;
  ownedDecks: number;
  globalTags: number;
  dropped: DroppedCounts;
  /** Total records dropped (not counting clamped allocations). */
  droppedTotal: number;
}

/**
 * Upgrade raw backup data from an older backup format to the current one. Each step is keyed by
 * the version it upgrades FROM. Version 1 is current, so there are no steps yet and v1 data is
 * returned unchanged.
 */
const BACKUP_MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrateBackup(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let data = raw;
  for (let v = fromVersion; v < BACKUP_VERSION; v++) {
    const step = BACKUP_MIGRATIONS[v];
    if (step) data = step(data);
  }
  return { ...data, version: BACKUP_VERSION };
}

// ---------- Record validation ----------

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TX_KINDS: TxKind[] = ['bought', 'received', 'sold', 'traded'];

/** A stored card snapshot needs at least id, name, set and collector number. */
export function isValidCard(c: unknown): c is Card {
  return isObj(c) && isStr(c.id) && isStr(c.name) && isStr(c.set) && isStr(c.collector_number);
}

function cleanAllocations(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1) out[k] = Math.floor(v);
  }
  return out;
}

/** Parse and sanity-check a backup file. Throws a readable error if it isn't one. */
export function parseBackup(text: string): { backup: Backup; summary: BackupSummary } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!isObj(data) || data.app !== BACKUP_APP || typeof data.version !== 'number') throw new Error("That file isn't a Grimoire backup.");
  if (data.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app.');
  const b = migrateBackup(data, data.version);

  const arr = (x: unknown, name: string): unknown[] => {
    if (x == null) return [];
    if (!Array.isArray(x)) throw new Error(`Backup is damaged (${name}).`);
    return x;
  };
  const dropped: DroppedCounts = { decks: 0, deckCards: 0, collection: 0, watchlist: 0, sales: 0, prices: 0, searches: 0, ownedDecks: 0, globalTags: 0, allocationsClamped: 0 };
  const keep = <T,>(list: unknown[], key: Exclude<keyof DroppedCounts, 'deckCards' | 'allocationsClamped'>, fix: (x: Record<string, unknown>) => T | null): T[] => {
    const out: T[] = [];
    for (const x of list) {
      const v = isObj(x) ? fix(x) : null;
      if (v) out.push(v); else dropped[key]++;
    }
    return out;
  };

  const decks = keep<Deck>(arr(b.decks, 'decks'), 'decks', (d) => {
    if (!isStr(d.id) || !Array.isArray(d.entries)) return null;
    const entries = (d.entries as unknown[]).filter((e): e is Deck['entries'][number] => {
      const ok = isObj(e) && isStr(e.uid) && typeof e.qty === 'number' && e.qty >= 1 && isValidCard(e.card)
        && (e.board === 'main' || e.board === 'side' || e.board === 'maybe');
      if (!ok) dropped.deckCards++;
      return ok;
    });
    const deck = { ...(d as unknown as Deck), name: typeof d.name === 'string' ? d.name : 'Untitled deck', entries };
    if (deck.commanderUid && !entries.some((e) => e.uid === deck.commanderUid)) deck.commanderUid = undefined;
    const target = cleanTargetBracket(deck.targetBracket);
    if (target) deck.targetBracket = target;
    else delete deck.targetBracket;
    return deck;
  });

  const collection = keep<CollectionItem>(arr(b.collection, 'collection'), 'collection', (i) => {
    if (!isStr(i.id) || !isValidCard(i.card) || typeof i.qty !== 'number' || !Number.isFinite(i.qty) || i.qty < 1) return null;
    const item: CollectionItem = {
      ...(i as unknown as CollectionItem),
      qty: Math.floor(i.qty),
      tags: Array.isArray(i.tags) ? i.tags.filter(isStr) : [],
      allocations: cleanAllocations(i.allocations),
      favorite: !!i.favorite,
      finish: i.finish === 'foil' || i.finish === 'etched' ? i.finish : 'nonfoil',
    };
    if (allocatedQty(item) > item.qty) {
      clampAllocations(item);
      dropped.allocationsClamped++;
    }
    return item;
  });

  const watchlist = keep<WatchItem>(arr(b.watchlist, 'watchlist'), 'watchlist', (w) => (isStr(w.id) && isValidCard(w.card) ? (w as unknown as WatchItem) : null));
  const sales = keep<SaleRecord>(arr(b.sales, 'sales'), 'sales', (s) =>
    isStr(s.id) && isValidCard(s.card) && TX_KINDS.includes(s.kind as TxKind) && typeof s.date === 'string' && DATE_RE.test(s.date)
      ? (s as unknown as SaleRecord) : null);
  const prices = keep<PriceSnapshot>(arr(b.prices, 'prices'), 'prices', (p) => (isStr(p.id) && isObj(p.prices) ? (p as unknown as PriceSnapshot) : null));
  const searches = keep<SavedSearch>(arr(b.searches, 'searches'), 'searches', (s) => (isStr(s.id) && typeof s.query === 'string' ? (s as unknown as SavedSearch) : null));
  const ownedDecks = keep<PurchasedDeck>(arr(b.ownedDecks, 'ownedDecks'), 'ownedDecks', (d) => (isStr(d.id) ? (d as unknown as PurchasedDeck) : null));

  const globalTags = keep<GlobalCardTags>(arr(b.globalTags, 'globalTags'), 'globalTags', (g) => {
    if (!isStr(g.id) || !Array.isArray(g.tags)) return null;
    const tags = [...new Set(g.tags.filter(isStr))];
    const favorite = g.favorite === true;
    return tags.length || favorite
      ? { id: g.id, card: isValidCard(g.card) ? g.card : undefined, tags, ...(favorite ? { favorite } : {}), updatedAt: typeof g.updatedAt === 'number' ? g.updatedAt : Date.now() }
      : null;
  });

  const backup: Backup = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    decks, collection, watchlist, sales, prices, searches, ownedDecks, globalTags,
    settings: isObj(b.settings) ? (b.settings as Partial<Settings>) : {},
  };
  return {
    backup,
    summary: {
      exportedAt: backup.exportedAt,
      decks: decks.length,
      collection: collection.length,
      copies: collection.reduce((n, i) => n + i.qty, 0),
      watchlist: watchlist.length,
      sales: sales.length,
      prices: prices.length,
      searches: searches.length,
      ownedDecks: ownedDecks.length,
      globalTags: globalTags.length,
      dropped,
      droppedTotal: Object.values(dropped).reduce((a, n) => a + n, 0) - dropped.allocationsClamped,
    },
  };
}

/** Replace everything on this device with the backup's contents. All-or-nothing: one transaction. */
export async function restoreBackup(b: Backup) {
  const groups: [StoreName, { id: string; updatedAt: number }[]][] = [
    ['decks', b.decks], ['collection', b.collection], ['watchlist', b.watchlist], ['sales', b.sales],
    ['prices', b.prices], ['searches', b.searches], ['owneddecks', b.ownedDecks], ['cardtags', b.globalTags],
  ];
  await transact([...groups.map(([s]) => s), 'meta'], async (tx) => {
    for (const [store, rows] of groups) {
      tx.clear(store);
      for (const r of rows) tx.put(store, r, false);
    }
    tx.putSettings({ ...DEFAULT_SETTINGS, ...b.settings, lastBackupAt: Date.now() });
    // Older backups have no ledger rows for their lots: let the backfill run (in the same transaction).
    await backfillLedgerTx(tx);
  });
}
