import { useMemo, useState, type FormEvent } from 'react';
import type { Card, Condition, Finish } from '../types';
import { Modal } from './Modal';
import { PLBadge } from './Money';
import { useToast } from './Toast';
import { collectionT, decksT, ownedDecksT, useSettings } from '../lib/store';
import {
  allocatedQty, availableFinishes, CONDITIONS, defaultFinish, disposeLots, FINISH_LABEL, finishPrice, itemUnitValue,
  resolveCardList, SOURCES, splitTotal, today,
} from '../lib/collection';
import {
  buyDeck, deckLines, IN_PERSON_PLACES, lotsForDeck, lotsOfPurchasedDeck, ONLINE_RETAILERS, recordTrade, sellDeck, VENUES,
  type DeckCardLine, type Where,
} from '../lib/ledger';
import { searchCards } from '../lib/scryfall';
import { cardImage, formatUSD, uid } from '../lib/rules';

const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n >= 0 ? n : 0; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- Where (online retailer / in person / other) ----------

export function WhereFields({ value, onChange, who = 'Buyer' }: { value: Where; onChange: (w: Where) => void; who?: string }) {
  const options = value.venue === 'online' ? ONLINE_RETAILERS : value.venue === 'in-person' ? IN_PERSON_PLACES : [];
  const custom = !!value.channel && !options.includes(value.channel);
  const [other, setOther] = useState(custom || value.venue === 'other');
  const set = (p: Partial<Where>) => onChange({ ...value, ...p });
  return (
    <div className="if-grid">
      <div className="if-field"><span className="label">Where</span>
        <div className="status-toggle">
          {VENUES.map((v) => (
            <button type="button" key={v.id} className={`seg ${value.venue === v.id ? 'on' : ''}`}
              onClick={() => { setOther(v.id === 'other'); set({ venue: v.id, channel: undefined }); }}>{v.label}</button>
          ))}
        </div>
      </div>
      {value.venue && value.venue !== 'other' && (
        <div className="if-field"><span className="label">{value.venue === 'online' ? 'Retailer / site' : 'Place'}</span>
          <select className="input" value={other ? '__other' : value.channel ?? ''} onChange={(e) => {
            if (e.target.value === '__other') { setOther(true); set({ channel: '' }); } else { setOther(false); set({ channel: e.target.value || undefined }); }
          }}>
            <option value="">Not set</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
            <option value="__other">Other…</option>
          </select>
          {other && <input className="input if-other" value={value.channel ?? ''} placeholder="Name it" onChange={(e) => set({ channel: e.target.value || undefined })} />}
        </div>
      )}
      {value.venue === 'other' && (
        <label className="if-field"><span className="label">Details</span>
          <input className="input" value={value.channel ?? ''} placeholder="e.g. sold to a friend's store" onChange={(e) => set({ channel: e.target.value || undefined })} />
        </label>
      )}
      <label className="if-field"><span className="label">{who} <span className="optional">optional</span></span>
        <input className="input" value={value.counterparty ?? ''} placeholder="name or username" onChange={(e) => set({ counterparty: e.target.value || undefined })} />
      </label>
    </div>
  );
}

// ---------- Sell one or more lots ----------

