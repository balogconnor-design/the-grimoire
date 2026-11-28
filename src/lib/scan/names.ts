/**
 * Fuzzy matching of OCR text against every card name (Scryfall's name catalog), for the photo scanner.
 *
 * OCR gets most letters right but drops, swaps or adds a few, and reads mana symbols after the name as
 * junk ("Sol Ring @"). A trigram index finds the names that share the most letter triples with the text,
 * then edit distance ranks those few properly. Both sides are normalised the same way, including the
 * letters OCR confuses (0/o, 1/l/i, 5/s, 8/b), so a misread "S0l Ring" still scores 1.
 */

export interface NameMatch {
  /** The card's full name as Scryfall has it (two-faced cards: "Front // Back"). */
  name: string;
  /** 0..1 similarity between the text and the matched name (or face name). */
  score: number;
}

/** Lower-case, accents and punctuation dropped, OCR look-alikes folded together. */
export function normName(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/0/g, 'o').replace(/[1i|]/g, 'l').replace(/5/g, 's').replace(/8/g, 'b')
    .trim();
}

/** Levenshtein distance (single-row). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export const similarity = (a: string, b: string) => {
  const len = Math.max(a.length, b.length);
  return len ? 1 - editDistance(a, b) / len : 0;
};

const trigrams = (s: string): string[] => {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return [...out];
};

export class NameIndex {
  /** Normalised strings that can be matched: full names and each face of a two-faced card. */
  private keys: string[] = [];
  /** Full card name for each key. */
  private owner: string[] = [];
  private grams = new Map<string, number[]>();
  private gramCount: number[] = [];

  constructor(names: string[]) {
    for (const name of names) {
      if (/^A-/.test(name)) continue; // Alchemy rebalanced cards never exist on paper
      const faces = name.includes(' // ') ? [name, ...name.split(' // ')] : [name];
      for (const f of new Set(faces.map(normName))) {
        if (!f) continue;
        const id = this.keys.length;
        this.keys.push(f);
        this.owner.push(name);
        const g = trigrams(f);
        this.gramCount.push(g.length);
        for (const t of g) {
          const list = this.grams.get(t);
          if (list) list.push(id); else this.grams.set(t, [id]);
        }
      }
    }
  }

  get size() { return this.owner.length; }

  /**
   * Best matching card names for a piece of text, best first (at most `limit`, each name once).
   * A long enough text that matches the start of a name also counts, a little lower: titles get cut
   * off where the mana cost begins ("Phlage, Titan of Fire's F").
   */
  match(text: string, limit = 3): NameMatch[] {
    const q = normName(text);
    if (q.replace(/ /g, '').length < 3) return [];
    const qg = trigrams(q);
    const shared = new Map<number, number>();
    for (const t of qg) for (const id of this.grams.get(t) ?? []) shared.set(id, (shared.get(id) ?? 0) + 1);
    // Dice coefficient on trigrams picks a short list; edit distance ranks it. (A prefix shares fewer
    // trigrams with the whole name, hence the low bar.)
    const short = [...shared]
      .map(([id, n]) => ({ id, dice: (2 * n) / (qg.length + this.gramCount[id]) }))
      .filter((x) => x.dice >= 0.25)
      .sort((a, b) => b.dice - a.dice)
      .slice(0, 30);
    const best = new Map<string, { score: number; face: boolean }>();
    for (const { id } of short) {
      const key = this.keys[id];
      let score = similarity(q, key);
      if (q.length >= 8 && q.length < key.length && q.length >= 0.6 * key.length) {
        score = Math.max(score, similarity(q, key.slice(0, q.length)) * (0.8 + 0.2 * (q.length / key.length)));
      }
      const name = this.owner[id];
      const face = normName(name) !== key;
      const prev = best.get(name);
      if (!prev || score > prev.score) best.set(name, { score, face });
    }
    // On a tie, a card whose whole name matched beats one where only a face did
    // ("Lightning Bolt" over "Emeritus of Conflict // Lightning Bolt").
    return [...best]
      .sort((a, b) => b[1].score - a[1].score || Number(a[1].face) - Number(b[1].face))
      .slice(0, limit)
      .map(([name, { score }]) => ({ name, score }));
  }

  /**
   * Like match, but also tries the text without junk at either end: mana symbols after a name read as
   * short scraps ("Sol Ring @ 1", "Opt o"), and a frame edge or set symbol before it as one or two
   * characters ("| Lightning Bolt").
   */
  matchTitle(text: string, limit = 3): NameMatch[] {
    const words = text.trim().split(/\s+/);
    const junk = (w: string) => w.replace(/[^A-Za-z]/g, '').length <= 2;
    let start = 0;
    while (start < words.length - 1 && junk(words[start])) start++;
    const tries = new Set([text, words.slice(start).join(' ')]);
    for (let n = words.length - 1; n > start; n--) {
      if (!words.slice(n).every(junk)) break;
      tries.add(words.slice(0, n).join(' '));
      tries.add(words.slice(start, n).join(' '));
    }
    const merged = new Map<string, number>();
    for (const t of tries) for (const m of this.match(t, limit)) if (m.score > (merged.get(m.name) ?? -1)) merged.set(m.name, m.score);
    return [...merged].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

/** Do two card names refer to the same card (front-face name of a two-faced card counts)? */
export function sameCardName(cardName: string, name: string): boolean {
  const n = normName(name);
  return [cardName, ...cardName.split(' // ')].some((f) => normName(f) === n);
}
