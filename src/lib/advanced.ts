/**
 * Advanced search form state and the Scryfall query it builds.
 * Mirrors the fields on scryfall.com/advanced, plus a few collection filters of our own.
 * Shared by the main-page search and the deck search panel.
 */

export type Op = '=' | '!=' | '<' | '<=' | '>' | '>=';
export const OPS: { value: Op; label: string }[] = [
  { value: '=', label: '=' }, { value: '!=', label: '≠' }, { value: '<', label: '<' },
  { value: '<=', label: '≤' }, { value: '>', label: '>' }, { value: '>=', label: '≥' },
];

export type ColorMode = 'exactly' | 'including' | 'atmost';
export type TriState = 'is' | 'not';

export interface TypeTerm { value: string; mode: TriState }
export interface StatRow { stat: string; op: Op; value: string }
export interface FormatRow { status: 'f' | 'banned' | 'restricted'; format: string }
export interface PriceRow { currency: 'usd' | 'eur' | 'tix'; op: Op; value: string }

export interface Adv {
  name: string;
  oracle: string;
  types: TypeTerm[];
  typesAny: boolean; // true: match any included type; false: all of them
  colors: string[];
  colorMode: ColorMode;
  identity: string[];
  mana: string;
  stats: StatRow[];
  games: string[];
  formats: FormatRow[];
  sets: string[];
  block: string;
  rarities: string[];
  criteria: Record<string, TriState>;
  prices: PriceRow[];
  artist: string;
  flavor: string;
  lore: string;
  lang: string;
  owned: '' | 'owned' | 'unowned';
  fav: boolean;
  tag: string;
  unique: 'cards' | 'art' | 'prints';
  dir: 'auto' | 'asc' | 'desc';
  extras: boolean;
}

export const EMPTY_ADV: Adv = {
  name: '', oracle: '', types: [], typesAny: false, colors: [], colorMode: 'including', identity: [], mana: '',
  stats: [{ stat: 'mv', op: '=', value: '' }], games: [], formats: [{ status: 'f', format: '' }], sets: [], block: '',
  rarities: [], criteria: {}, prices: [{ currency: 'usd', op: '<=', value: '' }],
  artist: '', flavor: '', lore: '', lang: '', owned: '', fav: false, tag: '',
  unique: 'cards', dir: 'auto', extras: false,
};

export const STATS: { value: string; label: string }[] = [
  { value: 'mv', label: 'Mana value' }, { value: 'pow', label: 'Power' }, { value: 'tou', label: 'Toughness' },
  { value: 'pt', label: 'Power + toughness' }, { value: 'loy', label: 'Loyalty' },
  { value: 'year', label: 'Release year' },
];

export const GAMES = [{ value: 'paper', label: 'Paper' }, { value: 'arena', label: 'Arena' }, { value: 'mtgo', label: 'MTGO' }];

export const FORMATS: { value: string; label: string }[] = [
  ['standard', 'Standard'], ['future', 'Future Standard'], ['alchemy', 'Alchemy'], ['historic', 'Historic'],
  ['timeless', 'Timeless'], ['gladiator', 'Gladiator'], ['pioneer', 'Pioneer'], ['explorer', 'Explorer'],
  ['modern', 'Modern'], ['legacy', 'Legacy'], ['pauper', 'Pauper'], ['vintage', 'Vintage'], ['penny', 'Penny Dreadful'],
  ['commander', 'Commander'], ['oathbreaker', 'Oathbreaker'], ['standardbrawl', 'Standard Brawl'], ['brawl', 'Brawl'],
  ['paupercommander', 'Pauper Commander'], ['duel', 'Duel Commander'], ['predh', 'PreDH'], ['oldschool', 'Old School'],
  ['premodern', 'Premodern'],
].map(([value, label]) => ({ value, label }));

export const RARITIES = [
  { value: 'common', label: 'Common' }, { value: 'uncommon', label: 'Uncommon' }, { value: 'rare', label: 'Rare' },
  { value: 'mythic', label: 'Mythic' }, { value: 'special', label: 'Special' }, { value: 'bonus', label: 'Bonus' },
];

