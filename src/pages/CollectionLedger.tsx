import { useMemo, useState, type ReactNode } from 'react';
import { CardLink } from '../components/CardLink';
import { CardModal } from '../components/CardModal';
import { hideArt, hoverArtProps } from '../components/HoverArt';
import type { Card, PurchasedDeck, SaleRecord, TxKind } from '../types';
import { collectionT, decksT, ownedDecksT, pricesT, salesT } from '../lib/store';
import { computePL, FINISH_LABEL, isDisposal, lotsTrend, realizedPL, spentOn, valueSeries } from '../lib/collection';
import {
  exportSummary, exportTransactions, inRange, KIND_LABEL, lotsOfPurchasedDeck, PERIODS, summarizeByPeriod, VENUES, whereLabel, type Period,
} from '../lib/ledger';
import { cardImage, formatUSD } from '../lib/rules';
import { navigate } from '../lib/router';
import { DeltaBadge, PLBadge, ValueChart } from '../components/Money';
import { BuyDeckModal, SellDeckModal, TradeModal } from '../components/TransactionModals';
import { ItemModal } from '../components/CollectionModals';
import { LabeledTable } from '../components/LabeledTable';

export function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="stat-value">{children}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

const txPL = (s: SaleRecord) => {
  if (!isDisposal(s) || s.costBasis == null || s.price == null) return { diff: null, pct: null };
  return { diff: (s.price - s.costBasis) * s.qty, pct: s.costBasis ? ((s.price - s.costBasis) / s.costBasis) * 100 : null };
};

// ======================= Transactions =======================

type TxSort = 'date' | 'card' | 'kind' | 'qty' | 'price' | 'total' | 'pl' | 'where';
type KindFilter = 'all' | 'in' | 'out' | 'trades' | TxKind;
const isTrade = (s: SaleRecord) => s.kind === 'traded' || s.kind === 'received';
const RANGES: { id: string; label: string; days?: number }[] = [
  { id: 'all', label: 'All time' }, { id: '7', label: '7 days', days: 7 }, { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 }, { id: '365', label: '12 months', days: 365 }, { id: 'ytd', label: 'This year' }, { id: 'custom', label: 'Custom' },
];
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

