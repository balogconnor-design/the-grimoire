import { expect, test, type Page } from '@playwright/test';
import { mockScryfall } from './scryfall';

// Errors the app logs or throws fail the test (Scryfall is mocked, so there's no network noise).
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
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
  await page.getByRole('button', { name: /All tags/ }).click();
  const pick = page.locator('.tag-pick', { hasText: 'ramp' });
  await expect(pick).toContainText('1');
  await pick.click();
  await expect(page.locator('.tag-group')).toContainText('Sol Ring');

  // #ramp alone searches your own cards.
  const box = page.locator('.search-form input').first();
  await box.fill('#ramp');
  await box.press('Enter');
  await expect(page.locator('.results-meta')).toContainText('1 of your cards');
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
  await page.getByRole('button', { name: /All tags/ }).click();
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
