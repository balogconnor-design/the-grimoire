import type { Card, CollectionItem, DeckEntry, Finish } from '../types';
import { cardPrice, frontTypeLine } from './rules';
import { finishPrice, isAltArt, itemPL, itemUnitValue, printBadges } from './collection';

/**
 * Local search engine — a practical subset of Scryfall syntax plus collection extras.
 * Works on anything that can be described as a Subject (collection lot, deck entry, Scryfall card).
 *
 *   t:creature  o:"draw a card"  c>=ug  id<=wub  mv<=3  r:mythic  s:mh3  a:"terese"  pow>=4  usd>5
 *   is:foil  is:etched  is:alt  is:borderless  is:showcase  is:promo  is:fav  is:owned
 *   tag:ramp or #ramp (any scope)  gtag:staple (global)  coltag:binder  cardtag:wincon  decktag:cedh  status:sell  cond:nm  qty>=2  paid<10  gain>=50  pl>20  deck:atraxa  source:tcg
 *   year>=2020  f:commander  kw:flying  -t:land  (t:elf or t:goblin)  !"Sol Ring"
 */

export interface Subject {
  card: Card;
  finish?: Finish;
  item?: CollectionItem;
  entry?: DeckEntry;
  favorite?: boolean;
  globalTags?: string[]; // tags on the card itself, in every deck and printing
  collectionTags?: string[]; // tags on owned lots of this card
  cardTags?: string[]; // per-deck card tags (this deck in a deck view; every deck elsewhere)
  deckTags?: string[]; // tags of the deck(s) this card is in
  ownedQty?: number;
  decks?: string[]; // names of decks the card appears in
}

type Node =
  | { kind: 'and'; nodes: Node[] }
  | { kind: 'or'; nodes: Node[] }
  | { kind: 'not'; node: Node }
  | { kind: 'term'; key: string; op: string; value: string; raw: string };

export interface ParsedQuery {
  root: Node | null;
  warnings: string[];
  test: (s: Subject) => boolean;
}

// Keys only meaningful against your own data (cannot be sent to Scryfall).
export const LOCAL_KEYS = new Set([
  'tag', 'tags', 'gtag', 'coltag', 'cardtag', 'decktag', 'status', 'intent', 'cond', 'condition', 'qty', 'owned', 'paid', 'cost', 'gain', 'pl',
  'deck', 'source', 'fav', 'value',
]);
const LOCAL_IS = new Set(['fav', 'favorite', 'favourite', 'owned', 'unowned', 'missing', 'allocated', 'unallocated', 'gain', 'loss', 'forsale', 'sell', 'trade', 'hold', 'buy', 'tagged', 'alt', 'altart']);

const KEY_ALIAS: Record<string, string> = {
  n: 'name', name: 'name', t: 'type', type: 'type', o: 'oracle', oracle: 'oracle', fo: 'oracle',
  c: 'color', color: 'color', colors: 'color', id: 'identity', identity: 'identity', ci: 'identity', commander: 'identity',
  mv: 'mv', cmc: 'mv', manavalue: 'mv', r: 'rarity', rarity: 'rarity', s: 'set', e: 'set', set: 'set', edition: 'set',
  cn: 'cn', number: 'cn', a: 'artist', artist: 'artist', pow: 'pow', power: 'pow', tou: 'tou', toughness: 'tou',
  usd: 'usd', price: 'usd', is: 'is', not: 'not', tag: 'tag', tags: 'tag',
  gtag: 'gtag', globaltag: 'gtag', gt: 'gtag',
  coltag: 'coltag', ctag: 'coltag', collectiontag: 'coltag', cardtag: 'cardtag', etag: 'cardtag', decktag: 'decktag', dtag: 'decktag',
  status: 'status', intent: 'status',
  cond: 'cond', condition: 'cond', qty: 'qty', owned: 'qty', paid: 'paid', cost: 'paid', gain: 'gain', pl: 'pl',
  deck: 'deck', source: 'source', year: 'year', f: 'format', format: 'format', legal: 'format', banned: 'banned',
  kw: 'keyword', keyword: 'keyword', fav: 'fav', value: 'value', lang: 'lang', m: 'mana', mana: 'mana', ft: 'flavor', flavor: 'flavor',
};

// ---------- Tokenizer ----------

