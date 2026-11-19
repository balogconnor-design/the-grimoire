import type { Board, Card, Deck, DeckEntry, DeckFilter, TypeCategory } from '../types';
import { getFormat, type FormatDef } from './formats';

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
export const COLOR_NAMES: Record<string, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless',
};
export const BASIC_FOR_COLOR: Record<string, string> = {
  W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest', C: 'Wastes',
};

export const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

// ---------- Card helpers ----------

export function frontFace(card: Card) {
  return card.card_faces?.[0];
}

export function frontTypeLine(card: Card): string {
  return (frontFace(card)?.type_line ?? card.type_line ?? '').split(' // ')[0];
}

export function manaCost(card: Card): string {
  if (card.mana_cost) return card.mana_cost;
  return frontFace(card)?.mana_cost ?? '';
}

export function cardImage(card: Card, size: 'small' | 'normal' | 'large' | 'art_crop' = 'normal', face = 0): string | undefined {
  return card.image_uris?.[size] ?? card.card_faces?.[face]?.image_uris?.[size] ?? card.card_faces?.[0]?.image_uris?.[size];
}

export function hasBackFaceImage(card: Card): boolean {
  return !card.image_uris && !!card.card_faces?.[1]?.image_uris;
}

export function cardPrice(card: Card): number | null {
  const p = card.prices?.usd ?? card.prices?.usd_foil ?? card.prices?.usd_etched;
  return p ? parseFloat(p) : null;
}

