import { describe, expect, it } from 'vitest';
import { NameIndex, normName, sameCardName, similarity } from '../src/lib/scan/names';
import { cardFromTitle, findCards, hintSupports, isKeywordLine, parseInfoLine, splitLine, stripText, type Box, type OcrLine } from '../src/lib/scan/detect';
import { ownedPrinting } from '../src/lib/scan/scan';
import type { Card, CollectionItem } from '../src/types';

const NAMES = [
  'Sol Ring', 'Lightning Bolt', 'Llanowar Elves', 'Opt', 'Flash', 'Fear', 'Counterspell', 'Arcane Signet',
  'Delver of Secrets // Insectile Aberration', 'Urza\'s Saga', 'Jace, the Mind Sculptor', 'A-Sol Ring Rebalanced',
  'Lightning Helix', 'Swords to Plowshares', 'Bonecrusher Giant // Stomp', 'Sol Talisman',
];
const index = new NameIndex(NAMES);
const SETS = new Set(['c21', 'mh3', 'm19', 'blb', 'woe', '2x2', 'ons']);

/** An OCR line with evenly spaced words, `h` px tall, starting at (x, y). */
function line(text: string, x: number, y: number, h = 30, gaps: number[] = []): OcrLine {
  let at = x;
  const words = text.split(' ').map((w, i) => {
    const width = w.length * h * 0.55;
    const bbox: Box = { x0: at, y0: y, x1: at + width, y1: y + h };
    at += width + h * 0.35 + (gaps[i] ?? 0);
    return { text: w, conf: 90, bbox };
  });
  return {
    text, conf: 90, words,
    bbox: { x0: x, y0: y, x1: words[words.length - 1].bbox.x1, y1: y + h },
  };
}

describe('name matching', () => {
  it('normalises case, punctuation, accents and OCR look-alikes', () => {
    expect(normName("Urza's Saga")).toBe(normName('URZAS SAGA'));
    expect(normName('S0l R1ng')).toBe(normName('Sol Ring'));
    expect(normName('Lim-Dûl')).toBe(normName('lim dul'));
  });

  it('finds the right card through a few misread letters', () => {
    expect(index.match('Lightnlng Bo1t')[0]).toMatchObject({ name: 'Lightning Bolt' });
    expect(index.match('Lightnlng Bo1t')[0].score).toBeGreaterThan(0.9);
    expect(index.match('Counterspel')[0].name).toBe('Counterspell');
    expect(index.match('Jace the Mind Scu1ptor')[0].name).toBe('Jace, the Mind Sculptor');
  });

  it('matches a two-faced card by its front face, and skips Alchemy names', () => {
    expect(index.match('Delver of Secrets')[0]).toEqual({ name: 'Delver of Secrets // Insectile Aberration', score: 1 });
    expect(index.match('Sol Ring Rebalanced')[0]?.name).not.toBe('A-Sol Ring Rebalanced');
  });

  it('drops mana-symbol junk after a title', () => {
    expect(index.matchTitle('Sol Ring @ 1')[0]).toEqual({ name: 'Sol Ring', score: 1 });
    expect(index.matchTitle('Opt o')[0]).toEqual({ name: 'Opt', score: 1 });
  });

  it('matches a title cut off where the mana cost starts, and junk before a title', () => {
    expect(index.matchTitle("Jace, the Mind Scu")[0]).toMatchObject({ name: 'Jace, the Mind Sculptor' });
    expect(index.matchTitle("Jace, the Mind Scu")[0].score).toBeGreaterThan(0.9);
    expect(index.matchTitle('19 Lightning Bolt')[0]).toEqual({ name: 'Lightning Bolt', score: 1 });
  });

  it('on a tie, a whole-name match beats a face of a two-faced card', () => {
    const idx = new NameIndex(['Emeritus of Conflict // Lightning Bolt', 'Lightning Bolt']);
    expect(idx.match('Lightning Bolt').map((m) => m.name)).toEqual(['Lightning Bolt', 'Emeritus of Conflict // Lightning Bolt']);
  });

  it('gives runners-up for an unclear read', () => {
    const m = index.match('Lightning He', 3);
    expect(m.map((x) => x.name)).toContain('Lightning Helix');
    expect(m.map((x) => x.name)).toContain('Lightning Bolt');
  });

  it('similarity and same-name checks', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abcd', 'abed')).toBe(0.75);
    expect(sameCardName('Delver of Secrets // Insectile Aberration', 'delver of secrets')).toBe(true);
    expect(sameCardName('Sol Ring', 'Sol Talisman')).toBe(false);
  });
});

