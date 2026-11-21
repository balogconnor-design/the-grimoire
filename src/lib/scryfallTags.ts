import { useEffect, useMemo, useSyncExternalStore } from 'react';
import TAG_LIST from './scryfallTagList.json';
import { db, getSettings, onSettingsChange, setSettings, useSettings, type Settings } from './store';

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
 *
 * Opt-in (`Settings.scryfallTags`, off by default), and each tag can be hidden on its own
 * (`Settings.hiddenScryfallTags`). Off or hidden tags stay attached to the cards in the data, but
 * Grimoire ignores them: they don't show, group, sort, count in draw odds or match tag searches.
 * The one exception is the bracket estimate, which reads every tag (`useAllScryfallTags`) because it
 * is about what the cards do, not how they're shown.
 */
export const SCRYFALL_TAGS: { otag: string; label: string }[] = TAG_LIST;
const ALL_LABELS = SCRYFALL_TAGS.map((t) => t.label);

type Visibility = Pick<Settings, 'scryfallTags' | 'hiddenScryfallTags'>;

/** Labels in use: none while Scryfall tags are off, else every tag not hidden. */
export function shownScryfallTags(s: Visibility = getSettings()): Set<string> {
  if (!s.scryfallTags) return new Set();
  const hidden = new Set(s.hiddenScryfallTags ?? []);
  return new Set(ALL_LABELS.filter((l) => !hidden.has(l)));
}
let shown = shownScryfallTags();

const LABEL_ORDER = new Map(SCRYFALL_TAGS.map((t, i) => [t.label, i]));
/** True for the label of one of the fixed Scryfall tags (e.g. "mana rock") that is turned on and not hidden. */
export const isScryfallTagLabel = (t: string) => shown.has(t);
/** The Scryfall name (otag) for a search value given as a label or a Scryfall name, if it is one of the shown tags. */
export const scryfallOtagFor = (value: string): string | undefined => {
  const v = value.toLowerCase().replace(/-/g, ' ');
  return SCRYFALL_TAGS.find((t) => shown.has(t.label) && (t.label === v || t.otag.replace(/-/g, ' ') === v))?.otag;
};
/** Sort labels into priority order (the order of SCRYFALL_TAGS). */
export const byTagPriority = (a: string, b: string) => (LABEL_ORDER.get(a) ?? 999) - (LABEL_ORDER.get(b) ?? 999);

/** A Scryfall tag matches a search value by label ("mana rock") or Scryfall name ("mana-rock"). */
export const scryfallTagMatches = (label: string, value: string, exact: boolean) => {
  const v = value.toLowerCase().replace(/-/g, ' ');
  return exact ? label === v : label.includes(v);
};

/** Turn Scryfall tags on or off. Hidden tags are remembered for when they're turned on again. */
export const setScryfallTagsOn = (on: boolean) => setSettings({ scryfallTags: on });
/** Hide or show one tag (by label). */
export function setScryfallTagHidden(label: string, hide: boolean) {
  const cur = new Set(getSettings().hiddenScryfallTags ?? []);
  if (hide) cur.add(label); else cur.delete(label);
  setSettings({ hiddenScryfallTags: ALL_LABELS.filter((l) => cur.has(l)) });
}
/** Hide every tag, or show every tag again. */
export const setAllScryfallTagsHidden = (hide: boolean) => setSettings({ hiddenScryfallTags: hide ? [...ALL_LABELS] : [] });

/** The shipped data: every card name once, and per tag the positions of its cards in `names`. */
export interface TagData { generated: string; tags: string[]; names: string[]; cards: number[][] }

export interface ScryfallTagStatus {
  /** 'updating' while the bundled data loads (a moment on first use). */
  state: 'idle' | 'updating' | 'error';
  /** Date the bundled data was collected from Scryfall (YYYY-MM-DD), once loaded. */
  generated?: string;
}

let allByName = new Map<string, string[]>(); // card name -> every label, priority order
let byName = new Map<string, string[]>(); // the same with only shown labels (cards left with none are left out)
let status: ScryfallTagStatus = { state: 'idle' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Keep only shown labels. */
function visibleOnly(all: Map<string, string[]>, show: Set<string>): Map<string, string[]> {
  if (show.size === ALL_LABELS.length) return all;
  const m = new Map<string, string[]>();
  if (!show.size) return m;
  for (const [n, labels] of all) {
    const keep = labels.filter((l) => show.has(l));
    if (keep.length) m.set(n, keep);
  }
  return m;
}

const visibilityKey = (s: Visibility) => `${s.scryfallTags ? 1 : 0}|${(s.hiddenScryfallTags ?? []).join(',')}`;
let lastVisibility = visibilityKey(getSettings());
/**
 * Follow the settings: re-apply what's shown when they change, and load the bundled data the first
 * time the tags are on (nothing is loaded while they're off). Call once at start.
 */
export function watchScryfallTagSettings(): () => void {
  const check = () => {
    const s = getSettings();
    if (s.scryfallTags) void loadScryfallTags();
    const key = visibilityKey(s);
    if (key === lastVisibility) return;
    lastVisibility = key;
    shown = shownScryfallTags(s);
    byName = visibleOnly(allByName, shown);
    emit();
  };
  check();
  return onSettingsChange(check);
}

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
      allByName = indexTagData(data);
      byName = visibleOnly(allByName, shown);
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

/**
 * Tests: put lists (otag -> card names) in memory instead of the bundled data. The tags count as
 * turned on with none hidden, unless `visibility` says otherwise.
 */
export function setScryfallTagsForTests(data: Record<string, string[]>, visibility: Visibility = { scryfallTags: true }) {
  const names = [...new Set(Object.values(data).flat())];
  const index = new Map(names.map((n, i) => [n, i]));
  allByName = indexTagData({ generated: 'test', tags: Object.keys(data), names, cards: Object.values(data).map((l) => l.map((n) => index.get(n)!)) });
  shown = shownScryfallTags(visibility);
  byName = visibleOnly(allByName, shown);
  status = { state: 'idle', generated: 'test' };
  emit();
}

/** Tests: turn the tags on or off, or hide some, without going through the saved settings. */
export function setScryfallTagVisibilityForTests(visibility: Visibility) {
  shown = shownScryfallTags(visibility);
  byName = visibleOnly(allByName, shown);
  emit();
}

/** Shown Scryfall tags of a card (by name), in priority order. */
export const scryfallTagsOf = (name: string): string[] => byName.get(name) ?? [];

/** card name -> shown Scryfall tags; re-renders when the data loads or the settings change. */
export function useScryfallTags(): Map<string, string[]> {
  return useSyncExternalStore(subscribe, () => byName);
}

/**
 * card name -> every Scryfall tag, whether turned off or hidden or not. Only for the bracket estimate,
 * which is about what the cards do. Loads the bundled data when first used.
 */
export function useAllScryfallTags(): Map<string, string[]> {
  useEffect(() => { void loadScryfallTags(); }, []);
  return useSyncExternalStore(subscribe, () => allByName);
}

/** Whether Scryfall tags are on, and which labels are hidden. */
export function useScryfallTagVisibility(): { on: boolean; hidden: Set<string> } {
  const s = useSettings();
  return useMemo(() => ({ on: !!s.scryfallTags, hidden: new Set(s.hiddenScryfallTags ?? []) }), [s.scryfallTags, s.hiddenScryfallTags]);
}

export function useScryfallTagStatus(): ScryfallTagStatus {
  return useSyncExternalStore(subscribe, () => status);
}