export function formatUSD(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function typeCategory(card: Card): Exclude<TypeCategory, 'Commander'> {
  const t = frontTypeLine(card);
  if (/\bCreature\b/.test(t)) return 'Creature';
  if (/\bPlaneswalker\b/.test(t)) return 'Planeswalker';
  if (/\bBattle\b/.test(t)) return 'Battle';
  if (/\bLand\b/.test(t)) return 'Land';
  if (/\bInstant\b/.test(t)) return 'Instant';
  if (/\bSorcery\b/.test(t)) return 'Sorcery';
  if (/\bArtifact\b/.test(t)) return 'Artifact';
  if (/\bEnchantment\b/.test(t)) return 'Enchantment';
  return 'Other';
}

export const TYPE_ORDER: TypeCategory[] = [
  'Commander', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other',
];

export function isLand(card: Card) {
  return /\bLand\b/.test(frontTypeLine(card));
}

export function isBasicLand(card: Card) {
  return /\bBasic\b/.test(card.type_line) && /\bLand\b/.test(card.type_line);
}

function allOracleText(card: Card): string {
  return [card.oracle_text, ...(card.card_faces?.map((f) => f.oracle_text) ?? [])].filter(Boolean).join('\n');
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};

/** Max copies of this card allowed in the given format (deck rules, not legality). */
export function copyLimit(card: Card, format: FormatDef): number {
  if (isBasicLand(card)) return Infinity;
  const text = allOracleText(card);
  if (/a deck can have any number of cards named/i.test(text)) return Infinity;
  const upTo = text.match(/a deck can have up to (\w+) cards named/i);
  if (upTo) {
    const n = NUMBER_WORDS[upTo[1].toLowerCase()] ?? parseInt(upTo[1], 10);
    if (n) return n;
  }
  if (format.legalityKey && card.legalities?.[format.legalityKey] === 'restricted') return 1;
  return format.maxCopies;
}

/** Can this card be the commander of a deck in this format (per comprehensive rule 903.3 + format variants)? */
export function canBeCommander(card: Card, format: FormatDef): boolean {
  if (!format.hasCommander) return false;
  const t = frontTypeLine(card);
  const legendary = /\bLegendary\b/.test(t);
  if (/can be your commander/i.test(allOracleText(card))) return true;
  if (format.id === 'oathbreaker') return /\bPlaneswalker\b/.test(t);
  // PDH commanders must have an uncommon printing; rarity varies by printing, so only the type is checked here.
  if (format.id === 'paupercommander') return /\bCreature\b/.test(t);
  if (legendary && /\bCreature\b/.test(t)) return true;
  // e.g. Grist, the Hunger Tide: a creature everywhere except the battlefield (so in the command zone).
  if (legendary && /isn't on the battlefield, it's a .*creature/i.test(allOracleText(card))) return true;
  // CR 903.3 (2025): legendary Vehicles / Spacecraft with power & toughness may be commanders.
  if (legendary && /\b(Vehicle|Spacecraft)\b/.test(t) && (card.power ?? frontFace(card)?.power) != null) return true;
  if (format.planeswalkerCommander && legendary && /\bPlaneswalker\b/.test(t)) return true;
  return false;
}

export function withinIdentity(card: Card, identity: string[]): boolean {
  return card.color_identity.every((c) => identity.includes(c));
}

// ---------- Deck helpers ----------

/** The commander entry, if the deck's format uses one and it has been chosen. */
export function commanderEntry(deck: Deck): DeckEntry | undefined {
  if (!deck.commanderUid || !getFormat(deck.format).hasCommander) return undefined;
  return deck.entries.find((e) => e.uid === deck.commanderUid && e.board === 'main');
}

/** Commander color identity, or null if the format has no commander / none chosen yet. */
export function deckIdentity(deck: Deck): string[] | null {
  const fmt = getFormat(deck.format);
  if (!fmt.hasCommander) return null;
  const cmd = commanderEntry(deck);
  return cmd ? cmd.card.color_identity : null;
}

export function boardEntries(deck: Deck, board: Board) {
  return deck.entries.filter((e) => e.board === board);
}

export function boardCount(deck: Deck, board: Board) {
  return boardEntries(deck, board).reduce((n, e) => n + e.qty, 0);
}

export function entryCategory(deck: Deck, e: DeckEntry): TypeCategory {
  return e.uid === commanderEntry(deck)?.uid ? 'Commander' : typeCategory(e.card);
}

export function boardPrice(deck: Deck, board: Board) {
  return boardEntries(deck, board).reduce((sum, e) => sum + (cardPrice(e.card) ?? 0) * e.qty, 0);
}

// ---------- Validation ----------

export interface Issue {
  severity: 'error' | 'warning';
  message: string;
  uids?: string[];
}

export interface Requirement {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface Validation {
  requirements: Requirement[];
  issues: Issue[];
  /** uid -> problems for that entry, used to flag rows in the deck list. */
  entryProblems: Record<string, string[]>;
  legal: boolean;
}

const LEGALITY_TEXT: Record<string, string> = {
  banned: 'Banned', not_legal: 'Not legal', restricted: 'Restricted',
};

export function validateDeck(deck: Deck): Validation {
  const fmt = getFormat(deck.format);
  const requirements: Requirement[] = [];
  const issues: Issue[] = [];
  const entryProblems: Record<string, string[]> = {};
  const flag = (uid: string, msg: string) => (entryProblems[uid] ??= []).push(msg);

  const main = boardEntries(deck, 'main');
  const mainCount = boardCount(deck, 'main');
  const sideCount = boardCount(deck, 'side');

  // Deck size
  requirements.push({
    label: fmt.exact ? `Exactly ${fmt.deckSize} cards` : `At least ${fmt.deckSize} cards`,
    ok: fmt.exact ? mainCount === fmt.deckSize : mainCount >= fmt.deckSize,
    detail: `${mainCount} in deck`,
  });

  // Sideboard
  if (fmt.sideboardMax != null) {
    requirements.push({ label: `Sideboard ≤ ${fmt.sideboardMax}`, ok: sideCount <= fmt.sideboardMax, detail: `${sideCount} in sideboard` });
  }

  // Commander
  const identity = deckIdentity(deck);
  if (fmt.hasCommander) {
    const cmd = commanderEntry(deck);
    const label = fmt.id === 'oathbreaker' ? 'Oathbreaker chosen' : 'Commander chosen';
    requirements.push({ label, ok: !!cmd, detail: cmd?.card.name ?? 'None selected' });
    if (cmd && !canBeCommander(cmd.card, fmt)) {
      issues.push({ severity: 'error', message: `${cmd.card.name} can't be a commander in ${fmt.name}.`, uids: [cmd.uid] });
      flag(cmd.uid, 'Not a valid commander');
    }
    if (identity) {
      const outside = main.filter((e) => !withinIdentity(e.card, identity));
      outside.forEach((e) => flag(e.uid, "Outside commander's color identity"));
      requirements.push({
        label: 'Within color identity',
        ok: outside.length === 0,
        detail: outside.length ? `${outside.length} card${outside.length > 1 ? 's' : ''} outside identity` : 'All cards match',
      });
      if (outside.length) {
        issues.push({ severity: 'error', message: `Outside color identity: ${outside.map((e) => e.card.name).join(', ')}`, uids: outside.map((e) => e.uid) });
      }
    }
  }

  // Copy limits (counted by name across main + side for constructed; main only for singleton commander formats)
  const counted = fmt.hasCommander || fmt.sideboardMax == null ? main : deck.entries.filter((e) => e.board !== 'maybe');
  const byName = new Map<string, DeckEntry[]>();
  for (const e of counted) {
    const list = byName.get(e.card.name) ?? [];
    list.push(e);
    byName.set(e.card.name, list);
  }
  const overLimit: string[] = [];
  for (const [name, list] of byName) {
    const total = list.reduce((n, e) => n + e.qty, 0);
    const limit = copyLimit(list[0].card, fmt);
    if (total > limit) {
      overLimit.push(`${name} (${total}/${limit})`);
      list.forEach((e) => flag(e.uid, `Too many copies (${total}, max ${limit})`));
    }
  }
  if (fmt.maxCopies !== Infinity) {
    requirements.push({
      label: fmt.maxCopies === 1 ? 'Singleton' : `Max ${fmt.maxCopies} copies`,
      ok: overLimit.length === 0,
      detail: overLimit.length ? overLimit.join(', ') : 'No duplicates over limit',
    });
  }

  // Legality
  if (fmt.legalityKey) {
    const illegal: string[] = [];
    for (const e of counted) {
      const status = e.card.legalities?.[fmt.legalityKey];
      if (status && status !== 'legal' && status !== 'restricted') {
        illegal.push(e.card.name);
        flag(e.uid, `${LEGALITY_TEXT[status] ?? status} in ${fmt.name}`);
      }
    }
    requirements.push({
      label: `All cards legal in ${fmt.name}`,
      ok: illegal.length === 0,
      detail: illegal.length ? illegal.join(', ') : 'No banned or illegal cards',
    });
  }

  const legal = requirements.every((r) => r.ok) && !issues.some((i) => i.severity === 'error');
  return { requirements, issues, entryProblems, legal };
}

// ---------- Stats ----------

export interface ColorStat {
  color: string;
  pips: number;
  pipPct: number;
  sources: number; // lands producing this color
  cards: number; // nonland cards of this color
}

const PIP_RE = /\{([^}]+)\}/g;

export function parseSymbols(cost: string): string[] {
  return [...cost.matchAll(PIP_RE)].map((m) => m[1]);
}

export function computeColorStats(entries: DeckEntry[]): ColorStat[] {
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const sources: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const cards: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const e of entries) {
    const c = e.card;
    if (isLand(c)) {
      for (const m of new Set(c.produced_mana ?? [])) if (m in sources) sources[m] += e.qty;
      continue;
    }
    for (const sym of parseSymbols(card_costs(c))) {
      // Hybrid / Phyrexian symbols ({W/U}, {G/P}, {2/W}) count toward every color in them.
      const colorsInSym = new Set(sym.split('/').filter((s) => s in pips && s !== 'C'));
      if (sym === 'C') pips.C += e.qty;
      colorsInSym.forEach((col) => (pips[col] += e.qty));
    }
    const colors = c.colors ?? c.card_faces?.[0]?.colors ?? [];
    if (colors.length === 0) cards.C += e.qty;
    else colors.forEach((col) => (cards[col] += e.qty));
  }
  const totalPips = Object.values(pips).reduce((a, b) => a + b, 0) || 1;
  return (['W', 'U', 'B', 'R', 'G', 'C'] as const).map((color) => ({
    color,
    pips: pips[color],
    pipPct: (pips[color] / totalPips) * 100,
    sources: sources[color],
    cards: cards[color],
  }));
}