/** Scryfall's is: criteria, grouped the way the advanced search page lists them. */
export const CRITERIA: { group: string; items: { value: string; label: string }[] }[] = [
  { group: 'Card', items: [
    ['spell', 'Spell'], ['permanent', 'Permanent'], ['historic', 'Historic'], ['party', 'Party'], ['outlaw', 'Outlaw'],
    ['modal', 'Modal'], ['vanilla', 'Vanilla'], ['frenchvanilla', 'French vanilla'], ['bear', 'Bear (2/2 for 2)'],
    ['commander', 'Can be commander'], ['companion', 'Companion'], ['gamechanger', 'Game changer'],
    ['reserved', 'Reserved list'], ['funny', 'Un-card / funny'], ['hybrid', 'Hybrid mana'], ['phyrexian', 'Phyrexian mana'],
  ] },
  { group: 'Layout', items: [
    ['split', 'Split'], ['flip', 'Flip'], ['transform', 'Transform'], ['mdfc', 'Modal DFC'], ['dfc', 'Double-faced'],
    ['meld', 'Meld'], ['leveler', 'Leveler'], ['adventure', 'Adventure'],
  ] },
  { group: 'Lands', items: [
    ['dual', 'Original duals'], ['fetchland', 'Fetch lands'], ['shockland', 'Shock lands'], ['checkland', 'Check lands'],
    ['fastland', 'Fast lands'], ['painland', 'Pain lands'], ['slowland', 'Slow lands'], ['bounceland', 'Bounce lands'],
    ['bikeland', 'Cycling lands'], ['filterland', 'Filter lands'], ['triland', 'Tri-lands'], ['scryland', 'Scry lands'],
    ['gainland', 'Gain lands'], ['tangoland', 'Battle lands'], ['canopyland', 'Horizon lands'], ['creatureland', 'Creature lands'],
    ['surveilland', 'Surveil lands'], ['pathway', 'Pathways'], ['storageland', 'Storage lands'],
  ] },
  { group: 'Printing', items: [
    ['firstprint', 'First printing'], ['reprint', 'Reprint'], ['new', 'New in set'], ['digital', 'Digital only'],
    ['promo', 'Promo'], ['spotlight', 'Story spotlight'], ['booster', 'In boosters'], ['foil', 'Foil'], ['nonfoil', 'Nonfoil'],
    ['etched', 'Etched'], ['fullart', 'Full art'], ['textless', 'Textless'], ['borderless', 'Borderless'],
    ['extendedart', 'Extended art'], ['showcase', 'Showcase'], ['colorshifted', 'Colorshifted'], ['masterpiece', 'Masterpiece'],
    ['hires', 'High-res image'], ['universesbeyond', 'Universes Beyond'],
  ] },
].map(({ group, items }) => ({ group, items: items.map(([value, label]) => ({ value, label })) }));

