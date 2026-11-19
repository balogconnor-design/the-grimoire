export interface FormatDef {
  id: string;
  name: string;
  /** Key in Scryfall's `legalities` object; undefined = no legality checks (casual). */
  legalityKey?: string;
  /** Scryfall search keyword for `f:` filtering. */
  searchKey?: string;
  deckSize: number;
  /** true = deck must be exactly deckSize; false = minimum. */
  exact: boolean;
  maxCopies: number; // 1 = singleton
  sideboardMax?: number; // undefined = sideboard not used / not checked
  hasCommander: boolean;
  /** Planeswalkers may be commanders (Brawl, Oathbreaker). */
  planeswalkerCommander?: boolean;
  description: string;
  group: 'Commander' | 'Constructed' | 'Digital' | 'Other';
}

export const FORMATS: FormatDef[] = [
  {
    id: 'commander', name: 'Commander (EDH)', legalityKey: 'commander', searchKey: 'commander',
    deckSize: 100, exact: true, maxCopies: 1, hasCommander: true, group: 'Commander',
    description: 'Exactly 100 cards including your commander. Singleton (except basic lands). Every card must be within the commander\'s color identity.',
  },
  {
    id: 'paupercommander', name: 'Pauper Commander', legalityKey: 'paupercommander', searchKey: 'paupercommander',
    deckSize: 100, exact: true, maxCopies: 1, hasCommander: true, group: 'Commander',
    description: '100-card singleton. Commons only; your commander is an uncommon creature. Color identity applies.',
  },
  {
    id: 'brawl', name: 'Brawl', legalityKey: 'brawl', searchKey: 'brawl',
    deckSize: 100, exact: true, maxCopies: 1, hasCommander: true, planeswalkerCommander: true, group: 'Commander',
    description: '100-card singleton using the Arena card pool. Legendary creature or planeswalker commander. Color identity applies.',
  },
  {
    id: 'standardbrawl', name: 'Standard Brawl', legalityKey: 'standardbrawl', searchKey: 'standardbrawl',
    deckSize: 60, exact: true, maxCopies: 1, hasCommander: true, planeswalkerCommander: true, group: 'Commander',
    description: '60-card singleton using Standard-legal cards. Legendary creature or planeswalker commander.',
  },
  {
    id: 'oathbreaker', name: 'Oathbreaker', legalityKey: 'oathbreaker', searchKey: 'oathbreaker',
    deckSize: 60, exact: true, maxCopies: 1, hasCommander: true, planeswalkerCommander: true, group: 'Commander',
    description: '60-card singleton led by a planeswalker (your Oathbreaker). Color identity applies.',
  },
  {
    id: 'duel', name: 'Duel Commander', legalityKey: 'duel', searchKey: 'duel',
    deckSize: 100, exact: true, maxCopies: 1, hasCommander: true, group: 'Commander',
    description: '1v1 Commander with its own banlist. 100-card singleton, color identity applies.',
  },
  {
    id: 'predh', name: 'PreDH', legalityKey: 'predh', searchKey: 'predh',
    deckSize: 100, exact: true, maxCopies: 1, hasCommander: true, group: 'Commander',
    description: 'Commander using only cards printed before Commander 2011.',
  },
  ...(
    [
      ['standard', 'Standard'], ['pioneer', 'Pioneer'], ['modern', 'Modern'], ['legacy', 'Legacy'],
      ['vintage', 'Vintage'], ['pauper', 'Pauper'], ['premodern', 'Premodern'], ['oldschool', 'Old School'],
      ['penny', 'Penny Dreadful'],
    ] as const
  ).map(([id, name]): FormatDef => ({
    id, name, legalityKey: id, searchKey: id, deckSize: 60, exact: false, maxCopies: 4, sideboardMax: 15,
    hasCommander: false, group: 'Constructed',
    description:
      `Minimum 60 cards, up to 4 copies of any card except basic lands, sideboard up to 15.` +
      (id === 'vintage' ? ' Restricted cards are limited to 1 copy.' : '') +
      (id === 'pauper' ? ' Commons only.' : ''),
  })),
  ...(
    [
      ['historic', 'Historic'], ['timeless', 'Timeless'], ['explorer', 'Explorer'], ['alchemy', 'Alchemy'],
    ] as const
  ).map(([id, name]): FormatDef => ({
    id, name, legalityKey: id, searchKey: id, deckSize: 60, exact: false, maxCopies: 4, sideboardMax: 15,
    hasCommander: false, group: 'Digital',
    description: `MTG Arena format. Minimum 60 cards, up to 4 copies, sideboard up to 15.` +
      (id === 'timeless' ? ' Restricted cards are limited to 1 copy.' : ''),
  })),
  {
    id: 'gladiator', name: 'Gladiator', legalityKey: 'gladiator', searchKey: 'gladiator',
    deckSize: 100, exact: false, maxCopies: 1, hasCommander: false, group: 'Digital',
    description: 'Arena singleton format: minimum 100 cards, no commander, no sideboard.',
  },
  {
    id: 'casual', name: 'Casual / Freeform', deckSize: 60, exact: false, maxCopies: Infinity,
    hasCommander: false, group: 'Other', description: 'No restrictions. Kitchen-table anything goes.',
  },
];

export const FORMAT_MAP: Record<string, FormatDef> = Object.fromEntries(FORMATS.map((f) => [f.id, f]));

export function getFormat(id: string): FormatDef {
  return FORMAT_MAP[id] ?? FORMAT_MAP.casual;
}

export const LEGALITY_LABELS: Record<string, string> = Object.fromEntries(
  FORMATS.filter((f) => f.legalityKey).map((f) => [f.legalityKey!, f.name.replace(' (EDH)', '')]),
);