type Tok = { t: 'lp' | 'rp' | 'or' | 'neg' } | { t: 'word'; v: string };

function tokenize(q: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { out.push({ t: 'lp' }); i++; continue; }
    if (ch === ')') { out.push({ t: 'rp' }); i++; continue; }
    if (ch === '-' && i + 1 < q.length && !/\s/.test(q[i + 1])) { out.push({ t: 'neg' }); i++; continue; }
    // A word: may contain key:op"quoted value"
    let w = '';
    while (i < q.length && !/[\s()]/.test(q[i])) {
      if (q[i] === '"') {
        const end = q.indexOf('"', i + 1);
        const stop = end === -1 ? q.length : end;
        w += q.slice(i, stop + 1);
        i = stop + 1;
      } else {
        w += q[i++];
      }
    }
    if (/^or$/i.test(w)) out.push({ t: 'or' });
    else if (/^and$/i.test(w)) continue;
    else if (w) out.push({ t: 'word', v: w });
  }
  return out;
}

const unquote = (s: string) => s.replace(/^"|"$/g, '');

function parseTerm(raw: string): Node {
  // #ramp is shorthand for tag:ramp (a tag in any scope); #"card draw" for tags with spaces.
  if (raw.startsWith('#') && raw.length > 1) return { kind: 'term', key: 'tag', op: ':', value: unquote(raw.slice(1)), raw };
  if (raw.startsWith('!')) return { kind: 'term', key: 'exact', op: '=', value: unquote(raw.slice(1)), raw };
  const m = raw.match(/^([a-zA-Z]+)(:|>=|<=|!=|=|>|<)(.*)$/);
  if (m) return { kind: 'term', key: m[1].toLowerCase(), op: m[2], value: unquote(m[3]), raw };
  return { kind: 'term', key: 'name', op: ':', value: unquote(raw), raw };
}

function parse(toks: Tok[]): Node | null {
  let pos = 0;
  const parseOr = (): Node | null => {
    const parts: Node[] = [];
    const first = parseAnd();
    if (first) parts.push(first);
    while (toks[pos]?.t === 'or') {
      pos++;
      const n = parseAnd();
      if (n) parts.push(n);
    }
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : { kind: 'or', nodes: parts };
  };
  const parseAnd = (): Node | null => {
    const parts: Node[] = [];
    while (pos < toks.length && toks[pos].t !== 'or' && toks[pos].t !== 'rp') {
      const n = parseUnary();
      if (n) parts.push(n);
    }
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : { kind: 'and', nodes: parts };
  };
  const parseUnary = (): Node | null => {
    const tok = toks[pos];
    if (tok.t === 'neg') {
      pos++;
      const n = pos < toks.length ? parseUnary() : null;
      return n ? { kind: 'not', node: n } : null;
    }
    if (tok.t === 'lp') {
      pos++;
      const n = parseOr();
      if (toks[pos]?.t === 'rp') pos++;
      return n;
    }
    pos++;
    if (tok.t === 'word') return parseTerm(tok.v);
    return null;
  };
  const root = parseOr();
  return root;
}

// ---------- Evaluation ----------

const COLOR_WORDS: Record<string, string> = {
  white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g', colorless: 'c',
  azorius: 'wu', dimir: 'ub', rakdos: 'br', gruul: 'rg', selesnya: 'gw', orzhov: 'wb', izzet: 'ur', golgari: 'bg', boros: 'rw', simic: 'gu',
  esper: 'wub', grixis: 'ubr', jund: 'brg', naya: 'rgw', bant: 'gwu', abzan: 'wbg', jeskai: 'urw', sultai: 'bgu', mardu: 'rwb', temur: 'gur',
};
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
const RARITY_ALIAS: Record<string, string> = { c: 'common', u: 'uncommon', r: 'rare', m: 'mythic', s: 'special' };

function cmp(a: number, op: string, b: number) {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '!=': return a !== b;
    default: return a === b;
  }
}

function colorSet(v: string): Set<string> | null {
  const s = (COLOR_WORDS[v.toLowerCase()] ?? v.toLowerCase());
  if (!/^[wubrgcm]+$/.test(s)) return null;
  return new Set(s.split('').filter((c) => c !== 'c').map((c) => c.toUpperCase()));
}

