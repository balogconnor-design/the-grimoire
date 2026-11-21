import type { Board, Card, Deck, DeckEntry } from '../types';
import { getFormat } from './formats';
import { getCollection, getNamed } from './scryfall';
import { lookupLines } from './cardLookup';
import { BASIC_FOR_COLOR, canBeCommander, copyLimit, uid } from './rules';
import { collectionT, decksT, deleteDeck, getDeck, globalTagsT, saveDeck, updateDeck } from './store';
import { writeSnapshot } from './collection';
import { categoryMeaning, splitListMarkup } from './listMarkup';

export function newDeck(name: string, format: string): Deck {
  const now = Date.now();
  return { id: uid(), name, format, status: 'in-progress', entries: [], createdAt: now, updatedAt: now };
}

/** Add qty copies of card to a board. Returns a user-facing message. */
export function addCard(deckId: string, card: Card, qty = 1, board: Board = 'main'): string {
  const deck = getDeck(deckId);
  if (!deck) return '';
  const fmt = getFormat(deck.format);
  const sameName = deck.entries.filter((e) => e.board === board && e.card.name === card.name);
  const have = sameName.reduce((n, e) => n + e.qty, 0);
  const limit = board === 'main' ? copyLimit(card, fmt) : Infinity;
  if (have >= limit) {
    return `${card.name} is already at the ${fmt.name} limit (${limit}).`;
  }
  updateDeck(deckId, (d) => {
    const existing = d.entries.find((e) => e.board === board && e.card.id === card.id);
    if (existing) existing.qty += qty;
    else d.entries.push({ uid: uid(), qty, board, card });
  });
  const where = board === 'main' ? '' : board === 'side' ? ' to sideboard' : ' to maybeboard';
  return `Added ${qty > 1 ? `${qty}× ` : ''}${card.name}${where}`;
}

export function setQty(deckId: string, entryUid: string, qty: number) {
  updateDeck(deckId, (d) => {
    if (qty <= 0) {
      d.entries = d.entries.filter((e) => e.uid !== entryUid);
      if (d.commanderUid === entryUid) d.commanderUid = undefined;
    } else {
      const e = d.entries.find((x) => x.uid === entryUid);
      if (e) e.qty = qty;
    }
  });
}

export function removeEntry(deckId: string, entryUid: string) {
  setQty(deckId, entryUid, 0);
}

export function moveEntry(deckId: string, entryUid: string, board: Board) {
  updateDeck(deckId, (d) => {
    const e = d.entries.find((x) => x.uid === entryUid);
    if (!e) return;
    const target = d.entries.find((x) => x.board === board && x.card.id === e.card.id && x.uid !== e.uid);
    if (target) {
      target.qty += e.qty;
      if (e.tags?.length) target.tags = [...new Set([...(target.tags ?? []), ...e.tags])];
      target.favorite = target.favorite || e.favorite;
      d.entries = d.entries.filter((x) => x.uid !== e.uid);
    } else {
      e.board = board;
    }
    if (d.commanderUid === entryUid) d.commanderUid = undefined;
  });
}

/** Make a card the commander. Adds it to the main board (1 copy) if needed. */
export function setCommander(deckId: string, card: Card): string {
  const deck = getDeck(deckId);
  if (!deck) return '';
  const fmt = getFormat(deck.format);
  if (!canBeCommander(card, fmt)) return `${card.name} can't be a commander in ${fmt.name}.`;
  updateDeck(deckId, (d) => {
    let entry = d.entries.find((e) => e.board === 'main' && e.card.name === card.name);
    if (!entry) {
      entry = { uid: uid(), qty: 1, board: 'main', card };
      d.entries.push(entry);
    } else {
      entry.qty = 1;
      entry.card = card;
    }
    d.commanderUid = entry.uid;
  });
  return `${card.name} is now your commander`;
}

export function clearCommander(deckId: string) {
  updateDeck(deckId, (d) => {
    d.commanderUid = undefined;
  });
}

export function changePrinting(deckId: string, entryUid: string, card: Card) {
  updateDeck(deckId, (d) => {
    const e = d.entries.find((x) => x.uid === entryUid);
    if (e) e.card = card;
  });
}

// ---------- Favourites & per-deck card tags ----------

export function toggleEntryFavorite(deckId: string, entryUid: string) {
  updateDeck(deckId, (d) => {
    const e = d.entries.find((x) => x.uid === entryUid);
    if (e) e.favorite = !e.favorite;
  });
}

