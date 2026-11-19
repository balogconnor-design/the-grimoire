import { useEffect, useState } from 'react';
import { Library } from './pages/Library';
import { DeckPage } from './pages/DeckPage';
import { CollectionPage, type CollectionTab } from './pages/CollectionPage';
import { navigate } from './lib/router';
import logoUrl from './assets/grimoire-logo.png';

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

type Theme = 'dark' | 'light';
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('deckforge.theme') as Theme) || 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('deckforge.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export function App() {
  const route = useHashRoute();
  const [theme, toggleTheme] = useTheme();
  const deckMatch = route.match(/^\/deck\/([^/]+)/);
  const collMatch = route.match(/^\/collection(?:\/(\w+))?/);
  const rawTab = collMatch?.[1] === 'sales' ? 'transactions' : collMatch?.[1] ?? '';
  const collTab = (['inventory', 'decks', 'transactions', 'buy', 'binder', 'watch'].includes(rawTab) ? rawTab : 'overview') as CollectionTab;
  const section = deckMatch ? 'decks' : collMatch ? 'collection' : 'home';

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')}>
          <img className="brand-logo" src={logoUrl} alt="" width={36} height={36} />
          <span className="brand-name">The Grimoire</span>
        </button>
        <nav className="main-nav" aria-label="Main">
          <button className={`nav-link ${section !== 'collection' ? 'on' : ''}`} onClick={() => navigate('/')}>Search & Decks</button>
          <button className={`nav-link ${section === 'collection' ? 'on' : ''}`} onClick={() => navigate('/collection')}>Collection</button>
        </nav>
        <span className="muted small topbar-tag">card data from Scryfall</span>
        <button className="icon-btn theme-btn" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>
      <main>
        {deckMatch ? <DeckPage key={deckMatch[1]} id={deckMatch[1]} /> : collMatch ? <CollectionPage tab={collTab} /> : <Library />}
      </main>
      <footer className="app-footer muted small">
        <p className="footer-data">Your decks and collection are saved only in this browser on this device. Use <strong>Collection → Export &amp; backup</strong> to keep a copy or move them elsewhere.</p>
        The Grimoire is unofficial fan content. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast. Magic: The Gathering, card names, text, symbols and artwork are the property of Wizards of the Coast LLC and the artists. Card images and data are provided by Scryfall.
      </footer>
    </div>
  );
}
