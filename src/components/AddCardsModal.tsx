import { useState, type FormEvent } from 'react';
import type { Card } from '../types';
import { Modal } from './Modal';
import { ItemForm, draftFor, type ItemDraft } from './ItemForm';
import { useToast } from './Toast';
import { applyDefaults, DefaultsRow, type Defaults } from './BulkDefaults';
import { ScanAdd } from './ScanAdd';
import { searchCards } from '../lib/scryfall';
import { addItems, defaultFinish, finishPrice, printBadges, resolveCardList, today, type NewItemInput } from '../lib/collection';
import { cardImage, formatUSD, isBasicLand } from '../lib/rules';
import { decksT } from '../lib/store';
import { usePool } from '../lib/hooks';
import { nameKey } from '../lib/ownership';

type Tab = 'search' | 'paste' | 'scan' | 'deck';

export function AddCardsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('search');
  return (
    <Modal onClose={onClose} wide title="Add cards to collection">
      <div className="board-tabs">
        <button className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>Scryfall search</button>
        <button className={`tab ${tab === 'paste' ? 'active' : ''}`} onClick={() => setTab('paste')}>Paste a list</button>
        <button className={`tab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>Scan photos</button>
        <button className={`tab ${tab === 'deck' ? 'active' : ''}`} onClick={() => setTab('deck')}>From a deck</button>
      </div>
      {tab === 'search' && <SearchAdd />}
      {tab === 'paste' && <PasteAdd onDone={onClose} />}
      {tab === 'scan' && <ScanAdd onDone={onClose} />}
      {tab === 'deck' && <DeckAdd onDone={onClose} />}
    </Modal>
  );
}

// ---------- Search ----------

function SearchAdd() {
  const [q, setQ] = useState('');
  const [prints, setPrints] = useState(true);
  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [lastSource, setLastSource] = useState<string | undefined>();
  const toast = useToast();

  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    try {
      // A bare name searches that card's printings; anything else is a Scryfall query.
      const query = /[:<>=!"]/.test(q) ? q : `!"${q.trim()}" or "${q.trim()}"`;
      const res = await searchCards(`${query} game:paper`, { unique: prints ? 'prints' : 'cards', order: 'released', dir: 'desc' });
      setResults(res.data);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const add = async () => {
    if (!draft) return;
    const { card, ...rest } = draft;
    await addItems([{ card, ...rest }]);
    setLastSource(draft.source);
    toast(`Added ${draft.qty}× ${card.name}`, 'success');
    setDraft(null);
  };

  if (draft) {
    return (
      <div className="ie-body">
        <ItemForm draft={draft} onChange={setDraft} />
        <div className="ie-actions">
          <button className="btn btn-ghost" onClick={() => setDraft(null)}>← Back to results</button>
          <button className="btn btn-primary" onClick={add}>+ Add to collection</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ie-body">
      <form className="search-row" onSubmit={run}>
        <input className="input search-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder='Card name, or Scryfall syntax (e.g. s:mh3 r:mythic)' />
        <label className="radio"><input type="checkbox" checked={prints} onChange={(e) => setPrints(e.target.checked)} /> Every printing</label>
        <button className="btn btn-primary" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </form>
      <p className="muted small">Pick the exact printing you own — set, collector number and treatment are tracked per lot.</p>
      <div className="results-grid compact">
        {results.map((c) => {
          const badges = printBadges(c);
          return (
            <button key={c.id} className="print-pick" onClick={() => setDraft(draftFor(c, { source: lastSource }))}>
              <img src={cardImage(c, 'small')} alt={c.name} loading="lazy" />
              <span className="truncate small">{c.name}</span>
              <span className="muted tiny-label">{c.set.toUpperCase()} #{c.collector_number}{badges.length ? ` · ${badges.join(', ')}` : ''}</span>
              <span className="price tiny-label">{formatUSD(finishPrice(c, defaultFinish(c)))}{c.prices.usd_foil && c.prices.usd ? ` · foil ${formatUSD(parseFloat(c.prices.usd_foil))}` : ''}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Paste ----------

function PasteAdd({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const [defaults, setDefaults] = useState<Defaults>({ acquiredAt: today(), useMarket: false });
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const toast = useToast();

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setMissing([]);
    try {
      const { lines, missing: miss } = await resolveCardList(text);
      const inputs: NewItemInput[] = lines.map((l) => applyDefaults(l.card, l.finish, l.qty, defaults));
      const n = await addItems(inputs);
      toast(`Added ${n} card${n === 1 ? '' : 's'} to your collection`, 'success');
      if (miss.length) setMissing(miss);
      else onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ie-body">
      <p className="muted small">
        One card per line: <code>4 Sol Ring</code>, <code>1 Sol Ring (C21) 263</code>, add <code>*F*</code> for foil or <code>*E*</code> for etched.
        Without a set, Scryfall's default printing is used — you can change the print on each lot afterwards.
      </p>
      <textarea className="input textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'4 Lightning Bolt (2X2) 117\n1 Sol Ring (C21) 263 *F*\n1 Arcane Signet'} />
      <DefaultsRow value={defaults} onChange={setDefaults} />
      {missing.length > 0 && <div className="alert alert-error">Couldn't find {missing.length}: {missing.join(', ')}</div>}
      <div className="ie-actions">
        <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={add}>{busy ? 'Looking up cards…' : 'Add to collection'}</button>
      </div>
    </div>
  );
}

// ---------- From a saved deck ----------

function DeckAdd({ onDone }: { onDone: () => void }) {
  const decks = decksT.useAll();
  const pool = usePool();
  const [deckId, setDeckId] = useState(decks[0]?.id ?? '');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [skipBasics, setSkipBasics] = useState(true);
  const [commit, setCommit] = useState(true);
  const [defaults, setDefaults] = useState<Defaults>({ acquiredAt: today(), useMarket: false });
  const toast = useToast();
  const deck = decks.find((d) => d.id === deckId);
  const cov = pool.byDeck.get(deckId);

  const plan = (deck?.entries ?? [])
    .filter((e) => e.board !== 'maybe' && !(skipBasics && isBasicLand(e.card)))
    .map((e) => {
      const missing = cov?.needs.get(nameKey(e.card))?.missing ?? e.qty;
      return { e, qty: onlyMissing ? Math.min(e.qty, missing) : e.qty };
    })
    .filter((x) => x.qty > 0);
  // When one name has several entries, don't add the "missing" count twice.
  const seen = new Map<string, number>();
  const finalPlan = plan.map((x) => {
    if (!onlyMissing) return x;
    const k = nameKey(x.e.card);
    const left = (cov?.needs.get(k)?.missing ?? x.qty) - (seen.get(k) ?? 0);
    const qty = Math.max(0, Math.min(x.qty, left));
    seen.set(k, (seen.get(k) ?? 0) + qty);
    return { ...x, qty };
  }).filter((x) => x.qty > 0);
  const total = finalPlan.reduce((n, x) => n + x.qty, 0);

  const add = async () => {
    if (!deck) return;
    const inputs = finalPlan.map(({ e, qty }) => ({
      ...applyDefaults(e.card, defaultFinish(e.card), qty, defaults),
      allocations: commit ? { [deck.id]: qty } : {},
    }));
    const n = await addItems(inputs);
    toast(`Added ${n} card${n === 1 ? '' : 's'} from ${deck.name}`, 'success');
    onDone();
  };

  if (!decks.length) return <div className="empty">You don't have any decks yet.</div>;
  return (
    <div className="ie-body">
      <label className="if-field"><span className="label">Deck</span>
        <select className="input" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <div className="ie-actions ie-left">
        <label className="radio"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Only cards I'm missing</label>
        <label className="radio"><input type="checkbox" checked={skipBasics} onChange={(e) => setSkipBasics(e.target.checked)} /> Skip basic lands</label>
        <label className="radio"><input type="checkbox" checked={commit} onChange={(e) => setCommit(e.target.checked)} /> Commit these copies to the deck</label>
      </div>
      <p className="muted small">Uses the printing chosen in the deck. Marks the cards as purchased/owned.</p>
      <DefaultsRow value={defaults} onChange={setDefaults} />
      <div className="ie-actions">
        <span className="muted small">{total} card{total === 1 ? '' : 's'} will be added</span>
        <button className="btn btn-primary" disabled={!total} onClick={add}>Add to collection</button>
      </div>
    </div>
  );
}
