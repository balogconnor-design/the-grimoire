import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { loadAll } from './lib/store';
import { loadSymbology } from './lib/scryfall';
import { autoRefreshCollection, backfillLedger } from './lib/collection';
import { watchScryfallTagSettings } from './lib/scryfallTags';
import './styles.css';

// Load every store, then refresh collection + deck prices (at most once a day) to build price history.
void loadAll().then(async () => {
  await backfillLedger();
  await autoRefreshCollection();
});
// Scryfall tags (opt-in): the bundled data loads the first time they are turned on.
watchScryfallTagSettings();
// Symbols used to be cached for a year without re-checking; drop that cache so a bad copy can't stick.
if (typeof caches !== 'undefined') void caches.delete('scryfall-symbols').catch(() => undefined);
void loadSymbology();

// Branch preview builds only (see vite.config.ts): an on-page console, opened from the gear button.
if (__PREVIEW_CONSOLE__) void import('eruda').then(({ default: eruda }) => eruda.init());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
