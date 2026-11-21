import { useEffect, useState } from 'react';
import { setCardDrag } from '../lib/dnd';
import type { Board, Card, DeckEntry } from '../types';
import { Modal } from './Modal';
import { ColorPips, ManaCost, OracleText } from './Mana';
import { useToast } from './Toast';
import { getPrints } from '../lib/scryfall';
import { FORMATS, getFormat } from '../lib/formats';
import {
  canBeCommander, cardImage, commanderEntry, cardPrice, deckIdentity, formatUSD, hasBackFaceImage, withinIdentity,
} from '../lib/rules';
import { addCard, changePrinting, setCardFavorite, setCommander } from '../lib/actions';
import { decksT, useDeck, watchT } from '../lib/store';
import { useGlobalTags, useLotsFor, useSubjects } from '../lib/hooks';
import { FINISH_LABEL, intentLabel, itemPL, printBadges } from '../lib/collection';
import { AddToCollectionModal, ItemModal, WatchModal } from './CollectionModals';
import { TagModal, type TagContext } from './TagModal';
import { PLBadge } from './Money';
import { Tag, TagList } from './TagEditor';
import { useScryfallTags } from '../lib/scryfallTags';
import { deckmatesByTag, mainGroup } from '../lib/deckTags';
import { setMainTag } from '../lib/actions';
import { pinCard, useCanPin } from '../lib/viewPanel';

interface Props {
  card: Card;
  deckId?: string;
  /** When opened from a deck row: allows swapping that entry's printing. */
  entryUid?: string;
  onClose: () => void;
}

const LEGALITY_CLASS: Record<string, string> = {
  legal: 'leg-legal', not_legal: 'leg-not', banned: 'leg-banned', restricted: 'leg-restricted',
};
const LEGALITY_TEXT: Record<string, string> = {
  legal: 'Legal', not_legal: 'Not legal', banned: 'Banned', restricted: 'Restricted',
};

/** A card in a list the card window can step through with the arrow keys. */
export interface CardRef { card: Card; entryUid?: string }

/**
 * Card window. Clicking another card under "Also in this deck" replaces this window with that card's
 * (the body is keyed by card, so all of its state starts fresh). With `siblings` (the list the card was
 * opened from), the left and right arrow keys move to the previous and next card in that list.
 */
export function CardModal({ card, deckId, entryUid, onClose, siblings }: Props & { siblings?: CardRef[] }) {
  const [cur, setCur] = useState<CardRef>({ card, entryUid });
  const index = siblings ? siblings.findIndex((s) => (cur.entryUid ? s.entryUid === cur.entryUid : s.card.id === cur.card.id)) : -1;
  const step = siblings && index >= 0 && siblings.length > 1
    ? (dir: -1 | 1) => setCur(siblings[(index + dir + siblings.length) % siblings.length])
    : undefined;
  return (
    <CardModalBody
      key={cur.entryUid ?? cur.card.id} card={cur.card} deckId={deckId} entryUid={cur.entryUid} onClose={onClose}
      onNavigate={(e) => setCur({ card: e.card, entryUid: e.uid })}
      step={step} position={step ? { index, total: siblings!.length } : undefined}
    />
  );
}

/** The card details shown inline, in the deck page's view panel. */
export function CardView({ card, deckId, entryUid }: { card: Card; deckId?: string; entryUid?: string }) {
  const [cur, setCur] = useState<CardRef>({ card, entryUid });
  return (
    <CardModalBody
      key={cur.entryUid ?? cur.card.id} card={cur.card} deckId={deckId} entryUid={cur.entryUid} onClose={() => undefined}
      onNavigate={(e) => setCur({ card: e.card, entryUid: e.uid })} inline
    />
  );
}

