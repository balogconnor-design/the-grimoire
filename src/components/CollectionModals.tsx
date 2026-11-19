import { useMemo, useState } from 'react';
import type { Card, CollectionItem, Finish, WatchItem } from '../types';
import { Modal } from './Modal';
import { ItemForm, draftFor, type ItemDraft } from './ItemForm';
import { PLBadge, Trend, ValueChart } from './Money';
import { TagModal } from './TagModal';
import { useToast } from './Toast';
import { collectionT, decksT, pricesT, salesT, watchT } from '../lib/store';
import {
  addItems, addWatch, allocatedQty, availableFinishes, clampAllocations, defaultFinish, FINISH_LABEL, finishPrice,
  isDisposal, isForSale, itemPL, itemUnitValue, priceSeries, trendPct, updateItem,
} from '../lib/collection';
import { KIND_LABEL, whereLabel } from '../lib/ledger';
import { SellModal, TradeModal } from './TransactionModals';
import { cardImage, formatUSD } from '../lib/rules';
import { navigate } from '../lib/router';

// ---------- Add ----------

export function AddToCollectionModal({ card, deckId, qty = 1, onClose, onAdded }: {
  card: Card; deckId?: string; qty?: number; onClose: () => void; onAdded?: () => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => draftFor(card, { qty }));
  const [allocate, setAllocate] = useState(!!deckId);
  const deck = decksT.useOne(deckId);
  const toast = useToast();

  const add = async () => {
    const { card: c, ...rest } = draft;
    await addItems([{ ...rest, card: c, allocations: allocate && deck ? { [deck.id]: draft.qty } : {} }]);
    toast(`Added ${draft.qty}× ${c.name} to your collection`, 'success');
    onAdded?.();
    onClose();
  };

  return (
    <Modal onClose={onClose} title="Add to collection">
      <ItemForm draft={draft} onChange={setDraft} />
      {deck && (
        <label className="radio if-alloc">
          <input type="checkbox" checked={allocate} onChange={(e) => setAllocate(e.target.checked)} /> Commit these copies to “{deck.name}”
        </label>
      )}
      <div className="ie-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={add}>+ Add {draft.qty > 1 ? `${draft.qty} copies` : 'to collection'}</button>
      </div>
    </Modal>
  );
}

// ---------- Edit a lot ----------

export function ItemModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const item = collectionT.useOne(itemId);
  const decks = decksT.useAll();
  const snaps = pricesT.useAll();
  const [draft, setDraft] = useState<ItemDraft | null>(() => (item ? toDraft(item) : null));
  const [tab, setTab] = useState<'details' | 'decks' | 'sell'>('details');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagging, setTagging] = useState(false);
  const toast = useToast();

  if (!item || !draft) return null;
  const dirty = JSON.stringify(toDraft(item)) !== JSON.stringify(draft);
  const pl = itemPL(item);
  const unit = itemUnitValue(item);
  const series = priceSeries(snaps, item.card.id, item.finish);

  const save = () => {
    updateItem(item.id, (d) => {
      Object.assign(d, { ...draft });
      clampAllocations(d);
    });
    toast('Saved', 'success');
  };

  return (
    <Modal onClose={onClose} wide title={item.card.name}>
      <div className="item-modal">
        <div className="im-side">
          <img src={cardImage(item.card, 'normal')} alt={item.card.name} className="card-img-large" />
          <div className="im-stats">
            <div><span className="label">Market (each)</span><span className="value">{formatUSD(unit)}</span></div>
            <div><span className="label">Paid (each)</span><span className="value">{formatUSD(item.purchasePrice)}</span></div>
            <div><span className="label">Value ({item.qty}×)</span><span className="value">{formatUSD(unit != null ? unit * item.qty : null)}</span></div>
            <div><span className="label">Gain / loss</span><PLBadge diff={pl.diff} pct={pl.pct} /></div>
            <div><span className="label">7-day trend</span><Trend pct={trendPct(snaps, item.card, item.finish, 7)} /></div>
            <div><span className="label">30-day trend</span><Trend pct={trendPct(snaps, item.card, item.finish, 30)} days={30} /></div>
          </div>
          <ValueChart series={series} height={130} label="Market price" />
          <button className="btn btn-sm" onClick={() => setTagging(true)}>🏷 Tags in decks & collection</button>
        </div>

        <div className="im-main">
          <div className="board-tabs">
            {(['details', 'decks', 'sell'] as const).map((t) => (
              <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t === 'details' ? 'Details' : t === 'decks' ? `Deck allocation (${allocatedQty(item)}/${item.qty})` : 'Sell / trade'}
              </button>
            ))}
          </div>

          {tab === 'details' && (
            <>
              <ItemForm draft={draft} onChange={setDraft} />
              <div className="ie-actions">
                {confirmDelete ? (
                  <>
                    <span className="muted small">Delete this lot ({item.qty}×)?</span>
                    <button className="btn btn-danger btn-sm" onClick={async () => { await collectionT.remove(item.id); onClose(); }}>Delete</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Keep</button>
                  </>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>🗑 Delete lot</button>
                )}
                <button className="btn" disabled={!dirty} onClick={() => setDraft(toDraft(item))}>Reset</button>
                <button className="btn btn-primary" disabled={!dirty} onClick={save}>Save changes</button>
              </div>
            </>
          )}

          {tab === 'decks' && <AllocationEditor item={item} decks={decks} />}
          {tab === 'sell' && <SellForm item={item} onDone={onClose} />}
        </div>
      </div>
      {tagging && <TagModal card={item.card} context={{ kind: 'collection', itemId: item.id }} onClose={() => setTagging(false)} />}
    </Modal>
  );
}

