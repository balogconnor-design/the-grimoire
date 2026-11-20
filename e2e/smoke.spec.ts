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

test('every collection tab renders', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/#/collection');
  for (const tab of ['inventory', 'decks', 'transactions', 'buy', 'binder', 'watch', '']) {
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
