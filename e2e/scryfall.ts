import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/** A real Scryfall card (Sol Ring, C21), saved so the tests never touch the network. */
export const SOL_RING = JSON.parse(readFileSync(new URL('./fixtures/sol-ring.json', import.meta.url), 'utf8'));
const PNG = readFileSync(new URL('../public/favicon.png', import.meta.url));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#999"/></svg>';

/** Answer every Scryfall request locally: searches return Sol Ring, images return placeholders. */
export async function mockScryfall(page: Page) {
  await page.route('https://api.scryfall.com/**', (route) => {
    const url = new URL(route.request().url());
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    // Scryfall tag downloads (CSV): Sol Ring is ramp and a mana rock; other tags have no cards.
    if (url.pathname === '/cards/search' && url.searchParams.get('format') === 'csv') {
      const tagged = ['otag:ramp', 'otag:mana-rock'].includes(url.searchParams.get('q') ?? '');
      return tagged ? route.fulfill({ status: 200, contentType: 'text/csv', body: 'name\nSol Ring\n' }) : json(404, { object: 'error', status: 404 });
    }
    if (url.pathname === '/cards/search') return json(200, { object: 'list', total_cards: 1, has_more: false, data: [SOL_RING] });
    if (url.pathname === '/cards/collection') return json(200, { object: 'list', data: [SOL_RING], not_found: [] });
    if (url.pathname === '/sets') return json(200, { object: 'list', data: [{ code: 'c21', name: 'Commander 2021', set_type: 'commander', released_at: '2021-04-23' }] });
    if (url.pathname === '/symbology') return json(200, { object: 'list', data: [] });
    return json(404, { object: 'error', status: 404, details: 'Not mocked in e2e tests' });
  });
  await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('https://svgs.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
}