export function setEntryTags(deckId: string, entryUid: string, tags: string[]) {
  updateDeck(deckId, (d) => {
    const e = d.entries.find((x) => x.uid === entryUid);
    if (e) e.tags = tags.length ? tags : undefined;
  });
}

/** Card tags are per deck: apply to every entry of this card (any board/print) in that deck. */
export function setCardTagsInDeck(deckId: string, cardName: string, tags: string[]) {
  updateDeck(deckId, (d) => {
    d.entries.forEach((e) => {
      if (e.card.name === cardName) e.tags = tags.length ? [...tags] : undefined;
    });
  });
}

export function setDeckTags(deckId: string, tags: string[]) {
  updateDeck(deckId, (d) => {
    d.tags = tags.length ? [...tags] : undefined;
  });
}

/** Global tags live on the card (by name): they show in every deck, search and printing. */
export function setGlobalTags(card: Card, tags: string[]) {
  saveCardInfo(card, { tags: [...new Set(tags)] });
}

/** Write a card's global row, dropping it once it has no tags and isn't a favorite. */
function saveCardInfo(card: Card, patch: { tags?: string[]; favorite?: boolean }) {
  const prev = globalTagsT.get(card.name);
  const next = { id: card.name, card: prev?.card ?? card, tags: prev?.tags ?? [], favorite: prev?.favorite, updatedAt: Date.now(), ...patch };
  if (!next.favorite) delete next.favorite;
  if (next.tags.length || next.favorite) void globalTagsT.put(next).catch(() => undefined);
  else if (prev) void globalTagsT.remove(card.name).catch(() => undefined);
}

/**
 * Favorite or unfavorite a card everywhere. Favoriting marks the card itself (owned or not).
 * Unfavoriting also clears the star on its collection lots and deck rows, so it leaves the
 * favorites list entirely.
 */
export function setCardFavorite(card: Card, on: boolean) {
  saveCardInfo(card, { favorite: on });
  if (on) return;
  collectionT.all().filter((i) => i.card.name === card.name && i.favorite)
    .forEach((i) => collectionT.update(i.id, (d) => { d.favorite = false; }));
  decksT.all().filter((d) => d.entries.some((e) => e.card.name === card.name && e.favorite))
    .forEach((d) => updateDeck(d.id, (x) => { x.entries.forEach((e) => { if (e.card.name === card.name) e.favorite = false; }); }));
}

export function toggleDeckFavorite(deckId: string) {
  updateDeck(deckId, (d) => {
    d.favorite = !d.favorite;
  });
}

/**
 * Tag suggestions for a card in one deck. Tags never carry across decks, but the tags
 * this same card has in your other decks (most recently edited first) are offered first,
 * followed by tags already used elsewhere in this deck.
 */
export function cardTagSuggestions(deckId: string, cardName: string, decks: Deck[]): { fromOtherDecks: string[]; inThisDeck: string[] } {
  const other: string[] = [];
  for (const d of [...decks].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (d.id === deckId) continue;
    for (const e of d.entries) if (e.card.name === cardName) for (const t of e.tags ?? []) if (!other.includes(t)) other.push(t);
  }
  const deck = decks.find((d) => d.id === deckId);
  const counts = new Map<string, number>();
  deck?.entries.forEach((e) => e.tags?.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
  const inThis = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).filter((t) => !other.includes(t));
  return { fromOtherDecks: other.slice(0, 6), inThisDeck: inThis.slice(0, 10) };
}

export function allDeckTags(decks: Deck[]): string[] {
  return [...new Set(decks.flatMap((d) => d.tags ?? []))].sort((a, b) => a.localeCompare(b));
}

const basicCache = new Map<string, Card>();
export async function getBasic(color: string): Promise<Card> {
  const name = BASIC_FOR_COLOR[color];
  if (!basicCache.has(name)) basicCache.set(name, await getNamed(name));
  return basicCache.get(name)!;
}

export async function addBasics(deckId: string, counts: Record<string, number>) {
  const cards = await Promise.all(
    Object.entries(counts).filter(([, n]) => n > 0).map(async ([color, n]) => [await getBasic(color), n] as const),
  );
  updateDeck(deckId, (d) => {
    for (const [card, n] of cards) {
      const existing = d.entries.find((e) => e.board === 'main' && e.card.name === card.name);
      if (existing) existing.qty += n;
      else d.entries.push({ uid: uid(), qty: n, board: 'main', card });
    }
  });
}

