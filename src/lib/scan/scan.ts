/**
 * The photo scanner's pipeline: photo -> OCR -> card titles -> set / collector number -> Scryfall cards.
 * Every result is a best guess the user confirms on the review screen (components/ScanAdd.tsx).
 */
import type { Card, CollectionItem, Finish } from '../../types';
import { getCardNames, getCollection, getSets } from '../scryfall';
import { lookupLines } from '../cardLookup';
import { defaultFinish } from '../collection';
import { collectionT } from '../store';
import { uid } from '../rules';
import { findCards, hintSupports, infoStrip, MIN_SCORE, parseInfoLine, stripText, SURE_SCORE, titleBand, type Box, type Detection } from './detect';
import { NameIndex, sameCardName, type NameMatch } from './names';
import { crop, loadPhoto, readLines, scaled, toUrl, type OcrProgress, type Rotation } from './ocr';

/**
 * How sure the printing is:
 * exact = set and collector number read from the card; user = picked by the user;
 * set = set read (or applied by the user), number not; owned = a printing already in the collection;
 * guess = Scryfall's default printing.
 */
export type PrintingCertainty = 'exact' | 'user' | 'set' | 'owned' | 'guess';

export interface ScanTile {
  id: string;
  photoId: string;
  /** Object URL of the card cropped from the photo. */
  crop?: string;
  /** Text the name was read from, and the names it could be (best first). */
  read: string;
  matches: NameMatch[];
  nameSure: boolean;
  card: Card;
  finish: Finish;
  qty: number;
  printing: PrintingCertainty;
}

let indexPromise: Promise<NameIndex> | null = null;

/** The card-name index, built once per session from Scryfall's name catalog. */
export function getNameIndex(): Promise<NameIndex> {
  indexPromise ??= getCardNames().then((names) => new NameIndex(names));
  indexPromise.catch(() => { indexPromise = null; });
  return indexPromise;
}

const inBox = (b: Box, c: Box) => {
  const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2;
  return x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1;
};
const scaleBox =(b: Box, s: number): Box => ({ x0: b.x0 * s, y0: b.y0 * s, x1: b.x1 * s, y1: b.y1 * s });

/**
 * Whole-photo readings: the longer side at up to 2000 px as taken, then at up to 3200 px (enlarging a
 * small photo up to 2×). What OCR gets right changes a lot with scale (one reading gets the title, the
 * other the set line), so both readings' lines are pooled. The second is skipped when it would be
 * nearly the same size as the first.
 */
const PASS_A = 2000;
const PASS_B = 3200;
/** Close-up second readings (title bar, info strip) per photo, at most. */
const MAX_CLOSEUPS = 24;

export interface PhotoScan { detections: (Detection & { crop?: string })[] }

/** Find the cards in one photo. Coordinates in the result are in the upright photo's pixels. */
export async function scanPhoto(file: Blob, rotation: Rotation, onProgress?: OcrProgress): Promise<PhotoScan> {
  const [src, index, sets] = await Promise.all([
    loadPhoto(file, rotation),
    getNameIndex(),
    getSets().then((s) => new Set(s.map((x) => x.code.toLowerCase()))),
  ]);

  const read = async (canvas: HTMLCanvasElement, scale: number) => {
    const back = 1 / scale;
    return (await readLines(canvas, 'auto', onProgress))
      .map((l) => ({ ...l, bbox: scaleBox(l.bbox, back), words: l.words.map((w) => ({ ...w, bbox: scaleBox(w.bbox, back) })) }));
  };
  const a = scaled(src, PASS_A);
  const b = scaled(src, PASS_B, 2);
  const lines = await read(a.canvas, a.scale);
  if (b.scale / a.scale >= 1.25) lines.push(...(await read(b.canvas, b.scale)));
  const found = findCards(lines, index, sets);

  let closeups = 0;
  /** Read part of the photo again, enlarged and in greyscale with stretched contrast. */
  const closeup = async (box: Box, psm: 'line' | 'block') => {
    if (closeups >= MAX_CLOSEUPS) return '';
    const c = crop(src, box, 1400, true);
    if (!c) return '';
    closeups++;
    return (await readLines(c, psm, onProgress)).map((l) => l.text).join('\n');
  };

  const out: PhotoScan['detections'] = [];
  for (const d of found) {
    // The name: unsure, or only the set line was found. Busy title bars read better up close.
    if (!d.matches[0] || d.matches[0].score < SURE_SCORE) {
      const text = (await closeup(titleBand(d.card), 'line')).replace(/\n/g, ' ');
      const again = text ? index.matchTitle(text) : [];
      if (again[0] && again[0].score >= MIN_SCORE && (!d.matches[0] || again[0].score > d.matches[0].score)) {
        d.matches = again;
        d.read = text;
      }
      // Whatever was read in the title bar, to back up a name found by set and number.
      const band = titleBand(d.card);
      d.hints = [text, ...lines.filter((l) => inBox(l.bbox, band)).map((l) => l.text)].filter(Boolean);
    }
    // The set and number: usually too small to read in the first pass.
    if (!d.set || !d.cn) {
      const near = parseInfoLine(stripText(lines, d.card), sets);
      const close = near.set && near.cn ? near : parseInfoLine(await closeup(infoStrip(d.card), 'block'), sets);
      d.set ??= near.set ?? close.set;
      d.cn ??= near.cn ?? close.cn;
    }
    const pic = crop(src, d.card, 300);
    out.push({ ...d, crop: pic ? await toUrl(pic) : undefined });
  }
  return { detections: out };
}

