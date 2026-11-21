import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Card, CollectionItem, Intent } from '../types';
import {
  collectionT, decksT, pricesT, salesT, setSettings, useSettings, watchT,
} from '../lib/store';
import {
  allocatedQty, bulkUpdate, computePL, deleteItems, FINISH_LABEL, finishPrice, freeQty, INTENTS, intentLabel, isForSale,
  itemPL, itemUnitValue, printBadges, realizedPL, refreshCollectionPrices, trendPct, valueSeries, priceSeries,
} from '../lib/collection';
import { buildBuyList, wantList, type BuyLine } from '../lib/ownership';
import { parseQuery } from '../lib/query';
import { searchCards } from '../lib/scryfall';
import { usePool, useAllCollectionTags, useGlobalTags, useSubjects } from '../lib/hooks';
import { useScryfallTags } from '../lib/scryfallTags';
import { download } from '../lib/backup';
import { cardImage, cardPrice, formatUSD } from '../lib/rules';
import { navigate } from '../lib/router';
import { PLBadge, Sparkline, Trend, ValueChart } from '../components/Money';
import { FavStar, Tag, TagList, SCOPE_META, cleanTag, type TagScope } from '../components/TagEditor';
import { SavedSearches } from '../components/SavedSearches';
import { TagModal } from '../components/TagModal';
import { AddCardsModal } from '../components/AddCardsModal';
import { BackupModal } from '../components/BackupModal';
import { AddToCollectionModal, ItemModal, WatchModal } from '../components/CollectionModals';
import { useToast } from '../components/Toast';
import { CardLink } from '../components/CardLink';
import { CardModal } from '../components/CardModal';
import { hideArt, hoverArtProps } from '../components/HoverArt';
import { SellModal, TradeModal } from '../components/TransactionModals';
import { PurchasedDecks, Stat, Transactions } from './CollectionLedger';
import { LabeledTable } from '../components/LabeledTable';
import { FavoritesTab } from './FavoritesTab';

export type CollectionTab = 'overview' | 'inventory' | 'favorites' | 'decks' | 'transactions' | 'buy' | 'binder' | 'watch';
const TABS: { id: CollectionTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'favorites', label: '★ Favorites' },
  { id: 'decks', label: 'Purchased decks' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'buy', label: 'Buy list' },
  { id: 'binder', label: 'Trade binder' },
  { id: 'watch', label: 'Watchlist' },
];

const quoteTag = (t: string) => (/\s/.test(t) ? `"${t}"` : t);

export function CollectionPage({ tab }: { tab: CollectionTab }) {
  const items = collectionT.useAll();
  const loaded = collectionT.useLoaded();
  const settings = useSettings();
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState<CollectionItem[] | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [invQuery, setInvQuery] = useState('');
  const toast = useToast();
  // On narrow screens the tab strip scrolls sideways: keep the current tab in view.
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  const refresh = async () => {
    setRefreshing('Starting…');
    try {
      const n = await refreshCollectionPrices((d, t) => setRefreshing(`${d}/${t}`));
      toast(n ? `Updated prices for ${n} printings` : 'Nothing to refresh yet', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRefreshing(null);
    }
  };

  /** Jump to the inventory with a query (e.g. from a tag or alert). */
  const showInInventory = (q: string) => { setInvQuery(q); navigate('/collection/inventory'); };

  return (
    <div className="collection-page">
      <div className="library-head">
        <div>
          <h1>Collection</h1>
          <p className="muted">
            Prices from Scryfall (TCGplayer market){settings.lastCollectionRefresh ? ` · updated ${new Date(settings.lastCollectionRefresh).toLocaleString()}` : ''}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={refresh} disabled={!!refreshing}>{refreshing ? `Refreshing ${refreshing}` : '↻ Refresh prices'}</button>
          <button className="btn" onClick={() => setExporting(items)}>⇩ Export & backup</button>
          <button className="btn btn-primary btn-lg" onClick={() => setAdding(true)}>+ Add cards</button>
        </div>
      </div>

      <nav className="board-tabs coll-tabs" ref={tabsRef}>
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => navigate(t.id === 'overview' ? '/collection' : `/collection/${t.id}`)}>
            {t.label}
          </button>
        ))}
      </nav>

      {!loaded ? <div className="loading">Loading collection…</div> : (
        <>
          {tab === 'overview' && <Overview onAdd={() => setAdding(true)} showInInventory={showInInventory} />}
          {tab === 'inventory' && <Inventory query={invQuery} setQuery={setInvQuery} onExport={(sel) => setExporting(sel)} onAdd={() => setAdding(true)} />}
          {tab === 'favorites' && <FavoritesTab />}
          {tab === 'buy' && <BuyList />}
          {tab === 'binder' && <TradeBinder />}
          {tab === 'watch' && <Watchlist />}
          {tab === 'decks' && <PurchasedDecks />}
          {tab === 'transactions' && <Transactions />}
        </>
      )}

      {adding && <AddCardsModal onClose={() => setAdding(false)} />}
      {exporting && <BackupModal items={exporting} selectedCount={exporting.length !== items.length ? exporting.length : undefined} onClose={() => setExporting(null)} />}
    </div>
  );
}

// ======================= Overview =======================

