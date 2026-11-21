import { useSyncExternalStore } from 'react';
import { searchNamesPage } from './scryfall';
import { db } from './store';

/**
 * Scryfall tags: automatic, read-only tags from Scryfall Tagger (oracle tags, `otag:`).
 *
 * Scryfall can't say which tags a card has, only which cards have a tag, so Grimoire downloads the
 * card names for a fixed set of tags, keeps them in IndexedDB ('meta' store, key `stag:<otag>`) and
 * refreshes them weekly. Every card then gets its tags locally, offline too. Not part of backups:
 * the lists can always be downloaded again.
 *
 * Order matters: it is the priority used to pick a card's main tag when grouping a deck by tag.
 */
export const SCRYFALL_TAGS: { otag: string; label: string }[] = [
  { otag: 'ramp', label: 'ramp' },
  { otag: 'mana-rock', label: 'mana rock' },
  { otag: 'mana-dork', label: 'mana dork' },
  { otag: 'draw', label: 'draw' },
  { otag: 'draw-engine', label: 'draw engine' },
  { otag: 'removal', label: 'removal' },
  { otag: 'boardwipe', label: 'board wipe' },
  { otag: 'counterspell', label: 'counterspell' },
  { otag: 'tutor', label: 'tutor' },
  { otag: 'recursion', label: 'recursion' },
  { otag: 'reanimate', label: 'reanimate' },
  { otag: 'protection', label: 'protection' },
  { otag: 'repeatable-token-generator', label: 'tokens' },
  { otag: 'lifegain', label: 'lifegain' },
  { otag: 'burn', label: 'burn' },
  { otag: 'sacrifice-outlet', label: 'sac outlet' },
  { otag: 'graveyard-hate', label: 'graveyard hate' },
  { otag: 'copy', label: 'copy' },
  { otag: 'win-condition', label: 'win condition' },
  { otag: 'extra-turn', label: 'extra turn' },
  { otag: 'land-removal', label: 'land destruction' },
  { otag: 'mass-land-denial', label: 'mass land denial' },
];

const LABEL_ORDER = new Map(SCRYFALL_TAGS.map((t, i) => [t.label, i]));
/** True for the label of one of the fixed Scryfall tags (e.g. "mana rock"). */
export const isScryfallTagLabel = (t: string) => LABEL_ORDER.has(t);
/** The Scryfall name (otag) for a search value given as a label or a Scryfall name, if it is one of the fixed tags. */
export const scryfallOtagFor = (value: string): string | undefined => {
  const v = value.toLowerCase().replace(/-/g, ' ');
  return SCRYFALL_TAGS.find((t) => t.label === v || t.otag.replace(/-/g, ' ') === v)?.otag;
};
/** Sort labels into priority order (the order of SCRYFALL_TAGS). */
export const byTagPriority = (a: string, b: string) => (LABEL_ORDER.get(a) ?? 999) - (LABEL_ORDER.get(b) ?? 999);

/** A Scryfall tag matches a search value by label ("mana rock") or Scryfall name ("mana-rock"). */
export const scryfallTagMatches = (label: string, value: string, exact: boolean) => {
  const v = value.toLowerCase().replace(/-/g, ' ');
  return exact ? label === v : label.includes(v);
};

const REFRESH_MS = 7 * 24 * 3600 * 1000;
/** Pause between tag-list pages (on top of Scryfall's ~1 s to answer each): about one request a second. */
let PAGE_GAP_MS = 600;
const pause = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
/** Tests: no pause between pages. */
export function setTagPageGapForTests(ms: number) { PAGE_GAP_MS = ms; }
const KEY = (otag: string) => `stag:${otag}`;

interface Stored { key: string; value: { names: string[]; fetchedAt: number } }

export interface ScryfallTagStatus {
  state: 'idle' | 'updating' | 'error';
  /** Tags downloaded so far in the current update. */
  done: number;
  total: number;
  /** Oldest download among the tags (0 = some tag never downloaded). */
  updatedAt: number;
}

