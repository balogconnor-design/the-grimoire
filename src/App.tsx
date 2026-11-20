import { useEffect, useState } from 'react';
import { Library } from './pages/Library';
import { DeckPage } from './pages/DeckPage';
import { CollectionPage, type CollectionTab } from './pages/CollectionPage';
import { HelpPage } from './pages/HelpPage';
import { navigate } from './lib/router';
import { UpdatePrompt } from './components/UpdatePrompt';
import { DataSafety } from './components/DataSafety';
import { isPortable } from './lib/device';
import logoUrl from './assets/grimoire-logo.png';

const THEME_COLOR: Record<string, string> = { dark: '#0f1218', light: '#f3f5f8' };

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
    // Colors the browser/phone status bar to match, including the installed app.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
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
  const collTab = (['inventory', 'favorites', 'decks', 'transactions', 'buy', 'binder', 'watch'].includes(rawTab) ? rawTab : 'overview') as CollectionTab;
  const helpMatch = route.startsWith('/help');
  const section = deckMatch ? 'decks' : collMatch ? 'collection' : helpMatch ? 'help' : 'home';

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
          <button className={`nav-link ${section === 'home' || section === 'decks' ? 'on' : ''}`} onClick={() => navigate('/')}>Search & Decks</button>
          <button className={`nav-link ${section === 'collection' ? 'on' : ''}`} onClick={() => navigate('/collection')}>Collection</button>
        </nav>
        <span className="muted small topbar-tag">card data from Scryfall</span>
        <button className={`icon-btn help-btn ${section === 'help' ? 'on' : ''}`} onClick={() => navigate('/help')} title="Help & about" aria-label="Help and about">?</button>
        <button className="icon-btn theme-btn" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>
      <DataSafety />
      <main>
        {deckMatch ? <DeckPage key={deckMatch[1]} id={deckMatch[1]} /> : collMatch ? <CollectionPage tab={collTab} /> : helpMatch ? <HelpPage /> : <Library />}
      </main>
      {/* The portable launcher already works offline, so it skips the service worker (which would
          otherwise keep serving the old app after the portable app folder is replaced). */}
      {!isPortable() && <UpdatePrompt />}
      <footer className="app-footer muted small">
        <p className="footer-data">Your decks and collection are saved only in this browser on this device. Use <strong>Collection → Export &amp; backup</strong> to keep a copy or move them elsewhere. <button className="link-btn" onClick={() => navigate('/help')}>Help &amp; about</button></p>
        The Grimoire is unofficial fan content. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast. Magic: The Gathering, card names, text, symbols and artwork are the property of Wizards of the Coast LLC and the artists. Card images and data are provided by Scryfall.
      </footer>
    </div>
  );
}