/** The printing of a card the collection has the most copies of, if any. */
export function ownedPrinting(card: Card, items: CollectionItem[] = collectionT.all()): Card | undefined {
  const qty = new Map<string, { card: Card; n: number }>();
  for (const i of items) {
    if (card.oracle_id ? i.card.oracle_id !== card.oracle_id : i.card.name !== card.name) continue;
    const e = qty.get(i.card.id) ?? { card: i.card, n: 0 };
    e.n += i.qty;
    qty.set(i.card.id, e);
  }
  return [...qty.values()].sort((a, b) => b.n - a.n)[0]?.card;
}

export interface Resolved { tiles: ScanTile[]; missing: string[] }

/**
 * Look the detections up on Scryfall.
 * 1. Set and collector number, when both were read: the exact printing. Kept when the name read agrees
 *    with it (two separate readings agreeing: the name counts as sure), or when no confident name
 *    disagrees (the name is then left for the user to check). A confident name that disagrees means
 *    the number was misread, so the card is looked up by name instead.
 * 2. Otherwise by name, in the set read if any. A card found by name alone takes the printing already
 *    owned, if any.
 */
export async function resolveDetections(photoId: string, dets: PhotoScan['detections']): Promise<Resolved> {
  if (!dets.length) return { tiles: [], missing: [] };
  const withNumber = dets.map((d, i) => ({ d, i })).filter(({ d }) => d.set && d.cn);
  const { found } = withNumber.length ? await getCollection(withNumber.map(({ d }) => ({ set: d.set!, collector_number: d.cn! }))) : { found: [] };
  const exact = new Map<number, Card>();
  for (const { d, i } of withNumber) {
    const c = found.find((x) => x.set === d.set && x.collector_number === d.cn);
    if (c) exact.set(i, c);
  }

  const results = new Map<number, { card: Card; printing: PrintingCertainty; nameSure: boolean }>();
  const byName: { i: number; name: string; set?: string }[] = [];
  dets.forEach((d, i) => {
    const best = d.matches[0];
    const c = exact.get(i);
    const agrees = !!c && (d.matches.some((m) => sameCardName(c.name, m.name)) || !!d.hints?.some((h) => hintSupports(h, c.name)));
    if (c && (agrees || !best || best.score < SURE_SCORE)) results.set(i, { card: c, printing: 'exact', nameSure: agrees });
    else if (best) byName.push({ i, name: best.name, set: d.set });
  });

  if (byName.length) {
    const { matched } = await lookupLines(byName);
    for (const { line, card: found } of matched) {
      if (!sameCardName(found.name, line.name)) continue;
      const d = dets[line.i];
      let card = found;
      let printing: PrintingCertainty = d.set && card.set === d.set ? 'set' : 'guess';
      if (printing === 'guess') {
        const owned = ownedPrinting(card);
        if (owned) { card = owned; printing = 'owned'; }
      }
      results.set(line.i, { card, printing, nameSure: d.matches[0].score >= SURE_SCORE });
    }
  }

  const tiles: ScanTile[] = [];
  const missing: string[] = [];
  dets.forEach((d, i) => {
    const r = results.get(i);
    if (!r) {
      missing.push(d.matches[0]?.name ?? `a card from ${d.set?.toUpperCase()}${d.cn ? ` #${d.cn}` : ''} (name unreadable)`);
      return;
    }
    tiles.push({ id: uid(), photoId, crop: d.crop, read: d.read, matches: d.matches, ...r, finish: defaultFinish(r.card), qty: 1 });
  });
  return { tiles, missing };
}

/** A card by name for a tile whose name was wrong: owned printing first, else Scryfall's default. */
export async function cardByName(name: string): Promise<{ card: Card; printing: PrintingCertainty } | null> {
  const { matched } = await lookupLines([{ name }]);
  const card = matched[0]?.card;
  if (!card) return null;
  const owned = ownedPrinting(card);
  return owned ? { card: owned, printing: 'owned' } : { card, printing: 'guess' };
}

/** The same cards in another set (carry a set choice over to the other unconfirmed tiles). */
export async function inSet(names: string[], set: string): Promise<Map<string, Card>> {
  const { matched } = await lookupLines(names.map((name) => ({ name, set })));
  const out = new Map<string, Card>();
  for (const { line, card } of matched) if (card.set === set && sameCardName(card.name, line.name)) out.set(line.name, card);
  return out;
}

/** Tiles that need a look first: unsure names, then guessed printings, then owned / set-only. */
const RANK: Record<PrintingCertainty, number> = { guess: 1, owned: 2, set: 3, exact: 9, user: 9 };
export const needsCheck = (t: ScanTile) => !t.nameSure || RANK[t.printing] < 9;
export const checkRank = (t: ScanTile) => (t.nameSure ? RANK[t.printing] : 0);
