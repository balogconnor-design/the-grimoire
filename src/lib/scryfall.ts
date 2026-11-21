import type { Card, ScryfallList } from '../types';

const API = 'https://api.scryfall.com';

// Scryfall asks clients to keep to ~10 requests/second. Serialize requests with a small gap.
const MIN_GAP_MS = 110;
let queue: Promise<unknown> = Promise.resolve();
let lastRequest = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

export class ScryfallError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return throttled(async () => {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ScryfallError(body?.details ?? `Scryfall request failed (${res.status})`, res.status);
    }
    return body as T;
  });
}

/**
 * One page (up to 175 cards) of a search as Scryfall's CSV, reduced to card names. About a seventh of
 * the JSON's size, for lists where only names matter (Scryfall tags). Null once past the last page.
 */
export async function searchNamesPage(q: string, page: number): Promise<string[] | null> {
  return throttled(async () => {
    const params = new URLSearchParams({ q, format: 'csv', unique: 'cards', page: String(page) });
    const res = await fetch(`${API}/cards/search?${params}`, { headers: { Accept: 'text/csv' } });
    if (res.status === 404 || res.status === 422) return null; // no results / past the end
    if (!res.ok) throw new ScryfallError(`Scryfall request failed (${res.status})`, res.status);
    return csvColumn(await res.text(), 'name');
  });
}

/** Values of one column of a CSV document (handles quoted fields with commas, quotes and newlines). */
export function csvColumn(text: string, column: string): string[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const col = rows[0]?.indexOf(column) ?? -1;
  return col < 0 ? [] : rows.slice(1).map((r) => r[col]).filter(Boolean);
}

// Keep stored decks lean: only keep the fields the app reads.
const KEEP: (keyof Card)[] = [
  'id', 'oracle_id', 'name', 'layout', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'flavor_text',
  'power', 'toughness', 'loyalty', 'defense', 'colors', 'color_identity', 'produced_mana', 'keywords',
  'legalities', 'prices', 'image_uris', 'card_faces', 'set', 'set_name', 'collector_number', 'rarity',
  'artist', 'released_at', 'scryfall_uri', 'prints_search_uri', 'edhrec_rank', 'game_changer',
  'finishes', 'frame_effects', 'promo_types', 'full_art', 'border_color', 'promo', 'lang',
];

export function trimCard(raw: Record<string, unknown>): Card {
  const out: Record<string, unknown> = {};
  for (const k of KEEP) if (raw[k] !== undefined) out[k] = raw[k];
  out.cmc = typeof raw.cmc === 'number' ? raw.cmc : 0;
  out.color_identity = raw.color_identity ?? [];
  out.legalities = raw.legalities ?? {};
  out.prices = raw.prices ?? {};
  return out as unknown as Card;
}

function trimList(list: ScryfallList<Record<string, unknown>>): ScryfallList<Card> {
  return { ...list, data: list.data.filter((c) => c.object === 'card' || c.object === undefined).map(trimCard) };
}

export type SortOrder =
  | 'name' | 'set' | 'released' | 'rarity' | 'color' | 'usd' | 'tix' | 'eur' | 'cmc'
  | 'power' | 'toughness' | 'edhrec' | 'penny' | 'artist' | 'review';

/** Every sort order Scryfall offers, labelled for the sort dropdowns. */
export const SORT_ORDERS: { value: SortOrder; label: string }[] = [
  { value: 'name', label: 'Name' }, { value: 'edhrec', label: 'Popularity (EDHREC)' }, { value: 'released', label: 'Release date' },
  { value: 'set', label: 'Set / number' }, { value: 'rarity', label: 'Rarity' }, { value: 'color', label: 'Color' },
  { value: 'cmc', label: 'Mana value' }, { value: 'power', label: 'Power' }, { value: 'toughness', label: 'Toughness' },
  { value: 'usd', label: 'Price (USD)' }, { value: 'eur', label: 'Price (EUR)' }, { value: 'tix', label: 'Price (MTGO tix)' },
  { value: 'artist', label: 'Artist' }, { value: 'penny', label: 'Penny Dreadful rank' }, { value: 'review', label: 'Set review' },
];

export type SortDir = 'auto' | 'asc' | 'desc';
export type Unique = 'cards' | 'prints' | 'art';

export async function searchCards(
  q: string,
  opts: { order?: SortOrder; dir?: SortDir; unique?: Unique } = {},
): Promise<ScryfallList<Card>> {
  const params = new URLSearchParams({
    q,
    order: opts.order ?? 'name',
    dir: opts.dir ?? 'auto',
    unique: opts.unique ?? 'cards',
  });
  try {
    return trimList(await request(`/cards/search?${params}`));
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) {
      return { object: 'list', data: [], has_more: false, total_cards: 0 };
    }
    throw e;
  }
}

