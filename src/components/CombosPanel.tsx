import { useEffect, useMemo, useState } from 'react';
import type { Card, Deck } from '../types';
import { addCard } from '../lib/actions';
import { cardByName, loadCardsByName } from '../lib/cardsByName';
import {
  checkCombos, COMBO_TAG_LABEL, combosAvailable, currentCombos, deckSignature, useCombos, type Combo,
} from '../lib/combos';
import { getNamed } from '../lib/scryfall';
import { CardLink } from './CardLink';
import { CardModal } from './CardModal';
import { useToast } from './Toast';

const ALMOST_SHOWN = 8;
const PRODUCES_SHOWN = 3;
const comboUrl = (id: string) => `https://commanderspellbook.com/combo/${id}/`;
type Viewing = { card: Card; entryUid?: string } | null;

/** Commander Spellbook combo check for a Commander deck: combos in the deck and combos one card away. */
export function CombosPanel({ deck }: { deck: Deck }) {
  const { state, error, saved } = useCombos(deck.id);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [allAlmost, setAllAlmost] = useState(false);
  const [, setLookups] = useState(0);
  const toast = useToast();

  const entryByName = useMemo(() => {
    const m = new Map<string, Deck['entries'][number]>();
    for (const e of deck.entries) if (e.board === 'main') { m.set(e.card.name, e); m.set(e.card.name.split(' // ')[0], e); }
    return m;
  }, [deck.entries]);
  const included = currentCombos(deck, saved);
  const almost = (saved?.result.almost ?? []).filter((c) => !entryByName.has(c.missing[0]));
  const shownAlmost = allAlmost ? almost : almost.slice(0, ALMOST_SHOWN);
  const changed = !!saved && saved.signature !== deckSignature(deck);

  // Cards that aren't in the deck are looked up on Scryfall so they open, drag and show art too.
  const lookupKey = [...new Set(shownAlmost.flatMap((c) => c.cards).filter((n) => !entryByName.has(n)))].join('\n');
  useEffect(() => {
    if (!lookupKey) return;
    let live = true;
    loadCardsByName(lookupKey.split('\n')).then(() => live && setLookups((n) => n + 1)).catch(() => undefined);
    return () => { live = false; };
  }, [lookupKey]);

  const open = async (name: string) => {
    const entry = entryByName.get(name);
    if (entry) return setViewing({ card: entry.card, entryUid: entry.uid });
    try { setViewing({ card: cardByName(name) ?? await getNamed(name) }); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const addMissing = async (name: string) => {
    try { toast(addCard(deck.id, cardByName(name) ?? await getNamed(name), 1, 'main'), 'success'); } catch (e) { toast((e as Error).message, 'error'); }
  };

  const cardLinks = (c: Combo) => c.cards.map((n, i) => {
    const entry = entryByName.get(n);
    return (
      <span key={n} className={`combo-card ${entry ? '' : 'combo-missing'}`}>
        {i > 0 && <span className="combo-plus" aria-hidden> + </span>}
        <CardLink card={entry?.card ?? cardByName(n)} name={n} onOpen={() => void open(n)} className="inline-card-link" />
        {c.commanderCards.includes(n) && <span className="muted tiny"> (commander)</span>}
      </span>
    );
  });

  const comboRow = (c: Combo, almostRow = false) => (
    <li key={c.id} className="combo">
      <div className="combo-cards">
        {cardLinks(c)}
        {c.tag && <span className={`combo-tag combo-tag-${c.tag}`} title="Commander Spellbook's bracket rating for this combo">{COMBO_TAG_LABEL[c.tag]}</span>}
      </div>
      <div className="muted small combo-produces">
        {c.produces.slice(0, PRODUCES_SHOWN).join(' · ')}{c.produces.length > PRODUCES_SHOWN && ` · +${c.produces.length - PRODUCES_SHOWN} more`}
      </div>
      <div className="combo-actions small">
        {almostRow && (
          <button className="btn btn-sm" onClick={() => void addMissing(c.missing[0])}>+ Add {c.missing[0]}</button>
        )}
        <details className="combo-steps">
          <summary>How it works</summary>
          {c.mana && <div><b>Mana:</b> {c.mana}</div>}
          {c.prerequisites && <div className="combo-pre"><b>Setup:</b> {c.prerequisites}</div>}
          {c.steps && <ol>{c.steps.split('\n').filter(Boolean).map((s, i) => <li key={i}>{s}</li>)}</ol>}
          <a href={comboUrl(c.id)} target="_blank" rel="noreferrer">View on Commander Spellbook ↗</a>
        </details>
      </div>
    </li>
  );

  return (
    <div className="detail-section combos-panel">
      <div className="section-head">
        <h3>Combos</h3>
        {saved && <span className="muted small">{included.length} in deck</span>}
      </div>
      {!combosAvailable() ? (
        <div className="muted small">Combo checks work on the website, the-grimoire.app.</div>
      ) : (
        <>
          {!saved && (
            <p className="muted small">
              Find combos in this deck with Commander Spellbook. Checking sends the deck’s card names (nothing else) to Commander
              Spellbook through The Grimoire’s server, which doesn’t keep them.
            </p>
          )}
          {saved && (
            <>
              <div className="panel-block">
                <div className="panel-subhead"><span className="panel-subhead-title">In this deck</span></div>
                {included.length === 0 ? <div className="muted small">No combos found.</div> : <ul className="combo-list">{included.map((c) => comboRow(c))}</ul>}
              </div>
              {almost.length > 0 && (
                <div className="panel-block">
                  <div className="panel-subhead"><span className="panel-subhead-title">One card away</span><span className="muted small">most played first</span></div>
                  <ul className="combo-list">{shownAlmost.map((c) => comboRow(c, true))}</ul>
                  {almost.length > ALMOST_SHOWN && (
                    <button className="link-btn small" onClick={() => setAllAlmost(!allAlmost)}>{allAlmost ? 'Show fewer' : `Show all ${almost.length}`}</button>
                  )}
                </div>
              )}
            </>
          )}
          {changed && <div className="mb-verdict warn small">The deck has changed since this check.</div>}
          {state === 'error' && <div className="mb-verdict bad small">{error}</div>}
          <div className="combo-check">
            <button className="btn btn-sm" disabled={state === 'checking'} onClick={() => void checkCombos(deck)}>
              {state === 'checking' ? 'Checking…' : saved ? 'Check again' : 'Check combos'}
            </button>
            {saved && <span className="muted tiny">Checked {new Date(saved.checkedAt).toLocaleString()}</span>}
          </div>
          <div className="muted tiny">
            Combo data from <a href="https://commanderspellbook.com" target="_blank" rel="noreferrer">Commander Spellbook</a>. Ratings
            (Exhibition, Core, Powerful, Spicy, Ruthless) are Spellbook’s and feed the bracket estimate.
          </div>
        </>
      )}
      {viewing && <CardModal card={viewing.card} deckId={deck.id} entryUid={viewing.entryUid} onClose={() => setViewing(null)} />}
    </div>
  );
}
