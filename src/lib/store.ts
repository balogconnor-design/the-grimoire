import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { useSyncExternalStore } from 'react';
import type { CollectionItem, Deck, PriceSnapshot, PurchasedDeck, SaleRecord, SavedSearch, WatchItem } from '../types';

// Internal name: renaming it makes existing data unreadable. Keep "deckforge".
const DB_NAME = 'deckforge';
const DB_VERSION = 3;
export const STORES = ['decks', 'collection', 'watchlist', 'sales', 'prices', 'searches', 'owneddecks', 'meta'] as const;
export type StoreName = (typeof STORES)[number];

type UpgradeStep = (d: IDBPDatabase) => void;

/** Create whatever stores are missing, so existing data is untouched. Idempotent. */
const ensureStores: UpgradeStep = (d) => {
  for (const s of STORES) {
    if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
  }
};

/**
 * Schema upgrade steps, keyed by the version they upgrade TO. Opening runs every step after the
 * stored version, in order. v1 had only 'decks'; v2/v3 added the rest. Add a step here (and bump
 * DB_VERSION) only when the schema itself changes.
 */
export const UPGRADES: Record<number, UpgradeStep> = {
  1: ensureStores,
  2: ensureStores,
  3: ensureStores,
};

let dbPromise: Promise<IDBPDatabase> | null = null;
export function db() {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d, oldVersion, newVersion) {
      for (let v = oldVersion + 1; v <= (newVersion ?? DB_VERSION); v++) UPGRADES[v]?.(d);
    },
  });
  return dbPromise;
}

/** Tests only: close and forget the connection so a fresh fake database can be opened. */
export async function resetDbForTests() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

// ---------- Save-error reporting ----------

type ErrorListener = (message: string) => void;
const errorListeners = new Set<ErrorListener>();
/** The UI (Toast provider) subscribes here to show failed writes. */
export function onSaveError(l: ErrorListener) {
  errorListeners.add(l);
  return () => { errorListeners.delete(l); };
}
const reported = new WeakSet<object>();
/** True when this error was already shown to the user by the store (so callers needn't toast it again). */
export const wasReported = (err: unknown) => typeof err === 'object' && err !== null && reported.has(err);
export function reportSaveError(err: unknown) {
  if (typeof err === 'object' && err !== null) reported.add(err);
  const why = err instanceof Error ? err.message : String(err);
  const msg = `Couldn't save your changes${why ? ` (${why})` : ''}. The screen now shows what is actually saved.`;
  if (!errorListeners.size) console.error(msg);
  errorListeners.forEach((l) => l(msg));
}

// ---------- Generic reactive table ----------

interface Row { id: string; updatedAt: number }

interface Committed<T> { cleared: boolean; puts: Map<string, T>; deletes: Set<string> }

export interface Table<T extends Row> {
  name: StoreName;
  all: () => T[];
  get: (id: string) => T | undefined;
  load: () => Promise<void>;
  put: (row: T, touch?: boolean) => Promise<void>;
  putMany: (rows: T[], touch?: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeMany: (ids: string[]) => Promise<void>;
  replaceAll: (rows: T[]) => Promise<void>;
  update: (id: string, fn: (draft: T) => T | void) => void;
  /** Apply changes that a transaction has already committed to the database. */
  applyCommitted: (c: Committed<T>) => void;
  useAll: () => T[];
  useOne: (id: string | undefined) => T | undefined;
  useLoaded: () => boolean;
}

const tables = new Map<StoreName, Table<Row>>();

function createTable<T extends Row>(name: StoreName, sort: (a: T, b: T) => number): Table<T> {
  let rows: T[] = [];
  let loaded = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const set = (next: T[]) => {
    rows = next.sort(sort);
    emit();
  };

  /**
   * Single-store writes are optimistic (the screen updates at once). If the write fails, the
   * table is reloaded from the database, the error is reported to the UI, and the promise rejects.
   */
  const guarded = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch (e) {
      await t.load().catch(() => undefined);
      reportSaveError(e);
      throw e;
    }
  };