/** Scryfall semantics: c: means "including" (>=); id: means "within" (<=). */
function colorTest(have: string[], op: string, v: string, defaultOp: '>=' | '<='): boolean | null {
  if (/^\d+$/.test(v)) return cmp(have.length, op === ':' ? '=' : op, parseInt(v, 10));
  const want = colorSet(v);
  if (!want) return null;
  const h = new Set(have);
  if (v.toLowerCase() === 'c' || v.toLowerCase() === 'colorless') return h.size === 0;
  if (v.toLowerCase() === 'm' || v.toLowerCase() === 'multicolor') return h.size > 1;
  const sub = [...want].every((c) => h.has(c)); // have ⊇ want
  const sup = [...h].every((c) => want.has(c)); // have ⊆ want
  const eff = op === ':' ? defaultOp : op;
  switch (eff) {
    case '>=': return sub;
    case '<=': return sup;
    case '=': return sub && sup;
    case '>': return sub && h.size > want.size;
    case '<': return sup && h.size < want.size;
    case '!=': return !(sub && sup);
  }
  return null;
}

const allText = (c: Card) => [c.oracle_text, ...(c.card_faces?.map((f) => f.oracle_text) ?? [])].filter(Boolean).join('\n').toLowerCase();
const allNames = (c: Card) => [c.name, ...(c.card_faces?.map((f) => f.name) ?? [])].map((n) => n.toLowerCase());

function subjectPrice(s: Subject): number | null {
  if (s.item) return itemUnitValue(s.item);
  if (s.finish) return finishPrice(s.card, s.finish);
  return cardPrice(s.card);
}

function numOrNull(v: string): number | null {
  const n = parseFloat(v.replace(/^\$/, ''));
  return Number.isFinite(n) ? n : null;
}