function CardModalBody({ card: initial, deckId, entryUid, onClose, onNavigate, step, position, inline }: Props & {
  onNavigate: (e: DeckEntry) => void;
  /** Move to the previous (-1) or next (1) card of the list the window was opened from. */
  step?: (dir: -1 | 1) => void;
  position?: { index: number; total: number };
  /** Render in place (view panel) instead of in a window. */
  inline?: boolean;
}) {
  const [card, setCard] = useState(initial);
  const [face, setFace] = useState(0);
  const [prints, setPrints] = useState<Card[] | null>(null);
  const [loadingPrints, setLoadingPrints] = useState(false);
  const [qty, setQty] = useState(1);
  const [board, setBoard] = useState<Board>('main');
  const [sub, setSub] = useState<null | 'add' | 'watch' | 'tag' | { item: string }>(null);
  const [targetDeck, setTargetDeck] = useState('');
  const allDecks = decksT.useAll();
  const lots = useLotsFor(card);
  const watching = watchT.useAll().some((w) => w.card.name === card.name);
  const toast = useToast();
  const favorite = !!useSubjects()(card).favorite;
  const deck = useDeck(deckId);
  const tagContext: TagContext = deckId ? { kind: 'deck', deckId } : { kind: 'search' };
  const badges = printBadges(card);
  const fmt = deck ? getFormat(deck.format) : undefined;
  const identity = deck ? deckIdentity(deck) : null;
  const outside = identity && !withinIdentity(card, identity);
  const inDeck = deck?.entries.filter((e) => e.card.name === card.name) ?? [];
  const cmdUid = deck ? commanderEntry(deck)?.uid : undefined;
  const isCommander = !!cmdUid && inDeck.some((e) => e.uid === cmdUid);

  // Tags: this deck's card tags, global tags, then automatic Scryfall tags.
  const globalTags = useGlobalTags();
  const stags = useScryfallTags();
  const tagSrc = { global: globalTags, scryfall: stags };
  const entry = (entryUid ? deck?.entries.find((e) => e.uid === entryUid) : undefined) ?? inDeck[0];
  const cardTagsHere = entry?.tags ?? [];
  const globalHere = globalTags.get(card.name) ?? [];
  const ownTags = [...new Set([...cardTagsHere, ...globalHere])];
  const autoTags = (stags.get(card.name) ?? []).filter((t) => !ownTags.includes(t));
  const allTags = [...ownTags, ...autoTags];
  const mates = deck ? deckmatesByTag(deck, card.name, allTags, tagSrc) : [];
  const listedUnder = deck && entry && entry.board === 'main' && entry.uid !== cmdUid ? mainGroup(deck, entry, tagSrc) : undefined;

  useEffect(() => {
    setFace(0);
  }, [card.id]);

  // Left / right arrows step through the list this window was opened from (not while typing or in a sub-window).
  useEffect(() => {
    if (!step || inline) return;
    const onKey = (e: KeyboardEvent) => {
      if (sub || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, sub, inline]);
  const canPin = useCanPin();

  const loadPrints = async () => {
    setLoadingPrints(true);
    try {
      setPrints(await getPrints(card));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoadingPrints(false);
    }
  };

  const faces = card.card_faces && card.card_faces.length > 1 ? card.card_faces : null;
  const img = cardImage(card, 'large', face);
  const price = cardPrice(card);
  const shownFaces = faces ?? [card];

  const body = (
    <>
      <div className="card-modal">
        <div className="card-modal-image">
          {step && position && (
            <div className="card-step">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => step(-1)} aria-label="Previous card" title="Previous card (←)">‹</button>
              <span className="muted small">{position.index + 1} of {position.total}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => step(1)} aria-label="Next card" title="Next card (→)">›</button>
            </div>
          )}
          {img ? (
            <img src={img} alt={card.name} className="card-img-large" draggable={inline || undefined}
              onDragStart={inline ? (e) => setCardDrag(e.dataTransfer, card) : undefined}
              title={inline ? 'Drag onto the deck list to add a copy' : undefined} />
          ) : <div className="card-img-missing">{card.name}</div>}
          {!inline && canPin && (
            <button type="button" className="btn btn-ghost btn-sm pin-btn" onClick={() => { pinCard(card, entryUid); onClose(); }}
              title="Keep this card on show under Card Search (or right-click any card)">📌 Pin to view panel</button>
          )}
          {hasBackFaceImage(card) && (
            <button className="btn btn-ghost flip-btn" onClick={() => setFace((f) => (f ? 0 : 1))}>
              ⟲ Show {face ? 'front' : 'back'} face
            </button>
          )}
          <div className="print-meta">
            <span className={`rarity rarity-${card.rarity}`}>{card.rarity}</span>
            <span>{card.set_name} ({card.set.toUpperCase()}) #{card.collector_number}</span>
          </div>
          {badges.length > 0 && <div className="badge-row">{badges.map((b) => <span key={b} className="print-badge">{b}</span>)}</div>}
          {card.artist && <div className="muted small">Illustrated by {card.artist}</div>}
        </div>

        <div className="card-modal-info">
          <div className="card-modal-tools">
            <button
              type="button" className={`btn btn-sm card-fav-btn ${favorite ? 'on' : ''}`} aria-pressed={favorite}
              onClick={() => setCardFavorite(card, !favorite)}
            >{favorite ? '★ Favorite' : '☆ Add to favorites'}</button>
          </div>
          {shownFaces.map((f, i) => (
            <div key={i} className="face-block">
              <div className="face-head">
                <h3>{f.name}</h3>
                <ManaCost cost={f.mana_cost} size={18} />
              </div>
              <div className="type-line">{f.type_line}</div>
              <OracleText text={f.oracle_text} />
              {f.flavor_text && <p className="flavor">{f.flavor_text}</p>}
              {(f.power || f.loyalty || f.defense) && (
                <div className="pt">
                  {f.power && `${f.power}/${f.toughness}`}
                  {f.loyalty && `Loyalty ${f.loyalty}`}
                  {f.defense && `Defense ${f.defense}`}
                </div>
              )}
            </div>
          ))}

          <div className="info-row">
            <div>
              <div className="label">Color identity</div>
              <ColorPips colors={card.color_identity} />
            </div>
            <div>
              <div className="label">Mana value</div>
              <div className="value">{card.cmc}</div>
            </div>
            <div>
              <div className="label">Price (USD)</div>
              <div className="value price">{formatUSD(price)}</div>
              {card.prices.usd_foil && <div className="muted small">Foil {formatUSD(parseFloat(card.prices.usd_foil))}</div>}
            </div>
          </div>

          <div className="card-tags-panel">
            <div className="section-head">
              <h3>Tags</h3>
              <button className="btn btn-sm" onClick={() => setSub('tag')}>🏷 Edit your tags</button>
            </div>
            {allTags.length ? (
              <TagList
                groups={[{ scope: 'card', tags: cardTagsHere }, { scope: 'global', tags: globalHere.filter((t) => !cardTagsHere.includes(t)) }, { scope: 'scryfall', tags: autoTags }]}
                max={99}
              />
            ) : (
              <div className="muted small">No tags yet. Scryfall tags (◆) are added automatically once they've downloaded.</div>
            )}
            {deck && allTags.length > 0 && (
              <div className="deckmates">
                <div className="label">Also in this deck</div>
                {mates.map(({ tag, entries }) => {
                  const scope = cardTagsHere.includes(tag) ? 'card' : globalHere.includes(tag) ? 'global' : 'scryfall';
                  return (
                    <div key={tag} className="deckmate-row">
                      <div className="deckmate-head">
                        <Tag scope={scope} small>{tag}</Tag>
                        <span className="muted tiny-label">{entries.length} other{entries.length === 1 ? '' : 's'}</span>
                        {listedUnder && (listedUnder === tag
                          ? <span className="muted tiny-label">· listed here when grouped by tag</span>
                          : <button className="link-btn small" onClick={() => entry && setMainTag(deck.id, entry.uid, tag)}>List under {tag}</button>)}
                      </div>
                      {entries.length > 0 && (
                        <div className="deckmate-cards">
                          {entries.map((e) => (
                            <button key={e.uid} className="deckmate-card" onClick={() => onNavigate(e)} title={`Open ${e.card.name}`}>{e.card.name}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {deck && fmt && (
            <div className="add-panel">
              {outside && (
                <div className="alert alert-error">Outside your commander's color identity — not legal in this deck.</div>
              )}
              {inDeck.length > 0 && (
                <div className="muted small">
                  In this deck: {inDeck.map((e) => `${e.qty}× ${e.board === 'main' ? 'main' : e.board === 'side' ? 'sideboard' : 'maybeboard'}`).join(', ')}
                  {isCommander && ' · ★ Commander'}
                </div>
              )}
              <div className="add-controls">
                <input
                  type="number" min={1} max={99} value={qty} className="input qty-input"
                  onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  aria-label="Quantity"
                />
                <select className="input" value={board} onChange={(e) => setBoard(e.target.value as Board)} aria-label="Board">
                  <option value="main">Main deck</option>
                  <option value="side">Sideboard</option>
                  <option value="maybe">Maybeboard</option>
                </select>
                <button className="btn btn-primary" onClick={() => toast(addCard(deck.id, card, qty, board), 'success')}>
                  + Add to deck
                </button>
                {fmt.hasCommander && canBeCommander(card, fmt) && !isCommander && (
                  <button className="btn btn-gold" onClick={() => toast(setCommander(deck.id, card), 'success')}>
                    ★ Set as {fmt.id === 'oathbreaker' ? 'Oathbreaker' : 'Commander'}
                  </button>
                )}
                {entryUid && (
                  <button
                    className="btn"
                    onClick={() => { changePrinting(deck.id, entryUid, card); toast('Printing updated', 'success'); }}
                  >
                    Use this printing
                  </button>
                )}
              </div>
            </div>
          )}

          {!deck && allDecks.length > 0 && (
            <div className="add-panel">
              <div className="add-controls">
                <select className="input" value={targetDeck} onChange={(e) => setTargetDeck(e.target.value)} aria-label="Deck">
                  <option value="">Add to a deck…</option>
                  {allDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button className="btn btn-primary" disabled={!targetDeck} onClick={() => toast(addCard(targetDeck, card), 'success')}>+ Add to deck</button>
              </div>
            </div>
          )}

          <div className="collection-panel">
            <div className="section-head">
              <h3>Your collection</h3>
              <span className="muted small">{lots.length ? `${lots.reduce((n, i) => n + i.qty, 0)} owned` : 'Not owned'}{watching ? ' · 👁 watching' : ''}</span>
            </div>
            {lots.length > 0 && (
              <ul className="lot-list">
                {lots.map((i) => {
                  const pl = itemPL(i);
                  return (
                    <li key={i.id}>
                      <button className="lot-row" onClick={() => setSub({ item: i.id })}>
                        <span className="qty">{i.qty}×</span>
                        <span className="truncate">{i.card.set.toUpperCase()} #{i.card.collector_number} · {FINISH_LABEL[i.finish]}{i.condition ? ` · ${i.condition}` : ''}</span>
                        {i.intent && <span className={`intent intent-${i.intent}`}>{intentLabel(i.intent)}</span>}
                        <PLBadge diff={pl.diff} pct={pl.pct} compact />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="add-controls">
              <button className="btn btn-sm" onClick={() => setSub('add')}>+ Add this print to collection</button>
              <button className="btn btn-sm" onClick={() => setSub('watch')}>👁 Watch price</button>
              <button className="btn btn-sm" onClick={() => setSub('tag')}>🏷 Tag</button>
            </div>
          </div>

          <details className="legalities">
            <summary>Format legality</summary>
            <div className="legality-grid">
              {FORMATS.filter((f) => f.legalityKey).map((f) => {
                const s = card.legalities[f.legalityKey!] ?? 'not_legal';
                return (
                  <div key={f.id} className={`legality ${LEGALITY_CLASS[s]}`}>
                    <span className="leg-badge">{LEGALITY_TEXT[s]}</span>
                    <span>{f.name.replace(' (EDH)', '')}</span>
                  </div>
                );
              })}
            </div>
          </details>

          <div className="printings">
            {!prints ? (
              <button className="btn btn-ghost" onClick={loadPrints} disabled={loadingPrints}>
                {loadingPrints ? 'Loading printings…' : '🖼 Choose printing / art'}
              </button>
            ) : (
              <>
                <div className="label">{prints.length} printings — click to select</div>
                <div className="print-grid">
                  {prints.map((p) => (
                    <button
                      key={p.id}
                      className={`print-tile ${p.id === card.id ? 'selected' : ''}`}
                      onClick={() => setCard(p)}
                      title={`${p.set_name} #${p.collector_number}`}
                    >
                      <img src={cardImage(p, 'small')} alt="" loading="lazy" />
                      <span className="print-tile-set">{p.set.toUpperCase()}</span>
                      <span className="print-tile-price">{formatUSD(cardPrice(p))}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {card.scryfall_uri && (
            <a className="muted small" href={card.scryfall_uri} target="_blank" rel="noreferrer">View on Scryfall ↗</a>
          )}
        </div>
      </div>
      {sub === 'add' && <AddToCollectionModal card={card} deckId={deckId} onClose={() => setSub(null)} />}
      {sub === 'watch' && <WatchModal card={card} onClose={() => setSub(null)} />}
      {sub === 'tag' && <TagModal card={card} context={tagContext} onClose={() => setSub(null)} />}
      {sub && typeof sub === 'object' && <ItemModal itemId={sub.item} onClose={() => setSub(null)} />}
    </>
  );
  return inline ? <div className="card-view-inline">{body}</div> : <Modal onClose={onClose} wide title={card.name}>{body}</Modal>;
}
