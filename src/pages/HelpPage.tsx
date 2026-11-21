import type { ReactNode } from 'react';
import { isPortable } from '../lib/device';
import { navigate } from '../lib/router';

const ISSUES = 'https://github.com/balogconnor-design/the-grimoire/issues/new/choose';
const SOURCE = 'https://github.com/balogconnor-design/the-grimoire';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="help-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Help & about: where data lives, backups, installing, offline, privacy, feedback and credits. */
export function HelpPage() {
  const portable = isPortable();
  return (
    <div className="help-page">
      <h1>Help &amp; about</h1>
      <p className="muted">
        The Grimoire is a free deck builder and collection tracker for Magic: The Gathering, focused on Commander.
        Version {__APP_VERSION__}{portable ? ' (portable app)' : ''}.
      </p>

      <Section title="Where your data lives">
        <p>
          There's no account and no server. Your decks, collection, ledger, watchlist and price history are saved only{' '}
          {portable ? <>in the <b>data</b> folder next to <b>The Grimoire.exe</b>, so they travel with the drive.</> : <>in this browser, on this device.</>}
        </p>
        <ul>
          <li>Each browser, device and installed copy keeps its <b>own separate data</b>. The web app, the portable app and a phone don't share anything automatically.</li>
          <li>To keep a copy or move your data, use <b>Collection → Export &amp; backup → Full backup</b>, then <b>Restore</b> it wherever you want it. A new, empty library also offers <b>Restore a backup</b>.</li>
          <li>The app reminds you if you've never backed up or your last backup is over a month old.</li>
          {!portable && <li>Clearing your browser's site data (or browsing in a private window) deletes what's saved. Keep backups.</li>}
        </ul>
      </Section>

      {!portable && (
        <Section title="Install it like an app">
          <ul>
            <li><b>Chrome or Edge (Windows, Mac, Linux):</b> click the install icon at the right of the address bar.</li>
            <li><b>Android:</b> browser menu → <b>Install app</b> (or <b>Add to Home screen</b>).</li>
            <li><b>iPhone and iPad:</b> in Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. Install before adding data: the installed app keeps its own storage, separate from Safari, and Safari can clear a website's data after 7 days without a visit.</li>
          </ul>
          <p>Once installed it opens in its own window, works offline, and updates itself: when a new version is out, a bar offers <b>Reload</b>.</p>
        </Section>
      )}

      <Section title="Offline">
        <p>
          Your decks, collection and ledger always work without a connection{portable ? '' : ' after your first visit'}. Card images you've
          already viewed are kept. Searching for cards and refreshing prices need the internet, because they come from Scryfall.
        </p>
      </Section>

      <Section title="Privacy">
        <ul>
          <li>Everything you enter stays on your device. The app never uploads your decks or collection.</li>
          <li>Card searches, images and prices are requested straight from your browser to <a href="https://scryfall.com" target="_blank" rel="noreferrer">Scryfall</a>.</li>
          <li>
            EDHREC data is off until you turn it on in a Commander deck's details. Then salt scores and your commander's page are
            downloaded from <a href="https://edhrec.com" target="_blank" rel="noreferrer">EDHREC</a>: only the commander's name is sent,
            never your deck.
          </li>
          {!portable && <li>The website counts visits with Cloudflare Web Analytics: no cookies, no personal data, no tracking across sites.</li>}
        </ul>
      </Section>

      <Section title="Feedback and bug reports">
        <p>
          Found a bug or have an idea? <a href={ISSUES} target="_blank" rel="noreferrer">Open an issue on GitHub</a>. Please include the
          version above and your browser and device. The <a href={SOURCE} target="_blank" rel="noreferrer">source code</a> is open (MIT license).
        </p>
      </Section>

      <Section title="Credits">
        <p>
          Card data and images come from <a href="https://scryfall.com" target="_blank" rel="noreferrer">Scryfall</a>. Salt scores and commander
          suggestions (if you turn them on) come from <a href="https://edhrec.com" target="_blank" rel="noreferrer">EDHREC</a>. The Grimoire is unofficial
          fan content permitted under the Wizards of the Coast Fan Content Policy. It is not approved or endorsed by Wizards. Portions of the
          materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
        </p>
      </Section>

      <p><button className="btn" onClick={() => navigate('/')}>← Back to the app</button></p>
    </div>
  );
}