/** Re-fetch every card in the deck so prices (and legalities) are current. */
export async function refreshPrices(deckId: string) {
  const deck = getDeck(deckId);
  if (!deck || deck.entries.length === 0) return;
  const ids = [...new Set(deck.entries.map((e) => e.card.id))];
  const { found } = await getCollection(ids.map((id) => ({ id })));
  const byId = new Map(found.map((c) => [c.id, c]));
  updateDeck(deckId, (d) => {
    d.entries.forEach((e) => {
      const fresh = byId.get(e.card.id);
      if (fresh) e.card = fresh;
    });
    d.pricesUpdatedAt = Date.now();
  });
  await writeSnapshot(found); // builds the deck's price history for its 7-day change
}

/** Choose the tag an entry is listed under when the deck is grouped by tag (undefined = automatic). */
export function setMainTag(deckId: string, entryUid: string, tag: string | undefined) {
  updateDeck(deckId, (d) => {
    const e = d.entries.find((x) => x.uid === entryUid);
    if (!e) return;
    if (tag) e.mainTag = tag;
    else delete e.mainTag;
  });
}

// ---------- Import / export ----------

export interface ParsedLine {
  qty: number;
  name: string;
  set?: string;
  collector?: string;
  board: Board;
  commander: boolean;
  /** Card tags from the line's categories (Archidekt's `[Ramp,Removal]`). */
  tags?: string[];
}

export function parseDecklist(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let board: Board = 'main';
  let commanderSection = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) {
      // Arena-style blank line after commander section switches back to the deck.
      if (!line && commanderSection) commanderSection = false;
      continue;
    }
    const header = line.replace(/[:\s]+$/, '').toLowerCase();
    if (/^(commanders?|oathbreaker)$/.test(header)) { commanderSection = true; board = 'main'; continue; }
    if (/^(deck|main(board)?|mainboard|companion)$/.test(header)) { commanderSection = false; board = 'main'; continue; }
    if (/^side(board)?$/.test(header)) { commanderSection = false; board = 'side'; continue; }
    if (/^(maybe(board)?|considering)$/.test(header)) { commanderSection = false; board = 'maybe'; continue; }

    let lineBoard = board;
    if (/^SB:\s*/i.test(line)) { lineBoard = 'side'; line = line.replace(/^SB:\s*/i, ''); }

    // Archidekt: `[Category,...]` and `^color label^` after the card.
    const split = splitListMarkup(line);
    line = split.line;
    const cat = categoryMeaning(split.categories);
    if (cat.board) lineBoard = cat.board;

    let commander = commanderSection || cat.commander;
    if (/\*CMDR\*/i.test(line)) { commander = true; line = line.replace(/\*CMDR\*/gi, ''); }
    if (commander) lineBoard = 'main'; // the commander always lives in the main deck
    line = line.replace(/\*F\*|\*E\*|#\S+/g, '').trim(); // foil/etched markers, tags

    const tags = cat.tags.length ? { tags: cat.tags } : {};
    const m = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★-]+))?)?\s*$/);
    if (m) {
      out.push({ qty: parseInt(m[1], 10), name: m[2].trim(), set: m[3]?.toLowerCase(), collector: m[4], board: lineBoard, commander, ...tags });
    } else {
      out.push({ qty: 1, name: line, board: lineBoard, commander, ...tags });
    }
  }
  return out;
}

/**
 * Result of importing a list. Counts always add up:
 *   added + sum(missing[].qty) === cards   (copies)
 *   matchedLines + missing.length === lines (card lines in the file)
 */
export interface ImportResult {
  added: number;
  matchedLines: number;
  missing: { name: string; qty: number }[];
  lines: number;
  cards: number;
}

