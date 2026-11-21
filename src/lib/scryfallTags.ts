import { useSyncExternalStore } from 'react';
import TAG_LIST from './scryfallTagList.json';
import { db } from './store';

/**
 * Scryfall tags: automatic, read-only tags from Scryfall Tagger (oracle tags, `otag:`).
 *
 * Scryfall can't say which tags a card has, only which cards have a tag, so the card lists for a fixed
 * set of 40 tags are collected once by `scripts/build-scryfall-tags.mjs` and shipped with the app in
 * `src/data/scryfall-tags.json` (loaded as its own chunk, cached offline with the rest of the app).
 * The app never asks Scryfall for tags at runtime. Re-run the script when new sets come out.
 *
 * Order matters (`scryfallTagList.json`): it is the priority used to pick a card's section when a
 * deck is grouped by tag.
 */
export const SCRYFALL_TAGS: { otag: string; label: string }[] = TAG_LIST;

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

/** The shipped data: every card name once, and per tag the positions of its cards in `names`. */
export interface TagData { generated: string; tags: string[]; names: string[]; cards: number[][] }

export interface ScryfallTagStatus {
  /** 'updating' while the bundled data loads (a moment on first use). */
  state: 'idle' | 'updating' | 'error';
  /** Date the bundled data was collected from Scryfall (YYYY-MM-DD), once loaded. */
  generated?: string;
}

let byName = new Map<string, string[]>(); // card name -> labels, priority order
let status: ScryfallTagStatus = { state: 'idle' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Turn the shipped data (or test lists) into card name -> labels in priority order. */
export function indexTagData(data: TagData): Map<string, string[]> {
  const pos = new Map(data.tags.map((t, i) => [t, i]));
  const m = new Map<string, string[]>();
  for (const t of SCRYFALL_TAGS) {
    const i = pos.get(t.otag);
    if (i == null) continue;
    for (const c of data.cards[i]) {
      const n = data.names[c];
      const cur = m.get(n);
      if (cur) cur.push(t.label); else m.set(n, [t.label]);
    }
  }
  return m;
}

let loading: Promise<void> | null = null;
/** Load the bundled tag data. Also clears the per-tag lists older versions downloaded into IndexedDB. */
export function loadScryfallTags(): Promise<void> {
  loading ??= (async () => {
    status = { state: 'updating' };
    emit();
    try {
      const data = (await import('../data/scryfall-tags.json')).default as TagData;
      byName = indexTagData(data);
      status = { state: 'idle', generated: data.generated };
    } catch (e) {
      console.warn('Scryfall tags: could not load the bundled data', e);
      status = { state: 'error' };
      loading = null;
    } finally {
      emit();
    }
    void clearOldDownloads();
  })();
  return loading;
}

/** Versions before 2026-11-21 downloaded each tag list into IndexedDB (`stag:<otag>`); remove them. */
export async function clearOldDownloads() {
  try {
    const d = await db();
    const keys = (await d.getAllKeys('meta')) as string[];
    await Promise.all(keys.filter((k) => typeof k === 'string' && k.startsWith('stag:')).map((k) => d.delete('meta', k)));
  } catch { /* nothing to clear */ }
}

/** Tests: put lists (otag -> card names) in memory instead of the bundled data. */
export function setScryfallTagsForTests(data: Record<string, string[]>) {
  const names = [...new Set(Object.values(data).flat())];
  const index = new Map(names.map((n, i) => [n, i]));
  byName = indexTagData({ generated: 'test', tags: Object.keys(data), names, cards: Object.values(data).map((l) => l.map((n) => index.get(n)!)) });
  status = { state: 'idle', generated: 'test' };
  emit();
}

/** Scryfall tags of a card (by name), in priority order. */
export const scryfallTagsOf = (name: string): string[] => byName.get(name) ?? [];

/** card name -> Scryfall tags; re-renders when the data loads. */
export function useScryfallTags(): Map<string, string[]> {
  return useSyncExternalStore(subscribe, () => byName);
}

export function useScryfallTagStatus(): ScryfallTagStatus {
  return useSyncExternalStore(subscribe, () => status);
}
