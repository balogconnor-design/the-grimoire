/**
 * Turning OCR output into card detections: which lines are card titles, where each card sits in the
 * photo, and what its set / collector number line says. Pure functions, so they're unit-tested with
 * made-up OCR output (src/lib/scan/ocr.ts does the real reading).
 *
 * Two kinds of anchor find a card:
 * - its title, matched against every card name (fails on busy title bars and stylised fonts);
 * - its set line ("MH3 • EN"), in a plain font on the black border, which OCR often reads when it can't
 *   read the title. The card is then placed from that line, and its title read again up close.
 */
import { normName, similarity, type NameIndex, type NameMatch } from './names';

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord { text: string; conf: number; bbox: Box }
export interface OcrLine { text: string; conf: number; bbox: Box; words: OcrWord[] }

export interface Detection {
  /** Best name and the runners-up (best first). Empty when only the set line was read. */
  matches: NameMatch[];
  /** The OCR text the name was read from, and where. */
  read: string;
  title?: Box;
  /** Estimated outline of the whole card (may reach past the photo's edges). */
  card: Box;
  /** How the card was found. */
  from: 'title' | 'info';
  /** Other text read in the title bar, too poor to match a name but useful to confirm one ("Jd Ring"). */
  hints?: string[];
  set?: string;
  cn?: string;
}

/** A matched name counts from this similarity; the review screen asks to check anything under SURE. */
export const MIN_SCORE = 0.78;
export const SURE_SCORE = 0.9;

// Card proportions (63 × 88 mm). The title's line box is roughly 1/33 of the card's height (Beleren caps
// plus any descenders); its text starts about 7% of the width in from the left edge, 5% down from the top.
const ASPECT = 63 / 88;
const TITLE_TO_HEIGHT = 33;
/** The set line's box is roughly 1/80 of the card's height (small caps, often read a little short or tall). */
const INFO_TO_HEIGHT = 80;

const height = (b: Box) => b.y1 - b.y0;
const center = (b: Box) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const inside = (b: Box, c: Box) => {
  const { x, y } = center(b);
  return x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1;
};

/** Estimated card outline from its title line. `k` scales the height (smaller = tighter). */
export function cardFromTitle(t: Box, k = TITLE_TO_HEIGHT): Box {
  const h = height(t) * k;
  const w = h * ASPECT;
  const x0 = t.x0 - 0.07 * w;
  const y0 = t.y0 - 0.05 * h;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** Estimated card outline from its set line, `h` tall (the set line sits ~6% in from the left, ~3% up from the bottom). */
export function cardFromInfo(line: Box, h: number): Box {
  const w = h * ASPECT;
  const x0 = line.x0 - 0.065 * w;
  const y1 = line.y1 + 0.035 * h;
  return { x0, y0: y1 - h, x1: x0 + w, y1 };
}

/**
 * Where to look for the collector number and set code: the bottom-left of the card (they sit about 93-98%
 * down). Generous above and below, because the card outline is only estimated from the title, whose line
 * box is taller when the name has descenders ("Sol Ring" vs "Counterspell"): off by up to a fifth either way.
 */
export function infoStrip(c: Box): Box {
  const w = c.x1 - c.x0, h = height(c);
  return { x0: c.x0 - 0.04 * w, y0: c.y0 + 0.7 * h, x1: c.x0 + 0.74 * w, y1: c.y0 + 1.25 * h };
}

/** The title bar: the top ~12% of the card, where the name is printed. */
export function titleBand(c: Box): Box {
  const w = c.x1 - c.x0, h = height(c);
  return { x0: c.x0 + 0.02 * w, y0: c.y0 + 0.01 * h, x1: c.x1 - 0.02 * w, y1: c.y0 + 0.13 * h };
}

/**
 * Split a line where words are far apart: two cards side by side can come back as one OCR line
 * ("Sol Ring   Lightning Bolt"). A gap wider than 1.5 × the line's height starts a new piece.
 */
export function splitLine(line: OcrLine): OcrLine[] {
  const words = line.words.filter((w) => w.text.trim());
  if (words.length < 2) return [line];
  const h = height(line.bbox);
  const parts: OcrWord[][] = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].bbox.x0 - words[i - 1].bbox.x1;
    if (gap > 1.5 * h) parts.push([]);
    parts[parts.length - 1].push(words[i]);
  }
  return parts.map((ws) => ({
    text: ws.map((w) => w.text).join(' '),
    conf: ws.reduce((s, w) => s + w.conf, 0) / ws.length,
    words: ws,
    bbox: { x0: Math.min(...ws.map((w) => w.bbox.x0)), y0: Math.min(...ws.map((w) => w.bbox.y0)), x1: Math.max(...ws.map((w) => w.bbox.x1)), y1: Math.max(...ws.map((w) => w.bbox.y1)) },
  }));
}

