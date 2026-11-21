import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { Card, Deck, DeckEntry } from '../types';
import { addCard } from '../lib/actions';
import { setCardDrag } from '../lib/dnd';
import { getNamed } from '../lib/scryfall';
import { commanderEntry, isLand } from '../lib/rules';
import { setSettings, useSettings } from '../lib/store';
import {
  edhrecCommanderUrl, ensureSalt, getCommanderData, loadSuggestionCards, suggestionCard, useSalt, useSaltStatus,
  type CommanderData, type Suggestion,
} from '../lib/edhrec';
import { CardModal } from './CardModal';
import { useToast } from './Toast';

const SHOWN = 10;
const SALTY_SHOWN = 5;
type SortBy = 'inclusion' | 'synergy';
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signedPct = (x: number) => {
  const n = Math.round(x * 100);
  return n === 0 ? '0%' : `${n > 0 ? '+' : '−'}${Math.abs(n)}%`;
};
/** Basic lands top every "most played" list; they're added with the basic land adder instead. */
const BASICS = /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest|Wastes)$/;

/** What the card window shows: a deck entry (salt list) or a card that isn't in the deck (suggestions). */
type Viewing = { card: Card; entryUid?: string } | null;

/** Opt-in EDHREC data for a Commander deck: salt scores and cards commonly played with the commander. */
export function EdhrecPanel({ deck }: { deck: Deck }) {
  const settings = useSettings();
  const on = !!settings.edhrec;
  const [viewing, setViewing] = useState<Viewing>(null);

  return (
    <div className="detail-section edhrec-panel">
      <div className="section-head">
        <h3>EDHREC</h3>
        {on && <button className="link-btn small" onClick={() => setSettings({ edhrec: false })}>Turn off</button>}
      </div>
      {on ? <EdhrecData deck={deck} onView={setViewing} /> : (
        <>
          <p className="muted small">
            Salt scores and the cards most often played with your commander, from EDHREC. Off until you turn it on.
          </p>
          <button className="btn btn-sm" onClick={() => setSettings({ edhrec: true })}>Turn on EDHREC</button>
          <div className="muted tiny">
            Downloads public data from json.edhrec.com: the salt list (about 2 MB, once a week) and your commander’s page (once a day).
            {' '}Only the commander’s name is sent, never your deck.
          </div>
        </>
      )}
      {viewing && <CardModal card={viewing.card} deckId={deck.id} entryUid={viewing.entryUid} onClose={() => setViewing(null)} />}
    </div>
  );
}