export const LANGUAGES: { value: string; label: string }[] = [
  ['any', 'Any language'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ru', 'Russian'], ['zhs', 'Simplified Chinese'],
  ['zht', 'Traditional Chinese'], ['he', 'Hebrew'], ['la', 'Latin'], ['grc', 'Ancient Greek'], ['ar', 'Arabic'],
  ['sa', 'Sanskrit'], ['ph', 'Phyrexian'],
].map(([value, label]) => ({ value, label }));

export const COMMON_TYPES = [
  'Legendary', 'Basic', 'Snow', 'World', 'Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Land',
  'Planeswalker', 'Sorcery', 'Aura', 'Equipment', 'Vehicle', 'Saga', 'Class', 'Room', 'Food', 'Treasure', 'Clue',
  'Angel', 'Assassin', 'Beast', 'Cat', 'Cleric', 'Demon', 'Dinosaur', 'Dragon', 'Dwarf', 'Elemental', 'Elf', 'Faerie',
  'Giant', 'Goblin', 'God', 'Horror', 'Human', 'Hydra', 'Knight', 'Merfolk', 'Ninja', 'Pirate', 'Rat', 'Rogue', 'Shaman',
  'Sliver', 'Soldier', 'Sphinx', 'Spirit', 'Vampire', 'Warrior', 'Wizard', 'Zombie',
];

const quote = (s: string) => (/[\s"():]/.test(s) || /^or$|^and$/i.test(s) ? `"${s.replace(/"/g, '')}"` : s);
const anyOf = (terms: string[]) => (terms.length > 1 ? `(${terms.join(' or ')})` : terms[0] ?? '');
const colorStr = (cs: string[]) => cs.filter((c) => c !== 'C').join('').toLowerCase();

/** Turn the form into Scryfall syntax. Empty fields add nothing. */
export function buildAdvanced(a: Adv): string {
  const parts: string[] = [];
  a.name.trim().split(/\s+/).filter(Boolean).forEach((w) => parts.push(`name:${quote(w)}`));
  if (a.oracle.trim()) parts.push(`o:${quote(a.oracle.trim())}`);

  const incl = a.types.filter((t) => t.mode === 'is').map((t) => `t:${quote(t.value)}`);
  const excl = a.types.filter((t) => t.mode === 'not').map((t) => `-t:${quote(t.value)}`);
  if (incl.length) a.typesAny ? parts.push(anyOf(incl)) : parts.push(...incl);
  parts.push(...excl);

  const colored = colorStr(a.colors);
  const cop = a.colorMode === 'including' ? '>=' : a.colorMode === 'exactly' ? '=' : '<=';
  if (colored) parts.push(`c${cop}${colored}`);
  else if (a.colors.includes('C')) parts.push('c=c');

  const ident = colorStr(a.identity);
  if (ident) parts.push(`id<=${ident}`);
  else if (a.identity.includes('C')) parts.push('id=c');

  if (a.mana.trim()) parts.push(`m:${a.mana.replace(/\s+/g, '')}`);
  a.stats.filter((s) => s.value.trim()).forEach((s) => parts.push(`${s.stat}${s.op}${s.value.trim()}`));

  if (a.games.length) parts.push(anyOf(a.games.map((g) => `game:${g}`)));
  a.formats.filter((f) => f.format).forEach((f) => parts.push(`${f.status}:${f.format}`));
  if (a.sets.length) parts.push(anyOf(a.sets.map((s) => `s:${s}`)));
  if (a.block.trim()) parts.push(`b:${quote(a.block.trim())}`);
  if (a.rarities.length) parts.push(anyOf(a.rarities.map((r) => `r:${r}`)));

  Object.entries(a.criteria).forEach(([k, mode]) => parts.push(`${mode === 'not' ? '-' : ''}is:${k}`));
  a.prices.filter((p) => p.value.trim()).forEach((p) => parts.push(`${p.currency}${p.op}${p.value.trim()}`));

  if (a.artist.trim()) parts.push(`a:${quote(a.artist.trim())}`);
  if (a.flavor.trim()) parts.push(`ft:${quote(a.flavor.trim())}`);
  if (a.lore.trim()) parts.push(`lore:${quote(a.lore.trim())}`);
  if (a.lang) parts.push(`lang:${a.lang}`);
  if (a.extras) parts.push('include:extras');

  if (a.owned === 'owned') parts.push('is:owned');
  if (a.owned === 'unowned') parts.push('is:unowned');
  if (a.fav) parts.push('is:fav');
  if (a.tag.trim()) parts.push(`tag:${quote(a.tag.trim())}`);
  return parts.filter(Boolean).join(' ');
}

/** How many filters are set, for the badge on the collapsed Advanced button. */
export function countAdvanced(a: Adv): number {
  let n = 0;
  if (a.name.trim()) n++;
  if (a.oracle.trim()) n++;
  n += a.types.length;
  if (a.colors.length) n++;
  if (a.identity.length) n++;
  if (a.mana.trim()) n++;
  n += a.stats.filter((s) => s.value.trim()).length;
  if (a.games.length) n++;
  n += a.formats.filter((f) => f.format).length;
  if (a.sets.length) n++;
  if (a.block.trim()) n++;
  if (a.rarities.length) n++;
  n += Object.keys(a.criteria).length;
  n += a.prices.filter((p) => p.value.trim()).length;
  [a.artist, a.flavor, a.lore, a.tag].forEach((s) => s.trim() && n++);
  if (a.lang) n++;
  if (a.extras) n++;
  if (a.owned) n++;
  if (a.fav) n++;
  if (a.unique !== 'cards') n++;
  if (a.dir !== 'auto') n++;
  return n;
}
