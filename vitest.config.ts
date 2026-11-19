import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Every test file gets a fresh in-memory IndexedDB (fake-indexeddb). No network is used.
    setupFiles: ['tests/setup.ts'],
  },
});