export async function fetchPage(url: string): Promise<ScryfallList<Card>> {
  return trimList(await request(url));
}

export async function getNamed(name: string, set?: string): Promise<Card> {
  const params = new URLSearchParams({ exact: name });
  if (set) params.set('set', set);
  return trimCard(await request(`/cards/named?${params}`));
}

export async function autocomplete(q: string): Promise<string[]> {
  if (q.trim().length < 2) return [];
  const res = await request<{ data: string[] }>(`/cards/autocomplete?q=${encodeURIComponent(q)}`);
  return res.data;
}

export type CollectionIdentifier =
  | { id: string }
  | { name: string }
  | { name: string; set: string }
  | { set: string; collector_number: string };

/** Look up many cards at once (75 per request). Returns found cards in input order plus misses. */
export async function getCollection(
  identifiers: CollectionIdentifier[],
): Promise<{ found: Card[]; notFound: CollectionIdentifier[] }> {
  const found: Card[] = [];
  const notFound: CollectionIdentifier[] = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    const chunk = identifiers.slice(i, i + 75);
    const res = await request<{ data: Record<string, unknown>[]; not_found: CollectionIdentifier[] }>(
      '/cards/collection',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers: chunk }) },
    );
    found.push(...res.data.map(trimCard));
    notFound.push(...(res.not_found ?? []));
  }
  return { found, notFound };
}

export async function getPrints(card: Card): Promise<Card[]> {
  if (!card.oracle_id) return [card];
  const res = await searchCards(`oracleid:${card.oracle_id} game:paper`, { order: 'released', dir: 'desc', unique: 'prints' });
  const all = [...res.data];
  let next = res.next_page;
  // Basics have hundreds of printings; cap the fetch so the picker stays snappy.
  while (next && all.length < 350) {
    const page = await fetchPage(next);
    all.push(...page.data);
    next = page.next_page;
  }
  return all.length ? all : [card];
}

// ---------- Sets (for the advanced search set picker) ----------

export interface SetInfo { code: string; name: string; set_type: string; released_at?: string }
const SETS_CACHE_KEY = 'grimoire.sets.v1';
const SETS_TTL_MS = 24 * 60 * 60 * 1000;
let setsPromise: Promise<SetInfo[]> | null = null;

/** All Scryfall sets, newest first. Cached for a day; an empty list if offline. */
export function getSets(): Promise<SetInfo[]> {
  if (setsPromise) return setsPromise;
  try {
    const cached = JSON.parse(localStorage.getItem(SETS_CACHE_KEY) ?? 'null') as { at: number; sets: SetInfo[] } | null;
    if (cached && Date.now() - cached.at < SETS_TTL_MS) return (setsPromise = Promise.resolve(cached.sets));
  } catch { /* ignore */ }
  setsPromise = request<{ data: SetInfo[] }>('/sets')
    .then((res) => {
      const sets = res.data.map(({ code, name, set_type, released_at }) => ({ code, name, set_type, released_at }));
      try { localStorage.setItem(SETS_CACHE_KEY, JSON.stringify({ at: Date.now(), sets })); } catch { /* full or blocked */ }
      return sets;
    })
    .catch(() => { setsPromise = null; return []; });
  return setsPromise;
}

// ---------- Symbology (mana pip SVGs) ----------

const SYMBOL_CACHE_KEY = 'deckforge.symbology.v1';
let symbolMap: Record<string, string> | null = null;

try {
  const cached = localStorage.getItem(SYMBOL_CACHE_KEY);
  if (cached) symbolMap = JSON.parse(cached);
} catch {
  /* ignore */
}

export async function loadSymbology(): Promise<void> {
  if (symbolMap) return;
  try {
    const res = await request<{ data: { symbol: string; svg_uri: string }[] }>('/symbology');
    symbolMap = Object.fromEntries(res.data.map((s) => [s.symbol, s.svg_uri]));
    localStorage.setItem(SYMBOL_CACHE_KEY, JSON.stringify(symbolMap));
  } catch {
    /* fall back to URL convention */
  }
}

/** "{W/U}" -> svg url. Falls back to Scryfall's file naming convention. */
export function symbolUrl(symbol: string): string {
  const key = symbol.startsWith('{') ? symbol : `{${symbol}}`;
  if (symbolMap?.[key]) return symbolMap[key];
  const file = key.slice(1, -1).replace(/\//g, '').replace('∞', 'INFINITY').replace('½', 'HALF');
  return `https://svgs.scryfall.io/card-symbols/${encodeURIComponent(file)}.svg`;
}