function evalTerm(n: Extract<Node, { kind: 'term' }>, s: Subject, warn: (w: string) => void): boolean {
  const key = n.key === 'exact' ? 'exact' : KEY_ALIAS[n.key];
  const v = n.value.toLowerCase();
  const op = n.op;
  const c = s.card;
  const numeric = (x: number | null | undefined) => {
    const b = numOrNull(v);
    if (b == null) { warn(`"${n.raw}" needs a number`); return true; }
    return x != null && cmp(x, op === ':' ? '=' : op, b);
  };
  const contains = (hay: string) => (op === '=' ? hay === v : hay.includes(v));

  switch (key) {
    case 'exact': return allNames(c).includes(v);
    case 'name': return allNames(c).some((x) => x.includes(v));
    case 'type': return [c.type_line, ...(c.card_faces?.map((f) => f.type_line ?? '') ?? [])].join(' ').toLowerCase().includes(v);
    case 'oracle': {
      const text = allText(c);
      // Scryfall lets "~" stand for the card's own name.
      return text.includes(v) || (v.includes('~') && text.split(c.name.toLowerCase()).join('~').includes(v));
    }
    case 'flavor': return [c.flavor_text, ...(c.card_faces?.map((f) => f.flavor_text) ?? [])].filter(Boolean).join(' ').toLowerCase().includes(v);
    case 'keyword': return (c.keywords ?? []).some((k) => k.toLowerCase() === v);
    case 'mana': return (c.mana_cost ?? c.card_faces?.map((f) => f.mana_cost).join('') ?? '').toLowerCase().includes(v.replace(/[{}]/g, ''));
    case 'color': {
      const r = colorTest(c.colors ?? c.card_faces?.[0]?.colors ?? [], op, v, '>=');
      if (r == null) warn(`Unknown color "${n.value}"`);
      return r ?? true;
    }
    case 'identity': {
      const r = colorTest(c.color_identity, op, v, '<=');
      if (r == null) warn(`Unknown color "${n.value}"`);
      return r ?? true;
    }
    case 'mv': return numeric(c.cmc);
    case 'pow': return numeric(numOrNull(c.power ?? c.card_faces?.[0]?.power ?? ''));
    case 'tou': return numeric(numOrNull(c.toughness ?? c.card_faces?.[0]?.toughness ?? ''));
    case 'usd': return numeric(subjectPrice(s));
    case 'year': return numeric(c.released_at ? parseInt(c.released_at.slice(0, 4), 10) : null);
    case 'rarity': {
      const want = RARITY_ALIAS[v] ?? v;
      const a = RARITY_ORDER.indexOf(c.rarity), b = RARITY_ORDER.indexOf(want);
      if (b === -1) { warn(`Unknown rarity "${n.value}"`); return true; }
      return cmp(a, op === ':' ? '=' : op, b);
    }
    case 'set': return c.set.toLowerCase() === v || c.set_name.toLowerCase().includes(v);
    case 'cn': return c.collector_number.toLowerCase() === v;
    case 'artist': return (c.artist ?? '').toLowerCase().includes(v);
    case 'lang': return (c.lang ?? 'en') === v;
    case 'format': return c.legalities?.[v] === 'legal' || c.legalities?.[v] === 'restricted';
    case 'banned': return c.legalities?.[v] === 'banned';
    case 'tag':
    case 'gtag':
    case 'coltag':
    case 'cardtag':
    case 'decktag': {
      const pool = key === 'gtag' ? s.globalTags : key === 'coltag' ? s.collectionTags : key === 'cardtag' ? s.cardTags : key === 'decktag' ? s.deckTags
        : [...(s.globalTags ?? []), ...(s.collectionTags ?? []), ...(s.cardTags ?? []), ...(s.deckTags ?? [])];
      const tags = (pool ?? []).map((t) => t.toLowerCase());
      return op === '=' ? tags.includes(v) : tags.some((t) => t.includes(v));
    }
    case 'status': {
      const i = s.item?.intent;
      if (v === 'sell') return i === 'sell' || i === 'sell-trade';
      if (v === 'trade') return i === 'trade' || i === 'sell-trade';
      if (v === 'none') return !i;
      return i === v;
    }
    case 'cond': return (s.item?.condition ?? '').toLowerCase() === v;
    case 'qty': return numeric(s.item ? s.item.qty : s.entry ? s.entry.qty : s.ownedQty ?? 0);
    case 'paid': return numeric(s.item?.purchasePrice);
    case 'gain': return numeric(s.item ? itemPL(s.item).pct : null);
    case 'pl': return numeric(s.item ? itemPL(s.item).diff : null);
    case 'value': return numeric(s.item ? (itemUnitValue(s.item) ?? 0) * s.item.qty : subjectPrice(s));
    case 'deck': return (s.decks ?? []).some((d) => contains(d.toLowerCase()));
    case 'source': return contains((s.item?.source ?? '').toLowerCase());
    case 'fav': return !!s.favorite === !/^(n|no|false|0)$/.test(v);
    case 'is':
    case 'not': {
      const r = isTest(v, s);
      if (r == null) { warn(`"${n.raw}" isn't supported in local search`); return true; }
      return key === 'not' ? !r : r;
    }
    default:
      warn(`"${n.raw}" isn't supported in local search — ignored`);
      return true;
  }
}

function isTest(v: string, s: Subject): boolean | null {
  const c = s.card;
  const finish = s.item?.finish ?? s.finish;
  const badges = printBadges(c).map((b) => b.toLowerCase());
  const tl = frontTypeLine(c);
  switch (v) {
    case 'foil': return finish === 'foil';
    case 'nonfoil': return finish === 'nonfoil';
    case 'etched': return finish === 'etched';
    case 'alt': case 'altart': return isAltArt(c);
    case 'borderless': return c.border_color === 'borderless';
    case 'showcase': return badges.includes('showcase');
    case 'extendedart': case 'extended': return badges.includes('extended');
    case 'fullart': return !!c.full_art;
    case 'promo': return !!c.promo;
    case 'serialized': return badges.includes('serialized');
    case 'fav': case 'favorite': case 'favourite': return !!s.favorite;
    case 'owned': return (s.item?.qty ?? s.ownedQty ?? 0) > 0;
    case 'unowned': case 'missing': return (s.item?.qty ?? s.ownedQty ?? 0) === 0;
    case 'allocated': return !!s.item && Object.values(s.item.allocations).some((n) => n > 0);
    case 'unallocated': return !!s.item && !Object.values(s.item.allocations).some((n) => n > 0);
    case 'gain': { const p = s.item ? itemPL(s.item).diff : null; return p != null && p > 0; }
    case 'loss': { const p = s.item ? itemPL(s.item).diff : null; return p != null && p < 0; }
    case 'forsale': case 'sell': return s.item?.intent === 'sell' || s.item?.intent === 'sell-trade';
    case 'trade': return s.item?.intent === 'trade' || s.item?.intent === 'sell-trade';
    case 'hold': return s.item?.intent === 'hold';
    case 'buy': return s.item?.intent === 'buy';
    case 'tagged': return !!(s.globalTags?.length || s.collectionTags?.length || s.cardTags?.length || s.deckTags?.length);
    case 'legendary': return /\bLegendary\b/.test(tl);
    case 'commander': return /\bLegendary\b/.test(tl) && /\bCreature\b/.test(tl) || /can be your commander/i.test(allText(c));
    case 'gamechanger': return !!c.game_changer;
    case 'permanent': return /\b(Creature|Artifact|Enchantment|Planeswalker|Land|Battle)\b/.test(tl);
    case 'spell': return !/\bLand\b/.test(tl);
    case 'mdfc': return c.layout === 'modal_dfc';
    case 'dfc': return c.layout === 'transform' || c.layout === 'modal_dfc';
  }
  return null;
}

