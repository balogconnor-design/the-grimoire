import { expect, test, type Page } from '@playwright/test';
import { mockScryfall, SOL_RING } from './scryfall';

// Errors the app logs or throws fail the test (Scryfall is mocked, so there's no network noise).
function watchErrors(page: Page) {
  const errors: string[] = [];
  // WebKit reports the background Scryfall tag download (CSV) as an error when a test navigates
  // away mid-request. The app already catches it, so it isn't a failure.
  const cancelledTagDownload = (m: string) => /format=csv/.test(m) && /access control checks|cancelled|aborted/i.test(m);
  page.on('pageerror', (e) => { if (!cancelledTagDownload(e.message)) errors.push(`pageerror: ${e.message}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !cancelledTagDownload(m.text())) errors.push(`console: ${m.text()}`); });
  return errors;
}

async function open(page: Page, path = '/') {
  await mockScryfall(page);
  await page.goto(path);
  await expect(page.locator('.topbar')).toBeVisible();
}

async function createDeck(page: Page, name: string) {
  await page.getByRole('button', { name: '+ New deck' }).first().click();
  await page.locator('.new-deck-form input').first().fill(name);
  await page.locator('.new-deck-form button[type=submit]').click();
  await expect(page).toHaveURL(/#\/deck\//);
}

/** Scryfall oracle tags are opt-in: open their settings with `opener` and turn them on. */
async function turnOnOracleTags(page: Page, opener: ReturnType<Page['locator']>) {
  await opener.click();
  const modal = page.locator('.modal', { hasText: 'Use Scryfall oracle tags' });
  await modal.getByLabel('Use Scryfall oracle tags').check();
  await modal.getByRole('button', { name: 'Done' }).click();
  await expect(modal).toHaveCount(0);
}

test('loads, with the data notice and no errors', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await expect(page).toHaveTitle(/The Grimoire/);
  await expect(page.locator('.footer-data')).toContainText('saved only in this browser');
  await expect(page.getByRole('heading', { name: 'Build your first deck' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a new deck is saved and survives a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'Smoke Test Elves');
  await page.goto('/');
  await page.reload();
  await expect(page.locator('.deck-grid')).toContainText('Smoke Test Elves');
  expect(errors).toEqual([]);
});

test('card search shows results and opens a card', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  const box = page.locator('.search-form input').first();
  await box.fill('sol ring');
  await box.press('Enter');
  const result = page.locator('.result-card').first();
  await expect(result).toContainText('Sol Ring');
  await result.locator('.result-img-btn').click();
  await expect(page.locator('.modal')).toContainText('Sol Ring');
  expect(errors).toEqual([]);
});

test('advanced search builds a Scryfall query on the main page', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  const sent: string[] = [];
  // Scryfall tag downloads (format=csv) run in the background; only record the user's searches.
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/cards/search' && u.searchParams.get('format') !== 'csv') sent.push(u.searchParams.get('q') ?? ''); });
  await page.getByRole('button', { name: /Advanced/ }).first().click();
  const adv = page.locator('.advanced');
  await adv.getByRole('button', { name: 'Color: G' }).click();
  await adv.getByLabel('Add a type').fill('Creature');
  await adv.getByLabel('Add a type').press('Enter');
  await adv.getByRole('button', { name: 'Arena' }).click();
  await adv.getByLabel('Add a set').fill('c21');
  await adv.getByLabel('Add a set').press('Enter');
  await expect(page.locator('.query-preview')).toContainText('t:Creature c>=g game:arena s:c21');
  await adv.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.result-card').first()).toContainText('Sol Ring');
  expect(sent.at(-1)).toBe('t:Creature c>=g game:arena s:c21');
  expect(errors).toEqual([]);
});

test('deck search adds to the board shown, by + button and by drag and drop', async ({ page, isMobile, browserName }) => {
  test.skip(!!isMobile, 'drag and drop is a desktop feature; phones show one column at a time');
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'Board Test');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await expect(result).toContainText('Sol Ring');
  const tab = (name: string) => page.locator('.board-tabs .tab', { hasText: name });

  // + adds to the board shown in the deck list.
  await tab('Sideboard').click();
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to sideboard' }).click();
  await expect(tab('Sideboard').locator('.tab-count')).toHaveText('1');
  await expect(tab('Main').locator('.tab-count')).toHaveText('0');

  // Dropping on the list adds to the board shown; dropping on a tab adds to that board.
  // (Playwright can't drive HTML drag and drop in WebKit on Windows/Linux; Safari itself supports it.)
  if (browserName === 'webkit') return;
  await tab('Main').click();
  // Record the drag picture: it must be a tile-sized element, not the full-size image file.
  await page.evaluate(() => {
    const orig = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function (el: Element, x: number, y: number) {
      const r = (el as HTMLElement).getBoundingClientRect();
      (window as unknown as { dragPic: unknown }).dragPic = { tag: el.tagName, w: r.width, h: r.height };
      return orig.call(this, el, x, y);
    };
  });
  await result.locator('.result-art').dragTo(page.locator('.deck-groups'));
  const pic = await page.evaluate(() => (window as unknown as { dragPic?: { tag: string; w: number; h: number } }).dragPic);
  expect(pic?.tag).toBe('DIV');
  expect(pic!.w).toBeLessThanOrEqual(180);
  expect(pic!.h).toBeLessThanOrEqual(260);
  await expect(tab('Main').locator('.tab-count')).toHaveText('1');
  await result.locator('.result-art').dragTo(tab('Maybeboard'));
  await expect(tab('Maybeboard').locator('.tab-count')).toHaveText('1');
  await expect(tab('Maybeboard')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('draw odds panel shows and updates the chance per card type', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'phones show the details panel on its own tab; the math is covered by unit tests');
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'Odds Test');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();
  const odds = page.locator('.detail-section', { has: page.getByRole('heading', { name: 'Draw odds' }) });
  await odds.scrollIntoViewIfNeeded();
  await expect(odds).toContainText('1 in library · 7 cards seen');
  const artifact = odds.locator('tr', { hasText: 'Artifact' });
  await expect(artifact).toContainText('100%');
  await odds.getByLabel('At least this many').selectOption('2');
  await expect(artifact).toContainText('0%');
  await odds.getByLabel('In first cards').selectOption('10');
  await expect(odds).toContainText('= turn 4');
  await odds.getByLabel('On the draw').check();
  await expect(odds).toContainText('= turn 3');
  await expect(odds).toContainText('10 cards seen');
  await page.screenshot({ path: 'test-results/draw-odds.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('bracket estimate shows the bracket and keeps a target bracket', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'phones show the details panel on its own tab; the rules are covered by unit tests');
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'Bracket Test');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();
  const panel = page.locator('.detail-section', { has: page.getByRole('heading', { name: 'Bracket estimate' }) });
  await expect(panel.locator('.bracket-badge')).toHaveText('Bracket 1–2'); // shown while folded
  await expect(panel.getByRole('button', { name: '2', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Bracket estimate' }).click();
  await panel.getByRole('button', { name: '2', exact: true }).click();
  await expect(panel).toContainText('Cards fit Bracket 2 (Core)');
  await page.reload();
  // The section stays open after a reload (your choice is remembered) and so does the target.
  await expect(panel.getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('EDHREC stays off until turned on, then shows salt scores', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'phones show the details panel on its own tab; the data handling is covered by unit tests');
  const errors = watchErrors(page);
  const edhrec: string[] = [];
  await page.route('https://json.edhrec.com/**', (route) => {
    edhrec.push(route.request().url());
    const body = { container: { json_dict: { cardlists: [{ header: '', cardviews: [{ name: 'Sol Ring', salt: 1.59 }, { name: 'Stasis', salt: 3.05 }] }] } } };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await open(page);
  await createDeck(page, 'Salt Test');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();

  const panel = page.locator('.edhrec-panel');
  await expect(panel.getByRole('button', { name: 'Turn on EDHREC' })).toBeVisible();
  await expect(panel.locator('.edhrec-salty')).toHaveCount(0);
  expect(edhrec).toEqual([]); // nothing is fetched while it's off
  await panel.getByRole('button', { name: 'Turn on EDHREC' }).click();
  await expect(panel.locator('.edhrec-salty')).toContainText('Sol Ring');
  await expect(panel.locator('.edhrec-salty')).toContainText('1.59');
  await expect(panel).toContainText('Choose a commander');
  expect(edhrec).toEqual(['https://json.edhrec.com/pages/top/salt-1.json']);
  expect(errors).toEqual([]);
});

test('EDHREC suggestions open the card view and drag into the deck', async ({ page, isMobile, browserName }) => {
  test.skip(!!isMobile, 'phones show the details panel on its own tab');
  // Wide enough for the three-column layout, so the deck list and EDHREC panel are both on screen while dragging.
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = watchErrors(page);
  await open(page);
  // Later routes win: a legendary commander for searches, a suggested card for lookups, and EDHREC.
  const atraxa = { ...SOL_RING, id: 'atraxa-test', name: "Atraxa, Praetors' Voice", type_line: 'Legendary Creature — Phyrexian Angel Horror', mana_cost: '{G}{W}{U}{B}', cmc: 4 };
  const skate = { ...SOL_RING, id: 'skate-test', name: 'Deepglow Skate', type_line: 'Creature — Fish', mana_cost: '{4}{U}', cmc: 5 };
  await page.route('https://api.scryfall.com/cards/search?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('format') === 'csv') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', total_cards: 1, has_more: false, data: [atraxa] }) });
  });
  await page.route('https://api.scryfall.com/cards/collection', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [skate], not_found: [] }) }));
  await page.route('https://json.edhrec.com/**', (route) => {
    const url = route.request().url();
    const body = url.includes('/commanders/')
      ? { container: { json_dict: { card: { num_decks: 46414 }, cardlists: [{ header: 'Creatures', cardviews: [{ name: 'Deepglow Skate', num_decks: 300, potential_decks: 1000, synergy: 0.25 }] }] } } }
      : { container: { json_dict: { cardlists: [{ header: '', cardviews: [{ name: "Atraxa, Praetors' Voice", salt: 1.72 }] }] } } };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });

  await createDeck(page, 'Suggest Test');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('atraxa');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: "Add Atraxa, Praetors' Voice to main deck" }).click();
  await page.locator('.deck-groups').getByText("Atraxa, Praetors' Voice").first().hover();
  await page.locator('.deck-groups').getByTitle('Set as commander').click();

  const panel = page.locator('.edhrec-panel');
  await panel.getByRole('button', { name: 'Turn on EDHREC' }).click();
  const row = panel.locator('.edhrec-table tr', { hasText: 'Deepglow Skate' });
  const handle = row.locator('.edhrec-drag');
  await expect(handle).toHaveAttribute('draggable', 'true'); // Scryfall data loaded

  // Click opens the card view; the salt list opens deck cards too.
  await row.click();
  await expect(page.locator('.modal')).toContainText('Deepglow Skate');
  await page.locator('.modal-close').click();
  await panel.locator('.edhrec-salty').getByRole('button', { name: /Atraxa/ }).click();
  await expect(page.locator('.modal')).toContainText('Atraxa');
  await page.locator('.modal-close').click();

  if (browserName === 'chromium') await panel.screenshot({ path: 'test-results/edhrec-panel.png' });

  // Drag onto the deck list adds it (Playwright can't drive HTML drag and drop in WebKit on Windows/Linux).
  if (browserName !== 'webkit') {
    await handle.dragTo(page.locator('.deck-groups'));
    await expect(page.locator('.board-tabs .tab', { hasText: 'Main' }).locator('.tab-count')).toHaveText('2');
    await expect(panel).toContainText('You already run every card EDHREC lists');
  }
  expect(errors).toEqual([]);
});

test('cards in Deck Details open, and hover art waits then stays on screen', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'touch screens have no hover; phones show the details panel on its own tab');
  await page.setViewportSize({ width: 1600, height: 1000 }); // three columns: Deck Details at the right edge
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'Hover Test');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();

  // Mana producers: the card name is a card link.
  const producers = page.locator('.detail-section', { has: page.getByRole('heading', { name: 'Mana producers' }) });
  await expect(producers.getByRole('button', { name: 'Rocks 1' })).toBeVisible(); // pills show while folded
  await producers.getByRole('button', { name: 'Mana producers' }).click();
  const link = producers.locator('.card-link', { hasText: 'Sol Ring' });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toHaveAttribute('draggable', 'true');
  const box = (await link.boundingBox())!;
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await expect(page.locator('.hover-preview')).toHaveCount(0); // not yet: it waits first
  const art = page.locator('.hover-preview');
  await expect(art).toBeVisible();
  const artBox = (await art.boundingBox())!;
  expect(artBox.x).toBeGreaterThanOrEqual(0);
  expect(artBox.x + artBox.width).toBeLessThanOrEqual(1600);
  const pointerX = box.x + box.width - 4;
  expect(artBox.x >= pointerX || artBox.x + artBox.width <= pointerX).toBe(true); // beside the pointer, not under it
  expect(artBox.y + artBox.height).toBeLessThanOrEqual(1000);
  if (test.info().project.name === 'chromium') await page.screenshot({ path: 'test-results/hover-art.png' });

  await link.click();
  await expect(page.locator('.hover-preview')).toHaveCount(0);
  await expect(page.locator('.modal')).toContainText('Sol Ring');
  await page.locator('.modal-close').click();

  // The deck list uses the same art.
  await page.locator('.deck-groups .entry', { hasText: 'Sol Ring' }).hover();
  await expect(art).toBeVisible();
  await page.mouse.move(5, 500);
  await expect(art).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('collection lists show hover art, and the buy list opens cards', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'touch screens have no hover');
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'Buy Test');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();

  await page.goto('/#/collection/buy');
  const link = page.locator('.card-link', { hasText: 'Sol Ring' }).first();
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute('draggable', 'true'); // nothing to drop onto here
  await link.hover();
  await expect(page.locator('.hover-preview')).toBeVisible();
  await link.click();
  await expect(page.locator('.hover-preview')).toHaveCount(0);
  await expect(page.locator('.modal')).toContainText('Sol Ring');
  expect(errors).toEqual([]);
});

test('combo check: nothing sent until asked, then combos, one card away, and the bracket', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'phones show the details panel on its own tab');
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = watchErrors(page);
  await open(page);
  const atraxa = { ...SOL_RING, id: 'atraxa-test', name: "Atraxa, Praetors' Voice", type_line: 'Legendary Creature — Phyrexian Angel Horror', mana_cost: '{G}{W}{U}{B}', cmc: 4 };
  const horror = { ...SOL_RING, id: 'horror-test', name: 'Hullbreaker Horror', type_line: 'Creature — Kraken Horror', mana_cost: '{5}{U}{U}', cmc: 7 };
  await page.route('https://api.scryfall.com/cards/search?**', (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get('format') === 'csv') return route.fallback();
    const data = (q.get('q') ?? '').includes('sol') ? [SOL_RING] : [atraxa];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', total_cards: 1, has_more: false, data }) });
  });
  await page.route('https://api.scryfall.com/cards/collection', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [horror], not_found: [] }) }));
  const sent: unknown[] = [];
  const combo = (id: string, cards: string[], tag: string, missing: string[]) => ({
    id, cards, commanderCards: [], produces: ['Infinite colorless mana'], tag, popularity: 10, mana: '', prerequisites: '', steps: 'Tap it.\nUntap it.', missing,
  });
  await page.route('**/api/combos', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      included: [combo('1-2', ["Atraxa, Praetors' Voice", 'Sol Ring'], 'R', [])],
      almost: [combo('3-4', ['Hullbreaker Horror', 'Sol Ring'], 'E', ['Hullbreaker Horror'])],
    }) });
  });

  await createDeck(page, 'Combo Test');
  const search = page.locator('.search-panel');
  for (const [q, name] of [['atraxa', "Atraxa, Praetors' Voice"], ['sol ring', 'Sol Ring']]) {
    await search.locator('.search-input').fill(q);
    await search.locator('.search-input').press('Enter');
    const result = search.locator('.result-card', { hasText: name }).first();
    await result.hover();
    await result.getByRole('button', { name: `Add ${name} to main deck` }).click();
  }
  await page.locator('.deck-groups').getByText("Atraxa, Praetors' Voice").first().hover();
  await page.locator('.deck-groups').getByTitle('Set as commander').click();

  const panel = page.locator('.combos-panel');
  await expect(panel.locator('.combo')).toHaveCount(0); // folded: just the heading and the button
  expect(sent).toEqual([]);
  await panel.getByRole('button', { name: 'Check combos' }).click();
  await expect(panel.locator('.combo').first()).toContainText('Ruthless');
  expect(sent).toEqual([{ commanders: ["Atraxa, Praetors' Voice"], main: ['Sol Ring'] }]);

  // One card away: the missing card opens and can be added.
  const almost = panel.locator('.combo', { hasText: 'Hullbreaker Horror' });
  const missingLink = almost.locator('.card-link', { hasText: 'Hullbreaker Horror' });
  await expect(missingLink).toHaveAttribute('draggable', 'true'); // its Scryfall data has loaded
  await missingLink.click();
  await expect(page.locator('.modal')).toContainText('Hullbreaker Horror');
  await page.locator('.modal-close').click();

  // The bracket estimate now counts the Ruthless combo.
  const bracket = page.locator('.detail-section', { has: page.getByRole('heading', { name: 'Bracket estimate' }) });
  await expect(bracket.locator('.bracket-badge')).toHaveText('Bracket 4+');
  await bracket.getByRole('button', { name: 'Bracket estimate' }).click();
  await expect(bracket).toContainText('Commander Spellbook rates Ruthless');

  // Adding the missing card moves it out of "one card away".
  await almost.getByRole('button', { name: '+ Add Hullbreaker Horror' }).click();
  await expect(panel).toContainText('The deck has changed since this check');
  await expect(panel.locator('.combo', { hasText: 'Hullbreaker Horror' })).toHaveCount(0);
  if (test.info().project.name === 'chromium') await panel.screenshot({ path: 'test-results/combos-panel.png' });
  expect(errors).toEqual([]);
});

test('deck search: popular staples, greyed in-deck cards, list and details views, tags in advanced search', async ({ page, isMobile, browserName }) => {
  test.skip(!!isMobile, 'drag and drop is a desktop feature');
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = watchErrors(page);
  await open(page);
  const sent: { q: string; order: string }[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/cards/search' && u.searchParams.get('format') !== 'csv') sent.push({ q: u.searchParams.get('q') ?? '', order: u.searchParams.get('order') ?? '' });
  });
  await createDeck(page, 'Views Test');
  const search = page.locator('.search-panel');
  const tab = (name: string) => page.locator('.board-tabs .tab', { hasText: name });

  // Popular staples: nonland cards, most played first, within the format.
  await search.getByRole('button', { name: '★ Popular staples' }).click();
  await expect(search.locator('.result-card').first()).toContainText('Sol Ring');
  expect(sent.at(-1)).toEqual({ q: '-t:land f:commander', order: 'edhrec' });
  await search.getByRole('button', { name: '★ Popular lands' }).click();
  await expect.poll(() => sent.at(-1)?.q).toBe('t:land -t:basic f:commander');

  // Adding a card greys it out in the results instead of hiding it.
  const tile = search.locator('.result-card').first();
  await tile.hover();
  await tile.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();
  await expect(tile).toHaveClass(/is-dim/);

  // List view: a row per card, with + and drag onto the deck list.
  await search.getByRole('radio', { name: 'List' }).click();
  const row = search.locator('.result-row').first();
  await expect(row).toContainText('Sol Ring');
  await expect(row).toContainText('1 in deck');
  await expect(row).toHaveClass(/is-dim/);
  // (Commander is singleton, so use the other boards.) + adds to the board shown in the deck list.
  await tab('Sideboard').click();
  await row.getByRole('button', { name: 'Add Sol Ring to sideboard' }).click();
  await expect(tab('Sideboard').locator('.tab-count')).toHaveText('1');
  if (browserName !== 'webkit') {
    await row.dragTo(tab('Maybeboard'));
    await expect(tab('Maybeboard').locator('.tab-count')).toHaveText('1');
  }

  // Details view adds rules text; the choice is remembered.
  await search.getByRole('radio', { name: 'Details' }).click();
  await expect(search.locator('.result-row.details').first()).toContainText('{T}: Add {C}{C}.');
  await page.reload();
  await search.getByRole('button', { name: '★ Popular staples' }).click();
  await expect(search.locator('.result-row.details').first()).toBeVisible();

  // Advanced search: Tags at the top; pick tags, match any or none; no "Your cards" section.
  await search.getByRole('button', { name: /Advanced/ }).click();
  const tags = page.locator('.adv-tags');
  await expect(tags).toContainText('Scryfall oracle tags are off.');
  await turnOnOracleTags(page, tags.getByRole('button', { name: 'Turn on…' }));
  await tags.getByRole('button', { name: 'ramp', exact: false }).first().click();
  await tags.getByRole('button', { name: /mana rock/ }).click();
  await expect(page.locator('.query-preview')).toContainText('#ramp #"mana rock"');
  await tags.getByRole('radio', { name: 'Any' }).click();
  await expect(page.locator('.query-preview')).toContainText('(#ramp or #"mana rock")');
  await tags.getByRole('radio', { name: 'None' }).click();
  await expect(page.locator('.query-preview')).toContainText('-#ramp -#"mana rock"');
  await expect(page.locator('.advanced legend', { hasText: 'Your cards' })).toHaveCount(0);
  await expect(page.locator('.advanced').getByText('Ownership')).toBeVisible();
  expect(errors).toEqual([]);
});

test('group by tag: choose sections in the window, saved per deck, reset to the most common', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'covered on desktop');
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'Group Test');
  const search = page.locator('.search-panel');
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Search' }).click();
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();

  // Scryfall oracle tags are off until turned on; then the bundled tags work straight away (no downloads).
  await page.getByLabel('Group cards by').selectOption('tag');
  const groups = page.locator('.deck-groups');

  await expect(groups).not.toContainText(/ramp/i);
  await turnOnOracleTags(page, page.getByRole('button', { name: '◆ Turn on oracle tags' }));
  await expect(groups).toContainText(/ramp/i);
  await page.getByRole('button', { name: 'Choose tags to group by' }).click();
  const modal = page.locator('.modal');
  await expect(modal).toContainText('Tick the tags that should become sections');
  await modal.getByRole('button', { name: 'None' }).click();
  await expect(modal.getByRole('button', { name: 'Group by selected tags' })).toBeDisabled();
  await modal.getByLabel(/mana rock/).check();
  await modal.getByRole('button', { name: 'Group by selected tags' }).click();
  await expect(modal).toHaveCount(0);
  await expect(groups.locator('.group-name').first()).toContainText(/mana rock/i);

  // Kept for this deck after a reload; Reset tags goes back to the most common.
  await page.reload();
  await expect(groups).toContainText(/mana rock/i);
  await page.getByRole('button', { name: 'Reset tags' }).click();
  await expect(page.getByRole('button', { name: 'Reset tags' })).toHaveCount(0);
  await expect(groups).toContainText(/ramp/i);

  // Hiding one oracle tag drops it from the deck list; the card moves to its next tag.
  await page.getByRole('button', { name: '◆ Oracle tags' }).click();
  const settings = page.locator('.modal', { hasText: 'Use Scryfall oracle tags' });
  await settings.getByLabel('◆ ramp', { exact: true }).uncheck();
  await settings.getByRole('button', { name: 'Done' }).click();
  await expect(groups.locator('.group-name', { hasText: /ramp$/i })).toHaveCount(0);
  await expect(groups.locator('.group-name').first()).toContainText(/mana rock/i);
  // Turning them off leaves only your own tags.
  await page.getByRole('button', { name: '◆ Oracle tags' }).click();
  await settings.getByLabel('Use Scryfall oracle tags').uncheck();
  await settings.getByRole('button', { name: 'Done' }).click();
  await expect(groups).not.toContainText(/mana rock/i);

  expect(errors).toEqual([]);
});

test('view panel: right-click to pin, drag a copy from it, Pin button, arrow keys, hide Card Search', async ({ page, isMobile, browserName }) => {
  test.skip(!!isMobile, 'right-click and the three-column layout are desktop features');
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = watchErrors(page);
  await open(page);
  const counter = { ...SOL_RING, id: 'counter-test', name: 'Counterspell', type_line: 'Instant', mana_cost: '{U}{U}', cmc: 2, oracle_text: 'Counter target spell.' };
  await page.route('https://api.scryfall.com/cards/search?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('format') === 'csv') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', total_cards: 2, has_more: false, data: [SOL_RING, counter] }) });
  });
  await createDeck(page, 'Pin Test');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('anything');
  await search.locator('.search-input').press('Enter');
  const sol = search.locator('.result-card', { hasText: 'Sol Ring' });
  await sol.hover();
  await sol.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();

  // Right-click a deck row: it shows in the view panel.
  const view = page.locator('.view-panel');
  await expect(view).toHaveCount(0);
  await page.locator('.deck-groups .entry', { hasText: 'Sol Ring' }).click({ button: 'right' });
  await expect(view).toContainText('Sol Ring');
  // Right-clicking another card replaces it.
  await search.locator('.result-card', { hasText: 'Counterspell' }).click({ button: 'right' });
  await expect(view).toContainText('Counterspell');
  await expect(view).not.toContainText('Artifact'); // Sol Ring's details are gone

  // Dragging the picture adds a copy without removing anything.
  const tab = (name: string) => page.locator('.board-tabs .tab', { hasText: name });
  if (browserName !== 'webkit') {
    await view.locator('.card-img-large').dragTo(tab('Sideboard'));
    await expect(tab('Sideboard').locator('.tab-count')).toHaveText('1');
    await expect(tab('Main').locator('.tab-count')).toHaveText('1');
  }
  await view.getByRole('button', { name: 'Close the view panel' }).click();
  await expect(view).toHaveCount(0);

  // Card window: arrow keys move through the search results; Pin puts the card in the panel.
  await search.locator('.result-card', { hasText: 'Sol Ring' }).locator('.result-img-btn').click();
  const modal = page.locator('.modal');
  await expect(modal).toContainText('1 of 2');
  await page.keyboard.press('ArrowRight');
  await expect(modal).toContainText('Counterspell');
  await expect(modal).toContainText('2 of 2');
  await page.keyboard.press('ArrowRight'); // wraps around
  await expect(modal).toContainText('1 of 2');
  await modal.getByRole('button', { name: '📌 Pin to view panel' }).click();
  await expect(modal).toHaveCount(0);
  await expect(view).toContainText('Sol Ring');

  // Collapse Card Search: just the search bar and the first row of buttons; searching opens the results again.
  await expect(search.getByRole('button', { name: 'Hide Card Search' })).toHaveCount(0); // two steps to hide
  await search.getByRole('button', { name: 'Collapse Card Search' }).click();
  await expect(search.locator('.search-input')).toBeVisible();
  await expect(search.getByRole('button', { name: /Advanced/ })).toBeVisible();
  await expect(search.locator('.result-card').first()).toBeHidden();
  await expect(search.getByRole('button', { name: '★ Popular staples' })).toBeHidden();
  await search.locator('.search-input').press('Enter');
  await expect(search.locator('.result-card').first()).toBeVisible();
  await expect(search.getByRole('button', { name: 'Collapse Card Search' })).toBeVisible();
  await search.getByRole('button', { name: 'Collapse Card Search' }).click();

  // Then hide it: a rail brings it back; the choice survives a reload; the pinned card keeps the column.
  await search.getByRole('button', { name: 'Hide Card Search' }).click();
  await expect(page.locator('.search-panel')).toHaveCount(0);
  await expect(view).toBeVisible();
  await page.reload();
  await expect(page.locator('.search-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show Card Search' }).click();
  await expect(page.locator('.search-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('view panel: pin several cards, card / grid / list views, sort, remove, collapse, hide, drag to pin', async ({ page, isMobile, browserName }) => {
  test.skip(!!isMobile, 'right-click and the three-column layout are desktop features');
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = watchErrors(page);
  await open(page);
  const counter = { ...SOL_RING, id: 'counter-pin', name: 'Counterspell', type_line: 'Instant', mana_cost: '{U}{U}', cmc: 2, oracle_text: 'Counter target spell.', prices: { usd: '0.50' } };
  const bolt = { ...SOL_RING, id: 'bolt-pin', name: 'Lightning Bolt', type_line: 'Instant', mana_cost: '{R}', cmc: 1, oracle_text: 'Deal 3 damage.', prices: { usd: '2.00' } };
  await page.route('https://api.scryfall.com/cards/search?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('format') === 'csv') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', total_cards: 3, has_more: false, data: [SOL_RING, counter, bolt] }) });
  });
  await createDeck(page, 'Pins');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('anything');
  await search.locator('.search-input').press('Enter');
  const tile = (name: string) => search.locator('.result-card', { hasText: name });
  await tile('Sol Ring').hover();
  await tile('Sol Ring').getByRole('button', { name: 'Add Sol Ring to main deck' }).click();

  // Right-click shows one card; pin it, then right-clicks add instead of replacing.
  const view = page.locator('.view-panel');
  await tile('Sol Ring').click({ button: 'right' });
  await view.getByRole('button', { name: 'Pin the view panel' }).click();
  await tile('Counterspell').click({ button: 'right' });
  await tile('Lightning Bolt').click({ button: 'right' });
  const count = view.locator('h2 .tab-count');
  await expect(count).toHaveText('3');

  // Card view: one at a time, step through them.
  await expect(view.locator('.pin-step')).toContainText('3 of 3');
  await expect(view.locator('.card-modal-info')).toContainText('Lightning Bolt');
  await view.getByRole('button', { name: 'Next pinned card' }).click();
  await expect(view.locator('.pin-step')).toContainText('1 of 3');
  await expect(view.locator('.card-modal-info')).toContainText('Sol Ring');

  // Grid: card art like the search results; sort by name.
  await view.getByRole('radio', { name: /Grid/ }).click();
  const tiles = view.locator('.result-card');
  await expect(tiles).toHaveCount(3);
  await view.getByLabel('Sort pinned cards').selectOption('name');
  await expect(tiles.first()).toContainText('Counterspell');
  await view.getByLabel('Sort pinned cards').selectOption('price');
  await expect(tiles.first()).toContainText('Lightning Bolt');

  // Remove one from the grid.
  await tiles.filter({ hasText: 'Counterspell' }).hover();
  await view.getByRole('button', { name: 'Remove Counterspell from the view panel' }).click();
  await expect(tiles).toHaveCount(2);
  await expect(count).toHaveText('2');
  // Right-clicking a card in the panel removes it too, with Undo.
  await tiles.filter({ hasText: 'Lightning Bolt' }).click({ button: 'right' });
  await expect(count).toHaveText('1');
  await page.locator('.toast', { hasText: 'Removed Lightning Bolt' }).getByRole('button', { name: 'Undo' }).click();
  await expect(count).toHaveText('2');
  await expect(tiles.first()).toContainText('Lightning Bolt');

  // List view rows; clicking one opens it in the Card view.
  await view.getByRole('radio', { name: /List/ }).click();
  await expect(view.locator('.result-row')).toHaveCount(2);
  await view.locator('.result-row', { hasText: 'Sol Ring' }).locator('.row-name').click();
  await expect(view.getByRole('radio', { name: /Card/ })).toHaveAttribute('aria-checked', 'true');
  await expect(view.locator('.card-modal-info')).toContainText('Sol Ring');

  // Collapse to the header, then hide to a rail with the count; the rail brings it back.
  await view.getByRole('button', { name: 'Collapse the view panel' }).click();
  await expect(view.locator('.card-modal')).toHaveCount(0);
  await view.getByRole('button', { name: 'Hide the view panel' }).click();
  await expect(view).toHaveCount(0);
  const rail = page.getByRole('button', { name: 'Show the view panel' });
  await expect(rail).toContainText('2');
  await rail.click();
  await expect(view.locator('.card-modal')).toBeVisible();

  if (browserName !== 'webkit') {
    // Dragging a search result or a deck row onto the panel pins it.
    await tile('Counterspell').locator('.result-art').dragTo(view);
    await expect(count).toHaveText('3');
    await expect(view.locator('.card-modal-info')).toContainText('Counterspell');
    await view.getByRole('button', { name: 'Remove Counterspell from the view panel' }).click();
    await view.getByRole('radio', { name: /Grid/ }).click();
    await tiles.filter({ hasText: 'Sol Ring' }).hover();
    await view.getByRole('button', { name: 'Remove Sol Ring from the view panel' }).click();
    await expect(count).toHaveText('1');
    await page.locator('.deck-groups .entry', { hasText: 'Sol Ring' }).dragTo(view);
    await expect(count).toHaveText('2');
  }

  // Unpin keeps only the card on show; close clears the panel.
  await view.getByRole('button', { name: 'Unpin the view panel' }).click();
  await expect(count).toHaveCount(0);
  await expect(view.locator('.pin-toolbar')).toHaveCount(0);
  await view.getByRole('button', { name: 'Close the view panel' }).click();
  await expect(view).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a search that can not reach Scryfall says so and offers Try again', async ({ page }) => {
  await open(page);
  let fail = true;
  await page.route('https://api.scryfall.com/cards/search?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('format') === 'csv') return route.fallback();
    if (fail) return route.abort('failed');
    return route.fallback();
  });
  const box = page.locator('.search-form input').first();
  await box.fill('sol ring');
  await box.press('Enter');
  const err = page.locator('.search-error');
  await expect(err).toContainText('Couldn’t reach Scryfall');
  fail = false;
  await err.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.result-card').first()).toContainText('Sol Ring');
  await expect(err).toHaveCount(0);
});

test('deck list: list dividers, grid and table views, color identity grouping and sorting', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await open(page);
  const bolt = { ...SOL_RING, id: 'bolt-test', name: 'Lightning Bolt', type_line: 'Instant', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], prices: { usd: '0.99' } };
  await page.route('https://api.scryfall.com/cards/collection', async (route) => {
    const ids = route.request().postDataJSON().identifiers as { name: string }[];
    const data = ids.map((i) => (i.name === 'Lightning Bolt' ? bolt : i.name === 'Sol Ring' ? SOL_RING : null)).filter(Boolean);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, not_found: [] }) });
  });
  await page.getByRole('button', { name: '⇪ Import deck' }).first().click();
  await page.getByLabel('Decklist').fill('Deck\n1 Lightning Bolt\n1 Sol Ring');
  await page.getByRole('button', { name: 'Import deck', exact: true }).last().click();
  await expect(page).toHaveURL(/#\/deck\//);
  await page.keyboard.press('Escape');
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Deck' }).click();
  const list = page.locator('.col-deck');

  // Group by color identity: Red, then Colorless.
  await page.getByLabel('Group cards by').selectOption('identity');
  await expect(list.locator('.group-name')).toHaveText(['Red', 'Colorless']);
  // None: one list with no group headings, sorted by name.
  await page.getByLabel('Group cards by').selectOption('none');
  await page.getByLabel('Sort cards by').selectOption('name');
  await expect(list.locator('.group-head')).toHaveCount(0);
  await expect(list.locator('.entry-name')).toHaveText([/Lightning Bolt/, /Sol Ring/]);
  await page.getByLabel('Sort cards by').selectOption('mv');
  await page.getByLabel('Group cards by').selectOption('mv');

  // Grid: full pictures, opens the card window.
  await list.getByRole('radio', { name: 'Grid' }).click();
  await expect(list.locator('.grid-tile')).toHaveCount(2);
  await list.locator('.grid-tile').first().locator('.grid-img-btn').click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.locator('.modal-close').click();

  // Table: a row per card with its type; remembered after a reload.
  await list.getByRole('radio', { name: 'Table' }).click();
  await expect(list.locator('.deck-table tbody tr')).toHaveCount(2);
  await expect(list.locator('.deck-table')).toContainText('Lightning Bolt');
  await page.reload();
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Deck' }).click();
  await expect(page.locator('.col-deck .deck-table').first()).toBeVisible();

  // The sort setting is kept (the order itself is covered by unit tests).
  await page.getByLabel('Sort cards by').selectOption('price');
  await expect(page.getByLabel('Sort cards by')).toHaveValue('price');

  // List: back to rows with dividers.
  await page.locator('.col-deck').getByRole('radio', { name: 'List' }).click();
  await expect(page.locator('.col-deck .entries .entry')).toHaveCount(2);

  // Table rows have their own −/+/remove buttons, which don't open the card window.
  await page.locator('.col-deck').getByRole('radio', { name: 'Table' }).click();
  await page.locator('.col-deck .deck-table').getByRole('button', { name: 'Remove Lightning Bolt', exact: true }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.col-deck .deck-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.col-deck .deck-table')).not.toContainText('Lightning Bolt');
  expect(errors).toEqual([]);
});

test('deck table: drag a header edge to resize a column, kept after reload, double-click resets', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'resizing columns is a desktop feature');
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'Columns Test');
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const r = search.locator('.result-card').first();
  await r.hover();
  await r.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();
  await page.locator('.col-deck').getByRole('radio', { name: 'Table' }).click();

  const tagsHead = page.locator('.deck-table th', { hasText: 'Tags' }).first();
  const width = async () => (await tagsHead.boundingBox())!.width;
  const before = await width();
  const handle = tagsHead.locator('.col-resizer');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 90, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(width).toBeGreaterThan(before + 60);
  const resized = await width();

  await page.reload();
  await expect.poll(width).toBeGreaterThan(resized - 3);

  await page.locator('.deck-table th', { hasText: 'Tags' }).first().locator('.col-resizer').dblclick();
  await expect.poll(width).toBeLessThan(resized - 60);
  expect(errors).toEqual([]);
});

test('#tag search and the tag browser find tagged cards', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'Tag Test');
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Search' }).click();
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();
  await result.getByRole('button', { name: 'Tag Sol Ring' }).click();
  const tagBox = page.locator('.modal').getByPlaceholder('e.g. ramp, wincon, removal');
  await tagBox.fill('ramp');
  await tagBox.press('Enter');
  await page.locator('.modal-close').click();

  // The tag browser on the main page lists the tag and opens into its cards.
  await page.goto('/');
  await page.getByRole('button', { name: '🏷 Tags', exact: true }).click();
  const pick = page.locator('.tag-pick', { hasText: 'ramp' });
  await expect(pick).toContainText('1');
  await pick.click();
  await expect(page.locator('.tag-group')).toContainText('Sol Ring');
  await turnOnOracleTags(page, page.locator('.tag-browser').getByRole('button', { name: '◆ Turn on oracle tags' }));

  // A tag of yours that isn't a Scryfall tag searches your own cards.
  const box = page.locator('.search-form input').first();
  await box.fill('#ramp-ish');
  await box.press('Enter');
  await expect(page.locator('.empty')).toContainText('No cards match');

  // #ramp is also a Scryfall tag: Scryfall is asked for every card with it (otag:ramp).
  const asked = page.waitForRequest((r) => {
    const u = new URL(r.url());
    return u.pathname === '/cards/search' && u.searchParams.get('format') !== 'csv' && (u.searchParams.get('q') ?? '').includes('otag:ramp');
  });
  await box.fill('#ramp');
  await box.press('Enter');
  await asked;
  await expect(page.locator('.results-meta')).toContainText('1 cards');
  await expect(page.locator('.result-card')).toHaveCount(1);
  await expect(page.locator('.result-card')).toContainText('Sol Ring');
  expect(errors).toEqual([]);
});

test('global tags follow a card into searches and every deck', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await open(page);
  // Tag Sol Ring globally from the main search, without owning it or using it in a deck.
  const box = page.locator('.search-form input').first();
  await box.fill('sol ring');
  await box.press('Enter');
  const result = page.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: 'Tag Sol Ring' }).click();
  const tagBox = page.locator('.modal').getByPlaceholder('e.g. staple, ramp, removal');
  for (const t of ['staple', 'ramp']) { await tagBox.fill(t); await tagBox.press('Enter'); }
  await page.locator('.modal-close').click();
  await expect(result.locator('.tag-global')).toHaveCount(2);

  // #staple and gtag:staple find it among your own cards.
  for (const q of ['#staple', 'gtag:staple']) {
    await box.fill(q);
    await box.press('Enter');
    await expect(page.locator('.results-meta')).toContainText('1 of your cards');
    await expect(page.locator('.result-card')).toContainText('Sol Ring');
  }
  await page.getByRole('button', { name: '🏷 Tags', exact: true }).click();
  await expect(page.locator('.tag-pick.tag-global', { hasText: 'staple' })).toContainText('1');

  // In any deck, the card carries its global tags.
  await createDeck(page, 'Global Tag Deck');
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Search' }).click();
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const r = search.locator('.result-card').first();
  await r.hover();
  await r.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Deck' }).click();
  await expect(page.locator('.deck-list-panel .tag-global', { hasText: 'staple' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('favorite a card from search, owned or not, and find it everywhere', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  const box = page.locator('.search-form input').first();
  await box.fill('sol ring');
  await box.press('Enter');
  const result = page.locator('.result-card').first();
  await result.hover();
  await result.getByRole('button', { name: 'Favorite Sol Ring' }).click();
  await expect(result.locator('.result-fav.on')).toBeVisible();

  // The ★ Favorites button on its own lists favorite cards, even ones you don't own.
  const main = page.locator('.global-search');
  await main.getByRole('button', { name: 'Clear' }).click();
  await main.getByRole('button', { name: '★ Favorites' }).click();
  await expect(page.locator('.results-meta')).toContainText('1 of your cards');
  await expect(page.locator('.result-card')).toContainText('Sol Ring');

  // The collection's Favorites tab shows it too, and unfavoriting there removes it.
  await page.goto('/#/collection/favorites');
  const fav = page.locator('.favorites-tab .result-card');
  await expect(fav).toContainText('Sol Ring');
  await expect(page.locator('.favorites-tab')).toContainText('1 favorite card · 0 owned · 1 not owned');
  await fav.locator('.result-img-btn').click();
  await expect(page.locator('.modal .card-fav-btn')).toHaveText('★ Favorite');
  await page.locator('.modal .card-fav-btn').click();
  await page.locator('.modal-close').click();
  await expect(page.locator('.favorites-tab')).toContainText('No favorite cards yet');
  expect(errors).toEqual([]);
});

test('every collection tab renders', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/#/collection');
  for (const tab of ['inventory', 'favorites', 'decks', 'transactions', 'buy', 'binder', 'watch', '']) {
    await page.goto(`/#/collection${tab ? `/${tab}` : ''}`);
    await expect(page.locator('.coll-tabs .tab.active')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('no sideways scrolling on the main screens', async ({ page }) => {
  await open(page);
  await createDeck(page, 'Width Check');
  const deckPath = new URL(page.url()).hash ? `/${new URL(page.url()).hash}` : '/';
  // The deck page too: its header buttons once ran off the side of phone screens.
  for (const path of ['/', deckPath, '/#/collection', '/#/collection/inventory', '/#/collection/transactions']) {
    await page.goto(path);
    await expect(page.locator('.topbar')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `page wider than the screen on ${path}`).toBeLessThanOrEqual(1);
  }
  await page.goto('/');
  await page.getByRole('button', { name: /Advanced/ }).first().click();
  await expect(page.locator('.advanced')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page wider than the screen with advanced search open').toBeLessThanOrEqual(1);
});

test('backup and restore move a deck into a fresh browser', async ({ browser, page, isMobile }) => {
  // Phones save backups through the share sheet, which a test browser can't drive; desktop covers the file round trip.
  test.skip(!!isMobile, 'share sheet on phones');
  await open(page);
  await createDeck(page, 'Backed Up Deck');
  await page.goto('/#/collection');
  await page.getByRole('button', { name: /Export & backup/ }).click();
  await page.getByRole('button', { name: 'Full backup' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.ie-actions .btn-primary').click()]);
  expect(download.suggestedFilename()).toMatch(/^grimoire-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();

  // A brand-new browser profile: empty library, restore from its link.
  const fresh = await browser.newContext({ serviceWorkers: 'block' });
  const p2 = await fresh.newPage();
  await open(p2);
  await p2.getByRole('button', { name: 'Restore a backup' }).click();
  await p2.getByLabel('Choose backup file').setInputFiles(file);
  await expect(p2.locator('.restore-summary')).toContainText('1 decks');
  await p2.getByLabel(/a backup of my current data first/).uncheck();
  await p2.getByRole('button', { name: 'Replace my data with this backup' }).click();
  // Wait for the restore to finish: navigating away mid-restore would abort its transaction.
  await expect(p2.getByText('Backup restored')).toBeVisible();
  await p2.goto('/');
  await expect(p2.locator('.deck-grid')).toContainText('Backed Up Deck');
  await fresh.close();
});

test('installable and works offline after the first visit', async ({ browser, browserName, isMobile }) => {
  // Playwright can only run service workers in Chromium.
  test.skip(browserName !== 'chromium' || !!isMobile, 'service workers are testable in desktop Chromium only');
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await open(page);
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', /manifest\.webmanifest/);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator('.topbar')).toBeVisible();
  await ctx.close();
});

test('help page opens from the top bar and shows the version', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.getByRole('button', { name: 'Help and about' }).click();
  await expect(page.getByRole('heading', { name: 'Help & about' })).toBeVisible();
  await expect(page.locator('.help-page')).toContainText(/Version \d+\.\d+\.\d+/);
  await expect(page.getByRole('link', { name: 'Open an issue on GitHub' })).toHaveAttribute('href', /github\.com\/balogconnor-design\/the-grimoire\/issues/);
  expect(errors).toEqual([]);
});

test('deck history: changelog, snapshots, compare and restore', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await open(page);
  await createDeck(page, 'History Test');
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Search' }).click();
  const search = page.locator('.search-panel');
  await search.locator('.search-input').fill('sol ring');
  await search.locator('.search-input').press('Enter');
  const result = search.locator('.result-card').first();
  await expect(result).toContainText('Sol Ring');
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to main deck' }).click();

  // The add is in the changelog.
  await page.getByRole('button', { name: 'History' }).click();
  const modal = page.locator('.modal');
  await expect(modal.locator('.history-session')).toContainText('+1 Sol Ring');

  // Save a snapshot.
  await modal.locator('.tab', { hasText: 'Snapshots' }).click();
  await modal.getByLabel('Snapshot name').fill('v1');
  await modal.getByRole('button', { name: 'Save snapshot' }).click();
  await expect(modal.locator('.snapshot-row')).toContainText('v1');
  if (!isMobile) await page.screenshot({ path: 'test-results/history-snapshots.png' });
  await modal.getByRole('button', { name: 'Close' }).click();

  // Change the deck: a second copy of Sol Ring goes to the sideboard.
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Deck' }).click();
  await page.locator('.board-tabs .tab', { hasText: 'Sideboard' }).click();
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Search' }).click();
  await result.hover();
  await result.getByRole('button', { name: 'Add Sol Ring to sideboard' }).click();

  // Compare the deck now (A) with the snapshot (B).
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByLabel('Deck B')).toHaveValue(/^snap:/);
  await modal.getByRole('radio', { name: 'Sideboard' }).click();
  await expect(modal.locator('.compare-a')).toContainText('Sol Ring');
  if (!isMobile) await page.screenshot({ path: 'test-results/compare.png' });
  await modal.getByRole('button', { name: 'Close' }).click();

  // Restore the snapshot: the sideboard copy is gone, and the current cards were saved first.
  await page.getByRole('button', { name: 'History' }).click();
  await modal.locator('.tab', { hasText: 'Snapshots' }).click();
  await modal.locator('.snapshot-row', { hasText: 'v1' }).getByRole('button', { name: 'Restore' }).click();
  await modal.locator('.snapshot-row', { hasText: 'v1' }).getByRole('button', { name: 'Restore' }).click();
  await expect(modal.locator('.snapshot-row')).toHaveCount(2);
  await modal.locator('.tab', { hasText: 'Changes' }).click();
  await expect(modal.locator('.history-session').first()).toContainText('Restored snapshot “v1”');
  await modal.getByRole('button', { name: 'Close' }).click();
  if (isMobile) await page.locator('.mobile-tabs .tab', { hasText: 'Deck' }).click();
  await expect(page.locator('.board-tabs .tab', { hasText: 'Sideboard' }).locator('.tab-count')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('commander: drag onto the commander slot, and its color identity applies to the search straight away', async ({ page, isMobile, browserName }) => {
  test.skip(!!isMobile, 'covered on desktop');
  test.skip(browserName === 'webkit', "Playwright can't drive HTML drag and drop in WebKit on Windows/Linux");
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = watchErrors(page);
  await open(page);
  const legend = (id: string, name: string, colors: string[]) => ({
    ...SOL_RING, id, name, type_line: 'Legendary Creature — Test', mana_cost: colors.map((c) => `{${c}}`).join(''), cmc: colors.length,
    colors, color_identity: colors, legalities: { ...SOL_RING.legalities, commander: 'legal' },
  });
  const atraxa = legend('atraxa-test', "Atraxa, Praetors' Voice", ['W', 'U', 'B', 'G']);
  const breya = legend('breya-test', 'Breya, Etherium Shaper', ['W', 'U', 'B', 'R']);
  const asked: string[] = [];
  await page.route('https://api.scryfall.com/cards/search?**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    asked.push(q);
    const data = /breya/i.test(q) ? [breya] : [atraxa];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', total_cards: 1, has_more: false, data }) });
  });

  await createDeck(page, 'Commander Drag Test');
  const search = page.locator('.search-panel');
  const slot = page.locator('.commander-showcase');
  await expect(slot).toContainText('No commander selected');

  // Add Breya to the deck, then search for Atraxa and drag the result onto the commander slot.
  await search.locator('.search-input').fill('breya');
  await search.locator('.search-input').press('Enter');
  await search.locator('.result-card').first().hover();
  await search.locator('.result-card').first().getByRole('button', { name: 'Add Breya, Etherium Shaper to main deck' }).click();
  await search.locator('.search-input').fill('atraxa');
  await search.locator('.search-input').press('Enter');
  await expect(search.locator('.result-card').first()).toContainText('Atraxa');
  await search.locator('.result-card .result-art').first().dragTo(slot);
  await expect(slot.locator('.commander-name')).toHaveText("Atraxa, Praetors' Voice");
  // The search on screen ran again within Atraxa's colors, without clicking anything.
  await expect.poll(() => asked.at(-1)).toContain('atraxa');
  await expect.poll(() => asked.at(-1)).toContain('id<=wubg');
  await expect(search.getByLabel(/Identity/)).toBeChecked();

  // A deck row can be dragged onto the slot too (grouped by type, not only by tag).
  await page.getByLabel('Group cards by').selectOption('type');
  await page.locator('.deck-groups .entry', { hasText: 'Breya' }).dragTo(slot);
  await expect(slot.locator('.commander-name')).toHaveText('Breya, Etherium Shaper');
  await expect.poll(() => asked.at(-1)).toContain('id<=wubr');

  // ★ on a row does the same.
  await page.locator('.deck-groups .entry', { hasText: 'Atraxa' }).hover();
  await page.locator('.deck-groups .entry', { hasText: 'Atraxa' }).getByTitle('Set as commander').click();
  await expect(slot.locator('.commander-name')).toHaveText("Atraxa, Praetors' Voice");
  await expect.poll(() => asked.at(-1)).toContain('id<=wubg');
  expect(errors).toEqual([]);
});

test('mid-size screens: the wheel over Card Search moves the page once Card Search reaches its end', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout');
  const errors = watchErrors(page);
  const names = Array.from({ length: 40 }, (_, i) => `Card ${i}`);
  await open(page);
  await page.route('https://api.scryfall.com/cards/collection', async (route) => {
    const ids = route.request().postDataJSON().identifiers as { name?: string; id?: string }[];
    const data = ids.map((x) => { const name = x.name ?? names[Number(x.id?.slice(1))]; const n = names.indexOf(name); return { ...SOL_RING, id: `c${n}`, oracle_id: `o${n}`, name, cmc: n % 6 }; });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, not_found: [] }) });
  });
  await page.setViewportSize({ width: 1000, height: 600 }); // two columns: Metrics under the deck list
  await page.getByRole('button', { name: '⇪ Import deck' }).first().click();
  await page.getByLabel('Decklist').fill('Deck\n' + names.map((n) => `1 ${n}`).join('\n'));
  await page.getByRole('button', { name: 'Import deck', exact: true }).last().click();
  await expect(page).toHaveURL(/#\/deck\//);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(1500);
  // Several quick wheel turns over Card Search (Firefox used to keep them all on Card Search's own scroll).
  await page.mouse.move(150, 400);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(150); }
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  expect(errors).toEqual([]);
});
