import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import type { Card, SaleRecord } from '../src/types';
import { loadAll, resetDbForTests } from '../src/lib/store';

export const fixturePath = (name: string) => resolve(__dirname, 'fixtures', name);
export const hasFixture = (name: string) => existsSync(fixturePath(name));
export const readFixture = (name: string) => readFileSync(fixturePath(name), 'utf8');

let n = 0;
/** A minimal but valid card snapshot. */
export function card(name: string, over: Partial<Card> = {}): Card {
  n++;
  return {
    id: over.id ?? `card-${n}-${name.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    layout: 'normal',
    cmc: 2,
    type_line: 'Artifact',
    color_identity: [],
    legalities: { commander: 'legal' },
    prices: { usd: '1.00' },
    set: 'tst',
    set_name: 'Test Set',
    collector_number: String(n),
    rarity: 'common',
    ...over,
  };
}

export const basic = (name: 'Island' | 'Mountain' | 'Forest' | 'Plains' | 'Swamp') =>
  card(name, { type_line: `Basic Land — ${name}`, cmc: 0, prices: { usd: '0.10' } });

export function tx(over: Partial<SaleRecord> & Pick<SaleRecord, 'kind' | 'date'>): SaleRecord {
  n++;
  return { id: `tx-${n}`, card: card(`Tx card ${n}`), finish: 'nonfoil', qty: 1, createdAt: n, updatedAt: n, ...over };
}

/** Swap in a brand-new empty IndexedDB and reload the in-memory tables from it. */
export async function freshDb() {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  await loadAll();
}