const looksLikeText = (s: string) => {
  const letters = s.replace(/[^A-Za-z]/g, '').length;
  return letters >= 3 && letters / s.replace(/\s/g, '').length >= 0.6;
};

/**
 * Lines that can't be a title: flavor text (starts with a quote mark or a dash), the copyright line
 * ("™ & © 2024 Wizards of the Coast"), reminder text in brackets.
 */
const notATitle = (s: string) => /^\W*["“”‘’'(—–-]/.test(s.trim()) || /wizards of the|[™©®]|\b(19|20)\d\d\b/i.test(s);

/**
 * Keyword lines from rules text. A few are card names too ("Flash", "Fear"), so those cards can't be
 * found by their title alone; in exchange "Flying" on a creature isn't taken for the card Fling.
 */
const KEYWORDS = [
  'flying', 'first strike', 'double strike', 'deathtouch', 'defender', 'flash', 'haste', 'hexproof', 'indestructible',
  'lifelink', 'menace', 'reach', 'trample', 'vigilance', 'ward', 'prowess', 'fear', 'intimidate', 'shroud', 'changeling',
  'devoid', 'convoke', 'delve', 'equip', 'enchant creature', 'enchant land', 'enchant permanent', 'enchant artifact',
].map(normName);

export function isKeywordLine(text: string): boolean {
  const parts = text.split(/[,;]/).map(normName).filter(Boolean);
  return parts.length > 0 && parts.every((p) => KEYWORDS.some((k) => similarity(p, k) >= 0.8));
}

/** OCR confidence a title line needs: short names are easy to "find" in the noise of card art. */
const minConf = (name: string) => (normName(name).replace(/ /g, '').length <= 5 ? 70 : 30);

interface TitleHit { line: OcrLine; matches: NameMatch[] }

/**
 * Lines that match a card name well enough to be a title, top to bottom. Each line is tried whole and
 * split at wide gaps: the split separates side-by-side titles, but OCR sometimes leaves a wide gap
 * inside one title too.
 */
function titleHits(lines: OcrLine[], index: NameIndex): TitleHit[] {
  return lines.flatMap((l) => { const parts = splitLine(l); return parts.length > 1 ? [l, ...parts] : parts; })
    .filter((l) => looksLikeText(l.text) && l.text.length <= 60 && !notATitle(l.text) && !isKeywordLine(l.text))
    .map((l) => ({ line: l, matches: index.matchTitle(l.text) }))
    .filter((h) => h.matches[0] && h.matches[0].score >= MIN_SCORE && h.line.conf >= minConf(h.matches[0].name))
    // Overlapping hits (a whole line and its piece, the same title from both readings): the best one.
    .sort((a, b) => b.matches[0].score - a.matches[0].score)
    .reduce<TitleHit[]>((kept, h) => (kept.some((k) => inside(h.line.bbox, k.line.bbox) || inside(k.line.bbox, h.line.bbox)) ? kept : [...kept, h]), [])
    .sort((a, b) => a.line.bbox.y0 - b.line.bbox.y0 || a.line.bbox.x0 - b.line.bbox.x0);
}

// ---------- Set line ----------

/** Letters and digits OCR swaps in set codes. Tried when the code as read isn't a real set. */
const SWAPS: Record<string, string> = { '0': 'O', O: '0', '1': 'I', I: '1', '5': 'S', S: '5', '8': 'B', B: '8', '2': 'Z', Z: '2' };

function realSet(code: string, sets: Set<string>): string | undefined {
  const up = code.toUpperCase();
  if (sets.has(up.toLowerCase())) return up.toLowerCase();
  for (let i = 0; i < up.length; i++) {
    const s = SWAPS[up[i]];
    if (!s) continue;
    const alt = (up.slice(0, i) + s + up.slice(i + 1)).toLowerCase();
    if (sets.has(alt)) return alt;
  }
  return undefined;
}

/** "MH3 • EN": a set code, a separator OCR reads as anything (or nothing), then the language. */
const SET_LINE = /\b([A-Za-z0-9]{3,5})[^A-Za-z0-9]{0,4}EN\b/gi;

function findSet(text: string, sets: Set<string>): string | undefined {
  for (const m of [...text.matchAll(SET_LINE)].reverse()) {
    const s = realSet(m[1], sets);
    if (s) return s;
  }
  return undefined;
}

/**
 * Collector number and set code from a card's bottom-left text. Handles both layouts:
 *   2015–2022: "123/274 R"  then  "M19 • EN  Artist Name"
 *   2023 on:   "0123 R" or "R 0123"  then  "MH3 • EN  Artist Name"
 * The set code only counts when it's a real Scryfall set (`sets`, lower case), allowing for common
 * letter/digit mix-ups. Collector numbers lose their leading zeros, as Scryfall writes them.
 */
export function parseInfoLine(raw0: string, sets: Set<string>): { set?: string; cn?: string } {
  // The copyright line ("™ & © 2022 Wizards of the Coast") sits beside the collector line; its year
  // isn't a collector number.
  const text = raw0.replace(/(?:[©c]|\(c\))\s*(?:19|20)\d\d\b|\b(?:19|20)\d\d\s+Wiz\w*/gi, ' ');
  // The lowest match wins: the strip can reach up into rules text. The set total has 2+ digits, so a
  // token's "1/1" in reminder text isn't taken for a collector number.
  const last = (re: RegExp) => [...text.matchAll(re)].pop()?.[1];
  const raw = last(/\b(\d{1,4})\s*\/\s*\d{2,4}\b/g) ?? last(/\b(\d{3,4})\s+[CURMSLTP]\b/gi) ?? last(/\b[CURMSLTP]\s?(\d{3,4})\b/gi);
  return { set: findSet(text.replace(/\n/g, ' '), sets), cn: raw?.replace(/^0+(?=\d)/, '') };
}

interface InfoHit { box: Box; set: string; cn?: string }

/**
 * Set lines anywhere in the photo, each with the collector number printed just above it (or on the
 * same line). The set code and "EN" sometimes come back as two OCR lines, so each line is also tried
 * joined to the next one when that one is beside or just below it.
 */
export function findInfoLines(lines: OcrLine[], sets: Set<string>): InfoHit[] {
  const out: InfoHit[] = [];
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    const h = Math.max(8, height(l.bbox));
    const near = next && Math.abs(center(next.bbox).y - center(l.bbox).y) < 2 * h && next.bbox.x0 - l.bbox.x0 < 12 * h && next.bbox.x0 >= l.bbox.x0 - 2 * h;
    let set = findSet(l.text, sets);
    let box = l.bbox;
    if (!set && near && /^\W*EN\b/i.test(next.text)) {
      set = findSet(`${l.text} ${next.text}`, sets);
      if (set) box = { x0: Math.min(l.bbox.x0, next.bbox.x0), y0: Math.min(l.bbox.y0, next.bbox.y0), x1: Math.max(l.bbox.x1, next.bbox.x1), y1: Math.max(l.bbox.y1, next.bbox.y1) };
    }
    if (!set || out.some((o) => inside(box, o.box) || inside(o.box, box))) return;
    // The number: on the line itself or within ~3 line heights above, starting near the same left edge.
    const hb = Math.max(8, height(box));
    const area: Box = { x0: box.x0 - 3 * hb, y0: box.y0 - 3.5 * hb, x1: box.x0 + 10 * hb, y1: box.y1 + 0.5 * hb };
    const text = lines.filter((x) => inside(x.bbox, area)).map((x) => x.text).join('\n');
    out.push({ box, set, cn: parseInfoLine(text, sets).cn });
  });
  return out;
}

