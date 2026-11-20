// ---------- Scryfall card snapshot (trimmed to what the app uses) ----------

export interface ImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
}

export interface CardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string[];
  image_uris?: ImageUris;
  artist?: string;
}

export interface Prices {
  usd?: string | null;
  usd_foil?: string | null;
  usd_etched?: string | null;
  eur?: string | null;
  tix?: string | null;
}

export type Legality = 'legal' | 'not_legal' | 'banned' | 'restricted';

export interface Card {
  id: string;
  oracle_id?: string;
  name: string;
  layout: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string[];
  color_identity: string[];
  produced_mana?: string[];
  keywords?: string[];
  legalities: Record<string, Legality>;
  prices: Prices;
  image_uris?: ImageUris;
  card_faces?: CardFace[];
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  artist?: string;
  released_at?: string;
  scryfall_uri?: string;
  prints_search_uri?: string;
  edhrec_rank?: number;
  game_changer?: boolean;
  // Print identification (collection tracking)
  finishes?: string[]; // 'nonfoil' | 'foil' | 'etched'
  frame_effects?: string[]; // 'showcase', 'extendedart', 'etched', 'inverted', ...
  promo_types?: string[];
  full_art?: boolean;
  border_color?: string; // 'black' | 'borderless' | ...
  promo?: boolean;
  lang?: string;
}

export interface ScryfallList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  next_page?: string;
  total_cards?: number;
  not_found?: unknown[];
}

// ---------- Decks ----------

export type Board = 'main' | 'side' | 'maybe';
export type DeckStatus = 'in-progress' | 'finished';

export interface DeckEntry {
  uid: string; // stable per-entry id (survives printing changes)
  qty: number;
  board: Board;
  card: Card;
  favorite?: boolean;
  /** Per-deck card tags (role in this deck, e.g. "ramp", "wincon"); never shared across decks. */
  tags?: string[];
}

export interface Deck {
  id: string;
  name: string;
  format: string; // FormatDef id
  status: DeckStatus;
  commanderUid?: string;
  entries: DeckEntry[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
  pricesUpdatedAt?: number;
  favorite?: boolean;
  tags?: string[];
}

// ---------- Collection ----------

export type Finish = 'nonfoil' | 'foil' | 'etched';
export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
/** Market status: what you plan to do with this lot. */
export type Intent = 'hold' | 'sell' | 'trade' | 'sell-trade' | 'buy';

/** One "lot": a single print + finish + condition + purchase. */
export interface CollectionItem {
  id: string;
  card: Card; // snapshot of the exact print (refreshed for prices)
  finish: Finish;
  qty: number;
  condition?: Condition;
  purchasePrice?: number; // per copy, USD
  acquiredAt?: string; // YYYY-MM-DD
  source?: string;
  tags: string[];
  favorite: boolean;
  intent?: Intent;
  targetPrice?: number; // sell-at (sell/trade) or buy-at (buy), per copy
  allocations: Record<string, number>; // deckId -> copies committed
  notes?: string;
  /** Lot came from a deck bought as a whole (precon, bulk deck purchase). */
  purchasedDeckId?: string;
  addedAt: number;
  updatedAt: number;
}

export type SaleVenue = 'online' | 'in-person' | 'other';

/** A deck bought as a whole. Its cards are ordinary collection lots tagged with purchasedDeckId. */
export interface PurchasedDeck {
  id: string;
  name: string;
  deckId?: string; // linked deck in "Your Decks"
  purchasePrice?: number; // total paid for the deck
  acquiredAt?: string;
  source?: string;
  notes?: string;
  cardsAtPurchase: number;
  valueAtPurchase?: number;
  status: 'owned' | 'sold';
  sold?: { date: string; price: number; venue?: SaleVenue; channel?: string; counterparty?: string; notes?: string };
  createdAt: number;
  updatedAt: number;
}

/** A card you want but don't (necessarily) own, with an optional buy-at target. */
export interface WatchItem {
  id: string;
  card: Card;
  finish: Finish;
  qty: number;
  targetPrice?: number;
  notes?: string;
  favorite?: boolean;
  addedAt: number;
  updatedAt: number;
}

/**
 * bought   — cards added to the collection (purchase, gift, opened…)
 * received — cards that came in through a trade
 * sold     — cards sold (cash)
 * traded   — cards given away in a trade
 */
export type TxKind = 'bought' | 'received' | 'sold' | 'traded';

/** One line in the transaction ledger. Sold/traded rows are the record of cards no longer in the collection. */
export interface SaleRecord {
  id: string;
  kind: TxKind;
  card: Card;
  finish: Finish;
  qty: number;
  /** Per copy: paid (bought/received) or proceeds (sold/traded). */
  price?: number;
  costBasis?: number; // sold/traded: per copy paid, if known
  date: string; // YYYY-MM-DD
  venue?: SaleVenue;
  channel?: string; // retailer / place
  counterparty?: string; // buyer, seller or trade partner
  condition?: Condition;
  acquiredAt?: string; // sold/traded: when the copies were acquired
  source?: string; // sold/traded: where they came from
  notes?: string;
  groupId?: string; // copies that moved together (a deck sale, a trade, a bulk sale)
  groupLabel?: string;
  lotId?: string;
  purchasedDeckId?: string;
  createdAt: number;
  updatedAt: number;
}
export type Transaction = SaleRecord;

/** Daily price snapshot: card id -> [usd, usd_foil, usd_etched] (null where unpriced). */
export interface PriceSnapshot {
  id: string; // YYYY-MM-DD
  prices: Record<string, [number | null, number | null, number | null]>;
  createdAt: number;
  updatedAt: number;
}

/** Global tags on a card: by card name, so they follow the card into every deck and printing. */
export interface GlobalCardTags {
  id: string; // card name
  /** Snapshot of a printing, so tagged cards you don't own or use can still be listed. */
  card?: Card;
  tags: string[];
  updatedAt: number;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  createdAt: number;
  updatedAt: number;
}

export type TypeCategory =
  | 'Commander'
  | 'Creature'
  | 'Planeswalker'
  | 'Battle'
  | 'Instant'
  | 'Sorcery'
  | 'Artifact'
  | 'Enchantment'
  | 'Land'
  | 'Other';

export interface DeckFilter {
  cmc?: number; // 7 means 7+
  type?: TypeCategory;
  color?: string; // W U B R G C
  text?: string;
}
