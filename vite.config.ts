import { readFileSync } from 'node:fs';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { handleCombos } from './shared/spellbook';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

// Node's process.env, typed here so the app's tsconfig doesn't need Node types.
declare const process: { env: Record<string, string | undefined> };

const DAY = 24 * 60 * 60;

/**
 * Serve POST /api/combos from the dev and preview servers too, with the same code as the Cloudflare
 * Pages Function (functions/api/combos.ts), so combo checks work locally without wrangler.
 */
// Just the parts of Node's request/response used here (the app's tsconfig has no Node types).
interface NodeReq {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', cb: (chunk: Uint8Array) => void): void;
  on(event: 'end', cb: () => void): void;
}
interface NodeRes { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }

function combosApi(): Plugin {
  const handle = (req: NodeReq, res: NodeRes, next: () => void) => {
    if (!req.url?.startsWith('/api/combos')) return next();
    const chunks: Uint8Array[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      chunks.reduce((at, c) => { body.set(c, at); return at + c.length; }, 0);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === 'POST' ? body : undefined });
      const response = await handleCombos(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await response.text());
    });
  };
  const middleware: Connect.NextHandleFunction = (req, res, next) => handle(req as unknown as NodeReq, res as unknown as NodeRes, next);
  return {
    name: 'grimoire-combos-api',
    configureServer: (server) => { server.middlewares.use(middleware); },
    configurePreviewServer: (server) => { server.middlewares.use(middleware); },
  };
}

/**
 * The photo scanner's OCR engine (Tesseract.js) runs from the app's own files under /tesseract/, never a
 * CDN (the CSP only allows our own scripts). Served from node_modules by the dev and preview servers,
 * copied into dist by the build. Only the LSTM engine builds are needed (OEM.LSTM_ONLY in src/lib/scan/ocr.ts);
 * the worker picks one by the browser's WebAssembly SIMD support.
 */
const TESSERACT_FILES: Record<string, string> = {
  'tesseract/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract/core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract/core/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract/lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};

function tesseractAssets(): Plugin {
  const serve: Connect.NextHandleFunction = (rawReq, rawRes, next) => {
    const req = rawReq as unknown as NodeReq;
    const res = rawRes as unknown as Omit<NodeRes, 'end'> & { end(body: Uint8Array): void };
    const path = (req.url ?? '').split('?')[0].replace(/^\//, '');
    const from = TESSERACT_FILES[path];
    if (!from) return next();
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(readFileSync(from));
  };
  return {
    name: 'grimoire-tesseract-assets',
    configureServer: (server) => { server.middlewares.use(serve); },
    configurePreviewServer: (server) => { server.middlewares.use(serve); },
    generateBundle() {
      for (const [fileName, from] of Object.entries(TESSERACT_FILES)) this.emitFile({ type: 'asset', fileName, source: readFileSync(from) });
    },
  };
}

// Cloudflare Pages sets CF_PAGES_BRANCH during its builds. Branch previews (anything but main) get an
// on-page developer console (Eruda) for debugging on phones without a computer attached.
// Production and local builds never include it.
const branch = process.env.CF_PAGES_BRANCH;
const previewConsole = !!branch && branch !== 'main';

export default defineConfig({
  define: { __PREVIEW_CONSOLE__: JSON.stringify(previewConsole), __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    combosApi(),
    tesseractAssets(),
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
        background_color: '#141414',
        theme_color: '#141414',
        categories: ['games', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'], // the plugin adds manifest.webmanifest itself
        // 404.html: Cloudflare's not-found page, never needed offline. tesseract/: the scanner's ~7 MB
        // OCR engine, fetched only when someone scans (then cached by the rule below).
        globIgnores: ['404.html', 'tesseract/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//], // the combo proxy is a server route, never the app shell
        cleanupOutdatedCaches: true,
        // Scryfall's image hosts allow CORS, so fetch in cors mode: the cached copies are readable
        // and sized normally (opaque no-cors responses count as megabytes each against storage).
        // The Scryfall API itself is never cached, so search results and prices are always live.
        runtimeCaching: [
          {
            // The OCR engine and its English data. Cache-first: the files only change with a new
            // Tesseract.js version, and then the cache name changes too.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: `tesseract-${pkg.dependencies['tesseract.js'].replace(/[^\w.]/g, '')}`,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 10, purgeOnQuotaError: true },
            },
          },
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
            // Stale-while-revalidate: a bad copy is replaced on the next view instead of sticking for a year.
            urlPattern: /^https:\/\/svgs\.scryfall\.io\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'scryfall-symbols-v2',
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