// ---------- Putting it together ----------

/**
 * All the cards in a photo's OCR lines.
 * 1. Title lines, top to bottom. A title starts a card; later matches inside that card (rules text that
 *    happens to be a name) are skipped. The outline used for that is kept a little short of a full
 *    card, so a second card stacked closely below isn't swallowed.
 * 2. Set lines. One that falls in a title's info strip gives that card its set and number. Any other
 *    starts a card of its own, sized like the titled cards in the photo (or from the line's height);
 *    a title match lower down inside it is its rules text naming the card ("Lightning Bolt deals 3…"),
 *    kept as the name to check against.
 */
export function findCards(lines: OcrLine[], index: NameIndex, sets: Set<string>): Detection[] {
  const titled: Detection[] = [];
  const claimed: Box[] = [];
  for (const h of titleHits(lines, index)) {
    if (claimed.some((c) => inside(h.line.bbox, c))) continue;
    const near = cardFromTitle(h.line.bbox, 28);
    claimed.push({ ...near, y1: near.y0 + height(near) * 0.92 });
    titled.push({ matches: h.matches, read: h.line.text, title: h.line.bbox, card: cardFromTitle(h.line.bbox), from: 'title' });
  }
  const heights = titled.map((d) => height(d.card)).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)];

  const extra: Detection[] = [];
  for (const info of findInfoLines(lines, sets)) {
    const owner = titled.find((d) => !d.set && inside(info.box, infoStrip(d.card)));
    if (owner) { owner.set = info.set; owner.cn = info.cn; continue; }
    const card = cardFromInfo(info.box, typical ?? height(info.box) * INFO_TO_HEIGHT);
    const det: Detection = { matches: [], read: '', card, from: 'info', set: info.set, cn: info.cn };
    // A titled card inside this one: its "title" in the top part is the real title; lower down it's rules text.
    const top = { ...card, y1: card.y0 + height(card) * 0.15 };
    const i = titled.findIndex((d) => !d.set && d.title && inside(d.title, card));
    if (i >= 0) {
      const d = titled[i];
      if (inside(d.title!, top)) { d.set = info.set; d.cn = info.cn; d.card = card; continue; }
      det.matches = d.matches;
      det.read = d.read;
      titled.splice(i, 1);
    }
    extra.push(det);
  }
  return [...titled, ...extra];
}

/**
 * Does some poorly read title text back up a card name? Either it's fairly close overall, or it shares
 * a whole word of 4+ letters with the name ("Jd Ring" / "Sol Ring", "e Duo" doesn't count).
 */
export function hintSupports(hint: string, name: string): boolean {
  const h = normName(hint);
  return name.split(' // ').map(normName).some((n) => {
    if (h.length >= 4 && similarity(h, n) >= 0.6) return true;
    const words = new Set(n.split(' ').filter((w) => w.length >= 4));
    return h.split(' ').some((w) => words.has(w));
  });
}

/** OCR lines that fall in a card's collector-info strip, as one string. */
export function stripText(lines: OcrLine[], card: Box): string {
  const strip = infoStrip(card);
  return lines.flatMap(splitLine).filter((l) => inside(l.bbox, strip)).map((l) => l.text).join('\n');
}