export async function importDecklist(deckId: string, text: string, mode: 'append' | 'replace'): Promise<ImportResult> {
  const lines = parseDecklist(text);
  const cards = lines.reduce((n, l) => n + l.qty, 0);
  if (!lines.length) return { added: 0, matchedLines: 0, missing: [], lines: 0, cards: 0 };
  // Decks import each card as its default printing: set codes and collector numbers in the list
  // are ignored here (the printing can be changed later in the deck). Printings matter in the
  // collection, whose paste-a-list import still honors them.
  const { matched, missing } = await lookupLines(lines.map((l) => ({ ...l, set: undefined, collector: undefined })));
  const missingOut = missing.map((l) => ({ name: l.name, qty: l.qty }));

  const deck = getDeck(deckId);
  if (!deck) throw new Error('That deck no longer exists.');
  const next: Deck = { ...deck, entries: mode === 'replace' ? [] : deck.entries.map((e) => ({ ...e })) };
  if (mode === 'replace') next.commanderUid = undefined;
  let added = 0;
  for (const { line, card } of matched) {
    let entry: DeckEntry | undefined = next.entries.find((e) => e.board === line.board && e.card.id === card.id);
    if (entry) entry.qty += line.qty;
    else {
      entry = { uid: uid(), qty: line.qty, board: line.board, card };
      next.entries.push(entry);
    }
    if (line.tags?.length) entry.tags = [...new Set([...(entry.tags ?? []), ...line.tags])];
    if (line.commander && getFormat(next.format).hasCommander) next.commanderUid = entry.uid;
    added += line.qty;
  }
  if (matched.length) await saveDeck(next, { note: mode === 'replace' ? 'Imported a list (replaced the cards)' : 'Imported a list' });
  return { added, matchedLines: matched.length, missing: missingOut, lines: lines.length, cards };
}

/** "Imported 97 of 100 cards. Couldn't find 3." */
export function importSummary(r: ImportResult): string {
  const base = `Imported ${r.added} of ${r.cards} card${r.cards === 1 ? '' : 's'}`;
  return r.missing.length ? `${base}. Couldn't find ${r.missing.length} line${r.missing.length === 1 ? '' : 's'}.` : `${base}.`;
}

/** Default name for a deck imported from the main menu: commander, else file name, else "Imported deck". */
export function defaultImportName(text: string, fileName?: string): string {
  const cmd = parseDecklist(text).find((l) => l.commander);
  if (cmd) return cmd.name;
  const base = fileName?.replace(/\.[^./\\]+$/, '').trim();
  return base || 'Imported deck';
}

export class ImportError extends Error {
  result?: ImportResult;
  constructor(message: string, result?: ImportResult) {
    super(message);
    this.result = result;
  }
}

/**
 * Import a list as a brand-new deck (main-menu import). Same parser and matching path as the
 * in-deck import. Nothing is created when no card lines parse; the new deck is removed again if
 * no card matched or the lookup failed.
 */
export async function importNewDeck(input: { text: string; format: string; name?: string; fileName?: string }): Promise<{ deck: Deck; result: ImportResult }> {
  const lines = parseDecklist(input.text);
  if (!lines.length) throw new ImportError('No card lines found. Paste a list like "1 Sol Ring", one card per line.');
  const deck = newDeck(input.name?.trim() || defaultImportName(input.text, input.fileName), input.format);
  await saveDeck(deck);
  let result: ImportResult;
  try {
    result = await importDecklist(deck.id, input.text, 'replace');
  } catch (e) {
    await deleteDeck(deck.id).catch(() => undefined);
    throw e;
  }
  if (result.added === 0) {
    await deleteDeck(deck.id).catch(() => undefined);
    throw new ImportError(`None of the ${result.lines} card line${result.lines === 1 ? '' : 's'} matched a card on Scryfall, so no deck was created.`, result);
  }
  return { deck: getDeck(deck.id) ?? deck, result };
}

export function exportDecklist(deck: Deck, withSets = false): string {
  const fmt = getFormat(deck.format);
  const line = (e: DeckEntry) => `${e.qty} ${e.card.name}${withSets ? ` (${e.card.set.toUpperCase()}) ${e.card.collector_number}` : ''}`;
  const sections: string[] = [];
  const cmd = deck.entries.find((e) => e.uid === deck.commanderUid);
  if (cmd && fmt.hasCommander) sections.push(`Commander\n${line(cmd)}`);
  const main = deck.entries.filter((e) => e.board === 'main' && e.uid !== deck.commanderUid);
  if (main.length) sections.push(`Deck\n${main.map(line).join('\n')}`);
  const side = deck.entries.filter((e) => e.board === 'side');
  if (side.length) sections.push(`Sideboard\n${side.map(line).join('\n')}`);
  const maybe = deck.entries.filter((e) => e.board === 'maybe');
  if (maybe.length) sections.push(`Maybeboard\n${maybe.map(line).join('\n')}`);
  return sections.join('\n\n') + '\n';
}

/** Set or clear the Commander bracket a deck aims for. */
export function setTargetBracket(deckId: string, bracket: 1 | 2 | 3 | 4 | 5 | undefined) {
  updateDeck(deckId, (d) => {
    if (bracket) d.targetBracket = bracket;
    else delete d.targetBracket;
  });
}