export type ManaBaseStatus = 'ok' | 'low' | 'critical' | 'high';

export interface ManaBaseRow {
  color: string;
  pipPct: number; // share of the deck's colored demand (needed colors only)
  sourcePct: number; // share of land color-production across needed colors
  delta: number; // sourcePct - pipPct, in percentage points
  sources: number; // lands that produce this color
  coverage: number; // % of all lands that produce this color
  shift: number; // lands to add (+) or remove (−) for this color to match its symbol share
  status: ManaBaseStatus;
}

/** A suggested swap: replace `count` lands making `from` with lands making `to`. */
export interface ManaBaseMove {
  from: string | 'other'; // 'other' = lands that make none of the deck's spell colors
  to: string;
  count: number;
}

export interface ManaBase {
  rows: ManaBaseRow[];
  lands: number;
  offColorLands: number; // lands producing none of the needed colors (utility/colorless/fetch)
  worst?: ManaBaseRow; // the most under-supplied color, if any is off
  moves: ManaBaseMove[]; // suggested swaps to fix under-supplied colors
}

/** Tolerance (percentage points) before a color is flagged as over/under supplied. */
export const MANA_BASE_TOLERANCE = 5;

/**
 * Compare where lands put their color production against where nonland spells
 * put their colored symbols. Only colors that actually appear in costs count,
 * so off-color production (e.g. Command Tower's extra colors) doesn't skew it.
 */
