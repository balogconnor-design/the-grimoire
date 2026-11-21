import { useSyncExternalStore } from 'react';
import { resetCardsByNameForTests } from './cardsByName';
import { db } from './store';

/**
 * Public EDHREC data (opt-in, see Settings.edhrec). EDHREC has no official API; these are the JSON
 * files its own pages load, served with `Access-Control-Allow-Origin: *`. Nothing about your deck is
 * sent: the salt list is one shared file, and a commander page is requested by the commander's name.
 * Everything is cached in IndexedDB and failures are quiet (the panel just says it's unavailable).
 */
const BASE = 'https://json.edhrec.com/pages/';
/** Every card's salt score in one file (~2 MB compressed). Salt comes from occasional surveys, so weekly is plenty. */
const SALT_URL = `${BASE}top/salt-1.json`;
export const SALT_MAX_AGE = 7 * 24 * 3600 * 1000;
export const COMMANDER_MAX_AGE = 24 * 3600 * 1000;
const SALT_KEY = 'edhrec:salt';
const CMD_KEY = (slug: string) => `edhrec:cmd:${slug}`;

/** EDHREC's URL name for a card: front face, lower case, accents and punctuation dropped, spaces as dashes. */
export function edhrecSlug(name: string): string {
  return name.split(' // ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’",.!?:]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export const edhrecCommanderUrl = (name: string) => `https://edhrec.com/commanders/${edhrecSlug(name)}`;

type Fetcher = (url: string) => Promise<Response>;
let fetcher: Fetcher = (url) => fetch(url);
/** Tests: replace the network. */
export function setEdhrecFetchForTests(f: Fetcher) { fetcher = f; }

async function getJson(url: string): Promise<unknown | null> {
  const res = await fetcher(url);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`EDHREC answered ${res.status}`);
  return res.json();
}

interface CardView { name?: string; salt?: number; num_decks?: number; potential_decks?: number; synergy?: number }
interface CardList { header?: string; cardviews?: CardView[] }
const cardlists = (data: unknown): CardList[] =>
  (data as { container?: { json_dict?: { cardlists?: CardList[] } } })?.container?.json_dict?.cardlists ?? [];

// ---------- Salt ----------

export interface SaltStatus { state: 'idle' | 'loading' | 'error'; fetchedAt: number }
let salt = new Map<string, number>();
let saltStatus: SaltStatus = { state: 'idle', fetchedAt: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Parse EDHREC's salt list into [card name, salt 0–4] pairs, keeping only cards with a score. */
export function parseSalt(data: unknown): [string, number][] {
  const out: [string, number][] = [];
  for (const list of cardlists(data)) for (const v of list.cardviews ?? []) {
    if (v.name && typeof v.salt === 'number' && v.salt > 0) out.push([v.name, Math.round(v.salt * 100) / 100]);
  }
  return out;
}

function setSalt(entries: [string, number][], fetchedAt: number) {
  const m = new Map<string, number>();
  for (const [n, s] of entries) {
    m.set(n, s);
    const front = n.split(' // ')[0];
    if (front !== n && !m.has(front)) m.set(front, s);
  }
  salt = m;
  saltStatus = { state: 'idle', fetchedAt };
  emit();
}

let saltRun: Promise<void> | null = null;
/** Load the saved salt list, downloading a fresh one when it is missing or a week old. Never throws. */
export function ensureSalt(): Promise<void> {
  saltRun ??= (async () => {
    try {
      const d = await db();
      if (!salt.size) {
        const row = (await d.get('meta', SALT_KEY)) as { value?: { entries: [string, number][]; fetchedAt: number } } | undefined;
        if (row?.value) setSalt(row.value.entries, row.value.fetchedAt);
      }
      if (Date.now() - saltStatus.fetchedAt < SALT_MAX_AGE) return;
      saltStatus = { ...saltStatus, state: 'loading' };
      emit();
      const data = await getJson(SALT_URL);
      const entries = data ? parseSalt(data) : [];
      if (!entries.length) throw new Error('EDHREC salt list was empty');
      const fetchedAt = Date.now();
      await d.put('meta', { key: SALT_KEY, value: { entries, fetchedAt } });
      setSalt(entries, fetchedAt);
    } catch (e) {
      console.warn('EDHREC salt', e);
      saltStatus = { ...saltStatus, state: 'error' };
      emit();
    } finally {
      saltRun = null;
    }
  })();
  return saltRun;
}

export const saltOf = (name: string): number | undefined => salt.get(name) ?? salt.get(name.split(' // ')[0]);
export function useSalt(): Map<string, number> { return useSyncExternalStore(subscribe, () => salt); }
export function useSaltStatus(): SaltStatus { return useSyncExternalStore(subscribe, () => saltStatus); }

// ---------- Commander pages ----------

export interface Suggestion {
  name: string;
  /** Share of this commander's decks that play the card, 0–1. */
  inclusion: number;
  /** How much more often this commander's decks play it than other decks that could, −1 to 1. */
  synergy: number;
  /** EDHREC's section, e.g. "Creatures". */
  list: string;
}
export interface CommanderData { name: string; decks: number; suggestions: Suggestion[]; fetchedAt: number }

/** Parse a commander page: every card it lists once, with inclusion and synergy. */
export function parseCommander(name: string, data: unknown, fetchedAt: number): CommanderData {
  const seen = new Map<string, Suggestion>();
  for (const list of cardlists(data)) for (const v of list.cardviews ?? []) {
    if (!v.name || seen.has(v.name) || !v.potential_decks) continue;
    seen.set(v.name, {
      name: v.name,
      inclusion: Math.min(1, (v.num_decks ?? 0) / v.potential_decks),
      synergy: v.synergy ?? 0,
      list: list.header ?? '',
    });
  }
  const card = (data as { container?: { json_dict?: { card?: { num_decks?: number } } } })?.container?.json_dict?.card;
  return { name, decks: card?.num_decks ?? 0, suggestions: [...seen.values()], fetchedAt };
}

const commanders = new Map<string, CommanderData | null>();
/**
 * A commander's EDHREC page: from memory, then IndexedDB, then the network once it is a day old.
 * Returns null when EDHREC doesn't know the commander. Falls back to a stale copy on errors; throws
 * only when there is nothing to show.
 */
export async function getCommanderData(name: string): Promise<CommanderData | null> {
  const slug = edhrecSlug(name);
  const mem = commanders.get(slug);
  if (mem !== undefined && (mem === null || Date.now() - mem.fetchedAt < COMMANDER_MAX_AGE)) return mem;
  const d = await db();
  const row = (await d.get('meta', CMD_KEY(slug))) as { value?: CommanderData } | undefined;
  const saved = row?.value;
  if (saved && Date.now() - saved.fetchedAt < COMMANDER_MAX_AGE) { commanders.set(slug, saved); return saved; }
  try {
    const data = await getJson(`${BASE}commanders/${slug}.json`);
    if (!data) { commanders.set(slug, null); return null; }
    const parsed = parseCommander(name, data, Date.now());
    await d.put('meta', { key: CMD_KEY(slug), value: parsed });
    commanders.set(slug, parsed);
    return parsed;
  } catch (e) {
    if (saved) return saved;
    throw e;
  }
}

/** Tests: forget everything held in memory. */
export function resetEdhrecForTests() {
  salt = new Map();
  saltStatus = { state: 'idle', fetchedAt: 0 };
  saltRun = null;
  commanders.clear();
  resetCardsByNameForTests();
}

// ---------- Card data for suggestions ----------

/** Suggested cards are looked up on Scryfall with the shared by-name lookup. */
export { cardByName as suggestionCard, loadCardsByName as loadSuggestionCards } from './cardsByName';