let lists = new Map<string, { names: Set<string>; fetchedAt: number }>(); // otag -> card names
let byName = new Map<string, string[]>(); // card name -> labels, priority order
let status: ScryfallTagStatus = { state: 'idle', done: 0, total: 0, updatedAt: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

function rebuild() {
  const m = new Map<string, string[]>();
  for (const t of SCRYFALL_TAGS) {
    const list = lists.get(t.otag);
    if (!list) continue;
    for (const n of list.names) {
      const cur = m.get(n);
      if (cur) cur.push(t.label); else m.set(n, [t.label]);
    }
  }
  byName = m;
  const times = SCRYFALL_TAGS.map((t) => lists.get(t.otag)?.fetchedAt ?? 0);
  status = { ...status, updatedAt: Math.min(...times) };
  emit();
}

/** Read saved tag lists from IndexedDB. */
export async function loadScryfallTags() {
  const d = await db();
  const rows = await Promise.all(SCRYFALL_TAGS.map((t) => d.get('meta', KEY(t.otag)) as Promise<Stored | undefined>));
  const next = new Map<string, { names: Set<string>; fetchedAt: number }>();
  rows.forEach((r, i) => r?.value && next.set(SCRYFALL_TAGS[i].otag, { names: new Set(r.value.names), fetchedAt: r.value.fetchedAt }));
  lists = next;
  rebuild();
}

/** Tests: put lists in memory without the database or the network. */
export function setScryfallTagsForTests(data: Record<string, string[]>) {
  lists = new Map(Object.entries(data).map(([otag, names]) => [otag, { names: new Set(names), fetchedAt: Date.now() }]));
  rebuild();
}

let running: Promise<void> | null = null;

/**
 * Download any tag list that is missing or older than a week, one page at a time through the
 * shared Scryfall queue (so the user's own searches still go through between pages). Stops quietly
 * when offline or on an error, and tries again next time.
 */
export function refreshScryfallTags(force = false): Promise<void> {
  running ??= (async () => {
    const due = SCRYFALL_TAGS.filter((t) => force || Date.now() - (lists.get(t.otag)?.fetchedAt ?? 0) > REFRESH_MS);
    if (!due.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    status = { ...status, state: 'updating', done: 0, total: due.length };
    emit();
    try {
      const d = await db();
      const fetchTag = async (t: (typeof SCRYFALL_TAGS)[number]) => {
        const names: string[] = [];
        for (let page = 1; page < 100; page++) {
          if (page > 1 || status.done > 0) await pause(PAGE_GAP_MS);
          const batch = await searchNamesPage(`otag:${t.otag}`, page);
          if (!batch) break;
          names.push(...batch);
          if (batch.length < 175) break;
        }
        const value = { names, fetchedAt: Date.now() };
        await d.put('meta', { key: KEY(t.otag), value });
        lists.set(t.otag, { names: new Set(names), fetchedAt: value.fetchedAt });
        status = { ...status, done: status.done + 1 };
        rebuild();
      };
      // One page at a time with a pause between: Scryfall limits search requests more tightly than
      // others (going faster gets refused), and the user's own searches go through in the pauses.
      for (const t of due) await fetchTag(t);
      status = { ...status, state: 'idle' };
    } catch (e) {
      console.warn('Scryfall tags: update stopped', e);
      status = { ...status, state: 'error' };
    } finally {
      emit();
      running = null;
    }
  })();
  return running;
}

/** Scryfall tags of a card (by name), in priority order. */
export const scryfallTagsOf = (name: string): string[] => byName.get(name) ?? [];

/** card name -> Scryfall tags; re-renders when lists change. */
export function useScryfallTags(): Map<string, string[]> {
  return useSyncExternalStore(subscribe, () => byName);
}

export function useScryfallTagStatus(): ScryfallTagStatus {
  return useSyncExternalStore(subscribe, () => status);
}
