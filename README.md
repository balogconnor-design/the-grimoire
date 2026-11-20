# The Grimoire — MTG Deck Builder

A browser-based deck builder and collection tracker for Magic: The Gathering, focused on Commander. Card data and images come from the [Scryfall API](https://scryfall.com/docs/api).

Everything is stored locally in your browser (IndexedDB). There's no account, no server and no sync. Use **Collection → Export & backup** to keep a copy of your data or move it to another device.

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
| `npm run build:web` | Tests, then the static build (what Cloudflare Pages runs) |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest suite (unit, storage and import tests; no network needed) |
| `npm run test:e2e` | Builds, then runs the Playwright smoke tests in Chromium, Firefox, WebKit and phone emulation (first time: `npx playwright install chromium firefox webkit`) |

> Internal names: the IndexedDB database and the backup file's `app` key are still `deckforge` (the project's old name). They must not be renamed, or existing data and old backups stop loading.

## Testing and CI

- **Unit tests** (`npm test`, `tests/`): Vitest with an in-memory IndexedDB.
- **Smoke tests** (`npm run test:e2e`, `e2e/`, `playwright.config.ts`): the production build served by `vite preview`, in
  desktop Chromium, Firefox and WebKit (Safari's engine) plus Android and iPhone emulation. They cover loading, saving a deck,
  card search, every collection tab, no sideways scrolling, backup → restore into a fresh browser, and working offline
  (Chromium only, the one engine Playwright can run service workers in). Scryfall is mocked with a saved card
  (`e2e/fixtures/sol-ring.json`), so no network is needed.
- **GitHub Actions** (`.github/workflows/ci.yml`) runs typecheck, unit tests, build and smoke tests on every pull request and
  push to `main`. A failed run uploads the Playwright report. It uses about 5 of the 2,000 free monthly minutes per run.
- **Debug console on previews:** Cloudflare branch previews (not `main`, not local builds) include Eruda, an on-page console
  opened from a gear button, for checking errors on a phone without a computer attached.
- **Not automated:** real Safari on a Mac, real phones, and the installed app. Check those on a preview URL before merging
  anything that changes layout, storage or installing.

## Web version (Cloudflare Pages)

The same static build is hosted free on Cloudflare Pages at **https://the-grimoire.app**. There's no server: the browser
calls Scryfall directly and saves everything in that browser, as in the other versions.

- **Addresses:** `the-grimoire.app` is the only production address. The Pages project is `the-grimoire`, and
  its default address `the-grimoire-4rq.pages.dev` and `www.the-grimoire.app` both redirect to it (a Bulk Redirect and a Redirect Rule),
  so nobody ends up saving data on a second address. The domain's DNS is on Cloudflare.
- **Deploys:** Cloudflare builds from GitHub on every push. `main` is production; every other branch gets its own preview URL
  (`<branch>.the-grimoire-4rq.pages.dev`, not redirected). Preview URLs keep their own data, separate from production.
- **Build settings:** build command `npm run build:web` (a failing test blocks the deploy), output directory `dist`, Node version
  from `.node-version`.
- **Headers:** `public/_headers` sets the security headers (the Content-Security-Policy allows only `api.scryfall.com` and
  `*.scryfall.io`, for both images and the service worker's fetches, so a new outside source must be added there or it will be blocked) and long caching for `assets/`. The portable
  build leaves this file out. To test it locally, run `npx wrangler pages dev dist` after a build.
- **The address must never change.** Like the portable port, saved data is tied to `https://the-grimoire.app`; moving to another
  address (including switching to `www.` or letting the domain lapse) leaves every user's data behind unless they back up and
  restore. Keep the domain on auto-renew.
- The web version, the portable app and the dev server each keep separate data; use **Export & backup** to move it between them.
- **Installable app and offline (PWA):** `vite-plugin-pwa` (config in `vite.config.ts`) builds `manifest.webmanifest` and a
  service worker (`sw.js`). The service worker precaches the app so it opens offline, and caches Scryfall card images (up to 600,
  60 days) and mana symbols as they're viewed. The Scryfall API is never cached, so search results and prices are always live.
  `src/components/UpdatePrompt.tsx` registers it and shows "A new version is available" with a Reload button when a deploy lands
  (it also checks hourly). The dev server never registers a service worker, and the portable build (port 47823) skips it too,
  because the launcher already works offline. To try it locally: `npm run build`, then `npx wrangler pages dev dist`.
- **Icons:** `public/icons/` is made from `src/assets/grimoire-logo.png` by
  `powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1`. Re-run it after changing the logo. The logo is 192×192, so the
  512px icons are enlarged; a 512px-or-larger logo would make them sharp.

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
- **Restore:** checks the file first and shows what it contains, including any incomplete records it will skip. Restore is all-or-nothing: if anything fails, nothing is changed. A brand-new, empty library also offers **Restore a backup**, for moving in from another device or browser.
- **Phones and tablets:** backups and exports open the share sheet (Save to Files, Drive, AirDrop, email…) instead of downloading, which is more reliable there. If the share is cancelled, nothing counts as backed up, and a restore that was set to back up first doesn't go ahead.

### Keeping your data safe
- **Backup reminder:** once you have decks, a collection or a watchlist, a bar reminds you if you've never backed up or the last backup is over a month old. **Remind me in a week** snoozes it.
- **Storage protection:** the app asks the browser to protect its saved data from being cleared when the device runs low on space. The backup screen shows whether the browser granted it (Chrome and Edge decide on their own, often only for installed or frequently used sites; Firefox may ask).
- **iPhone and iPad:** in a Safari tab, a one-time bar explains installing to the home screen. Safari can clear a website's data after 7 days without a visit, and the installed app keeps its own data, separate from Safari (so install first, or back up and restore in the app).

### Reliability
- Changes that touch several kinds of data (selling, trading, buying a deck, deleting a deck, restoring) are saved in a single transaction, so a failed save never leaves things half-done.
- If a save fails, the app says so and reloads the affected data from storage, so what you see matches what is saved.

### Phones and tablets
- **Layout:** works down to phone width with no sideways page scrolling. The deck builder switches to Search / Deck / Details tabs; collection, ledger, buy list, binder and watchlist tables turn into one card per row with labelled values; dialogs fill the screen with the close button always in reach; advanced search is one column.
- **Touch:** text boxes use 16px text on touch screens so iPhones don't zoom in when you tap them, small buttons get bigger tap targets, and deck rows use two lines (name and price, then mana cost and row buttons) so card names stay readable.
- **Installed app:** leaves room for the notch, rounded corners and home bar.

### Install and offline (web version)
- **Install:** add The Grimoire to your home screen or desktop like an app (Chrome/Edge: the install icon in the address bar; Android: *Install app*; iPhone/iPad: Safari → Share → *Add to Home Screen*). It opens in its own window with its own icon.
- **Offline:** after the first visit the app opens without a connection, and decks, collection and ledger all work. Card images you have already viewed are kept for offline use; searching Scryfall and refreshing prices need a connection.
- **Updates:** when a new version is published, a bar offers **Reload** (or **Later**), so an update never interrupts you mid-edit.

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
| `src/lib/backup.ts` | Exports (share sheet on phones, download elsewhere), full backup, validated all-or-nothing restore, backup migrations |
| `src/pages/` | Library, deck builder, collection and ledger screens |
| `src/lib/device.ts` | Device checks (iOS, installed app, phone share sheet, portable) and data-safety rules: backup reminder, storage protection |
| `src/components/DataSafety.tsx` | App-wide backup reminder, iPhone install hint, storage-protection request |
| `src/components/LabeledTable.tsx` | Table that labels each cell with its column name, so tables can stack into cards on phones |
| `src/components/UpdatePrompt.tsx` | Service worker registration (offline support) and the new-version prompt; skipped in the portable build |
| `vite.config.ts` | Build config, including the web app manifest and service worker caching rules |
| `scripts/make-icons.ps1` | Makes the web app icons in `public/icons/` from the logo |
| `src/components/` | Search, deck list, details panel, card modal, import/export, backup, transaction dialogs, etc. |
| `e2e/` | Playwright smoke tests and the Scryfall mock they use |
| `tests/` | Vitest unit, storage (fake-indexeddb), import and device/data-safety tests, with decklist fixtures |

## License

The code is released under the [MIT License](LICENSE). This covers the app's own code only, not Magic: The Gathering card names, text, symbols or artwork (see below).

## Unofficial fan content

The Grimoire is unofficial fan content. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast. Magic: The Gathering, card names, text, symbols and artwork are the property of Wizards of the Coast LLC and the artists. Card images and data are provided by Scryfall.
