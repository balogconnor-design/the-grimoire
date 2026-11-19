import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { loadAll } from './lib/store';
import { loadSymbology } from './lib/scryfall';
import { autoRefreshCollection, backfillLedger } from './lib/collection';
import './styles.css';

// Load every store, then refresh collection + deck prices (at most once a day) to build price history.
void loadAll().then(async () => {
  await backfillLedger();
  await autoRefreshCollection();
});
void loadSymbology();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