describe('card detection', () => {
  it('splits a line where two side-by-side titles were read as one', () => {
    const l = line('Sol Ring Lightning Bolt', 0, 0, 30, [0, 200]);
    expect(splitLine(l).map((p) => p.text)).toEqual(['Sol Ring', 'Lightning Bolt']);
  });

  it('finds each title once, and ignores a name inside a card\'s rules text', () => {
    const lines = [
      line('Sol Ring @', 100, 100),
      line('Artifact', 100, 560),
      line('Flash', 100, 640), // keyword in the text box, also a card name
      line('Lightning Bolt', 900, 110),
      line('Arcane Signet', 100, 1200), // a second row of cards
    ];
    const found = findCards(lines, index, SETS);
    expect(found.map((d) => d.matches[0].name)).toEqual(['Sol Ring', 'Lightning Bolt', 'Arcane Signet']);
  });

  it('never takes keywords, flavor text or the copyright line for a title', () => {
    expect(isKeywordLine('Flying')).toBe(true);
    expect(isKeywordLine('Flying, vigilance')).toBe(true);
    expect(isKeywordLine('Flash')).toBe(true);
    expect(isKeywordLine('Lightning Bolt')).toBe(false);
    const lines = [line('Flying', 100, 100), line('“Opt for the', 100, 300), line('™ & © 2024 Wizards of the Coast', 100, 500)];
    expect(findCards(lines, index, SETS)).toEqual([]);
  });

  it('a set line gives its titled card the set and number', () => {
    const title = line('Sol Ring', 100, 100);
    const card = cardFromTitle(title.bbox);
    const y = card.y0 + (card.y1 - card.y0) * 0.94;
    const [d] = findCards([title, line('263/281 R', 120, y, 12), line('C21 • EN Mike Bierek', 120, y + 16, 12)], index, SETS);
    expect(d).toMatchObject({ from: 'title', set: 'c21', cn: '263' });
  });

  it('a set line with no readable title is a card of its own, sized like the others in the photo', () => {
    const lines = [
      line('Sol Ring', 100, 100),
      // An unreadable card to the right: only its collector lines came out (set code and EN split in two).
      line('c 0050', 1000, 1060, 12), line('woe', 1000, 1076, 12), line('EN LEANNA CROSSAN', 1050, 1076, 12),
    ];
    const found = findCards(lines, index, SETS);
    expect(found).toHaveLength(2);
    expect(found[1]).toMatchObject({ from: 'info', set: 'woe', cn: '50', matches: [] });
    expect(found[1].card.y1 - found[1].card.y0).toBeCloseTo(found[0].card.y1 - found[0].card.y0);
  });

  it('a card name in the rules text of a card found by its set line is kept as its name, not a new card', () => {
    // "Lightning Bolt deals 3 damage…" in the text box, the title bar unreadable, the set line read.
    const lines = [line('Lightning Bolt', 100, 640, 30), line('2X2 • EN', 100, 1010, 14)];
    const found = findCards(lines, index, SETS);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ from: 'info', set: '2x2', read: 'Lightning Bolt' });
    expect(found[0].matches[0].name).toBe('Lightning Bolt');
  });

  it('poorly read title text can still back up a name', () => {
    expect(hintSupports('Jd Ring', 'Sol Ring')).toBe(true);
    expect(hintSupports('Glidedlve Du', 'Glidedive Duo')).toBe(true);
    expect(hintSupports('e Duo', 'Glidedive Duo')).toBe(false);
    expect(hintSupports('Ring', 'Lightning Bolt')).toBe(false);
  });

  it('estimates the card outline from the title line', () => {
    const c = cardFromTitle({ x0: 100, y0: 100, x1: 300, y1: 130 });
    expect(c.y1 - c.y0).toBeCloseTo(30 * 33);
    expect((c.x1 - c.x0) / (c.y1 - c.y0)).toBeCloseTo(63 / 88);
    expect(c.x0).toBeLessThan(100);
    expect(c.y0).toBeLessThan(100);
  });

  it('reads the collector strip from lines near the bottom of the card only', () => {
    const title = line('Sol Ring', 100, 100);
    const card = cardFromTitle(title.bbox);
    const bottom = card.y0 + (card.y1 - card.y0) * 0.93;
    const lines = [title, line('263/281 R', 100, bottom, 12), line('C21 • EN', 100, bottom + 16, 12), line('Tap: Add CC.', 100, 700, 20)];
    expect(stripText(lines, card)).toBe('263/281 R\nC21 • EN');
  });
});

