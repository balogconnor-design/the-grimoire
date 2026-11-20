/** Normalize a tag the way every tag editor does: trimmed, single spaces, lowercase, 40 characters max. */
export const cleanTag = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 40);

/** One Archidekt category from a `[...]` block, e.g. `Maybeboard{noDeck}{noPrice}` → name "Maybeboard", flags noDeck + noPrice. */
export interface ListCategory {
  name: string;
  flags: string[];
}

/**
 * Pull Archidekt's per-line markup off a decklist line:
 *   `1x Sol Ring (c21) 263 *F* [Ramp,Artifact{noPrice}] ^Buy,#0066ff^`
 * `[...]` holds the card's categories (with `{flag}` suffixes), `^...^` its color label.
 * Returns the line without either, plus the parsed categories. Lines without markup come back unchanged.
 */
export function splitListMarkup(line: string): { line: string; categories: ListCategory[] } {
  const categories: ListCategory[] = [];
  const rest = line
    .replace(/\s*\^[^^]*\^/g, '')
    .replace(/\s*\[([^\]]*)\]/g, (_, inner: string) => {
      for (const part of inner.split(',')) {
        const flags = [...part.matchAll(/\{([^}]*)\}/g)].map((m) => m[1].toLowerCase());
        const name = part.replace(/\{[^}]*\}/g, '').trim();
        if (name) categories.push({ name, flags });
      }
      return '';
    })
    .trim();
  return { line: rest, categories };
}

/** Archidekt's default type categories: Grimoire already groups by card type, so these don't become tags. */
const TYPE_CATEGORIES = new Set(['land', 'lands', 'creature', 'creatures', 'artifact', 'artifacts', 'enchantment', 'enchantments',
  'instant', 'instants', 'sorcery', 'sorceries', 'planeswalker', 'planeswalkers', 'battle', 'battles']);

/**
 * What a line's categories mean for a deck import:
 * - `Commander` sets the commander, `Sideboard` the sideboard;
 * - `Maybeboard` / `Considering`, or any other category flagged `{noDeck}`, the maybeboard;
 * - every other category, except plain card types, becomes a card tag.
 */
export function categoryMeaning(categories: ListCategory[]): { commander: boolean; board?: 'side' | 'maybe'; tags: string[] } {
  let commander = false;
  let board: 'side' | 'maybe' | undefined;
  const tags: string[] = [];
  for (const c of categories) {
    const key = c.name.toLowerCase();
    if (key === 'commander' || key === 'commanders') commander = true;
    else if (key === 'sideboard') board = 'side';
    else if (key === 'maybeboard' || key === 'considering') board ??= 'maybe';
    else {
      if (c.flags.includes('nodeck')) board ??= 'maybe';
      if (!TYPE_CATEGORIES.has(key)) {
        const t = cleanTag(c.name);
        if (t && !tags.includes(t)) tags.push(t);
      }
    }
  }
  return { commander, board, tags };
}