export function computeManaBase(entries: DeckEntry[]): ManaBase {
  const stats = computeColorStats(entries);
  const needed = stats.filter((s) => s.pips > 0);
  const pipTotal = needed.reduce((n, s) => n + s.pips, 0);
  const srcTotal = needed.reduce((n, s) => n + s.sources, 0);
  const neededSet = new Set(needed.map((s) => s.color));

  let lands = 0;
  let offColorLands = 0;
  for (const e of entries) {
    if (!isLand(e.card)) continue;
    lands += e.qty;
    if (!(e.card.produced_mana ?? []).some((m) => neededSet.has(m))) offColorLands += e.qty;
  }

  const rows: ManaBaseRow[] = needed.map((s) => {
    const pipPct = pipTotal ? (s.pips / pipTotal) * 100 : 0;
    const sourcePct = srcTotal ? (s.sources / srcTotal) * 100 : 0;
    const delta = sourcePct - pipPct;
    const status: ManaBaseStatus =
      s.sources === 0 || delta < -2 * MANA_BASE_TOLERANCE ? 'critical'
        : delta < -MANA_BASE_TOLERANCE ? 'low'
          : delta > MANA_BASE_TOLERANCE ? 'high'
            : 'ok';
    // A one-for-one swap of mono-color lands keeps the total production constant,
    // so the target source count is simply this color's symbol share of that total.
    const base = srcTotal || lands;
    const shift = Math.round((pipPct / 100) * base - s.sources);
    return { color: s.color, pipPct, sourcePct, delta, sources: s.sources, coverage: lands ? (s.sources / lands) * 100 : 0, shift, status };
  });

  const short = rows.filter((r) => r.status === 'critical' || r.status === 'low').sort((a, b) => a.delta - b.delta);
  return { rows, lands, offColorLands, worst: short[0], moves: planMoves(short, rows, offColorLands) };
}