function EdhrecData({ deck, onView }: { deck: Deck; onView: (v: Viewing) => void }) {
  const salt = useSalt();
  const saltStatus = useSaltStatus();
  useEffect(() => { void ensureSalt(); }, []);

  const main = useMemo(() => deck.entries.filter((e) => e.board === 'main'), [deck.entries]);
  const scored = useMemo(() => {
    const byName = new Map<string, { entry: DeckEntry; salt: number }>();
    for (const e of main) {
      const s = salt.get(e.card.name) ?? salt.get(e.card.name.split(' // ')[0]);
      if (s != null && !byName.has(e.card.name)) byName.set(e.card.name, { entry: e, salt: s });
    }
    return [...byName.values()].sort((a, b) => b.salt - a.salt);
  }, [main, salt]);
  const total = scored.reduce((n, x) => n + x.salt, 0);
  const nonland = new Set(main.filter((e) => !isLand(e.card)).map((e) => e.card.name)).size;

  return (
    <>
      <div className="edhrec-block">
        <div className="edhrec-subhead">
          <span className="edhrec-subhead-title">Salt</span>
          {salt.size > 0 && (
            <span className="edhrec-stats">
              <span className="edhrec-stat" title="Sum of the salt scores of every card in the main deck"><b>{total.toFixed(1)}</b> total</span>
              <span className="edhrec-stat" title="Total salt divided by the number of nonland cards"><b>{(nonland ? total / nonland : 0).toFixed(2)}</b> avg</span>
            </span>
          )}
        </div>
        {salt.size === 0 ? (
          <div className="muted small">
            {saltStatus.state === 'loading' ? 'Downloading salt scores…' : saltStatus.state === 'error' ? 'EDHREC isn’t available right now. Try again later.' : 'Loading…'}
          </div>
        ) : scored.length === 0 ? (
          <div className="muted small">None of these cards has a salt score.</div>
        ) : (
          <ol className="edhrec-salty">
            {scored.slice(0, SALTY_SHOWN).map(({ entry, salt: s }) => (
              <li key={entry.uid}>
                <button className="edhrec-card-btn" onClick={() => onView({ card: entry.card, entryUid: entry.uid })} title={`View ${entry.card.name}`}>
                  <span className="truncate">{entry.card.name}</span>
                </button>
                <span className="edhrec-salt-score" title="EDHREC salt score, 0–4">{s.toFixed(2)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <Suggestions deck={deck} onView={onView} />
      <div className="muted tiny">
        Salt is EDHREC’s 0–4 score from player surveys of the cards people least like playing against. Data from{' '}
        <a href="https://edhrec.com" target="_blank" rel="noreferrer">EDHREC</a>; salt refreshes weekly, commander pages daily.
      </div>
    </>
  );
}

function Suggestions({ deck, onView }: { deck: Deck; onView: (v: Viewing) => void }) {
  const cmd = commanderEntry(deck);
  const name = cmd?.card.name;
  const toast = useToast();
  const [data, setData] = useState<CommanderData | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('inclusion');
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [, setLookups] = useState(0); // bumped when Scryfall card data arrives

  useEffect(() => {
    if (!name) return;
    let live = true;
    setData(undefined);
    setFailed(false);
    getCommanderData(name).then((d) => live && setData(d)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [name]);

  const inDeck = useMemo(() => {
    const s = new Set<string>();
    for (const e of deck.entries) { s.add(e.card.name); s.add(e.card.name.split(' // ')[0]); }
    return s;
  }, [deck.entries]);
  const missing = useMemo(() => {
    const list = (data?.suggestions ?? []).filter((x) => !BASICS.test(x.name) && !inDeck.has(x.name) && !inDeck.has(x.name.split(' // ')[0]));
    return [...list].sort((a, b) => b[sortBy] - a[sortBy]);
  }, [data, inDeck, sortBy]);
  const shown = all ? missing : missing.slice(0, SHOWN);

  // Fetch the shown cards from Scryfall so they can be opened and dragged like search results.
  const shownKey = shown.map((s) => s.name).join('\n');
  useEffect(() => {
    if (!shownKey) return;
    let live = true;
    loadSuggestionCards(shownKey.split('\n')).then(() => live && setLookups((n) => n + 1)).catch(() => undefined);
    return () => { live = false; };
  }, [shownKey]);

  const cardFor = async (s: Suggestion): Promise<Card> => suggestionCard(s.name) ?? getNamed(s.name);
  const add = async (s: Suggestion) => {
    setAdding(s.name);
    try {
      toast(addCard(deck.id, await cardFor(s), 1, 'main'), 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setAdding(null);
    }
  };
  const view = async (s: Suggestion) => {
    try { onView({ card: await cardFor(s) }); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const onDragStart = (e: DragEvent, s: Suggestion) => {
    const card = suggestionCard(s.name);
    if (card) setCardDrag(e.dataTransfer, card);
    else e.preventDefault(); // card data not here yet
  };

  if (!name) return <div className="muted small edhrec-block">Choose a commander to see what its decks usually play.</div>;
  return (
    <div className="edhrec-block">
      <div className="edhrec-subhead">
        <span className="edhrec-subhead-title">Popular with {name.split(' // ')[0]}</span>
        <a className="link-btn small" href={edhrecCommanderUrl(name)} target="_blank" rel="noreferrer">EDHREC ↗</a>
      </div>
      {failed ? <div className="muted small">EDHREC isn’t available right now. Try again later.</div>
        : data === undefined ? <div className="muted small">Loading…</div>
        : data === null ? <div className="muted small">EDHREC has no page for this commander.</div>
        : (
          <>
            <div className="producer-kinds">
              {(['inclusion', 'synergy'] as const).map((k) => (
                <button key={k} className={`chip ${sortBy === k ? 'chip-on' : ''}`} aria-pressed={sortBy === k} onClick={() => setSortBy(k)}>
                  {k === 'inclusion' ? 'Most played' : 'High synergy'}
                </button>
              ))}
              <span className="muted small">{data.decks.toLocaleString()} decks</span>
            </div>
            {missing.length === 0 ? <div className="muted small">You already run every card EDHREC lists.</div> : (
              <table className="color-table edhrec-table">
                <thead>
                  <tr>
                    <th>Card you don’t run</th>
                    <th title="Share of this commander's decks that play it">Decks</th>
                    <th title="How much more often this commander's decks play it than other decks that could">Synergy</th>
                    <th aria-label="Add" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => {
                    const ready = !!suggestionCard(s.name);
                    return (
                      <tr key={s.name} className="clickable" onClick={() => view(s)} tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && view(s)}
                        title={ready ? `${s.name}: click to view, drag onto the deck list to add` : `${s.name}: click to view`}>
                        <td>
                          <span className={`truncate edhrec-drag ${ready ? 'is-draggable' : ''}`} draggable={ready || undefined}
                            onDragStart={(e) => onDragStart(e, s)}>{s.name}</span>
                        </td>
                        <td>{pct(s.inclusion)}</td>
                        <td className={s.synergy <= 0 ? 'muted' : ''}>{signedPct(s.synergy)}</td>
                        <td>
                          <button className="mini-btn" disabled={adding === s.name} onClick={(e) => { e.stopPropagation(); void add(s); }}
                            title={`Add ${s.name} to the main deck`} aria-label={`Add ${s.name} to main deck`}>+</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {missing.length > SHOWN && (
              <button className="link-btn small" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${missing.length}`}</button>
            )}
          </>
        )}
    </div>
  );
}
