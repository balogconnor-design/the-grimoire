import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockScryfall, SOL_RING } from './scryfall';

// The photo scanner end to end: real OCR (Tesseract, served by the app) on cards drawn in a canvas,
// under the same Content-Security-Policy the hosted site sends, then the review screen and the add.

const CSP = /Content-Security-Policy: (.+)/.exec(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'))![1].trim();

/** Every page and worker script from the app gets the production CSP header (vite preview sends none). */
async function withCsp(page: Page) {
  await page.context().route(/^http:\/\/localhost:4173\//, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': CSP } });
  });
}

// Lightning Bolt in two printings (made from the Sol Ring fixture; only the fields the scanner shows).
const bolt = (set: string, cn: string, setName: string) => ({
  ...SOL_RING, id: `bolt-${set}`, oracle_id: 'bolt', name: 'Lightning Bolt', set, set_name: setName, collector_number: cn,
  type_line: 'Instant', finishes: ['nonfoil', 'foil'], prices: { usd: '1.50', usd_foil: '4.00' },
});
const BOLT_M10 = bolt('m10', '146', 'Magic 2010');
const BOLT_2X2 = bolt('2x2', '117', 'Double Masters 2022');

/**
 * A PNG "photo" of two cards on a table: Sol Ring with its collector line (C21 #263), and Lightning
 * Bolt whose collector line is covered by a sleeve sticker (so its printing has to be guessed).
 */
async function cardPhoto(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#6b6b6b'; g.fillRect(0, 0, c.width, c.height); // table
    const card = (x: number, title: string, type: string, text: string, info?: [string, string]) => {
      const y = 140, w = 630, h = 880;
      g.fillStyle = '#111'; g.fillRect(x, y, w, h); // black border
      g.fillStyle = '#e8e4dc'; g.fillRect(x + 28, y + 28, w - 56, h - 90); // frame
      g.fillStyle = '#111';
      g.font = 'bold 28px Georgia, serif'; g.fillText(title, x + 46, y + 68);
      g.font = '28px Georgia, serif'; g.fillText(type, x + 46, y + 520);
      g.font = '24px Georgia, serif'; g.fillText(text, x + 46, y + 590);
      if (!info) return;
      g.fillStyle = '#eee'; g.font = 'bold 15px Arial, sans-serif';
      g.fillText(info[0], x + 40, y + h - 36);
      g.fillText(info[1], x + 40, y + h - 16);
    };
    card(120, 'Sol Ring', 'Artifact', 'Tap: Add two colorless mana.', ['263/281 R', 'C21 • EN    Mike Bierek']);
    card(850, 'Lightning Bolt', 'Instant', 'Deal 3 damage to any target.');
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(data, 'base64');
}

test('scan a photo: reads the cards, a printing is read or picked, then they go into the collection', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await withCsp(page);
  await mockScryfall(page);
  // Lookups by set + number or by name, and Lightning Bolt's printings.
  await page.route('https://api.scryfall.com/cards/collection', async (route) => {
    const ids = route.request().postDataJSON().identifiers as { name?: string; set?: string; collector_number?: string }[];
    const data = ids.map((x) => (x.name === 'Lightning Bolt' ? (x.set === '2x2' ? BOLT_2X2 : BOLT_M10) : SOL_RING));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, not_found: [] }) });
  });
  await page.route(/https:\/\/api\.scryfall\.com\/cards\/search\?.*oracleid/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', total_cards: 2, has_more: false, data: [BOLT_2X2, BOLT_M10] }),
  }));

  await page.goto('/#/collection');
  await page.getByRole('button', { name: '+ Add cards' }).first().click();
  await page.getByRole('button', { name: 'Scan photos' }).click();
  await page.getByTestId('scan-files').setInputFiles({ name: 'cards.png', mimeType: 'image/png', buffer: await cardPhoto(page) });
  await expect(page.getByRole('img', { name: 'Photo 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Scan photo', exact: true }).click();

  // Bolt's printing was guessed, so it's in "Check these"; Sol Ring's was read, so it's under Confirmed (folded).
  await expect(page.getByText('2 cards found')).toBeVisible({ timeout: 90_000 });
  const tiles = page.getByTestId('scan-tile');
  await expect(tiles).toHaveCount(1);
  const boltTile = tiles.filter({ hasText: 'Lightning Bolt' });
  await expect(boltTile).toContainText('Printing guessed');
  await expect(boltTile).toContainText('M10 #146');
  await expect(boltTile.getByRole('img', { name: 'From your photo' })).toBeVisible();
  await page.getByRole('button', { name: /Confirmed \(1\)/ }).click();
  const solTile = tiles.filter({ hasText: 'Sol Ring' });
  await expect(solTile).toContainText('C21 #263');
  await expect(solTile).toContainText('Printing read from card');

  // Pick the right printing of Bolt, make it foil, add two Sol Rings.
  await boltTile.getByRole('button', { name: 'Change printing' }).click();
  await page.getByRole('button', { name: /Lightning Bolt \(2X2 #117\)/ }).click();
  await expect(boltTile).toContainText('2X2 #117');
  await expect(boltTile).toContainText('Printing chosen');
  await boltTile.getByLabel('Finish').selectOption('foil');
  await expect(boltTile).toContainText('$4.00');
  await solTile.getByRole('button', { name: 'One more' }).click();
  await expect(solTile.getByLabel('Quantity')).toHaveText('2');

  await page.getByRole('button', { name: 'Add 3 cards to collection' }).click();
  await expect(page.getByText('Added 3 cards to your collection')).toBeVisible();
  await page.locator('.coll-tabs').getByRole('button', { name: 'Inventory' }).click();
  await expect(page.locator('main')).toContainText('Sol Ring');
  await expect(page.locator('main')).toContainText('Lightning Bolt');
  expect(errors).toEqual([]);
});
