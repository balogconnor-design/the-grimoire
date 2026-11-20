import type { Card, ScryfallList } from '../types';
import { fetchPage, searchCards, type SortDir, type SortOrder, type Unique } from './scryfall';
import { parseQuery, splitForScryfall, type Subject } from './query';
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

/**
 * Run a query that may mix Scryfall syntax with collection-only filters.
 * Scryfall terms go to the API; local terms (tags, favourites, ownership…) filter the results.
 * A query with only local terms searches the cards you own or use in decks.
 */
export async function hybridSearch(
  q: string,
  subjectFor: (c: Card) => Subject,
  opts: { order?: SortOrder; dir?: SortDir; unique?: Unique; extra?: string } = {},
): Promise<HybridResult> {
  const split = splitForScryfall(q);
  if (split.error) throw new Error(split.error);
  const remote = [split.remote, opts.extra ?? ''].filter(Boolean).join(' ');
  const local = parseQuery(split.local);
  const keep = (cs: Card[]) => (split.local ? cs.filter((c) => local.test(subjectFor(c))) : cs);

  if (!split.remote && split.local) {
    // Local-only: everything you own, have in a deck or have tagged globally, one per name.
    const seen = new Map<string, Card>();
    collectionT.all().forEach((i) => seen.has(i.card.name) || seen.set(i.card.name, i.card));
    decksT.all().forEach((d) => d.entries.forEach((e) => seen.has(e.card.name) || seen.set(e.card.name, e.card)));
    globalTagsT.all().forEach((g) => g.card && !seen.has(g.id) && seen.set(g.id, g.card));
    const extra = opts.extra ? parseQuery(opts.extra) : null;
    const cards = keep([...seen.values()]).filter((c) => !extra || extra.test(subjectFor(c))).sort((a, b) => a.name.localeCompare(b.name));
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

export async function hybridMore(next: string, local: string, subjectFor: (c: Card) => Subject) {
  const res = await fetchPage(next);
  const lq = parseQuery(local);
  return { cards: local ? res.data.filter((c) => lq.test(subjectFor(c))) : res.data, next: res.has_more ? res.next_page : undefined };
}
