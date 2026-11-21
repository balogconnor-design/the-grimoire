// Build the bundled Scryfall tag data: node scripts/build-scryfall-tags.mjs
//
// Scryfall can't list a card's oracle tags, only the cards that have a tag (`otag:` searches), so this
// script searches each tag once and writes src/data/scryfall-tags.json. The app ships that file and
// never asks Scryfall for tags at runtime. Re-run it when new sets come out (a few times a year), then
// commit the updated file. About 300 searches, one at a time with a pause between (Scryfall asks for
// no more than ~10 requests a second; searches are limited more tightly), so it takes ~7 minutes.
//
// The tag list and its order live in src/lib/scryfallTagList.json (shared with the app): the order is
// the priority used to pick a card's section when a deck is grouped by tag.
import { readFileSync, writeFileSync } from 'node:fs';

const TAGS = JSON.parse(readFileSync(new URL('../src/lib/scryfallTagList.json', import.meta.url), 'utf8'));
const OUT = new URL('../src/data/scryfall-tags.json', import.meta.url);
const GAP_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Values of the "name" column of a Scryfall CSV page (quoted fields may hold commas and quotes). */
function names(csv) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const col = rows[0]?.indexOf('name') ?? -1;
  return col < 0 ? [] : rows.slice(1).map((r) => r[col]).filter(Boolean);
}

async function tagCards(otag) {
  const out = [];
  for (let page = 1; page < 200; page++) {
    const url = `https://api.scryfall.com/cards/search?${new URLSearchParams({ q: `otag:${otag}`, format: 'csv', unique: 'cards', page: String(page) })}`;
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, { headers: { Accept: 'text/csv', 'User-Agent': 'TheGrimoire-tag-builder/1.0' } });
      if (res.status !== 429 || attempt >= 3) break;
      await sleep(5000 * (attempt + 1)); // asked to slow down: wait and retry
    }
    if (res.status === 404 || res.status === 422) break; // no results / past the last page
    if (!res.ok) throw new Error(`otag:${otag} page ${page}: Scryfall answered ${res.status}`);
    const batch = names(await res.text());
    out.push(...batch);
    await sleep(GAP_MS);
    if (batch.length < 175) break;
  }
  return [...new Set(out)];
}

const lists = [];
for (const t of TAGS) {
  const cards = await tagCards(t.otag);
  if (!cards.length) throw new Error(`otag:${t.otag} returned no cards: check the tag name`);
  lists.push(cards);
  console.log(`${t.label.padEnd(22)} ${cards.length}`);
}

// Compact form: every card name once, and per tag the positions of its cards in that list.
const allNames = [...new Set(lists.flat())].sort();
const index = new Map(allNames.map((n, i) => [n, i]));
const data = {
  generated: new Date().toISOString().slice(0, 10),
  source: 'Scryfall Tagger oracle tags (otag: searches), https://scryfall.com',
  tags: TAGS.map((t) => t.otag),
  names: allNames,
  cards: lists.map((l) => l.map((n) => index.get(n)).sort((a, b) => a - b)),
};
writeFileSync(OUT, JSON.stringify(data));
console.log(`\n${TAGS.length} tags, ${allNames.length} cards, ${lists.reduce((n, l) => n + l.length, 0)} tag entries -> src/data/scryfall-tags.json`);