/** Pair each under-supplied color with the most over-supplied ones, greedily. */
function planMoves(short: ManaBaseRow[], rows: ManaBaseRow[], offColorLands: number): ManaBaseMove[] {
  const donors = rows.filter((r) => r.shift < 0).map((r) => ({ color: r.color, spare: -r.shift })).sort((a, b) => b.spare - a.spare);
  let otherSpare = offColorLands;
  const moves: ManaBaseMove[] = [];
  for (const r of short) {
    let need = Math.max(1, r.shift);
    for (const d of donors) {
      if (need === 0) break;
      const n = Math.min(need, d.spare);
      if (n > 0) {
        moves.push({ from: d.color, to: r.color, count: n });
        d.spare -= n;
        need -= n;
      }
    }
    // Nothing colored left to give: fall back to utility/colorless lands.
    if (need > 0 && otherSpare > 0) {
      const n = Math.min(need, otherSpare);
      moves.push({ from: 'other', to: r.color, count: n });
      otherSpare -= n;
    }
  }
  return moves;
}

function card_costs(c: Card): string {
  // Split/adventure/MDFC cards: count every face's cost; normal cards: top-level cost.
  if (c.card_faces?.length && !c.mana_cost) return c.card_faces.map((f) => f.mana_cost ?? '').join('');
  return c.mana_cost ?? '';
}

export function cmcBucket(card: Card): number {
  return Math.min(7, Math.floor(card.cmc ?? 0));
}

export function computeCurve(entries: DeckEntry[]): number[] {
  const buckets = Array(8).fill(0);
  for (const e of entries) if (!isLand(e.card)) buckets[cmcBucket(e.card)] += e.qty;
  return buckets;
}

export function averageMV(entries: DeckEntry[]): number {
  let total = 0;
  let n = 0;
  for (const e of entries) {
    if (isLand(e.card)) continue;
    total += (e.card.cmc ?? 0) * e.qty;
    n += e.qty;
  }
  return n ? total / n : 0;
}

export function computeTypes(deck: Deck, entries: DeckEntry[]): { type: TypeCategory; count: number }[] {
  const counts = new Map<TypeCategory, number>();
  for (const e of entries) {
    const t = entryCategory(deck, e);
    counts.set(t, (counts.get(t) ?? 0) + e.qty);
  }
  return TYPE_ORDER.filter((t) => counts.has(t)).map((type) => ({ type, count: counts.get(type)! }));
}

export function matchesFilter(deck: Deck, e: DeckEntry, f: DeckFilter): boolean {
  if (f.cmc != null) {
    if (isLand(e.card)) return false;
    if (cmcBucket(e.card) !== f.cmc) return false;
  }
  if (f.type && entryCategory(deck, e) !== f.type) {
    // Type filters also include the commander when it matches the type (e.g. Creature).
    if (!(e.uid === commanderEntry(deck)?.uid && typeCategory(e.card) === f.type)) return false;
  }
  if (f.color) {
    if (isLand(e.card)) {
      if (!(e.card.produced_mana ?? []).includes(f.color)) return false;
    } else {
      const colors = e.card.colors ?? e.card.card_faces?.[0]?.colors ?? [];
      if (f.color === 'C' ? colors.length > 0 : !colors.includes(f.color)) return false;
    }
  }
  if (f.text) {
    const q = f.text.toLowerCase();
    const hay = `${e.card.name}\n${e.card.type_line}\n${allOracleText(e.card)}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function sortEntries(a: DeckEntry, b: DeckEntry) {
  return (a.card.cmc ?? 0) - (b.card.cmc ?? 0) || a.card.name.localeCompare(b.card.name);
}
