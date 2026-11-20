import { defineConfig, devices } from '@playwright/test';

// End-to-end smoke tests: the production build (npm run build) served by `vite preview`, driven in
// Chromium, Firefox and WebKit (Safari's engine), plus phone-sized Android and iPhone emulation.
// Scryfall is mocked (e2e/scryfall.ts), so the tests need no network.
// Run with `npm run test:e2e` (builds first). First time: `npx playwright install chromium firefox webkit`.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // Firefox times out when too many browsers start at once on one machine.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A fresh Firefox profile can take several seconds to open IndexedDB the first time on a busy machine.
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // The service worker would cache one test's build for the next; only the offline test turns it on.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