function toDraft(i: CollectionItem): ItemDraft {
  return {
    card: i.card, finish: i.finish, qty: i.qty, condition: i.condition, purchasePrice: i.purchasePrice, acquiredAt: i.acquiredAt,
    source: i.source, intent: i.intent, targetPrice: i.targetPrice, tags: i.tags, notes: i.notes, favorite: i.favorite,
  };
}

function AllocationEditor({ item, decks }: { item: CollectionItem; decks: ReturnType<typeof decksT.all> }) {
  const using = useMemo(() => decks.filter((d) => d.entries.some((e) => e.card.name === item.card.name && e.board !== 'maybe')), [decks, item.card.name]);
  const free = item.qty - allocatedQty(item);
  const setAlloc = (deckId: string, n: number) => updateItem(item.id, (d) => {
    const others = allocatedQty(d) - (d.allocations[deckId] ?? 0);
    const v = Math.max(0, Math.min(n, d.qty - others));
    if (v) d.allocations[deckId] = v; else delete d.allocations[deckId];
  });
  const need = (deckId: string) => decks.find((d) => d.id === deckId)?.entries
    .filter((e) => e.card.name === item.card.name && e.board !== 'maybe').reduce((n, e) => n + e.qty, 0) ?? 0;
  const listed = [...new Set([...using.map((d) => d.id), ...Object.keys(item.allocations)])].map((id) => decks.find((d) => d.id === id)).filter(Boolean);

  return (
    <div className="alloc">
      <p className="muted small">
        Commit specific copies to a deck so they're reserved for it. Uncommitted copies are shared out automatically when
        counting which decks you can build. {free} of {item.qty} free.
      </p>
      {listed.length === 0 ? (
        <div className="empty">No deck uses {item.card.name} yet.</div>
      ) : (
        <table className="color-table alloc-table">
          <thead><tr><th>Deck</th><th>Needs</th><th>Committed from this lot</th></tr></thead>
          <tbody>
            {listed.map((d) => (
              <tr key={d!.id}>
                <td><button className="link-btn" onClick={() => navigate(`/deck/${d!.id}`)}>{d!.name}</button></td>
                <td>{need(d!.id)}</td>
                <td>
                  <div className="stepper">
                    <button className="icon-btn sm" onClick={() => setAlloc(d!.id, (item.allocations[d!.id] ?? 0) - 1)} aria-label="Commit one fewer">−</button>
                    <span className="qty">{item.allocations[d!.id] ?? 0}</span>
                    <button className="icon-btn sm" disabled={free <= 0} onClick={() => setAlloc(d!.id, (item.allocations[d!.id] ?? 0) + 1)} aria-label="Commit one more">+</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SellForm({ item, onDone }: { item: CollectionItem; onDone: () => void }) {
  const [open, setOpen] = useState<'sell' | 'trade' | null>(null);
  const sales = salesT.useAll();
  const history = sales.filter((s) => s.lotId === item.id || (s.card.name === item.card.name && isDisposal(s)));
  const unit = itemUnitValue(item);
  return (
    <div className="sell-form">
      <p className="muted small">Selling or trading moves the copies out of your collection into your transaction history, with the realized gain/loss.</p>
      <div className="sell-summary">
        <span>{item.qty} cop{item.qty === 1 ? 'y' : 'ies'} · market {formatUSD(unit)} each</span>
        {item.purchasePrice != null && <span className="muted small">paid {formatUSD(item.purchasePrice)} each</span>}
      </div>
      <div className="ie-actions ie-left">
        <button className="btn btn-primary" onClick={() => setOpen('sell')}>$ Sell…</button>
        <button className="btn" onClick={() => setOpen('trade')}>⇄ Trade for other cards…</button>
      </div>
      {!isForSale(item.intent) && <div className="muted tiny">Tip: set Market status to Sell or Trade to list this lot in your trade binder.</div>}
      {history.length > 0 && (
        <>
          <div className="label">History for {item.card.name}</div>
          <ul className="coverage-list">
            {history.slice(0, 12).map((s) => (
              <li key={s.id} className="alert-row static">
                <span className="truncate"><span className={`tx-kind tx-${s.kind}`}>{KIND_LABEL[s.kind]}</span> {s.qty}× · {s.date}</span>
                <span className="muted small truncate">{whereLabel(s) || s.notes}</span>
                <span className="price">{formatUSD(s.price)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {open === 'sell' && <SellModal itemIds={[item.id]} onClose={() => setOpen(null)} onDone={onDone} />}
      {open === 'trade' && <TradeModal itemIds={[item.id]} onClose={() => setOpen(null)} onDone={onDone} />}
    </div>
  );
}

// ---------- Watchlist ----------

export function WatchModal({ card, watchId, onClose }: { card?: Card; watchId?: string; onClose: () => void }) {
  const existing = watchT.useOne(watchId);
  const c = existing?.card ?? card!;
  const [finish, setFinish] = useState<Finish>(existing?.finish ?? defaultFinish(c));
  const [qty, setQty] = useState(existing?.qty ?? 1);
  const [target, setTarget] = useState(existing?.targetPrice?.toString() ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const toast = useToast();
  const unit = finishPrice(c, finish);

  const save = async () => {
    const t = parseFloat(target);
    const targetPrice = Number.isFinite(t) ? t : undefined;
    if (existing) {
      const next: WatchItem = { ...existing, finish, qty, targetPrice, notes: notes || undefined };
      await watchT.put(next);
    } else {
      await addWatch(c, { finish, qty, targetPrice, notes: notes || undefined });
    }
    toast(`${c.name} is on your watchlist`, 'success');
    onClose();
  };

  return (
    <Modal onClose={onClose} title={existing ? 'Edit watchlist card' : 'Add to watchlist'}>
      <div className="if-print">
        <img src={cardImage(c, 'small')} alt="" className="if-thumb" />
        <div className="if-print-info">
          <div className="if-print-name">{c.name}</div>
          <div className="muted small">{c.set_name} ({c.set.toUpperCase()}) #{c.collector_number}</div>
          <div className="small">Market now: <b>{formatUSD(unit)}</b></div>
        </div>
      </div>
      <div className="if-grid">
        <div className="if-field"><span className="label">Finish</span>
          <div className="status-toggle">
            {availableFinishes(c).map((f) => <button key={f} className={`seg ${finish === f ? 'on' : ''}`} onClick={() => setFinish(f)}>{FINISH_LABEL[f]}</button>)}
          </div>
        </div>
        <label className="if-field"><span className="label">Copies wanted</span>
          <input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </label>
        <label className="if-field"><span className="label">Buy at or below (each)</span>
          <input className="input" type="number" min={0} step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="no target" />
        </label>
        <label className="if-field"><span className="label">Notes</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div className="ie-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{existing ? 'Save' : '+ Watch'}</button>
      </div>
    </Modal>
  );
}