  const t: Table<T> = {
    name,
    all: () => rows,
    get: (id) => rows.find((r) => r.id === id),
    async load() {
      rows = ((await (await db()).getAll(name)) as T[]).sort(sort);
      loaded = true;
      emit();
    },
    async putMany(input, touch = true) {
      if (!input.length) return;
      const now = Date.now();
      const next = touch ? input.map((r) => ({ ...r, updatedAt: now })) : input;
      const ids = new Set(next.map((r) => r.id));
      set([...next, ...rows.filter((r) => !ids.has(r.id))]);
      await guarded(async () => {
        const tx = (await db()).transaction(name, 'readwrite');
        await Promise.all([...next.map((r) => tx.store.put(r)), tx.done]);
      });
    },
    put: (row, touch) => t.putMany([row], touch),
    async removeMany(ids) {
      const s = new Set(ids);
      set(rows.filter((r) => !s.has(r.id)));
      await guarded(async () => {
        const tx = (await db()).transaction(name, 'readwrite');
        await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
      });
    },
    remove: (id) => t.removeMany([id]),
    async replaceAll(next) {
      set([...next]);
      await guarded(async () => {
        const tx = (await db()).transaction(name, 'readwrite');
        await Promise.all([tx.store.clear(), ...next.map((r) => tx.store.put(r)), tx.done]);
      });
    },
    update(id, fn) {
      const current = t.get(id);
      if (!current) return;
      const draft = structuredClone(current);
      t.put(fn(draft) ?? draft).catch(() => undefined); // failure already reported + reloaded
    },
    applyCommitted({ cleared, puts, deletes }) {
      const base = cleared ? [] : rows.filter((r) => !deletes.has(r.id) && !puts.has(r.id));
      set([...puts.values(), ...base]);
    },
    useAll: () => useSyncExternalStore(subscribe, () => rows),
    useOne: (id) => useSyncExternalStore(subscribe, () => rows.find((r) => r.id === id)),
    useLoaded: () => useSyncExternalStore(subscribe, () => loaded),
  };
  tables.set(name, t as unknown as Table<Row>);
  return t;
}

const byUpdated = (a: Row, b: Row) => b.updatedAt - a.updatedAt;

export const decksT = createTable<Deck>('decks', byUpdated);
export const collectionT = createTable<CollectionItem>('collection', (a, b) => a.card.name.localeCompare(b.card.name) || a.card.set.localeCompare(b.card.set));
export const watchT = createTable<WatchItem>('watchlist', byUpdated);
export const salesT = createTable<SaleRecord>('sales', (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
export const pricesT = createTable<PriceSnapshot>('prices', (a, b) => a.id.localeCompare(b.id)); // oldest -> newest
export const searchesT = createTable<SavedSearch>('searches', (a, b) => a.name.localeCompare(b.name));

export const ownedDecksT = createTable<PurchasedDeck>('owneddecks', (a, b) => (b.acquiredAt ?? '').localeCompare(a.acquiredAt ?? '') || b.createdAt - a.createdAt);

export const TABLES = [decksT, collectionT, watchT, salesT, pricesT, searchesT, ownedDecksT];

// ---------- Settings (meta store, key/value) ----------

export interface Settings {
  buyListMode: 'sum' | 'max';
  ignoreBasics: boolean;
  conditionAdjust: boolean;
  lastBackupAt?: number;
  lastCollectionRefresh?: number;
  /** Existing lots were written into the transaction ledger as "bought" rows. */
  ledgerBackfilled?: boolean;
}

export const DEFAULT_SETTINGS: Settings = { buyListMode: 'sum', ignoreBasics: true, conditionAdjust: false };
let settings: Settings = DEFAULT_SETTINGS;
const settingsListeners = new Set<() => void>();
const emitSettings = (next: Settings) => {
  settings = next;
  settingsListeners.forEach((l) => l());
};

let settingsLoaded = false;

export async function loadSettings() {
  const row = await (await db()).get('meta', 'settings');
  settingsLoaded = true;
  emitSettings({ ...DEFAULT_SETTINGS, ...(row?.value ?? {}) });
}

export function getSettings() {
  return settings;
}

export function setSettings(patch: Partial<Settings>) {
  emitSettings({ ...settings, ...patch });
  const value = settings;
  db()
    .then((d) => d.put('meta', { key: 'settings', value }))
    .catch(async (e) => {
      await loadSettings().catch(() => undefined);
      reportSaveError(e);
    });
}

export async function replaceSettings(next: Partial<Settings>) {
  const value = { ...DEFAULT_SETTINGS, ...next };
  await transact(['meta'], async (tx) => { tx.putSettings(value); });
}

const subscribeSettings = (l: () => void) => { settingsListeners.add(l); return () => settingsListeners.delete(l); };

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, () => settings);
}

/** True once saved settings have been read from storage (before that, useSettings returns defaults). */
export function useSettingsLoaded(): boolean {
  return useSyncExternalStore(subscribeSettings, () => settingsLoaded);
}

export async function loadAll() {
  await Promise.all([...TABLES.map((t) => t.load()), loadSettings()]);
}

// ---------- Multi-store transactions ----------

