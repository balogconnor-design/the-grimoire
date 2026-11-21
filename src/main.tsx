import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { loadAll } from './lib/store';
import { loadSymbology } from './lib/scryfall';
import { autoRefreshCollection, backfillLedger } from './lib/collection';
import { loadScryfallTags } from './lib/scryfallTags';
import './styles.css';

// Load every store, then refresh collection + deck prices (at most once a day) to build price history.
void loadAll().then(async () => {
  await backfillLedger();
  await autoRefreshCollection();
});
// Scryfall tags: saved lists first, then a background download of any list that is missing or a week old.
void loadScryfallTags();
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