export function SellModal({ itemIds, onClose, onDone }: { itemIds: string[]; onClose: () => void; onDone?: () => void }) {
  const items = collectionT.useAll();
  const lots = useMemo(() => itemIds.map((id) => items.find((i) => i.id === id)).filter((i) => !!i), [itemIds, items]);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lots.map((l) => [l.id, l.qty])));
  const [price, setPrice] = useState<Record<string, string>>(() => Object.fromEntries(lots.map((l) => [l.id, (l.targetPrice ?? itemUnitValue(l, false) ?? 0).toFixed(2)])));
  const [mode, setMode] = useState<'each' | 'total'>(lots.length > 1 ? 'total' : 'each');
  const market = lots.reduce((s, l) => s + (itemUnitValue(l, false) ?? 0) * (qty[l.id] ?? 0), 0);
  const [total, setTotal] = useState(market.toFixed(2));
  const [date, setDate] = useState(today());
  const [where, setWhere] = useState<Where>({ venue: 'online' });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const active = lots.filter((l) => (qty[l.id] ?? 0) > 0);
  const shares = splitTotal(num(total), active.map((l) => ({ weight: itemUnitValue(l, false) ?? 0, qty: qty[l.id] })));
  const each = (id: string) => (mode === 'each' ? num(price[id] ?? '0') : (shares[active.findIndex((l) => l.id === id)] ?? 0) / (qty[id] || 1));
  const proceeds = active.reduce((s, l) => s + each(l.id) * qty[l.id], 0);
  const costed = active.filter((l) => l.purchasePrice != null);
  const pl = costed.reduce((s, l) => s + (each(l.id) - l.purchasePrice!) * qty[l.id], 0);
  const base = costed.reduce((s, l) => s + l.purchasePrice! * qty[l.id], 0);
  const copies = active.reduce((n, l) => n + qty[l.id], 0);
  const dipsIntoDecks = active.some((l) => qty[l.id] > l.qty - allocatedQty(l));

  const submit = async () => {
    setBusy(true);
    const n = await disposeLots(active.map((l) => ({ itemId: l.id, qty: qty[l.id], price: Math.round(each(l.id) * 100) / 100 })), {
      kind: 'sold', date, ...where, notes: notes || undefined, groupLabel: active.length > 1 ? 'Bulk sale' : undefined,
      groupId: active.length > 1 ? uid() : undefined,
    });
    toast(`Recorded sale of ${plural(n, 'card')} for ${formatUSD(proceeds)}`, 'success');
    onDone?.();
    onClose();
  };

  if (!lots.length) return null;
  return (
    <Modal onClose={onClose} wide title={lots.length === 1 ? `Sell ${lots[0].card.name}` : `Sell ${lots.length} lots`}>
      <div className="sell-form">
        {lots.length > 1 && (
          <div className="status-toggle">
            <button className={`seg ${mode === 'total' ? 'on' : ''}`} onClick={() => setMode('total')}>One total price</button>
            <button className={`seg ${mode === 'each' ? 'on' : ''}`} onClick={() => setMode('each')}>Price per card</button>
          </div>
        )}
        <div className="table-wrap tx-lines">
          <table className="inv-table">
            <thead><tr><th>Card</th><th className="num">Copies</th><th className="num">Market</th><th className="num">Paid</th><th className="num">{mode === 'each' ? 'Sale price (each)' : 'Share (each)'}</th></tr></thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id}>
                  <td className="inv-card">
                    <img src={cardImage(l.card, 'small')} alt="" className="inv-thumb" />
                    <div className="inv-card-text"><span className="inv-name truncate">{l.card.name}</span>
                      <span className="muted tiny-label">{l.card.set.toUpperCase()} #{l.card.collector_number} · {FINISH_LABEL[l.finish]}{l.condition ? ` · ${l.condition}` : ''}</span></div>
                  </td>
                  <td className="num">
                    <input className="input input-sm qty-input" type="number" min={0} max={l.qty} value={qty[l.id] ?? 0}
                      onChange={(e) => setQty({ ...qty, [l.id]: Math.max(0, Math.min(l.qty, parseInt(e.target.value, 10) || 0)) })} />
                    <span className="muted tiny-label"> of {l.qty}</span>
                  </td>
                  <td className="num">{formatUSD(itemUnitValue(l, false))}</td>
                  <td className="num">{formatUSD(l.purchasePrice)}</td>
                  <td className="num">
                    {mode === 'each'
                      ? <input className="input input-sm price-input" type="number" min={0} step="0.01" value={price[l.id]} onChange={(e) => setPrice({ ...price, [l.id]: e.target.value })} />
                      : formatUSD((qty[l.id] ?? 0) > 0 ? each(l.id) : null)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="if-grid">
          {mode === 'total' && (
            <label className="if-field"><span className="label">Total received</span>
              <input className="input" type="number" min={0} step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
              <span className="muted tiny-label">Split across cards by market value</span>
            </label>
          )}
          <label className="if-field"><span className="label">Date sold</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="if-field"><span className="label">Notes <span className="optional">optional</span></span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. order #1234" />
          </label>
        </div>
        <WhereFields value={where} onChange={setWhere} />
        <div className="sell-summary">
          <span>{plural(copies, 'card')} · received {formatUSD(proceeds)}</span>
          {base > 0 ? <PLBadge diff={pl} pct={(pl / base) * 100} /> : <span className="muted small">No purchase prices — P/L unknown</span>}
          {costed.length < active.length && base > 0 && <span className="muted small">P/L over {costed.length}/{active.length} lots with a purchase price</span>}
          <span className="muted small">Market {formatUSD(market)}</span>
        </div>
        {dipsIntoDecks && <div className="alert alert-warn">This includes copies committed to decks — those allocations will shrink.</div>}
        <div className="ie-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!copies || busy} onClick={submit}>Record sale</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Card-for-card trade ----------

interface GetLine { key: string; card: Card; finish: Finish; qty: number; value: string; condition?: Condition }

export function TradeModal({ itemIds = [], onClose, onDone }: { itemIds?: string[]; onClose: () => void; onDone?: () => void }) {
  const items = collectionT.useAll();
  const [give, setGive] = useState<{ id: string; qty: number; value: string }[]>(() => itemIds.map((id) => {
    const l = collectionT.get(id);
    return { id, qty: l?.qty ?? 1, value: (l ? itemUnitValue(l, false) ?? 0 : 0).toFixed(2) };
  }));
  const [get, setGet] = useState<GetLine[]>([]);
  const [pickLot, setPickLot] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const [cash, setCash] = useState('');
  const [cashDir, setCashDir] = useState<'in' | 'out'>('in');
  const [date, setDate] = useState(today());
  const [where, setWhere] = useState<Where>({ venue: 'in-person' });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const lotLabel = (id: string) => {
    const l = items.find((i) => i.id === id);
    return l ? `${l.card.name} (${l.card.set.toUpperCase()} #${l.card.collector_number}${l.finish !== 'nonfoil' ? `, ${FINISH_LABEL[l.finish]}` : ''}) ×${l.qty}` : '';
  };
  const lotOptions = useMemo(() => items.filter((i) => !give.some((g) => g.id === i.id)).map((i) => ({ id: i.id, label: lotLabel(i.id) })), [items, give]);
  const addLot = (e: FormEvent) => {
    e.preventDefault();
    const hit = lotOptions.find((o) => o.label === pickLot) ?? lotOptions.find((o) => o.label.toLowerCase().startsWith(pickLot.toLowerCase().trim()));
    if (!hit) return;
    const l = items.find((i) => i.id === hit.id)!;
    setGive([...give, { id: l.id, qty: 1, value: (itemUnitValue(l, false) ?? 0).toFixed(2) }]);
    setPickLot('');
  };
  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      const query = /[:<>=!"]/.test(q) ? q : `!"${q.trim()}" or "${q.trim()}"`;
      setFound((await searchCards(`${query} game:paper`, { unique: 'prints', order: 'released', dir: 'desc' })).data.slice(0, 18));
    } catch (err) { toast((err as Error).message, 'error'); } finally { setSearching(false); }
  };
  const addGet = (c: Card) => {
    const f = defaultFinish(c);
    setGet([...get, { key: uid(), card: c, finish: f, qty: 1, value: (finishPrice(c, f) ?? 0).toFixed(2) }]);
    setFound([]);
    setQ('');
  };
  const patchGet = (key: string, p: Partial<GetLine>) => setGet(get.map((g) => (g.key === key ? { ...g, ...p } : g)));

  const giveValue = give.reduce((s, g) => s + num(g.value) * g.qty, 0);
  const getValue = get.reduce((s, g) => s + num(g.value) * g.qty, 0);
  const cashSigned = (cashDir === 'in' ? 1 : -1) * num(cash);
  const balance = getValue + cashSigned - giveValue;
  const givenCost = give.reduce((s, g) => { const l = items.find((i) => i.id === g.id); return l?.purchasePrice != null ? s + l.purchasePrice * g.qty : s; }, 0);

  const submit = async () => {
    setBusy(true);
    await recordTrade({
      give: give.filter((g) => g.qty > 0).map((g) => ({ itemId: g.id, qty: g.qty, value: num(g.value) })),
      get: get.filter((g) => g.qty > 0).map((g) => ({ card: g.card, finish: g.finish, qty: g.qty, value: num(g.value), condition: g.condition })),
      cash: cashSigned, date, notes: notes || undefined, ...where,
    });
    toast(`Trade recorded${where.counterparty ? ` with ${where.counterparty}` : ''}`, 'success');
    onDone?.();
    onClose();
  };

  return (
    <Modal onClose={onClose} wide title="Record a trade">
      <div className="sell-form">
        <div className="trade-grid">
          <section className="trade-side">
            <h3>You give</h3>
            {give.map((g) => {
              const l = items.find((i) => i.id === g.id);
              if (!l) return null;
              return (
                <div key={g.id} className="trade-line">
                  <img src={cardImage(l.card, 'small')} alt="" className="inv-thumb" />
                  <div className="inv-card-text"><span className="inv-name truncate">{l.card.name}</span>
                    <span className="muted tiny-label">{l.card.set.toUpperCase()} · {FINISH_LABEL[l.finish]} · market {formatUSD(itemUnitValue(l, false))}</span></div>
                  <input className="input input-sm qty-input" type="number" min={1} max={l.qty} value={g.qty} aria-label="Copies"
                    onChange={(e) => setGive(give.map((x) => (x.id === g.id ? { ...x, qty: Math.max(1, Math.min(l.qty, parseInt(e.target.value, 10) || 1)) } : x)))} />
                  <input className="input input-sm price-input" type="number" min={0} step="0.01" value={g.value} aria-label="Value each"
                    onChange={(e) => setGive(give.map((x) => (x.id === g.id ? { ...x, value: e.target.value } : x)))} />
                  <button className="icon-btn sm danger" aria-label="Remove" onClick={() => setGive(give.filter((x) => x.id !== g.id))}>✕</button>
                </div>
              );
            })}
            <form className="search-row" onSubmit={addLot}>
              <input className="input input-sm" list="trade-lots" value={pickLot} onChange={(e) => setPickLot(e.target.value)} placeholder="Add a card from your collection…" />
              <datalist id="trade-lots">{lotOptions.map((o) => <option key={o.id} value={o.label} />)}</datalist>
              <button className="btn btn-sm" type="submit" disabled={!pickLot.trim()}>+ Add</button>
            </form>
            <div className="muted small">Value given: <b>{formatUSD(giveValue)}</b></div>
          </section>

          <section className="trade-side">
            <h3>You receive</h3>
            {get.map((g) => (
              <div key={g.key} className="trade-line">
                <img src={cardImage(g.card, 'small')} alt="" className="inv-thumb" />
                <div className="inv-card-text"><span className="inv-name truncate">{g.card.name}</span>
                  <span className="muted tiny-label">{g.card.set.toUpperCase()} #{g.card.collector_number}</span>
                  <span className="trade-opts">
                    <select className="input input-xs" value={g.finish} onChange={(e) => { const f = e.target.value as Finish; patchGet(g.key, { finish: f, value: (finishPrice(g.card, f) ?? num(g.value)).toFixed(2) }); }}>
                      {availableFinishes(g.card).map((f) => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
                    </select>
                    <select className="input input-xs" value={g.condition ?? ''} onChange={(e) => patchGet(g.key, { condition: (e.target.value || undefined) as Condition | undefined })}>
                      <option value="">Cond.</option>
                      {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                    </select>
                  </span>
                </div>
                <input className="input input-sm qty-input" type="number" min={1} value={g.qty} aria-label="Copies" onChange={(e) => patchGet(g.key, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                <input className="input input-sm price-input" type="number" min={0} step="0.01" value={g.value} aria-label="Value each" onChange={(e) => patchGet(g.key, { value: e.target.value })} />
                <button className="icon-btn sm danger" aria-label="Remove" onClick={() => setGet(get.filter((x) => x.key !== g.key))}>✕</button>
              </div>
            ))}
            <form className="search-row" onSubmit={search}>
              <input className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Scryfall for the card you get…" />
              <button className="btn btn-sm" disabled={searching}>{searching ? '…' : 'Find'}</button>
            </form>
            {found.length > 0 && (
              <div className="results-grid compact trade-results">
                {found.map((c) => (
                  <button key={c.id} className="print-pick" onClick={() => addGet(c)}>
                    <img src={cardImage(c, 'small')} alt={c.name} loading="lazy" />
                    <span className="muted tiny-label">{c.set.toUpperCase()} #{c.collector_number}</span>
                    <span className="price tiny-label">{formatUSD(finishPrice(c, defaultFinish(c)))}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="if-field cash-field">
              <span className="label">Cash / store credit</span>
              <div className="adv-inline">
                <div className="status-toggle">
                  <button type="button" className={`seg ${cashDir === 'in' ? 'on' : ''}`} onClick={() => setCashDir('in')}>I received</button>
                  <button type="button" className={`seg ${cashDir === 'out' ? 'on' : ''}`} onClick={() => setCashDir('out')}>I paid</button>
                </div>
                <input className="input input-sm price-input" type="number" min={0} step="0.01" value={cash} placeholder="0.00" onChange={(e) => setCash(e.target.value)} />
              </div>
            </div>
            <div className="muted small">Value received: <b>{formatUSD(getValue + cashSigned)}</b></div>
          </section>
        </div>

        <div className="if-grid">
          <label className="if-field"><span className="label">Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="if-field"><span className="label">Notes <span className="optional">optional</span></span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <WhereFields value={where} onChange={setWhere} who="Traded with" />
        <div className="sell-summary">
          <span>Balance {balance >= 0 ? 'in your favor' : 'against you'}: <PLBadge diff={balance} pct={giveValue > 0 ? (balance / giveValue) * 100 : null} /></span>
          {givenCost > 0 && <span className="muted small">You paid {formatUSD(givenCost)} for what you give</span>}
        </div>
        <p className="muted tiny">
          Cards you give leave your collection with a note like “Traded {date}{where.counterparty ? ` with ${where.counterparty}` : ''} for …”. Cards you receive are added with
          their trade value as the price paid. What you receive is split across what you give by value to work out each card's realized gain/loss.
        </p>
        <div className="ie-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !give.some((g) => g.qty > 0)} onClick={submit}>Record trade</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Sell a whole deck ----------

export function SellDeckModal({ purchasedDeckId, onClose }: { purchasedDeckId?: string; onClose: () => void }) {
  const items = collectionT.useAll();
  const decks = decksT.useAll();
  const pd = ownedDecksT.useOne(purchasedDeckId);
  const settings = useSettings();
  const [deckId, setDeckId] = useState(pd?.deckId ?? decks[0]?.id ?? '');
  const [skipBasics, setSkipBasics] = useState(settings.ignoreBasics);
  const deck = decks.find((d) => d.id === deckId);

  const plan = useMemo(() => {
    if (pd) return { lines: lotsOfPurchasedDeck(items, pd.id).map((l) => ({ itemId: l.id, qty: l.qty, price: 0 })), missing: [] };
    if (!deck) return { lines: [], missing: [] };
    return lotsForDeck(deck, items, skipBasics);
  }, [pd, deck, items, skipBasics]);
  const name = pd?.name ?? deck?.name ?? '';
  const copies = plan.lines.reduce((n, l) => n + l.qty, 0);
  const market = plan.lines.reduce((s, l) => { const i = items.find((x) => x.id === l.itemId); return s + (i ? itemUnitValue(i, false) ?? 0 : 0) * l.qty; }, 0);
  const cost = plan.lines.reduce((s, l) => { const i = items.find((x) => x.id === l.itemId); return s + (i?.purchasePrice ?? 0) * l.qty; }, 0);
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(today());
  const [where, setWhere] = useState<Where>({ venue: 'online' });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const p = price === '' ? market : num(price);

  const submit = async () => {
    setBusy(true);
    const n = await sellDeck({ name, lines: plan.lines, price: p, date, notes: notes || undefined, purchasedDeckId: pd?.id, ...where });
    toast(`Sold ${name}: ${plural(n, 'card')} for ${formatUSD(p)}`, 'success');
    onClose();
  };

  return (
    <Modal onClose={onClose} wide title={pd ? `Sell ${pd.name}` : 'Sell a deck'}>
      <div className="sell-form">
        {!pd && (
          <>
            <p className="muted small">Sells the collection copies that make up one of your decks: copies committed to it first, then uncommitted copies.</p>
            <div className="if-grid">
              <label className="if-field"><span className="label">Deck</span>
                <select className="input" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                  {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="radio"><input type="checkbox" checked={skipBasics} onChange={(e) => setSkipBasics(e.target.checked)} /> Leave basic lands out</label>
            </div>
          </>
        )}
        <div className="sell-summary">
          <span>{plural(copies, 'card')} from your collection</span>
          <span className="muted small">Market {formatUSD(market)}</span>
          {cost > 0 && <span className="muted small">Paid {formatUSD(cost)}</span>}
        </div>
        {plan.missing.length > 0 && (
          <div className="alert alert-warn">
            You don't own (or have free) {plural(plan.missing.reduce((n, m) => n + m.qty, 0), 'card')} of this deck — {plan.missing.slice(0, 8).map((m) => `${m.qty}× ${m.name}`).join(', ')}
            {plan.missing.length > 8 ? '…' : ''}. Only cards in your collection are recorded.
          </div>
        )}
        <div className="if-grid">
          <label className="if-field"><span className="label">Sale price (whole deck)</span>
            <input className="input" type="number" min={0} step="0.01" value={price} placeholder={market.toFixed(2)} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="if-field"><span className="label">Date sold</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="if-field"><span className="label">Notes <span className="optional">optional</span></span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <WhereFields value={where} onChange={setWhere} />
        <div className="sell-summary">
          <span>Received {formatUSD(p)}</span>
          {cost > 0 ? <PLBadge diff={p - cost} pct={((p - cost) / cost) * 100} /> : <span className="muted small">No purchase prices — P/L unknown</span>}
        </div>
        <p className="muted tiny">Each card is logged with the note “Sold with deck {name || '…'}” and its share of the price (by market value). The deck list itself stays in Your Decks.</p>
        <div className="ie-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !copies} onClick={submit}>Record deck sale</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Record a deck you bought ----------

export function BuyDeckModal({ onClose }: { onClose: () => void }) {
  const decks = decksT.useAll();
  const settings = useSettings();
  const [mode, setMode] = useState<'deck' | 'paste'>(decks.length ? 'deck' : 'paste');
  const [deckId, setDeckId] = useState(decks[0]?.id ?? '');
  const [text, setText] = useState('');
  const [name, setName] = useState(decks[0]?.name ?? '');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(today());
  const [source, setSource] = useState('');
  const [condition, setCondition] = useState<Condition | ''>('NM');
  const [skipBasics, setSkipBasics] = useState(false);
  const [commit, setCommit] = useState(true);
  const [createDeck, setCreateDeck] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const toast = useToast();
  const deck = decks.find((d) => d.id === deckId);
  const preview: DeckCardLine[] = mode === 'deck' && deck ? deckLines(deck, skipBasics) : [];
  const previewValue = preview.reduce((s, l) => s + (finishPrice(l.card, l.finish) ?? 0) * l.qty, 0);

  const submit = async () => {
    setBusy(true);
    setMissing([]);
    try {
      let lines = preview;
      if (mode === 'paste') {
        const r = await resolveCardList(text);
        lines = r.lines;
        if (r.missing.length) setMissing(r.missing);
        if (!lines.length) { setBusy(false); return; }
      }
      const pd = await buyDeck({
        name: name.trim() || deck?.name || 'Purchased deck', lines, price: price === '' ? undefined : num(price), date,
        source: source || undefined, condition: condition || undefined, notes: notes || undefined,
        deckId: mode === 'deck' ? deckId : undefined, createDeck: mode === 'paste' && createDeck, commit,
      });
      toast(`Added ${pd.name} — ${plural(pd.cardsAtPurchase, 'card')}`, 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} wide title="Add a purchased deck">
      <div className="sell-form">
        <p className="muted small">For precons and decks bought as a whole. Every card is added to your collection; the price you paid is split across the cards by market value, so selling single cards later still shows a sensible gain/loss.</p>
        <div className="status-toggle">
          <button className={`seg ${mode === 'deck' ? 'on' : ''}`} disabled={!decks.length} onClick={() => setMode('deck')}>From one of my decks</button>
          <button className={`seg ${mode === 'paste' ? 'on' : ''}`} onClick={() => setMode('paste')}>Paste a decklist</button>
        </div>
        {mode === 'deck' ? (
          <div className="if-grid">
            <label className="if-field"><span className="label">Deck</span>
              <select className="input" value={deckId} onChange={(e) => { setDeckId(e.target.value); setName(decks.find((d) => d.id === e.target.value)?.name ?? ''); }}>
                {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="radio"><input type="checkbox" checked={skipBasics} onChange={(e) => setSkipBasics(e.target.checked)} /> Leave basic lands out</label>
            <div className="muted small">{plural(preview.reduce((n, l) => n + l.qty, 0), 'card')} · market {formatUSD(previewValue)}</div>
          </div>
        ) : (
          <>
            <textarea className="input textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1 Atraxa, Grand Unifier (ONC) 1\n1 Sol Ring\n...'} />
            <label className="radio"><input type="checkbox" checked={createDeck} onChange={(e) => setCreateDeck(e.target.checked)} /> Also create it in Your Decks</label>
          </>
        )}
        <div className="if-grid">
          <label className="if-field"><span className="label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grand Larceny precon" />
          </label>
          <label className="if-field"><span className="label">Price paid (whole deck)</span>
            <input className="input" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="—" />
          </label>
          <label className="if-field"><span className="label">Bought on</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="if-field"><span className="label">Bought from</span>
            <input className="input" list="pd-sources" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Not set" />
            <datalist id="pd-sources">{SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="if-field"><span className="label">Condition</span>
            <select className="input" value={condition} onChange={(e) => setCondition(e.target.value as Condition | '')}>
              <option value="">Not set</option>
              {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            </select>
          </label>
          <label className="if-field"><span className="label">Notes <span className="optional">optional</span></span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        {(mode === 'deck' || createDeck) && (
          <label className="radio"><input type="checkbox" checked={commit} onChange={(e) => setCommit(e.target.checked)} /> Commit these copies to the deck</label>
        )}
        {settings.ignoreBasics && mode === 'deck' && !skipBasics && <div className="muted tiny">Basic lands are included (precons come with them).</div>}
        {missing.length > 0 && <div className="alert alert-error">Couldn't find {missing.length}: {missing.join(', ')}</div>}
        <div className="ie-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || (mode === 'deck' ? !preview.length : !text.trim())} onClick={submit}>{busy ? 'Adding…' : 'Add purchased deck'}</button>
        </div>
      </div>
    </Modal>
  );
}