describe('collector line parsing', () => {
  const sets = new Set(['c21', 'mh3', 'm19', 'blb', 'woe', '2x2', 'ons']);
  it('2015–2022 layout: number/total and set • language', () => {
    expect(parseInfoLine('263/281 R\nC21 • EN  Mike Bierek', sets)).toEqual({ set: 'c21', cn: '263' });
    expect(parseInfoLine('045/280 U\nM19 * EN', sets)).toEqual({ set: 'm19', cn: '45' });
  });
  it('2023 layout: zero-padded number with rarity either side', () => {
    expect(parseInfoLine('0123 R\nMH3 • EN', sets)).toEqual({ set: 'mh3', cn: '123' });
    expect(parseInfoLine('M 0007\nBLB - EN', sets)).toEqual({ set: 'blb', cn: '7' });
  });
  it('reads lower-case OCR, and skips the copyright year', () => {
    expect(parseInfoLine('c 0050\nwoe +EN', sets)).toEqual({ set: 'woe', cn: '50' });
    expect(parseInfoLine('263\nc21\nEN Mike BIEREK', sets).set).toBe('c21');
    expect(parseInfoLine('™ & © 2022 Wizards of the Coast\n2X2 • EN', sets)).toEqual({ set: '2x2', cn: undefined });
  });
  it('takes the lowest number, and not a token\'s 1/1 from the rules text', () => {
    expect(parseInfoLine('create a 1/1 white Soldier\n0042/0287 C\nWOE • EN', sets)).toEqual({ set: 'woe', cn: '42' });
    expect(parseInfoLine('create a 1/1 white Soldier', sets).cn).toBeUndefined();
  });
  it('fixes letter/digit mix-ups in the set code, and ignores codes that are not sets', () => {
    expect(parseInfoLine('W0E • EN', sets).set).toBe('woe');
    expect(parseInfoLine('2X2 EN', sets).set).toBe('2x2');
    expect(parseInfoLine('ZZZ • EN', sets).set).toBeUndefined();
    expect(parseInfoLine('Tap: add one mana', sets)).toEqual({ set: undefined, cn: undefined });
  });
});

describe('owned printing preference', () => {
  const card = (id: string, set: string): Card => ({ id, oracle_id: 'o-sol', name: 'Sol Ring', set } as Card);
  const item = (c: Card, qty: number) => ({ card: c, qty } as CollectionItem);
  it('prefers the printing with the most copies owned', () => {
    const a = card('a', 'c21'), b = card('b', 'ltc');
    expect(ownedPrinting(card('x', 'cmm'), [item(a, 1), item(b, 2), item(a, 2)])?.id).toBe('a');
    expect(ownedPrinting(card('x', 'cmm'), [])).toBeUndefined();
  });
});