function Overview({ onAdd, showInInventory }: { onAdd: () => void; showInInventory: (q: string) => void }) {
  const items = collectionT.useAll();
  const decks = decksT.useAll();
  const sales = salesT.useAll();
  const snaps = pricesT.useAll();
  const watch = watchT.useAll();
  const settings = useSettings();
  const pool = usePool();
  const [openItem, setOpenItem] = useState<string | null>(null);

  const pl = useMemo(() => computePL(items, settings.conditionAdjust), [items, settings.conditionAdjust]);
  const realized = useMemo(() => realizedPL(sales), [sales]);
  const unique = useMemo(() => new Set(items.map((i) => i.card.name)).size, [items]);
  const uniquePrints = useMemo(() => new Set(items.map((i) => `${i.card.id}:${i.finish}`)).size, [items]);
  const series = useMemo(() => valueSeries(snaps, items), [snaps, items]);

  const ranked = useMemo(() => items.map((i) => ({ i, ...itemPL(i) })).filter((x) => x.diff != null), [items]);
  const gainers = [...ranked].sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0)).filter((x) => (x.diff ?? 0) > 0).slice(0, 5);
  const losers = [...ranked].sort((a, b) => (a.diff ?? 0) - (b.diff ?? 0)).filter((x) => (x.diff ?? 0) < 0).slice(0, 5);
  const movers = useMemo(() => items
    .map((i) => ({ i, t: trendPct(snaps, i.card, i.finish, 7) }))
    .filter((x) => x.t != null && Math.abs(x.t) >= 15)
    .sort((a, b) => Math.abs(b.t!) - Math.abs(a.t!)).slice(0, 6), [items, snaps]);
  const sellHits = items.filter((i) => isForSale(i.intent) && i.targetPrice != null && (finishPrice(i.card, i.finish) ?? 0) >= i.targetPrice);
  const buyHits = wantList(watch, items).filter((w) => w.hit);

  const byIntent = useMemo(() => {
    const rows = [...INTENTS.map((x) => x.id), undefined].map((id) => {
      const sub = items.filter((i) => i.intent === id);
      return { id, label: id ? intentLabel(id) : 'No status', count: sub.reduce((n, i) => n + i.qty, 0), ...computePL(sub, settings.conditionAdjust) };
    });
    return rows.filter((r) => r.count > 0);
  }, [items, settings.conditionAdjust]);

  if (!items.length) {
    return (
      <div className="empty-hero">
        <h2>Start your collection</h2>
        <p className="muted">Add cards by searching Scryfall, pasting a list, or straight from a deck. Track exact printings, what you paid, and what they're worth now.</p>
        <button className="btn btn-primary btn-lg" onClick={onAdd}>+ Add cards</button>
      </div>
    );
  }

  return (
    <div className="overview">
      <div className="stat-grid">
        <Stat label="Market value" sub={pl.priced < pl.qty ? `${pl.qty - pl.priced} cards have no price` : settings.conditionAdjust ? 'condition-adjusted estimate' : 'near-mint market'}>
          {formatUSD(pl.value)}
        </Stat>
        <Stat label="Paid" sub={pl.costed < pl.qty ? `purchase price known for ${pl.costed}/${pl.qty} cards` : 'all purchase prices recorded'}>
          {formatUSD(pl.cost)}
        </Stat>
        <Stat label="Unrealized gain / loss" sub="cards with a purchase price">
          <PLBadge diff={pl.plBase ? pl.pl : null} pct={pl.pct} />
        </Stat>
        <Stat label="Realized (sold)" sub={<>{formatUSD(realized.proceeds)} received{realized.trades.count ? ` · trades not included: ${realized.trades.out.cards} out (${formatUSD(realized.trades.out.value)}), ${realized.trades.in.cards} in (${formatUSD(realized.trades.in.value)})` : ''} · <button className="link-btn" onClick={() => navigate('/collection/transactions')}>{realized.count} transaction{realized.count === 1 ? '' : 's'} →</button></>}>
          {realized.count ? <PLBadge diff={realized.pl} pct={realized.pct} /> : <span className="muted">—</span>}
        </Stat>
        <Stat label="Cards" sub={`${unique.toLocaleString()} unique · ${uniquePrints.toLocaleString()} printings · ${items.length} lots`}>
          {pl.qty.toLocaleString()}
        </Stat>
        <Stat label="Decks buildable" sub={decks.length ? (pool.allBuildable ? 'all at once from one pool ✓' : `not all at once — short ${pool.shortfall.reduce((n, s) => n + s.missing, 0)} cards`) : 'no decks yet'}>
          {pool.fullyCovered}<span className="stat-den"> / {decks.length}</span>
        </Stat>
      </div>

      <div className="overview-grid">
        <section className="panel">
          <div className="section-head">
            <h3>Collection value</h3>
            <label className="radio small">
              <input type="checkbox" checked={settings.conditionAdjust} onChange={(e) => setSettings({ conditionAdjust: e.target.checked })} />
              Adjust for condition (estimate)
            </label>
          </div>
          <ValueChart series={series} label="Collection value" />
          <div className="muted tiny">Market value per day from your price snapshots, at today's quantities. Snapshots are taken when prices refresh (at most daily).</div>
        </section>

        <section className="panel">
          <h3>Alerts</h3>
          {sellHits.length === 0 && buyHits.length === 0 && movers.length === 0 && (
            <div className="muted small alert-empty">No alerts. Set a target price on Sell/Trade lots or watchlist cards to get notified here; big 7-day moves appear once price history builds up.</div>
          )}
          {sellHits.length > 0 && (
            <div className="alert-group">
              <div className="label">▲ Sell targets reached</div>
              {sellHits.slice(0, 5).map((i) => (
                <button key={i.id} className="alert-row" onClick={() => { hideArt(); setOpenItem(i.id); }} {...hoverArtProps(i.card)}>
                  <span className="truncate">{i.card.name}</span>
                  <span className="price">{formatUSD(finishPrice(i.card, i.finish))} ≥ {formatUSD(i.targetPrice)}</span>
                </button>
              ))}
            </div>
          )}
          {buyHits.length > 0 && (
            <div className="alert-group">
              <div className="label">▼ Buy targets reached</div>
              {buyHits.slice(0, 5).map((w) => (
                <button key={w.id} className="alert-row" onClick={() => { hideArt(); navigate('/collection/watch'); }} {...hoverArtProps(w.card)}>
                  <span className="truncate">{w.card.name}</span>
                  <span className="price">{formatUSD(w.unit)} ≤ {formatUSD(w.target)}</span>
                </button>
              ))}
            </div>
          )}
          {movers.length > 0 && (
            <div className="alert-group">
              <div className="label">Big moves (7 days)</div>
              {movers.map(({ i, t }) => (
                <button key={i.id} className="alert-row" onClick={() => { hideArt(); setOpenItem(i.id); }} {...hoverArtProps(i.card)}>
                  <span className="truncate">{i.card.name} <span className="muted">{i.card.set.toUpperCase()}</span></span>
                  <Trend pct={t} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="section-head"><h3>Top gainers</h3><button className="link-btn small" onClick={() => showInInventory('is:gain')}>All →</button></div>
          <MoverList rows={gainers} onOpen={setOpenItem} empty="No gains yet — add purchase prices to track them." />
        </section>
        <section className="panel">
          <div className="section-head"><h3>Top losers</h3><button className="link-btn small" onClick={() => showInInventory('is:loss')}>All →</button></div>
          <MoverList rows={losers} onOpen={setOpenItem} empty="Nothing is below what you paid." />
        </section>

        <section className="panel">
          <h3>By market status</h3>
          <table className="color-table num-table">
            <thead><tr><th>Status</th><th>Cards</th><th>Value</th><th>Gain / loss</th></tr></thead>
            <tbody>
              {byIntent.map((r) => (
                <tr key={r.label} className="clickable" onClick={() => showInInventory(r.id ? `status:${r.id}` : 'status:none')}>
                  <td>{r.id ? <span className={`intent intent-${r.id}`}>{r.label}</span> : <span className="muted">{r.label}</span>}</td>
                  <td>{r.count}</td>
                  <td>{formatUSD(r.value)}</td>
                  <td><PLBadge diff={r.plBase ? r.pl : null} pct={r.pct} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="section-head"><h3>Deck coverage</h3><button className="link-btn small" onClick={() => navigate('/collection/buy')}>Buy list →</button></div>
          {decks.length === 0 ? <div className="muted small">No decks yet.</div> : (
            <ul className="coverage-list">
              {pool.order.map((d) => {
                const c = pool.byDeck.get(d.id)!;
                return (
                  <li key={d.id}>
                    <button className="alert-row" onClick={() => navigate(`/deck/${d.id}`)}>
                      <span className={`own-dot ${c.complete ? 'full' : c.covered ? 'part' : 'none'}`} aria-hidden />
                      <span className="truncate">{d.favorite ? '★ ' : ''}{d.name}</span>
                      <span className="muted small">{c.totalNeed ? `${c.covered}/${c.totalNeed}` : 'empty'}</span>
                      <span className="price">{c.missing ? formatUSD(c.missingCost) : '✓'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="muted tiny">One shared pool: decks are filled in priority order (committed copies, favorites, then most recently edited).</div>
        </section>
      </div>
      {openItem && <ItemModal itemId={openItem} onClose={() => setOpenItem(null)} />}
    </div>
  );
}

function MoverList({ rows, onOpen, empty }: { rows: { i: CollectionItem; diff: number | null; pct: number | null }[]; onOpen: (id: string) => void; empty: string }) {
  if (!rows.length) return <div className="muted small">{empty}</div>;
  return (
    <ul className="coverage-list">
      {rows.map(({ i, diff, pct }) => (
        <li key={i.id}>
          <button className="alert-row" onClick={() => { hideArt(); onOpen(i.id); }} {...hoverArtProps(i.card)}>
            <span className="truncate">{i.card.name} <span className="muted small">{i.card.set.toUpperCase()}{i.finish !== 'nonfoil' ? ` · ${FINISH_LABEL[i.finish]}` : ''}</span></span>
            <PLBadge diff={diff} pct={pct} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ======================= Inventory =======================

type SortKey = 'name' | 'value' | 'unit' | 'pl' | 'pct' | 'trend' | 'qty' | 'added' | 'set' | 'paid';

function Inventory({ query, setQuery, onExport, onAdd }: { query: string; setQuery: (q: string) => void; onExport: (items: CollectionItem[]) => void; onAdd: () => void }) {
  const items = collectionT.useAll();
  const snaps = pricesT.useAll();
  const decks = decksT.useAll();
  const allTags = useAllCollectionTags();
  const subjects = useSubjects();
  const settings = useSettings();
  const [sort, setSort] = useState<SortKey>('name');
  const [dir, setDir] = useState<1 | -1>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(150);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [tagging, setTagging] = useState<CollectionItem | null>(null);
  const [selling, setSelling] = useState<string[] | null>(null);
  const [trading, setTrading] = useState<string[] | null>(null);

  const parsed = useMemo(() => parseQuery(query), [query]);
  const rows = useMemo(() => {
    const filtered = items.filter((i) => parsed.test(subjects(i.card, { item: i })));
    const val = (i: CollectionItem): number | string => {
      switch (sort) {
        case 'name': return i.card.name;
        case 'set': return `${i.card.set}:${i.card.collector_number.padStart(5, '0')}`;
        case 'value': return (itemUnitValue(i) ?? 0) * i.qty;
        case 'unit': return itemUnitValue(i) ?? 0;
        case 'paid': return i.purchasePrice ?? -1;
        case 'pl': return itemPL(i).diff ?? -Infinity;
        case 'pct': return itemPL(i).pct ?? -Infinity;
        case 'trend': return trendPct(snaps, i.card, i.finish, 7) ?? -Infinity;
        case 'qty': return i.qty;
        case 'added': return i.addedAt;
      }
    };
    return filtered.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return c * dir || a.card.name.localeCompare(b.card.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, parsed, subjects, sort, dir, snaps, settings.conditionAdjust]);

  const sel = rows.filter((r) => selected.has(r.id));
  const selPL = computePL(sel);
  const viewPL = computePL(rows);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const setSortKey = (k: SortKey) => { if (sort === k) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(k); setDir(k === 'name' || k === 'set' ? 1 : -1); } };
  const onTagClick = (scope: TagScope, t: string) => setQuery(`${SCOPE_META[scope].key}:${quoteTag(t)}`);
  const globalTags = useGlobalTags();
  const stags = useScryfallTags();
  const quick = (q: string) => setQuery(query.includes(q) ? query.replace(q, '').replace(/\s+/g, ' ').trim() : `${query} ${q}`.trim());
  const deckName = (id: string) => decks.find((d) => d.id === id)?.name ?? '';

  const Th = ({ k, children, num }: { k: SortKey; children: ReactNode; num?: boolean }) => (
    <th className={num ? 'num' : ''}>
      <button className={`th-sort ${sort === k ? 'on' : ''}`} onClick={() => setSortKey(k)}>{children}{sort === k ? (dir === 1 ? ' ↑' : ' ↓') : ''}</button>
    </th>
  );

  if (!items.length) {
    return <div className="empty-hero"><h2>No cards yet</h2><button className="btn btn-primary btn-lg" onClick={onAdd}>+ Add cards</button></div>;
  }

  return (
    <div className="inventory">
      <div className="library-toolbar">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden>⌕</span>
          <input className="input library-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder='Search your collection… e.g. sol ring, is:foil usd>10, coltag:binder status:sell gain>=25' aria-label="Search collection" />
        </div>
        <SavedSearches query={query} onApply={setQuery} />
        <select className="input input-sm" value={sort} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort">
          <option value="name">Sort: Name</option>
          <option value="value">Sort: Total value</option>
          <option value="unit">Sort: Price each</option>
          <option value="pl">Sort: Gain/loss $</option>
          <option value="pct">Sort: Gain/loss %</option>
          <option value="trend">Sort: 7-day trend</option>
          <option value="qty">Sort: Quantity</option>
          <option value="paid">Sort: Price paid</option>
          <option value="set">Sort: Set</option>
          <option value="added">Sort: Recently added</option>
        </select>
      </div>
      <div className="tag-filter-row">
        {[['is:fav', '★ Favorites'], ['is:foil', 'Foil'], ['is:alt', 'Alt art'], ['is:gain', '▲ Gains'], ['is:loss', '▼ Losses'], ['is:forsale', 'For sale/trade'], ['is:unallocated', 'Not in a deck']].map(([q, l]) => (
          <button key={q} className={`chip ${query.includes(q) ? 'chip-on' : ''}`} onClick={() => quick(q)}>{l}</button>
        ))}
        {allTags.slice(0, 12).map((t) => <Tag key={t} scope="collection" small onClick={() => onTagClick('collection', t)}>{t}</Tag>)}
      </div>
      {parsed.warnings.length > 0 && <div className="warn-text small">{parsed.warnings.join(' · ')}</div>}

      <div className="inv-summary">
        <span>{rows.length.toLocaleString()} lot{rows.length === 1 ? '' : 's'} · {viewPL.qty.toLocaleString()} cards</span>
        <span>Value <b>{formatUSD(viewPL.value)}</b></span>
        <span>Paid {formatUSD(viewPL.cost)}</span>
        <PLBadge diff={viewPL.plBase ? viewPL.pl : null} pct={viewPL.pct} />
      </div>

      {sel.length > 0 && (
        <BulkBar
          ids={sel.map((s) => s.id)} pl={selPL} allTags={allTags}
          onClear={() => setSelected(new Set())} onExport={() => onExport(sel)}
          onSell={() => setSelling(sel.map((s) => s.id))} onTrade={() => setTrading(sel.map((s) => s.id))}
        />
      )}

      <div className="table-wrap">
        <LabeledTable className="inv-table">
          <thead>
            <tr>
              <th className="cb"><input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" /></th>
              <th aria-label="Favorite" />
              <Th k="name">Card</Th>
              <Th k="set">Print</Th>
              <Th k="qty" num>Qty</Th>
              <Th k="paid" num>Paid</Th>
              <Th k="unit" num>Market</Th>
              <Th k="value" num>Value</Th>
              <Th k="pl" num>Gain / loss</Th>
              <Th k="trend" num>7d</Th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((i) => {
              const unit = itemUnitValue(i);
              const pl = itemPL(i);
              const alloc = allocatedQty(i);
              const badges = printBadges(i.card);
              const plClass = pl.pct != null && Math.abs(pl.pct) >= 25 ? (pl.pct > 0 ? 'row-gain' : 'row-loss') : '';
              return (
                <tr key={i.id} className={`${selected.has(i.id) ? 'selected' : ''} ${plClass}`} onClick={() => { hideArt(); setOpenItem(i.id); }} {...hoverArtProps(i.card)}>
                  <td className="cb" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.card.name}`} />
                  </td>
                  <td><FavStar on={i.favorite} onToggle={() => collectionT.update(i.id, (d) => { d.favorite = !d.favorite; })} /></td>
                  <td className="inv-card">
                    <img src={cardImage(i.card, 'small')} alt="" className="inv-thumb" loading="lazy" />
                    <div className="inv-card-text">
                      <span className="inv-name truncate">{i.card.name}</span>
                      <span className="inv-sub">
                        {i.finish !== 'nonfoil' && <span className={`finish-badge ${i.finish}`}>{FINISH_LABEL[i.finish]}</span>}
                        {badges.map((b) => <span key={b} className="print-badge">{b}</span>)}
                        {i.condition && <span className="cond-badge">{i.condition}</span>}
                        <TagList groups={[{ scope: 'global', tags: globalTags.get(i.card.name) ?? [] }, { scope: 'collection', tags: i.tags }, { scope: 'scryfall', tags: stags.get(i.card.name) ?? [] }]} max={3} onTagClick={onTagClick} />
                      </span>
                    </div>
                  </td>
                  <td className="small"><span title={i.card.set_name}>{i.card.set.toUpperCase()}</span> <span className="muted">#{i.card.collector_number}</span></td>
                  <td className="num">
                    {i.qty}
                    {alloc > 0 && <div className="muted tiny-label" title={Object.entries(i.allocations).map(([d, n]) => `${deckName(d)} ×${n}`).join('\n')}>{alloc} in decks</div>}
                  </td>
                  <td className="num">{formatUSD(i.purchasePrice)}</td>
                  <td className="num">{formatUSD(unit)}</td>
                  <td className="num"><b>{formatUSD(unit != null ? unit * i.qty : null)}</b></td>
                  <td className="num"><PLBadge diff={pl.diff} pct={pl.pct} /></td>
                  <td className="num"><Trend pct={trendPct(snaps, i.card, i.finish, 7)} /></td>
                  <td>
                    {i.intent && <span className={`intent intent-${i.intent}`}>{intentLabel(i.intent)}</span>}
                    {i.targetPrice != null && <div className="muted tiny-label">target {formatUSD(i.targetPrice)}</div>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <span className="row-actions">
                      <button className="icon-btn sm" title="Sell" aria-label={`Sell ${i.card.name}`} onClick={() => setSelling([i.id])}>$</button>
                      <button className="icon-btn sm" title="Tag" aria-label={`Tag ${i.card.name}`} onClick={() => setTagging(i)}>🏷</button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </LabeledTable>
      </div>
      {rows.length > limit && <button className="btn btn-ghost load-more" onClick={() => setLimit((l) => l + 300)}>Show more ({rows.length - limit} hidden)</button>}
      {rows.length === 0 && <div className="empty">No cards match.</div>}

      {openItem && <ItemModal itemId={openItem} onClose={() => setOpenItem(null)} />}
      {tagging && <TagModal card={tagging.card} context={{ kind: 'collection', itemId: tagging.id }} onClose={() => setTagging(null)} />}
      {selling && <SellModal itemIds={selling} onClose={() => setSelling(null)} onDone={() => setSelected(new Set())} />}
      {trading && <TradeModal itemIds={trading} onClose={() => setTrading(null)} onDone={() => setSelected(new Set())} />}
    </div>
  );
}

function BulkBar({ ids, pl, allTags, onClear, onExport, onSell, onTrade }: { ids: string[]; pl: ReturnType<typeof computePL>; allTags: string[]; onClear: () => void; onExport: () => void; onSell: () => void; onTrade: () => void }) {
  const [tag, setTag] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const toast = useToast();
  const n = ids.length;
  const addTag = async (e: FormEvent) => {
    e.preventDefault();
    const t = cleanTag(tag);
    if (!t) return;
    await bulkUpdate(ids, (d) => { if (!d.tags.includes(t)) d.tags.push(t); });
    toast(`Tagged ${n} lot${n === 1 ? '' : 's'} “${t}”`, 'success');
    setTag('');
  };
  const removeTag = async () => {
    const t = cleanTag(tag);
    if (!t) return;
    await bulkUpdate(ids, (d) => { d.tags = d.tags.filter((x) => x !== t); });
    setTag('');
  };
  return (
    <div className="bulk-bar">
      <div className="bulk-stats">
        <b>{n} selected</b> · {pl.qty} cards · value <b>{formatUSD(pl.value)}</b> · paid {formatUSD(pl.cost)}
        <PLBadge diff={pl.plBase ? pl.pl : null} pct={pl.pct} />
      </div>
      <div className="bulk-actions">
        <select className="input input-sm" value="" onChange={async (e) => {
          const v = e.target.value as Intent | 'none';
          await bulkUpdate(ids, (d) => { d.intent = v === 'none' ? undefined : v; });
        }} aria-label="Set market status">
          <option value="" disabled>Set status…</option>
          {INTENTS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          <option value="none">Clear status</option>
        </select>
        <form className="bulk-tag" onSubmit={addTag}>
          <input className="input input-sm" list="bulk-tags" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="◈ tag" aria-label="Collection tag" />
          <datalist id="bulk-tags">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
          <button className="btn btn-sm" type="submit" disabled={!tag.trim()}>+ Tag</button>
          <button className="btn btn-sm btn-ghost" type="button" disabled={!tag.trim()} onClick={removeTag}>− Untag</button>
        </form>
        <button className="btn btn-sm" onClick={() => bulkUpdate(ids, (d) => { d.favorite = true; })}>★</button>
        <button className="btn btn-sm" onClick={() => bulkUpdate(ids, (d) => { d.favorite = false; })}>☆</button>
        <button className="btn btn-sm btn-primary" onClick={onSell}>$ Sell…</button>
        <button className="btn btn-sm" onClick={onTrade}>⇄ Trade…</button>
        <button className="btn btn-sm" onClick={onExport}>Export</button>
        {confirmDel ? (
          <>
            <button className="btn btn-sm btn-danger" onClick={async () => { await deleteItems(ids); onClear(); }}>Delete {n}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDel(false)}>Keep</button>
          </>
        ) : <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDel(true)}>🗑</button>}
        <button className="link-btn small" onClick={onClear}>Clear selection</button>
      </div>
    </div>
  );
}

// ======================= Buy list =======================

function BuyList() {
  const [viewing, setViewing] = useState<Card | null>(null);
  const decks = decksT.useAll();
  const items = collectionT.useAll();
  const watch = watchT.useAll();
  const settings = useSettings();
  const pool = usePool();
  const toast = useToast();
  const [cheapest, setCheapest] = useState<Map<string, Card>>(new Map());
  const [finding, setFinding] = useState<string | null>(null);
  const [buying, setBuying] = useState<BuyLine | null>(null);

  const lines = useMemo(() => buildBuyList(decks, items, settings.buyListMode, settings.ignoreBasics, pool), [decks, items, settings.buyListMode, settings.ignoreBasics, pool]);
  const unitFor = (l: BuyLine) => cardPrice(cheapest.get(l.name) ?? l.card) ?? l.unit;
  const total = lines.reduce((s, l) => s + (unitFor(l) ?? 0) * l.buy, 0);
  const copies = lines.reduce((n, l) => n + l.buy, 0);
  const wants = wantList(watch, items);

  const findCheapest = async () => {
    const m = new Map(cheapest);
    let i = 0;
    for (const l of lines) {
      setFinding(`${++i}/${lines.length}`);
      try {
        const res = await searchCards(`!"${l.name.replace(/"/g, '')}" game:paper usd>0`, { unique: 'prints', order: 'usd', dir: 'asc' });
        if (res.data[0]) m.set(l.name, res.data[0]);
      } catch { /* keep the deck's print */ }
    }
    setCheapest(m);
    setFinding(null);
    toast('Found the cheapest printing for each card', 'success');
  };

  const exportText = () => {
    const txt = lines.map((l) => {
      const c = cheapest.get(l.name) ?? l.card;
      return `${l.buy} ${l.name} (${c.set.toUpperCase()}) ${c.collector_number}`;
    }).join('\n') + '\n';
    download(`buy-list-${new Date().toISOString().slice(0, 10)}.txt`, txt);
  };

  return (
    <div className="buylist">
      <div className="buy-head panel">
        <div className="buy-total">
          <div className="label">Estimated total</div>
          <div className="price-total">{formatUSD(total)}</div>
          <div className="muted small">{copies} card{copies === 1 ? '' : 's'} across {lines.length} name{lines.length === 1 ? '' : 's'}</div>
        </div>
        <div className="buy-controls">
          <div className="status-toggle" role="radiogroup" aria-label="How to count shared cards">
            <button className={`seg ${settings.buyListMode === 'sum' ? 'on' : ''}`} role="radio" aria-checked={settings.buyListMode === 'sum'} onClick={() => setSettings({ buyListMode: 'sum' })}>Build all decks at once</button>
            <button className={`seg ${settings.buyListMode === 'max' ? 'on' : ''}`} role="radio" aria-checked={settings.buyListMode === 'max'} onClick={() => setSettings({ buyListMode: 'max' })}>Swap cards between decks</button>
          </div>
          <div className="muted small">
            {settings.buyListMode === 'sum'
              ? 'Every deck sleeved up at the same time: copies needed are added up across decks.'
              : 'You move cards between decks: you only need the most any single deck uses.'}
          </div>
          <div className="ie-actions ie-left">
            <label className="radio"><input type="checkbox" checked={settings.ignoreBasics} onChange={(e) => setSettings({ ignoreBasics: e.target.checked })} /> Ignore basic lands</label>
            <button className="btn btn-sm" onClick={findCheapest} disabled={!!finding || !lines.length}>{finding ? `Checking ${finding}…` : '$ Find cheapest printings'}</button>
            <button className="btn btn-sm" onClick={exportText} disabled={!lines.length}>⇩ Export list</button>
          </div>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="empty">{decks.length ? 'You own everything your decks need. 🎉' : 'Create a deck to see what you need to buy.'}</div>
      ) : (
        <div className="table-wrap">
          <LabeledTable className="inv-table">
            <thead><tr><th>Card</th><th>Decks</th><th className="num">Needed</th><th className="num">Owned</th><th className="num">To buy</th><th className="num">Each</th><th className="num">Subtotal</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => {
                const c = cheapest.get(l.name) ?? l.card;
                const unit = unitFor(l);
                return (
                  <tr key={l.name}>
                    <td className="inv-card">
                      <img src={cardImage(c, 'small')} alt="" className="inv-thumb" loading="lazy" />
                      <div className="inv-card-text">
                        <CardLink card={c} name={l.name} draggable={false} onOpen={() => setViewing(c)}><span className="inv-name truncate card-link-name">{l.name}</span></CardLink>
                        <span className="muted tiny-label">{c.set.toUpperCase()} #{c.collector_number}{cheapest.has(l.name) ? ' · cheapest print' : " · deck's print"}</span>
                      </div>
                    </td>
                    <td className="small">
                      {l.decks.filter((d) => settings.buyListMode === 'max' || d.missing > 0).map((d) => (
                        <button key={d.deck.id} className="deck-chip" onClick={() => navigate(`/deck/${d.deck.id}`)} title={`Needs ${d.need}${d.missing ? `, missing ${d.missing}` : ''}`}>
                          {d.deck.name}{settings.buyListMode === 'sum' && d.missing ? ` ×${d.missing}` : ''}
                        </button>
                      ))}
                    </td>
                    <td className="num">{l.need}</td>
                    <td className="num">{l.owned}</td>
                    <td className="num"><b>{l.buy}</b></td>
                    <td className="num">{formatUSD(unit)}</td>
                    <td className="num">{formatUSD(unit != null ? unit * l.buy : null)}</td>
                    <td><button className="btn btn-sm" title="Mark as purchased — adds to your collection" onClick={() => setBuying(l)}>🛒 Bought</button></td>
                  </tr>
                );
              })}
            </tbody>
          </LabeledTable>
        </div>
      )}

      {wants.length > 0 && (
        <section className="panel want-section">
          <div className="section-head"><h3>Also wanted (watchlist & “Buy more”)</h3><button className="link-btn small" onClick={() => navigate('/collection/watch')}>Watchlist →</button></div>
          <ul className="coverage-list">
            {wants.map((w) => (
              <li key={`${w.kind}:${w.id}`} className="alert-row static">
                <span className="truncate">{w.qty}× <CardLink card={w.card} name={w.card.name} draggable={false} onOpen={() => setViewing(w.card)} className="inline-card-link" /> <span className="muted small">{w.card.set.toUpperCase()}</span></span>
                <span className="price">{formatUSD(w.unit)}{w.target != null && <> · target {formatUSD(w.target)}</>}</span>
                {w.hit && <span className="hit-badge">▼ at target</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {buying && <AddToCollectionModal card={cheapest.get(buying.name) ?? buying.card} qty={buying.buy} onClose={() => setBuying(null)} />}
      {viewing && <CardModal card={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ======================= Trade binder =======================

function TradeBinder() {
  const items = collectionT.useAll();
  const snaps = pricesT.useAll();
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'sell' | 'trade'>('all');
  const toast = useToast();
  const binder = items.filter((i) => isForSale(i.intent) && freeQty(i) > 0)
    .filter((i) => filter === 'all' || (filter === 'sell' ? i.intent !== 'trade' : i.intent !== 'sell'))
    .sort((a, b) => (itemUnitValue(b) ?? 0) * freeQty(b) - (itemUnitValue(a) ?? 0) * freeQty(a));
  const market = binder.reduce((s, i) => s + (itemUnitValue(i) ?? 0) * freeQty(i), 0);
  const atTarget = binder.reduce((s, i) => s + (i.targetPrice ?? itemUnitValue(i) ?? 0) * freeQty(i), 0);
  const hits = binder.filter((i) => i.targetPrice != null && (finishPrice(i.card, i.finish) ?? 0) >= i.targetPrice).length;

  const listText = () => binder.map((i) => {
    const f = i.finish === 'foil' ? ' *F*' : i.finish === 'etched' ? ' *E*' : '';
    const price = i.targetPrice ?? itemUnitValue(i);
    return `${freeQty(i)} ${i.card.name} (${i.card.set.toUpperCase()}) ${i.card.collector_number}${f}${i.condition ? ` [${i.condition}]` : ''}${price != null ? ` — ${formatUSD(price)}` : ''}`;
  }).join('\n') + '\n';
  const copy = async () => {
    try { await navigator.clipboard.writeText(listText()); toast('Trade list copied', 'success'); } catch { toast('Could not access the clipboard', 'error'); }
  };

  return (
    <div className="binder">
      <div className="stat-grid">
        <Stat label="Binder market value" sub={`${binder.reduce((n, i) => n + freeQty(i), 0)} cards available`}>{formatUSD(market)}</Stat>
        <Stat label="At your asking prices" sub="target price, or market if none">{formatUSD(atTarget)}</Stat>
        <Stat label="Targets reached" sub="market ≥ your target">{hits}</Stat>
      </div>
      <div className="library-toolbar">
        <div className="status-toggle">
          {(['all', 'sell', 'trade'] as const).map((f) => <button key={f} className={`seg ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'sell' ? 'For sale' : 'For trade'}</button>)}
        </div>
        <span className="muted small">Lots marked Sell / Trade, minus copies committed to decks.</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={copy} disabled={!binder.length}>Copy list</button>
        <button className="btn btn-sm" onClick={() => download('trade-binder.txt', listText())} disabled={!binder.length}>⇩ Download list</button>
      </div>
      {binder.length === 0 ? (
        <div className="empty">Nothing in your binder. Set a lot's Market status to Sell or Trade (in Inventory, or in bulk) to list it here.</div>
      ) : (
        <div className="table-wrap">
          <LabeledTable className="inv-table">
            <thead><tr><th>Card</th><th>Status</th><th className="num">Available</th><th className="num">Paid</th><th className="num">Market</th><th className="num">Target</th><th className="num">7d</th><th className="num">Gain / loss</th><th /></tr></thead>
            <tbody>
              {binder.map((i) => {
                const unit = itemUnitValue(i);
                const hit = i.targetPrice != null && (finishPrice(i.card, i.finish) ?? 0) >= i.targetPrice;
                const pl = itemPL(i);
                return (
                  <tr key={i.id} onClick={() => { hideArt(); setOpenItem(i.id); }} {...hoverArtProps(i.card)}>
                    <td className="inv-card">
                      <img src={cardImage(i.card, 'small')} alt="" className="inv-thumb" loading="lazy" />
                      <div className="inv-card-text">
                        <span className="inv-name truncate">{i.card.name}</span>
                        <span className="muted tiny-label">{i.card.set.toUpperCase()} #{i.card.collector_number} · {FINISH_LABEL[i.finish]}{i.condition ? ` · ${i.condition}` : ''}</span>
                      </div>
                    </td>
                    <td><span className={`intent intent-${i.intent}`}>{intentLabel(i.intent)}</span></td>
                    <td className="num">{freeQty(i)}{freeQty(i) < i.qty && <span className="muted tiny-label"> of {i.qty}</span>}</td>
                    <td className="num">{formatUSD(i.purchasePrice)}</td>
                    <td className="num">{formatUSD(unit)}</td>
                    <td className="num">{formatUSD(i.targetPrice)}{hit && <div className="hit-badge">▲ reached</div>}</td>
                    <td className="num"><Trend pct={trendPct(snaps, i.card, i.finish, 7)} /></td>
                    <td className="num"><PLBadge diff={pl.diff} pct={pl.pct} /></td>
                    <td><button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setOpenItem(i.id); }}>Sell / trade…</button></td>
                  </tr>
                );
              })}
            </tbody>
          </LabeledTable>
        </div>
      )}
      {openItem && <ItemModal itemId={openItem} onClose={() => setOpenItem(null)} />}
    </div>
  );
}

// ======================= Watchlist =======================

function Watchlist() {
  const [viewing, setViewing] = useState<Card | null>(null);
  const watch = watchT.useAll();
  const items = collectionT.useAll();
  const snaps = pricesT.useAll();
  const [editing, setEditing] = useState<{ id?: string; card?: Card } | null>(null);
  const [bought, setBought] = useState<{ id: string; card: Card; qty: number } | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Card[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const buyIntent = items.filter((i) => i.intent === 'buy');

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try { setFound((await searchCards(/[:<>=]/.test(q) ? q : `"${q}"`, { order: 'edhrec' })).data.slice(0, 12)); } catch (err) { toast((err as Error).message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="watchlist">
      <form className="search-row panel watch-add" onSubmit={search}>
        <input className="input search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a card to watch…" aria-label="Find a card to watch" />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Searching…' : 'Find'}</button>
      </form>
      {found.length > 0 && (
        <div className="results-grid compact">
          {found.map((c) => (
            <button key={c.id} className="print-pick" onClick={() => { setEditing({ card: c }); setFound([]); setQ(''); }}>
              <img src={cardImage(c, 'small')} alt={c.name} loading="lazy" />
              <span className="truncate small">{c.name}</span>
              <span className="price tiny-label">{formatUSD(cardPrice(c))}</span>
            </button>
          ))}
        </div>
      )}

      {watch.length === 0 && buyIntent.length === 0 ? (
        <div className="empty">Watch cards you want and set a buy-at price — you'll see when the market reaches it. You can also watch from any card's details.</div>
      ) : (
        <div className="table-wrap">
          <LabeledTable className="inv-table">
            <thead><tr><th>Card</th><th className="num">Want</th><th className="num">Market</th><th className="num">Buy at</th><th className="num">7d</th><th>History</th><th /></tr></thead>
            <tbody>
              {watch.map((w) => {
                const unit = finishPrice(w.card, w.finish);
                const hit = w.targetPrice != null && unit != null && unit <= w.targetPrice;
                const gap = w.targetPrice != null && unit != null && w.targetPrice > 0 ? ((unit - w.targetPrice) / w.targetPrice) * 100 : null;
                return (
                  <tr key={w.id} className={hit ? 'row-gain' : ''}>
                    <td className="inv-card">
                      <img src={cardImage(w.card, 'small')} alt="" className="inv-thumb" loading="lazy" />
                      <div className="inv-card-text">
                        <CardLink card={w.card} name={w.card.name} draggable={false} onOpen={() => setViewing(w.card)}><span className="inv-name truncate card-link-name">{w.card.name}</span></CardLink>
                        <span className="muted tiny-label">{w.card.set.toUpperCase()} #{w.card.collector_number} · {FINISH_LABEL[w.finish]}{w.notes ? ` · ${w.notes}` : ''}</span>
                      </div>
                    </td>
                    <td className="num">{w.qty}</td>
                    <td className="num">{formatUSD(unit)}</td>
                    <td className="num">
                      {formatUSD(w.targetPrice)}
                      {hit ? <div className="hit-badge">▼ at target</div> : gap != null && <div className="muted tiny-label">{gap.toFixed(0)}% above</div>}
                    </td>
                    <td className="num"><Trend pct={trendPct(snaps, w.card, w.finish, 7)} /></td>
                    <td><Sparkline points={priceSeries(snaps, w.card.id, w.finish).slice(-30).map((p) => p.price)} /></td>
                    <td>
                      <span className="row-actions">
                        <button className="btn btn-sm" onClick={() => setBought({ id: w.id, card: w.card, qty: w.qty })}>🛒 Bought</button>
                        <button className="icon-btn sm" title="Edit" onClick={() => setEditing({ id: w.id })}>✎</button>
                        <button className="icon-btn sm danger" title="Remove" onClick={() => watchT.remove(w.id)}>🗑</button>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {buyIntent.map((i) => {
                const unit = finishPrice(i.card, i.finish);
                const hit = i.targetPrice != null && unit != null && unit <= i.targetPrice;
                return (
                  <tr key={i.id} className={hit ? 'row-gain' : ''}>
                    <td className="inv-card">
                      <img src={cardImage(i.card, 'small')} alt="" className="inv-thumb" loading="lazy" />
                      <div className="inv-card-text">
                        <CardLink card={i.card} name={i.card.name} draggable={false} onOpen={() => setViewing(i.card)}><span className="inv-name truncate card-link-name">{i.card.name}</span></CardLink>
                        <span className="muted tiny-label"><span className="intent intent-buy">Buy more</span> own {i.qty} · {i.card.set.toUpperCase()} · {FINISH_LABEL[i.finish]}</span>
                      </div>
                    </td>
                    <td className="num">—</td>
                    <td className="num">{formatUSD(unit)}</td>
                    <td className="num">{formatUSD(i.targetPrice)}{hit && <div className="hit-badge">▼ at target</div>}</td>
                    <td className="num"><Trend pct={trendPct(snaps, i.card, i.finish, 7)} /></td>
                    <td><Sparkline points={priceSeries(snaps, i.card.id, i.finish).slice(-30).map((p) => p.price)} /></td>
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </LabeledTable>
        </div>
      )}
      {editing && <WatchModal card={editing.card} watchId={editing.id} onClose={() => setEditing(null)} />}
      {bought && (
        <AddToCollectionModal card={bought.card} qty={bought.qty} onClose={() => setBought(null)}
          onAdded={() => { void watchT.remove(bought.id); }} />
      )}
      {viewing && <CardModal card={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