export function Transactions() {
  const [viewing, setViewing] = useState<Card | null>(null);
  const all = salesT.useAll();
  const [kind, setKind] = useState<KindFilter>('all');
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [venue, setVenue] = useState('');
  const [group, setGroup] = useState('');
  const [sort, setSort] = useState<TxSort>('date');
  const [dir, setDir] = useState<1 | -1>(-1);
  const [period, setPeriod] = useState<Period>('month');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [trading, setTrading] = useState(false);
  const [limit, setLimit] = useState(200);

  const r = RANGES.find((x) => x.id === range)!;
  const lo = range === 'custom' ? from || undefined : range === 'ytd' ? `${new Date().getFullYear()}-01-01` : r.days ? daysAgo(r.days) : undefined;
  const hi = range === 'custom' ? to || undefined : undefined;

  const groups = useMemo(() => [...new Map(all.filter((s) => s.groupId && s.groupLabel).map((s) => [s.groupId!, s.groupLabel!])).entries()], [all]);
  const ql = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const f = all.filter((s) => inRange(s.date, lo, hi))
      .filter((s) => kind === 'all' || (kind === 'in' ? s.kind === 'bought' || s.kind === 'received' : kind === 'out' ? isDisposal(s) : kind === 'trades' ? isTrade(s) : s.kind === kind))
      .filter((s) => !venue || s.venue === venue)
      .filter((s) => !group || s.groupId === group)
      .filter((s) => !ql || [s.card.name, s.card.set, s.card.set_name, s.channel, s.counterparty, s.notes, s.groupLabel, s.source]
        .some((x) => x?.toLowerCase().includes(ql)));
    const val = (s: SaleRecord): string | number => {
      switch (sort) {
        case 'date': return `${s.date}:${String(s.createdAt).padStart(15, '0')}`;
        case 'card': return s.card.name;
        case 'kind': return s.kind;
        case 'qty': return s.qty;
        case 'price': return s.price ?? -1;
        case 'total': return (s.price ?? 0) * s.qty;
        case 'pl': return txPL(s).diff ?? -Infinity;
        case 'where': return whereLabel(s);
      }
    };
    return f.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return c * dir || b.createdAt - a.createdAt;
    });
  }, [all, lo, hi, kind, venue, group, ql, sort, dir]);

  const realized = realizedPL(rows);
  const spent = spentOn(rows);
  const received = rows.filter((s) => s.kind === 'received').reduce((n, s) => n + s.qty, 0);
  const periods = useMemo(() => summarizeByPeriod(rows, period), [rows, period]);
  const maxAbs = Math.max(1, ...periods.map((p) => Math.abs(p.pl)));
  const setSortKey = (k: TxSort) => { if (sort === k) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(k); setDir(k === 'card' || k === 'where' || k === 'kind' ? 1 : -1); } };
  const Th = ({ k, children, num }: { k: TxSort; children: ReactNode; num?: boolean }) => (
    <th className={num ? 'num' : ''}><button className={`th-sort ${sort === k ? 'on' : ''}`} onClick={() => setSortKey(k)}>{children}{sort === k ? (dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>
  );
  const filtered = kind !== 'all' || range !== 'all' || !!venue || !!group || !!ql;

  return (
    <div className="transactions">
      <div className="stat-grid">
        <Stat label="Spent (bought)" sub={`${spent.copies.toLocaleString()} cards in · ${received} received in trades`}>{formatUSD(spent.spent)}</Stat>
        <Stat label="Received (sold)" sub={`${realized.copies.toLocaleString()} cards sold · ${realized.count} transactions`}>{formatUSD(realized.proceeds)}</Stat>
        <Stat label="Cost of cards sold" sub="where purchase price was known">{formatUSD(realized.cost)}</Stat>
        <Stat label="Realized gain / loss" sub={`${filtered ? 'for the filtered transactions' : 'all time'} · trades not included`}>
          {realized.count ? <PLBadge diff={realized.pl} pct={realized.pct} /> : <span className="muted">—</span>}
        </Stat>
      </div>

      <div className="library-toolbar tx-toolbar">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden>⌕</span>
          <input className="input library-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search card, set, buyer, retailer, notes…" aria-label="Search transactions" />
        </div>
        <select className="input input-sm" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
          {RANGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        {range === 'custom' && (
          <span className="date-range">
            <input className="input input-sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span className="muted">–</span>
            <input className="input input-sm" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </span>
        )}
        <select className="input input-sm" value={venue} onChange={(e) => setVenue(e.target.value)} aria-label="Where">
          <option value="">Anywhere</option>
          {VENUES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        {groups.length > 0 && (
          <select className="input input-sm" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Deck / trade group">
            <option value="">All groups</option>
            {groups.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setTrading(true)}>⇄ Record a trade</button>
        <button className="btn btn-sm" onClick={() => exportTransactions(rows, 'all')} disabled={!rows.length}>⇩ Export view (.csv)</button>
      </div>
      <div className="tag-filter-row">
        {([['all', 'All'], ['in', 'In (bought + received)'], ['out', 'Out (sold + traded)'], ['bought', 'Bought'], ['sold', 'Sold'], ['trades', 'Trades'], ['traded', 'Traded away'], ['received', 'Received in trade']] as [KindFilter, string][]).map(([k, l]) => (
          <button key={k} className={`chip ${kind === k ? 'chip-on' : ''}`} onClick={() => setKind(k)}>{l}</button>
        ))}
        {filtered && <button className="link-btn small" onClick={() => { setKind('all'); setRange('all'); setVenue(''); setGroup(''); setQ(''); }}>Clear filters</button>}
      </div>

      <section className="panel period-panel">
        <div className="section-head">
          <h3>Sale earnings / losses</h3>
          <div className="status-toggle">
            {PERIODS.map((p) => <button key={p.id} className={`seg ${period === p.id ? 'on' : ''}`} onClick={() => setPeriod(p.id)}>{p.label}</button>)}
          </div>
          <button className="link-btn small" onClick={() => exportSummary(rows, period)} disabled={!rows.length}>⇩ CSV</button>
        </div>
        {periods.length === 0 ? <div className="muted small">No transactions in this view.</div> : (
          <div className="table-wrap flat">
            <table className="color-table num-table period-table">
              <thead><tr><th>Period</th><th>Sold</th><th>Received</th><th>Cost</th><th>Realized gain / loss</th><th aria-label="Bar" /><th>Bought</th><th>Spent</th></tr></thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td>{p.copiesOut || '—'}</td>
                    <td>{p.sales ? formatUSD(p.proceeds) : '—'}</td>
                    <td>{p.sales ? formatUSD(p.cost) : '—'}{p.unknownCost > 0 && <span className="muted tiny-label" title="Cards with no purchase price — excluded from gain/loss"> ({p.unknownCost} ?)</span>}</td>
                    <td>{p.sales ? <PLBadge diff={p.pl} pct={p.pct} /> : <span className="muted">—</span>}</td>
                    <td className="bar-cell">{p.sales > 0 && p.pl !== 0 && <span className={`pl-bar ${p.pl > 0 ? 'gain' : 'loss'}`} style={{ width: `${(Math.abs(p.pl) / maxAbs) * 100}%` }} />}</td>
                    <td>{p.copiesIn || '—'}</td>
                    <td>{p.bought ? formatUSD(p.spent) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {realized.trades.count > 0 && (
              <p className="muted small">
                Trades (not included above): {realized.trades.out.cards.toLocaleString()} card{realized.trades.out.cards === 1 ? '' : 's'} traded away
                ({formatUSD(realized.trades.out.value)}) · {realized.trades.in.cards.toLocaleString()} received ({formatUSD(realized.trades.in.value)}), by trade value.
              </p>
            )}
          </div>
        )}
      </section>

      {rows.length === 0 ? (
        <div className="empty">{all.length ? 'No transactions match.' : 'No transactions yet. Adding cards logs a purchase; selling or trading (from Inventory, a card, or a deck) logs the rest.'}</div>
      ) : (
        <div className="table-wrap">
          <LabeledTable className="inv-table tx-table">
            <thead>
              <tr>
                <Th k="date">Date</Th><Th k="kind">Type</Th><Th k="card">Card</Th><Th k="qty" num>Qty</Th><Th k="price" num>Each</Th>
                <Th k="total" num>Total</Th><th className="num">Paid each</th><Th k="pl" num>Gain / loss</Th><Th k="where">Where</Th><th>Notes</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((s) => {
                const pl = txPL(s);
                return (
                  <tr key={s.id} className="static-row">
                    <td className="small nowrap">{s.date}</td>
                    <td><span className={`tx-kind tx-${s.kind}`}>{KIND_LABEL[s.kind]}</span></td>
                    <td className="inv-card">
                      <img src={cardImage(s.card, 'small')} alt="" className="inv-thumb" loading="lazy" />
                      <div className="inv-card-text">
                        <CardLink card={s.card} name={s.card.name} draggable={false} onOpen={() => setViewing(s.card)}><span className="inv-name truncate card-link-name">{s.card.name}</span></CardLink>
                        <span className="muted tiny-label">{s.card.set.toUpperCase()} #{s.card.collector_number} · {FINISH_LABEL[s.finish]}{s.condition ? ` · ${s.condition}` : ''}</span>
                      </div>
                    </td>
                    <td className="num">{s.qty}</td>
                    <td className="num">{formatUSD(s.price)}</td>
                    <td className="num"><b>{s.price != null ? formatUSD(s.price * s.qty) : '—'}</b></td>
                    <td className="num">{isDisposal(s) ? formatUSD(s.costBasis) : ''}</td>
                    <td className="num">{isDisposal(s) ? <PLBadge diff={pl.diff} pct={pl.pct} /> : ''}</td>
                    <td className="small">{whereLabel(s) || <span className="muted">—</span>}</td>
                    <td className="small tx-notes">
                      {s.groupLabel && <button className="deck-chip" onClick={() => setGroup(s.groupId!)} title="Show everything in this group">{s.groupLabel}</button>}
                      <span className="muted">{s.notes}</span>
                    </td>
                    <td>
                      {confirm === s.id ? (
                        <span className="row-actions">
                          <button className="btn btn-sm btn-danger" onClick={() => salesT.remove(s.id)}>Delete</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>Keep</button>
                        </span>
                      ) : <button className="icon-btn sm danger" title="Delete record (doesn't change your collection)" onClick={() => setConfirm(s.id)}>🗑</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </LabeledTable>
        </div>
      )}
      {rows.length > limit && <button className="btn btn-ghost load-more" onClick={() => setLimit((l) => l + 300)}>Show more ({rows.length - limit} hidden)</button>}
      <p className="muted tiny">Deleting a record only removes it from history — it doesn't add or remove cards. Sold and traded rows are the permanent record of cards no longer in your collection.</p>
      {trading && <TradeModal onClose={() => setTrading(false)} />}
      {viewing && <CardModal card={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ======================= Purchased decks =======================

export function PurchasedDecks() {
  const owned = ownedDecksT.useAll();
  const items = collectionT.useAll();
  const sales = salesT.useAll();
  const snaps = pricesT.useAll();
  const decks = decksT.useAll();
  const [adding, setAdding] = useState(false);
  const [selling, setSelling] = useState<{ pd?: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showSold, setShowSold] = useState(true);

  const rows = useMemo(() => owned.map((pd) => {
    const lots = lotsOfPurchasedDeck(items, pd.id);
    const pl = computePL(lots, false);
    const out = sales.filter((s) => s.purchasedDeckId === pd.id && isDisposal(s));
    const realized = realizedPL(out, { includeTrades: true });
    return { pd, lots, pl, realized, trend: lotsTrend(snaps, lots, 7), remaining: pl.qty };
  }), [owned, items, sales, snaps]);
  const active = rows.filter((r) => r.pd.status === 'owned');
  const totals = {
    paid: active.reduce((s, r) => s + (r.pd.purchasePrice ?? 0), 0),
    value: active.reduce((s, r) => s + r.pl.value, 0),
    realized: rows.reduce((s, r) => s + r.realized.proceeds, 0),
  };
  const trendAll = lotsTrend(snaps, active.flatMap((r) => r.lots), 7);
  const shown = rows.filter((r) => showSold || r.pd.status === 'owned');

  return (
    <div className="purchased-decks">
      <div className="stat-grid">
        <Stat label="Decks owned" sub={`${rows.length - active.length} sold`}>{active.length}</Stat>
        <Stat label="Paid (owned decks)">{formatUSD(totals.paid)}</Stat>
        <Stat label="Value now" sub={<DeltaBadge diff={trendAll?.diff} pct={trendAll?.pct} />}>{formatUSD(totals.value)}</Stat>
        <Stat label="Gain / loss (owned)" sub="value now + sold cards − paid">
          {totals.paid ? <PLBadge diff={totals.value + active.reduce((s, r) => s + r.realized.proceeds, 0) - totals.paid} pct={((totals.value + active.reduce((s, r) => s + r.realized.proceeds, 0) - totals.paid) / totals.paid) * 100} /> : <span className="muted">—</span>}
        </Stat>
      </div>
      <div className="library-toolbar">
        <label className="radio small"><input type="checkbox" checked={showSold} onChange={(e) => setShowSold(e.target.checked)} /> Show sold decks</label>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setSelling({})} disabled={!decks.length}>$ Sell a deck I built…</button>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>+ Add purchased deck</button>
      </div>

      {shown.length === 0 ? (
        <div className="empty">No purchased decks yet. Add a precon or a deck you bought whole to track what it's worth against what you paid.</div>
      ) : (
        <div className="pd-list">
          {shown.map(({ pd, lots, pl, realized, trend, remaining }) => {
            const total = pl.value + realized.proceeds;
            const diff = pd.purchasePrice != null ? total - pd.purchasePrice : null;
            const deck = decks.find((d) => d.id === pd.deckId);
            const isOpen = open === pd.id;
            return (
              <section key={pd.id} className={`panel pd-card ${pd.status === 'sold' ? 'sold' : ''}`}>
                <button className="pd-head" onClick={() => setOpen(isOpen ? null : pd.id)} aria-expanded={isOpen}>
                  <span className="pd-title">
                    <b className="truncate">{pd.name}</b>
                    <span className="muted small">
                      {pd.acquiredAt ?? 'date unknown'}{pd.source ? ` · ${pd.source}` : ''} · {remaining}/{pd.cardsAtPurchase} cards left
                      {pd.status === 'sold' && pd.sold ? ` · sold ${pd.sold.date} for ${formatUSD(pd.sold.price)}` : ''}
                    </span>
                  </span>
                  <span className="pd-nums">
                    <span><span className="label">Paid</span>{formatUSD(pd.purchasePrice)}</span>
                    <span><span className="label">{pd.status === 'sold' ? 'Received' : 'Value'}</span>{formatUSD(pd.status === 'sold' ? realized.proceeds : pl.value)}</span>
                    <span><span className="label">Gain / loss</span><PLBadge diff={diff} pct={diff != null && pd.purchasePrice ? (diff / pd.purchasePrice) * 100 : null} /></span>
                    {pd.status === 'owned' && <span><span className="label">7 days</span><DeltaBadge diff={trend?.diff} pct={trend?.pct} /></span>}
                  </span>
                  <span className="pd-chev" aria-hidden>{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && <PurchasedDeckDetail pd={pd} lots={lots} realizedProceeds={realized.proceeds} deckName={deck?.name} onSell={() => setSelling({ pd: pd.id })} />}
              </section>
            );
          })}
        </div>
      )}
      {adding && <BuyDeckModal onClose={() => setAdding(false)} />}
      {selling && <SellDeckModal purchasedDeckId={selling.pd} onClose={() => setSelling(null)} />}
    </div>
  );
}

function PurchasedDeckDetail({ pd, lots, realizedProceeds, deckName, onSell }: {
  pd: PurchasedDeck; lots: ReturnType<typeof lotsOfPurchasedDeck>; realizedProceeds: number; deckName?: string; onSell: () => void;
}) {
  const snaps = pricesT.useAll();
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const series = useMemo(() => valueSeries(snaps, lots), [snaps, lots]);
  const sorted = [...lots].sort((a, b) => computePL([b], false).value - computePL([a], false).value || a.card.name.localeCompare(b.card.name));
  return (
    <div className="pd-detail">
      <div className="pd-detail-grid">
        <div>
          <ValueChart series={series} height={140} label={`${pd.name} value`} />
          <div className="muted tiny">
            Value at purchase {formatUSD(pd.valueAtPurchase)}{realizedProceeds > 0 ? ` · ${formatUSD(realizedProceeds)} received from cards sold or traded out of it` : ''}.
            {pd.notes ? ` ${pd.notes}` : ''}
          </div>
          <div className="ie-actions ie-left">
            {pd.deckId && deckName && <button className="btn btn-sm" onClick={() => navigate(`/deck/${pd.deckId}`)}>Open deck “{deckName}”</button>}
            {pd.status === 'owned' && lots.length > 0 && <button className="btn btn-sm btn-primary" onClick={onSell}>$ Sell whole deck…</button>}
            {confirm ? (
              <>
                <button className="btn btn-sm btn-danger" onClick={async () => {
                  await collectionT.putMany(lots.map((l) => ({ ...l, purchasedDeckId: undefined })));
                  await ownedDecksT.remove(pd.id);
                }}>Remove record</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>Keep</button>
                <span className="muted tiny">Cards stay in your collection as ordinary lots.</span>
              </>
            ) : <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)}>🗑 Remove</button>}
          </div>
        </div>
        <div className="table-wrap pd-lots">
          <LabeledTable className="inv-table">
            <thead><tr><th>Card</th><th className="num">Qty</th><th className="num">Cost each</th><th className="num">Value</th></tr></thead>
            <tbody>
              {sorted.map((l) => {
                const v = computePL([l], false);
                return (
                  <tr key={l.id} onClick={() => { hideArt(); setOpenItem(l.id); }} {...hoverArtProps(l.card)}>
                    <td className="truncate">{l.card.name} <span className="muted tiny-label">{l.card.set.toUpperCase()}</span></td>
                    <td className="num">{l.qty}</td>
                    <td className="num">{formatUSD(l.purchasePrice)}</td>
                    <td className="num">{formatUSD(v.priced ? v.value : null)}</td>
                  </tr>
                );
              })}
              {sorted.length === 0 && <tr><td colSpan={4} className="muted small">No cards left — all sold or traded.</td></tr>}
            </tbody>
          </LabeledTable>
        </div>
      </div>
      {openItem && <ItemModal itemId={openItem} onClose={() => setOpenItem(null)} />}
    </div>
  );
}