function evaluate(n: Node, s: Subject, warn: (w: string) => void): boolean {
  switch (n.kind) {
    case 'and': return n.nodes.every((x) => evaluate(x, s, warn));
    case 'or': return n.nodes.some((x) => evaluate(x, s, warn));
    case 'not': return !evaluate(n.node, s, warn);
    case 'term': return evalTerm(n, s, warn);
  }
}

const cache = new Map<string, Node | null>();

export function parseQuery(q: string): ParsedQuery {
  const text = q.trim();
  let root = cache.get(text);
  if (root === undefined) {
    root = text ? parse(tokenize(text)) : null;
    if (cache.size > 200) cache.clear();
    cache.set(text, root);
  }
  const warnings = new Set<string>();
  const warn = (w: string) => warnings.add(w);
  const r = root;
  const parsed: ParsedQuery = {
    root: r,
    get warnings() { return [...warnings]; },
    test: (s) => (r ? evaluate(r, s, warn) : true),
  };
  return parsed;
}

/** True if the text uses query syntax (so a plain substring filter would be the wrong tool). */
export const looksLikeQuery = (q: string) => /(^|\s)-?[a-zA-Z]+(:|>=|<=|!=|=|>|<)\S|(^|\s)-?#\S|(^|\s)!"|\bor\b|[()]/.test(q);

// ---------- Splitting for Scryfall ----------

function isLocalTerm(n: Node): boolean {
  if (n.kind !== 'term') return false;
  const key = KEY_ALIAS[n.key] ?? n.key;
  if (key === 'is' || key === 'not') return LOCAL_IS.has(n.value.toLowerCase());
  return LOCAL_KEYS.has(key) || LOCAL_KEYS.has(n.key);
}

function containsLocal(n: Node): boolean {
  if (n.kind === 'term') return isLocalTerm(n);
  if (n.kind === 'not') return containsLocal(n.node);
  return n.nodes.some(containsLocal);
}

function toText(n: Node): string {
  switch (n.kind) {
    case 'term': return n.raw;
    case 'not': return `-${toText(n.node)}`;
    case 'and': return n.nodes.map((x) => (x.kind === 'or' ? `(${toText(x)})` : toText(x))).join(' ');
    case 'or': return n.nodes.map(toText).join(' or ');
  }
}

/**
 * Split a query for the Scryfall API: remote part goes to Scryfall, local part
 * (tags, favourites, ownership...) is applied to the results here.
 */
export function splitForScryfall(q: string): { remote: string; local: string; error?: string } {
  const root = parse(tokenize(q.trim()));
  if (!root) return { remote: '', local: '' };
  if (!containsLocal(root)) return { remote: q.trim(), local: '' };
  const parts = root.kind === 'and' ? root.nodes : [root];
  const remote: Node[] = [];
  const local: Node[] = [];
  for (const p of parts) {
    if (!containsLocal(p)) remote.push(p);
    else if (p.kind === 'or' && p.nodes.some((x) => !containsLocal(x))) {
      return { remote: '', local: '', error: 'Collection filters (tag:, is:fav, owned…) can\'t be mixed inside an OR group with Scryfall filters.' };
    } else local.push(p);
  }
  return { remote: remote.map(toText).join(' '), local: local.map(toText).join(' ') };
}
