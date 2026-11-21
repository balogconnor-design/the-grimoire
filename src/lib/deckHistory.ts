import type { Board, Card, Deck, DeckChangeItem, DeckChangeSession, DeckEntry } from '../types';

/**
 * Deck changelog and comparison (pure functions, no storage).
 *
 * Every save of a deck is compared with the version before it. Card count changes are recorded per
 * card name and board, so a printing swap is not a change and a board move shows as -1 on one board
 * and +1 on the other. Saves within SESSION_GAP of the previous change join that session and are
 * netted out (add then remove = nothing).
 */
export const SESSION_GAP = 30 * 60 * 1000;
/** Oldest sessions are dropped beyond this many. */
export const MAX_SESSIONS = 300;

const BOARD_ORDER: Board[] = ['main', 'side', 'maybe'];
export const BOARD_LABEL: Record<Board, string> = { main: 'Main', side: 'Sideboard', maybe: 'Maybeboard' };

const key = (board: Board, name: string) => `${board}\u0000${name}`;

function counts(entries: DeckEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(key(e.board, e.card.name), (m.get(key(e.board, e.card.name)) ?? 0) + e.qty);
  return m;
}

const byBoardThenName = (a: DeckChangeItem, b: DeckChangeItem) =>
  BOARD_ORDER.indexOf(a.board) - BOARD_ORDER.indexOf(b.board) || a.name.localeCompare(b.name);

/** What changed from `before` to `after`: per card name and board, the change in copies (never 0). */
export function diffEntries(before: DeckEntry[], after: DeckEntry[]): DeckChangeItem[] {
  const a = counts(before);
  const b = counts(after);
  const out: DeckChangeItem[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const delta = (b.get(k) ?? 0) - (a.get(k) ?? 0);
    if (!delta) continue;
    const [board, name] = k.split('\u0000') as [Board, string];
    out.push({ name, board, delta });
  }
  return out.sort(byBoardThenName);
}

/** Name of the card chosen as commander (whatever the format), if any. */
export function commanderName(d: { entries: DeckEntry[]; commanderUid?: string }): string | undefined {
  return d.commanderUid ? d.entries.find((e) => e.uid === d.commanderUid)?.card.name : undefined;
}

function mergeItems(a: DeckChangeItem[], b: DeckChangeItem[]): DeckChangeItem[] {
  const m = new Map<string, DeckChangeItem>();
  for (const i of [...a, ...b]) {
    const k = key(i.board, i.name);
    const cur = m.get(k);
    m.set(k, { ...i, delta: (cur?.delta ?? 0) + i.delta });
  }
  return [...m.values()].filter((i) => i.delta !== 0).sort(byBoardThenName);
}

const newId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * The changelog `next` should be saved with, given the version before it (`prev`, missing for a new
 * deck). Returns the existing changelog unchanged when no cards or commander changed.
 */
export function recordChanges(prev: Deck | undefined, next: Deck, opts: { note?: string; now?: number } = {}): DeckChangeSession[] {
  const now = opts.now ?? Date.now();
  const base = next.changelog ?? prev?.changelog ?? [];
  const items = diffEntries(prev?.entries ?? [], next.entries);
  const from = prev ? commanderName(prev) : undefined;
  const to = commanderName(next);
  const commander = from !== to ? { from, to } : undefined;
  if (!items.length && !commander && !opts.note) return base;

  const last = base[base.length - 1];
  if (!opts.note && last && !last.note && now - last.at <= SESSION_GAP) {
    const merged = mergeItems(last.items, items);
    const cmdFrom = last.commander ? last.commander.from : from;
    const cmd = cmdFrom !== to ? { from: cmdFrom, to } : undefined;
    const rest = base.slice(0, -1);
    if (!merged.length && !cmd) return rest; // everything in the session cancelled out
    return [...rest, { ...last, at: now, items: merged, commander: cmd }];
  }
  const session: DeckChangeSession = { id: newId(), startedAt: now, at: now, items, ...(commander ? { commander } : {}), ...(opts.note ? { note: opts.note } : {}) };
  return [...base, session].slice(-MAX_SESSIONS);
}

/** Copies added and removed in one session (board moves count on both sides). */
export function sessionTotals(s: DeckChangeSession): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const i of s.items) {
    if (i.delta > 0) added += i.delta;
    else removed -= i.delta;
  }
  return { added, removed };
}

export type ChangeLine =
  | { kind: 'add' | 'remove'; name: string; qty: number; board: Board }
  | { kind: 'move'; name: string; qty: number; from: Board; to: Board };

/**
 * A session as readable lines: copies that left one board and arrived on another are shown as a
 * move; the rest as added or removed. Order: moves, adds, removes, each by board then name.
 */
export function describeSession(s: DeckChangeSession): ChangeLine[] {
  const items = s.items.map((i) => ({ ...i }));
  const moves: ChangeLine[] = [];
  for (const out of items) {
    if (out.delta >= 0) continue;
    for (const into of items) {
      if (out.delta >= 0) break;
      if (into.name !== out.name || into.delta <= 0) continue;
      const qty = Math.min(-out.delta, into.delta);
      moves.push({ kind: 'move', name: out.name, qty, from: out.board, to: into.board });
      out.delta += qty;
      into.delta -= qty;
    }
  }
  const rest: ChangeLine[] = items.filter((i) => i.delta > 0).map((i) => ({ kind: 'add', name: i.name, qty: i.delta, board: i.board }));
  rest.push(...items.filter((i) => i.delta < 0).map((i): ChangeLine => ({ kind: 'remove', name: i.name, qty: -i.delta, board: i.board })));
  return [...moves, ...rest];
}

// ---------- Comparing two card lists ----------

export interface CompareRow {
  name: string;
  a: number;
  b: number;
  /** A printing of the card, from whichever side has it (for hover art and the card window). */
  card: Card;
}

export interface Comparison {
  onlyA: CompareRow[];
  onlyB: CompareRow[];
  /** In both, with different copy counts. */
  changed: CompareRow[];
  /** In both with the same count. */
  same: CompareRow[];
}

/** Compare two card lists on one board, by card name. */
export function compareEntries(a: DeckEntry[], b: DeckEntry[], board: Board = 'main'): Comparison {
  const rows = new Map<string, CompareRow>();
  const add = (entries: DeckEntry[], side: 'a' | 'b') => {
    for (const e of entries) {
      if (e.board !== board) continue;
      const r = rows.get(e.card.name) ?? { name: e.card.name, a: 0, b: 0, card: e.card };
      r[side] += e.qty;
      rows.set(e.card.name, r);
    }
  };
  add(a, 'a');
  add(b, 'b');
  const out: Comparison = { onlyA: [], onlyB: [], changed: [], same: [] };
  for (const r of [...rows.values()].sort((x, y) => x.name.localeCompare(y.name))) {
    if (!r.b) out.onlyA.push(r);
    else if (!r.a) out.onlyB.push(r);
    else if (r.a !== r.b) out.changed.push(r);
    else out.same.push(r);
  }
  return out;
}
