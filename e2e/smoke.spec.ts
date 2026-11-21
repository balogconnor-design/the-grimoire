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
  await expect(panel.locator('.bracket-badge')).toHaveText('Bracket 1–2');
  await panel.getByRole('button', { name: '2', exact: true }).click();
  await expect(panel).toContainText('Cards fit Bracket 2 (Core)');
  await page.reload();
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
  await expect(panel).toContainText('Off until you turn it on');
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
  await expect(panel).toContainText('sends the deck’s card names');
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
  for (const path of ['/', '/#/collection', '/#/collection/inventory', '/#/collection/transactions']) {
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
