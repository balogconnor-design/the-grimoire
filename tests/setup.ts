import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Tests must never reach Scryfall. Any test that needs card data mocks src/lib/scryfall.
vi.stubGlobal('fetch', () => Promise.reject(new Error('Network access is disabled in tests')));
