import type { Card, ScryfallList } from '../types';
import { fetchPage, searchCards, type SortDir, type SortOrder, type Unique } from './scryfall';
import { liftScryfallTags, parseQuery, splitForScryfall, type Subject } from './query';
import { scryfallOtagFor, scryfallTagsOf, SCRYFALL_TAGS } from './scryfallTags';
import { collectionT, decksT, globalTagsT } from './store';

export interface HybridResult {
  cards: Card[];
  total: number | null;
  next?: string;
  localOnly: boolean;
  warnings: string[];
  remote: string;
  local: string;
}

/** Everything you own, have in a deck or have tagged globally, one per name. */
function yourCards(): Card[] {
  const seen = new Map<string, Card>();
  collectionT.all().forEach((i) => seen.has(i.card.name) || seen.set(i.card.name, i.card));
  decksT.all().forEach((d) => d.entries.forEach((e) => seen.has(e.card.name) || seen.set(e.card.name, e.card)));
  globalTagsT.all().forEach((g) => g.card && !seen.has(g.id) && seen.set(g.id, g.card));
  return [...seen.values()];
}

/** Key that decides whether two results are the same row: one per name, or one per printing. */
const rowKey = (unique?: Unique) => (c: Card) => (unique === 'prints' ? c.id : c.name);

/** Append a page of results, skipping rows already shown (your own cards are listed first). */
export function appendResults(shown: Card[], more: Card[], unique?: Unique): Card[] {
  const key = rowKey(unique);
  const have = new Set(shown.map(key));
  return [...shown, ...more.filter((c) => !have.has(key(c)))];
}

/**
 * Run a query that may mix Scryfall syntax with collection-only filters.
 * Scryfall terms go to the API; local terms (tags, favourites, ownership…) filter the results.
 * A tag term naming one of the fixed Scryfall tags (`#ramp`, `stag:"mana rock"`) is asked of
 * Scryfall as `otag:`, so every card with that tag comes back, with your own cards that match
 * (for example through a global tag of the same name) listed first.
 * A query with only local terms searches the cards you own, use in decks or have tagged.
 */
export async function hybridSearch(
  q: string,
  subjectFor: (c: Card) => Subject,
  opts: { order?: SortOrder; dir?: SortDir; unique?: Unique; extra?: string } = {},
): Promise<HybridResult> {
  const lifted = liftScryfallTags(q, scryfallOtagFor);
  if (lifted.otags.length) return tagSearch(q, lifted, subjectFor, opts);

  const split = splitForScryfall(q);
  if (split.error) throw new Error(split.error);
  const remote = [split.remote, opts.extra ?? ''].filter(Boolean).join(' ');
  const local = parseQuery(split.local);
  const keep = (cs: Card[]) => (split.local ? cs.filter((c) => local.test(subjectFor(c))) : cs);

  if (!split.remote && split.local) {
    const extra = opts.extra ? parseQuery(opts.extra) : null;
    const cards = keep(yourCards()).filter((c) => !extra || extra.test(subjectFor(c))).sort((a, b) => a.name.localeCompare(b.name));
    return { cards, total: cards.length, localOnly: true, warnings: local.warnings, remote: '', local: split.local };
  }

  const res: ScryfallList<Card> = await searchCards(remote, { order: opts.order, dir: opts.dir, unique: opts.unique });
  return {
    cards: keep(res.data),
    total: split.local ? null : res.total_cards ?? res.data.length,
    next: res.has_more ? res.next_page : undefined,
    localOnly: false,
    warnings: local.warnings,
    remote,
    local: split.local,
  };
}

async function tagSearch(
  q: string,
  lifted: { otags: string[]; rest: string },
  subjectFor: (c: Card) => Subject,
  opts: { order?: SortOrder; dir?: SortDir; unique?: Unique; extra?: string },
): Promise<HybridResult> {
  const split = splitForScryfall(lifted.rest);
  if (split.error) throw new Error(split.error);
  const remote = [split.remote, ...lifted.otags.map((o) => `otag:${o}`), opts.extra ?? ''].filter(Boolean).join(' ');
  const whole = parseQuery(q);
  const local = parseQuery(split.local);
  const extra = opts.extra ? parseQuery(opts.extra) : null;
  const mine = yourCards()
    .filter((c) => whole.test(subjectFor(c)) && (!extra || extra.test(subjectFor(c))))
    .sort((a, b) => a.name.localeCompare(b.name));

  let res: ScryfallList<Card>;
  try {
    res = await searchCards(remote, { order: opts.order, dir: opts.dir, unique: opts.unique });
  } catch (e) {
    if (!mine.length) throw e;
    // Offline or Scryfall unavailable: your own matching cards still answer the search.
    return {
      cards: mine, total: mine.length, localOnly: true, remote: '', local: q,
      warnings: [...whole.warnings, 'Scryfall couldn’t be reached, so only your own cards are shown.'],
    };
  }
  const found = split.local ? res.data.filter((c) => local.test(subjectFor(c))) : res.data;
  // Your cards that matched through a tag of yours (not Scryfall's) aren't in Scryfall's count.
  const labels = lifted.otags.map((o) => SCRYFALL_TAGS.find((t) => t.otag === o)!.label);
  const foundNames = new Set(found.map((c) => c.name));
  const extraMine = mine.filter((c) => !foundNames.has(c.name) && !labels.every((l) => scryfallTagsOf(c.name).includes(l))).length;
  return {
    cards: appendResults(mine, found, opts.unique),
    total: split.local ? null : (res.total_cards ?? res.data.length) + extraMine,
    next: res.has_more ? res.next_page : undefined,
    localOnly: false,
    warnings: local.warnings,
    remote,
    local: split.local,
  };
}

export async function hybridMore(next: string, local: string, subjectFor: (c: Card) => Subject) {
  const res = await fetchPage(next);
  const lq = parseQuery(local);
  return { cards: local ? res.data.filter((c) => lq.test(subjectFor(c))) : res.data, next: res.has_more ? res.next_page : undefined };
}
