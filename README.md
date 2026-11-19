# The Grimoire — MTG Deck Builder

A browser-based deck builder and collection tracker for Magic: The Gathering, focused on Commander. Card data and images come from the [Scryfall API](https://scryfall.com/docs/api).

Everything is stored locally in your browser (IndexedDB). There's no account, no server and no sync. Use **Backup** to keep a copy of your data or move it to another computer.

## Run it

```
npm install      # first time only
npm run dev      # opens http://localhost:5173
```

On Windows you can also double-click `Start The Grimoire.bat`, which installs dependencies if needed and opens the app.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with live reload |
| `npm run build` | Static build in `dist/` |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest suite (unit, storage and import tests; no network needed) |

> Internal names: the IndexedDB database and the backup file's `app` key are still `deckforge` (the project's old name). They must not be renamed, or existing data and old backups stop loading.

## Portable (flash drive) build

The portable build is the release distribution. Double-click `Build Portable.bat` (needs `npm install` once). It type-checks,
runs the tests, builds the app and produces:

- `Portable Build\The Grimoire\`: copy this folder to a drive and run `The Grimoire.exe`.
- `Portable Build\The-Grimoire-<version>-portable.zip`: the same folder zipped for sharing (never includes a `data\` folder).

The launcher (`portable/Launcher.cs`, compiled with the csc.exe built into Windows) serves the app on `http://localhost:47823` and
opens it in an Edge/Chrome app window. That window's browser profile lives in the folder's `data\`, so saved data travels with the
drive. The port must never change, because the browser ties saved data to it. The portable app and the dev server (port 5173)
keep separate data; use **Backup** to move data between them. The `.exe` icon is made from `src/assets/grimoire-logo.png`, and its
version comes from `package.json`. Re-run the build after code changes; the `data\` folder is left alone. To update a copy on a
drive, replace the `.exe` and `app\` and keep `data\`.

## Features

### Decks
- **Library:** all saved decks, filterable by status (In progress / Finished) and format, with a search for decks containing a card.
- **New deck or import:** start empty, or **Import deck** from pasted text or a `.txt` file (Moxfield, Archidekt, MTGO and Arena formats). The deck is named after its commander, otherwise the file name. Cards come in as their default printing; change printings later in the deck.
- **Import results:** shows how many cards were added and lists any that couldn't be found, each with a button that searches for it. Two-faced and split cards (e.g. `Tony Stark // The Invincible Iron Man`, `Fire // Ice`) are matched by their full name.
- **Formats:** every Scryfall-tracked format, each with its own size, copy-limit, sideboard and legality rules.
- **Commander:** set a commander, shown with its art. Its color identity limits search results, the basic land adder and legality checks.
- **Boards:** Main, Sideboard and Maybeboard. Export decklists as text.
- **Deck details:** card counter (e.g. `73/100`), a requirements checklist, prices, a clickable mana curve, color split (pips, %, land sources) and a type breakdown.
- **Tags and favorites:** tag decks, tag cards within a deck, and mark favorites.

### Search
- **Scryfall search:** full Scryfall syntax plus an advanced filter builder, sort options and paging.
- **Collection-aware filters:** mix in local terms such as `is:owned`, `is:fav`, `tag:ramp`, `deck:atraxa`, `qty>=2`, `paid<10` or `gain>=50`. A query with only local terms searches the cards you own or use in decks.
- **Saved searches:** keep favorite queries, shared across the main search, deck search and collection search.
- **Card view:** art (both faces), Oracle text, legality in every format, price, and a printing/art picker.

### Collection
- **Inventory:** every lot with its printing, finish, condition, quantity, purchase price, source, tags and notes. Search, filter and act on many lots at once.
- **Add cards:** from a Scryfall search, a pasted list (which keeps set and collector number), or a saved deck.
- **Overview:** collection value over time, top gainers and losers, big price moves, price alerts, and how much of each deck you own.
- **Deck coverage:** decks match your collection by card name, so any printing you own counts. Copies are shared across decks, and you can reserve copies for one deck.
- **Buy list:** the cards your decks still need, with a cheapest-printing finder, plus your watchlist and "buy more" cards.
- **Trade binder:** cards you've marked for sale or trade, with target prices and a downloadable list.
- **Watchlist:** cards you want, with target-price alerts.
- **Prices:** refresh prices from Scryfall; each refresh saves a daily snapshot used for trends and history.

### Transactions and earnings
- **Ledger:** every purchase, sale and card-for-card trade, filterable (including a **Trades** filter) and exportable to CSV. The export follows the active filter.
- **Sales and trades:** sell one or more lots, sell a whole deck, or record a trade. Received cards take their trade value as cost basis.
- **Purchased decks:** record a deck you bought (e.g. a precon); its price is split across the cards so the per-card costs add up exactly to what you paid.
- **Earnings summary:** realized gain/loss by week, month, quarter or year. Trades are kept out of the earnings and shown separately (cards traded away and cards received).

### Backup and restore
- **Exports:** collection as text or CSV, purchase and sale reports, and a full JSON backup of decks, collection, ledger, watchlist, price history, saved searches and settings.
- **Restore:** checks the file first and shows what it contains, including any incomplete records it will skip. Restore is all-or-nothing: if anything fails, nothing is changed.

### Reliability
- Changes that touch several kinds of data (selling, trading, buying a deck, deleting a deck, restoring) are saved in a single transaction, so a failed save never leaves things half-done.
- If a save fails, the app says so and reloads the affected data from storage, so what you see matches what is saved.

## Code map

| Path | What it does |
|---|---|
| `src/lib/scryfall.ts` | API client: request throttling, search, collection lookup, printings, symbol images |
| `src/lib/cardLookup.ts` | Decklist/collection-list card matching (batched lookup + exact-name retry) |
| `src/lib/formats.ts` | Format definitions and deck requirements |
| `src/lib/rules.ts` | MTG rules: color identity, commander eligibility, copy limits, validation, stats |
| `src/lib/actions.ts` | Deck changes, basic lands, tags, decklist import/export |
| `src/lib/collection.ts` | Collection lots, pricing, cost splitting, realized gain/loss, price snapshots |
| `src/lib/ledger.ts` | Trades, buying/selling decks, period summaries, CSV exports |
| `src/lib/ownership.ts` | Matching decks against the collection, shared copy pool, buy list |
| `src/lib/query.ts`, `search.ts` | Local search syntax and mixed Scryfall + local queries |
| `src/lib/store.ts` | IndexedDB persistence, multi-store transactions (`transact`), save-error reporting, React hooks |
| `src/lib/backup.ts` | Exports, full backup, validated all-or-nothing restore, backup migrations |
| `src/pages/` | Library, deck builder, collection and ledger screens |
| `src/components/` | Search, deck list, details panel, card modal, import/export, backup, transaction dialogs, etc. |
| `tests/` | Vitest unit, storage (fake-indexeddb) and import tests, with decklist fixtures |

## License

The code is released under the [MIT License](LICENSE). This covers the app's own code only, not Magic: The Gathering card names, text, symbols or artwork (see below).

## Unofficial fan content

The Grimoire is unofficial fan content. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast. Magic: The Gathering, card names, text, symbols and artwork are the property of Wizards of the Coast LLC and the artists. Card images and data are provided by Scryfall.
