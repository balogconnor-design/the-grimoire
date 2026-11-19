import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const DAY = 24 * 60 * 60;

export default defineConfig({
  plugins: [
    react(),
    // Installable web app + offline support. The service worker is only built for production
    // (npm run build); the dev server never registers one.
    VitePWA({
      registerType: 'prompt', // a new version waits until the user clicks Reload (UpdatePrompt.tsx)
      injectRegister: false, // registered from UpdatePrompt.tsx, and not in the portable build
      includeManifestIcons: false, // the icons are already precached by globPatterns below
      manifest: {
        id: '/',
        name: 'The Grimoire',
        short_name: 'Grimoire',
        description: 'Deck builder and collection tracker for Magic: The Gathering.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0f1218',
        theme_color: '#0f1218',
        categories: ['games', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'], // the plugin adds manifest.webmanifest itself
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Scryfall's image hosts allow CORS, so fetch in cors mode: the cached copies are readable
        // and sized normally (opaque no-cors responses count as megabytes each against storage).
        // The Scryfall API itself is never cached, so search results and prices are always live.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cards\.scryfall\.io\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'scryfall-card-images',
              fetchOptions: { mode: 'cors', credentials: 'omit' },
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * DAY, purgeOnQuotaError: true },
            },
          },
          {
            urlPattern: /^https:\/\/svgs\.scryfall\.io\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'scryfall-symbols',
              fetchOptions: { mode: 'cors', credentials: 'omit' },
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 300, maxAgeSeconds: 365 * DAY, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
  // Saved data lives in the browser per address (localhost:5173). If that port is busy, fail
  // instead of silently moving to another port, where the app would look empty.
  server: { port: 5173, strictPort: true },
});
