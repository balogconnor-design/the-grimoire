import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { isNetworkError, symbolUrl } from '../src/lib/scryfall';

describe('mana symbols', () => {
  it('serves the six colour pips from the app itself', () => {
    for (const s of ['W', 'U', 'B', 'R', 'G', 'C']) {
      expect(symbolUrl(s)).toBe(`/symbols/${s}.svg`);
      expect(symbolUrl(`{${s}}`)).toBe(`/symbols/${s}.svg`);
      expect(existsSync(new URL(`../public/symbols/${s}.svg`, import.meta.url))).toBe(true);
    }
  });
  it('still gets other symbols from Scryfall', () => {
    expect(symbolUrl('W/U')).toMatch(/^https:\/\/svgs\.scryfall\.io\/card-symbols\/WU\.svg$/);
    expect(symbolUrl('T')).toMatch(/^https:\/\/svgs\.scryfall\.io\//);
  });
});

describe('network errors', () => {
  it('recognises how Safari, Chrome and Firefox word a failed request', () => {
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isNetworkError(new Error('Scryfall request failed (500)'))).toBe(false);
  });
});