/**
 * Handle passed to a transact() callback. Reads see earlier writes made in the same transaction.
 * Only await IndexedDB work (get/getAll) inside the callback: awaiting anything else (fetch, timers)
 * lets the browser auto-commit the transaction early.
 */
export interface Tx {
  get<T>(store: StoreName, id: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  /** Queue a put. `touch` (default true) stamps updatedAt like Table.put does. Returns the stored row. */
  put<T extends Row>(store: StoreName, row: T, touch?: boolean): T;
  delete(store: StoreName, id: string): void;
  clear(store: StoreName): void;
  getSettings(): Promise<Settings>;
  putSettings(next: Settings): void;
}

type RWTx = IDBPTransaction<unknown, StoreName[], 'readwrite'>;

/**
 * Run one IndexedDB transaction across every store an operation touches. Either every write
 * commits or none do. In-memory tables (and settings) are updated only after the commit.
 * On failure the transaction is aborted, the error is reported to the UI, touched tables are
 * reloaded from the database, and the promise rejects.
 */
export async function transact<R>(stores: StoreName[], fn: (tx: Tx) => Promise<R>): Promise<R> {
  const changes = new Map<StoreName, Committed<Row>>();
  const change = (s: StoreName) => {
    let c = changes.get(s);
    if (!c) changes.set(s, (c = { cleared: false, puts: new Map(), deletes: new Set() }));
    return c;
  };
  let newSettings: Settings | undefined;
  const pending: Promise<unknown>[] = [];
  const track = (p: Promise<unknown>) => { pending.push(p); p.catch(() => undefined); };

  let tx: RWTx | undefined;
  try {
    const t = (tx = (await db()).transaction(stores, 'readwrite') as unknown as RWTx);
    const store = (s: StoreName) => t.objectStore(s);
    const api: Tx = {
      get: async (s, id) => (await store(s).get(id)) as never,
      getAll: async (s) => (await store(s).getAll()) as never,
      put(s, row, touch = true) {
        const r = touch ? { ...row, updatedAt: Date.now() } : row;
        track(store(s).put(r));
        const c = change(s);
        c.deletes.delete(r.id);
        c.puts.set(r.id, r);
        return r;
      },
      delete(s, id) {
        track(store(s).delete(id));
        const c = change(s);
        c.puts.delete(id);
        c.deletes.add(id);
      },
      clear(s) {
        track(store(s).clear());
        const c = change(s);
        c.cleared = true;
        c.puts.clear();
        c.deletes.clear();
      },
      async getSettings() {
        if (newSettings) return newSettings;
        const row = (await store('meta').get('settings')) as { value?: Partial<Settings> } | undefined;
        return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
      },
      putSettings(next) {
        newSettings = next;
        track(store('meta').put({ key: 'settings', value: next }));
      },
    };
    const result = await fn(api);
    await Promise.all(pending);
    await t.done;
    for (const [s, c] of changes) tables.get(s)?.applyCommitted(c);
    if (newSettings) emitSettings(newSettings);
    return result;
  } catch (e) {
    try { tx?.abort(); } catch { /* already finished */ }
    await tx?.done.catch(() => undefined);
    await Promise.all(stores.map((s) => (s === 'meta' ? loadSettings() : tables.get(s)?.load())?.catch(() => undefined)));
    reportSaveError(e);
    throw e;
  }
}

// ---------- Deck API (kept for existing callers) ----------

export const loadDecks = () => decksT.load();
export function useDecks(): { decks: Deck[]; loaded: boolean } {
  return { decks: decksT.useAll(), loaded: decksT.useLoaded() };
}
export const useDeck = (id: string | undefined) => decksT.useOne(id);
export const getDeck = (id: string) => decksT.get(id);
export const saveDeck = (deck: Deck) => decksT.put(deck);

/** Immutable update helper: fn receives a draft copy of the deck. */
export function updateDeck(id: string, fn: (d: Deck) => Deck | void) {
  const current = getDeck(id);
  if (!current) return;
  const draft: Deck = { ...current, entries: current.entries.map((e) => ({ ...e })) };
  const result = fn(draft) ?? draft;
  saveDeck(result).catch(() => undefined); // failure already reported + reloaded
}

/** Delete a deck and release the collection copies committed to it, in one transaction. */
export async function deleteDeck(id: string) {
  await transact(['decks', 'collection'], async (tx) => {
    tx.delete('decks', id);
    for (const i of await tx.getAll<CollectionItem>('collection')) {
      if (!i.allocations?.[id]) continue;
      const allocations = { ...i.allocations };
      delete allocations[id];
      tx.put('collection', { ...i, allocations });
    }
  });
}
