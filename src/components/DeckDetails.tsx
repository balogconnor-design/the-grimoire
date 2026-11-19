import { useMemo, useState } from 'react';
import type { Deck, DeckFilter, TypeCategory } from '../types';
import { getFormat } from '../lib/formats';
import {
  averageMV, boardCount, boardEntries, boardPrice, cardPrice, COLOR_NAMES, computeColorStats, computeCurve,
  computeManaBase, computeTypes, formatUSD, MANA_BASE_TOLERANCE, type ManaBaseStatus, type Validation,
} from '../lib/rules';
import { refreshPrices } from '../lib/actions';
import { ManaSymbol } from './Mana';
import { useToast } from './Toast';
import { usePool } from '../lib/hooks';
import { planAllocation, releaseAllocation } from '../lib/ownership';
import { collectionT, useSettings } from '../lib/store';
import { navigate } from '../lib/router';

interface Props {
  deck: Deck;
  validation: Validation;
  filter: DeckFilter;
  setFilter: (f: DeckFilter) => void;
}

export function DeckDetails({ deck, validation, filter, setFilter }: Props) {
  const fmt = getFormat(deck.format);
  const main = useMemo(() => boardEntries(deck, 'main'), [deck]);
  const mainCount = boardCount(deck, 'main');
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const pct = Math.min(100, (mainCount / fmt.deckSize) * 100);
  const over = fmt.exact && mainCount > fmt.deckSize;

  const topCards = useMemo(
    () => [...main].map((e) => ({ e, total: (cardPrice(e.card) ?? 0) * e.qty })).sort((a, b) => b.total - a.total).slice(0, 5),
    [main],
  );

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshPrices(deck.id);
      toast('Prices refreshed from Scryfall', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <aside className="panel details-panel">
      <div className="panel-head">
        <h2>Deck Details</h2>
        <span className={`legal-badge ${validation.legal ? 'ok' : 'bad'}`}>
          {validation.legal ? '✓ Legal' : '⚠ Not legal yet'}
        </span>
      </div>

      {/* Counter */}
      <div className="detail-section">
        <div className="counter">
          <span className={`counter-num ${over ? 'over' : mainCount === fmt.deckSize ? 'done' : ''}`}>{mainCount}</span>
          <span className="counter-den">/ {fmt.deckSize}{fmt.exact ? '' : '+'}</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={mainCount} aria-valuemax={fmt.deckSize}>
          <div className={`progress-fill ${over ? 'over' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="muted small">
          {fmt.exact
            ? mainCount < fmt.deckSize
              ? `${fmt.deckSize - mainCount} more card${fmt.deckSize - mainCount === 1 ? '' : 's'} needed`
              : mainCount > fmt.deckSize ? `${mainCount - fmt.deckSize} over the limit` : 'Deck size complete'
            : mainCount < fmt.deckSize ? `${fmt.deckSize - mainCount} more to reach the minimum` : 'Minimum size met'}
          {' · '}Side {boardCount(deck, 'side')} · Maybe {boardCount(deck, 'maybe')}
        </div>
      </div>

      {/* Requirements */}
      <div className="detail-section">
        <h3>{fmt.name} requirements</h3>
        <p className="muted small">{fmt.description}</p>
        <ul className="requirements">
          {validation.requirements.map((r) => (
            <li key={r.label} className={r.ok ? 'req-ok' : 'req-bad'}>
              <span className="req-icon" aria-hidden>{r.ok ? '✓' : '✕'}</span>
              <div>
                <div>{r.label}</div>
                {r.detail && <div className="muted small req-detail">{r.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Price */}
      <div className="detail-section">
        <div className="section-head">
          <h3>Price</h3>
          <button className="link-btn small" onClick={doRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>
        <div className="price-total">{formatUSD(boardPrice(deck, 'main'))}</div>
        <div className="muted small">
          Main deck (TCGplayer market) · Sideboard {formatUSD(boardPrice(deck, 'side'))} · Maybe {formatUSD(boardPrice(deck, 'maybe'))}
        </div>
        {deck.pricesUpdatedAt && (
          <div className="muted tiny">Updated {new Date(deck.pricesUpdatedAt).toLocaleString()}</div>
        )}
        {topCards.some((t) => t.total > 0) && (
          <ol className="top-cards">
            {topCards.filter((t) => t.total > 0).map(({ e, total }) => (
              <li key={e.uid}><span className="truncate">{e.card.name}</span><span className="price">{formatUSD(total)}</span></li>
            ))}
          </ol>
        )}
      </div>

      <CollectionSection deck={deck} />

      <ManaCurve deck={deck} filter={filter} setFilter={setFilter} />
      <ColorSplit deck={deck} filter={filter} setFilter={setFilter} />
      <ManaBaseCheck deck={deck} filter={filter} setFilter={setFilter} />
      <TypeBreakdown deck={deck} filter={filter} setFilter={setFilter} />
    </aside>
  );
}

function CollectionSection({ deck }: { deck: Deck }) {
  const pool = usePool();
  const items = collectionT.useAll();
  const settings = useSettings();
  const toast = useToast();
  const cov = pool.byDeck.get(deck.id);
  if (!cov || cov.totalNeed === 0) return null;
  const committed = [...cov.needs.values()].reduce((n, x) => n + x.manual, 0);
  const pct = (cov.covered / cov.totalNeed) * 100;

  const commit = async () => {
    const rows = planAllocation(deck, items, pool);
    if (!rows.length) { toast('No free copies to commit', 'info'); return; }
    await collectionT.putMany(rows);
    toast(`Committed owned copies to ${deck.name}`, 'success');
  };
  const release = async () => {
    await collectionT.putMany(releaseAllocation(deck.id, items));
    toast('Released this deck’s committed copies back to the shared pool', 'success');
  };

  return (
    <div className="detail-section">
      <div className="section-head">
        <h3>Collection</h3>
        <button className="link-btn small" onClick={() => navigate('/collection/buy')}>Buy list →</button>
      </div>
      <div className="own-headline">
        <span className={`own-dot ${cov.complete ? 'full' : cov.covered ? 'part' : 'none'}`} aria-hidden />
        <b>{cov.covered}/{cov.totalNeed}</b> owned {cov.complete ? '· ready to build ✓' : `· ${cov.missing} missing`}
      </div>
      <div className="progress" role="progressbar" aria-valuenow={cov.covered} aria-valuemax={cov.totalNeed}>
        <div className="progress-fill own-fill" style={{ width: `${pct}%` }} />
      </div>
      {cov.missing > 0 && <div className="small">Est. cost to finish: <b>{formatUSD(cov.missingCost)}</b></div>}
      <div className="muted small">
        {committed} committed to this deck · the rest come from your shared pool
        {settings.ignoreBasics ? ' · basic lands not counted' : ''}
      </div>
      <div className="own-actions">
        <button className="btn btn-sm" onClick={commit} title="Reserve owned copies for this deck so other decks can't use them">Commit owned copies</button>
        {committed > 0 && <button className="btn btn-sm btn-ghost" onClick={release}>Release</button>}
      </div>
    </div>
  );
}

type ChartProps = Omit<Props, 'validation'>;

function ManaCurve({ deck, filter, setFilter }: ChartProps) {
  const main = boardEntries(deck, 'main');
  const curve = computeCurve(main);
  const max = Math.max(...curve, 1);
  const avg = averageMV(main);
  const [hover, setHover] = useState<number | null>(null);
  const nonland = curve.reduce((a, b) => a + b, 0);

  return (
    <div className="detail-section">
      <div className="section-head">
        <h3>Mana curve</h3>
        <span className="muted small">Avg MV {avg.toFixed(2)} · {nonland} nonland</span>
      </div>
      <div className="curve" role="group" aria-label="Mana curve — click a bar to filter the deck list">
        {curve.map((n, mv) => {
          const active = filter.cmc === mv;
          const dim = filter.cmc != null && !active;
          return (
            <button
              key={mv}
              className={`curve-col ${active ? 'active' : ''} ${dim ? 'dim' : ''}`}
              onClick={() => setFilter({ ...filter, cmc: active ? undefined : mv })}
              onMouseEnter={() => setHover(mv)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(mv)}
              onBlur={() => setHover(null)}
              aria-pressed={active}
              aria-label={`Mana value ${mv === 7 ? '7 or more' : mv}: ${n} cards`}
            >
              <div className="curve-track">
                {hover === mv && (
                  <div className="chart-tip">
                    <b>{n}</b> card{n === 1 ? '' : 's'} at MV {mv === 7 ? '7+' : mv}
                    {nonland > 0 && <span className="muted"> · {((n / nonland) * 100).toFixed(0)}%</span>}
                  </div>
                )}
                <div className="curve-bar" style={{ height: `${(n / max) * 100}%` }} />
              </div>
              <span className="curve-count">{n || ''}</span>
              <span className="curve-label">{mv === 7 ? '7+' : mv}</span>
            </button>
          );
        })}
      </div>
      <div className="muted tiny">Click a bar to show those cards in the deck list. Lands excluded.</div>
    </div>
  );
}

const MTG_COLOR_VAR: Record<string, string> = {
  W: 'var(--mtg-w)', U: 'var(--mtg-u)', B: 'var(--mtg-b)', R: 'var(--mtg-r)', G: 'var(--mtg-g)', C: 'var(--mtg-c)',
};

function ColorSplit({ deck, filter, setFilter }: ChartProps) {
  const stats = computeColorStats(boardEntries(deck, 'main'));
  const totalPips = stats.reduce((n, s) => n + s.pips, 0);
  const shown = stats.filter((s) => s.pips > 0 || s.sources > 0 || s.cards > 0);

  return (
    <div className="detail-section">
      <div className="section-head">
        <h3>Color split</h3>
        <span className="muted small">{totalPips} mana symbols</span>
      </div>
      {totalPips > 0 && (
        <div className="color-stack" aria-hidden>
          {stats.filter((s) => s.pips > 0).map((s) => (
            <div key={s.color} className="color-stack-seg" style={{ flexGrow: s.pips, background: MTG_COLOR_VAR[s.color] }} title={`${COLOR_NAMES[s.color]} ${s.pipPct.toFixed(1)}%`} />
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="muted small">Add cards to see the color split.</div>
      ) : (
        <table className="color-table">
          <thead>
            <tr><th>Color</th><th>Pips</th><th>%</th><th title="Nonland cards of this color">Cards</th><th title="Lands that can produce this color">Land sources</th></tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const active = filter.color === s.color;
              return (
                <tr
                  key={s.color}
                  className={`clickable ${active ? 'active' : ''}`}
                  onClick={() => setFilter({ ...filter, color: active ? undefined : s.color })}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setFilter({ ...filter, color: active ? undefined : s.color })}
                >
                  <td><span className="color-cell"><ManaSymbol symbol={s.color} size={16} /> {COLOR_NAMES[s.color]}</span></td>
                  <td>{s.pips}</td>
                  <td>
                    <div className="pct-cell">
                      <div className="pct-bar"><div style={{ width: `${s.pipPct}%`, background: MTG_COLOR_VAR[s.color] }} /></div>
                      <span>{s.pipPct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td>{s.cards}</td>
                  <td>{s.sources}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="muted tiny">Hybrid symbols count toward each of their colors. Click a row to filter.</div>
    </div>
  );
}

const STATUS_LABEL: Record<ManaBaseStatus, string> = {
  ok: 'Balanced', low: 'Low', critical: 'Too low', high: 'Extra',
};

function ManaBaseCheck({ deck, filter, setFilter }: ChartProps) {
  const mb = computeManaBase(boardEntries(deck, 'main'));
  const { rows, lands, offColorLands, worst, moves } = mb;
  const fmtDelta = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}`;
  const plural = (n: number) => `${n} land${n === 1 ? '' : 's'}`;
  const fromName = (c: string) => (c === 'other' ? 'utility/colorless' : COLOR_NAMES[c]);

  let verdict: { tone: 'ok' | 'warn' | 'bad'; text: string };
  if (worst) {
    const name = COLOR_NAMES[worst.color];
    verdict = worst.sources === 0
      ? { tone: 'bad', text: `No lands produce ${name}.` }
      : { tone: worst.status === 'critical' ? 'bad' : 'warn', text: `Short on ${name}: ${worst.sourcePct.toFixed(0)}% of sources vs ${worst.pipPct.toFixed(0)}% of symbols.` };
  } else if (rows.length > 1) {
    verdict = { tone: 'ok', text: `Mana base matches your spells (all colors within ±${MANA_BASE_TOLERANCE} pts).` };
  } else {
    verdict = { tone: 'ok', text: rows.length ? 'Single color — every source counts.' : '' };
  }

  return (
    <div className="detail-section">
      <div className="section-head">
        <h3>Mana base check</h3>
        <span className="muted small">{lands} land{lands === 1 ? '' : 's'}</span>
      </div>
      {rows.length === 0 || lands === 0 ? (
        <div className="muted small">Add nonland spells and lands to compare sources against symbols.</div>
      ) : (
        <>
          {verdict.text && (
            <div className={`mb-verdict ${verdict.tone}`}>
              {verdict.text}
              {worst && (moves.length > 0 ? (
                <ul className="mb-moves">
                  {moves.map((m) => (
                    <li key={`${m.from}-${m.to}`}>
                      Shift <b>{plural(m.count)}</b>{' '}
                      {m.from !== 'other' && <ManaSymbol symbol={m.from} size={14} />} {fromName(m.from)}
                      {' → '}
                      <ManaSymbol symbol={m.to} size={14} /> {COLOR_NAMES[m.to]}
                    </li>
                  ))}
                </ul>
              ) : (
                <div>No surplus color to pull from — add {plural(Math.max(1, worst.shift))} making {COLOR_NAMES[worst.color]}.</div>
              ))}
            </div>
          )}

          <div className="mb-compare" aria-hidden>
            <span className="mb-compare-label muted tiny">Symbols</span>
            <div className="color-stack">
              {rows.map((r) => <div key={r.color} className="color-stack-seg" style={{ flexGrow: r.pipPct, background: MTG_COLOR_VAR[r.color] }} title={`${COLOR_NAMES[r.color]} ${r.pipPct.toFixed(1)}% of symbols`} />)}
            </div>
            <span className="mb-compare-label muted tiny">Lands</span>
            <div className="color-stack">
              {rows.map((r) => <div key={r.color} className="color-stack-seg" style={{ flexGrow: r.sourcePct, background: MTG_COLOR_VAR[r.color] }} title={`${COLOR_NAMES[r.color]} ${r.sourcePct.toFixed(1)}% of sources`} />)}
            </div>
          </div>

          <table className="color-table mb-table">
            <thead>
              <tr>
                <th>Color</th>
                <th title="Share of colored mana symbols in nonland costs">Symbols</th>
                <th title="Share of land color-production (a dual counts for both colors)">Sources</th>
                <th title="Sources % minus Symbols %, in percentage points">Diff</th>
                <th title="Lands that can make this color / total lands">Lands</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const active = filter.color === r.color;
                const toggle = () => setFilter({ ...filter, color: active ? undefined : r.color });
                return (
                  <tr key={r.color} className={`clickable ${active ? 'active' : ''}`} onClick={toggle} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && toggle()}>
                    <td><span className="color-cell"><ManaSymbol symbol={r.color} size={16} /> {COLOR_NAMES[r.color]}</span></td>
                    <td>{r.pipPct.toFixed(0)}%</td>
                    <td>{r.sourcePct.toFixed(0)}%</td>
                    <td>
                      <span
                        className={`mb-chip ${r.status}`}
                        title={`${STATUS_LABEL[r.status]}${r.shift ? ` · ${r.shift > 0 ? 'add' : 'could drop'} ${plural(Math.abs(r.shift))} to match exactly` : ''}`}
                      >{fmtDelta(r.delta)}</span>
                    </td>
                    <td><span title={`${r.coverage.toFixed(0)}% of lands`}>{r.sources}/{lands}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="muted tiny">
            Green = within ±{MANA_BASE_TOLERANCE} pts, amber = {MANA_BASE_TOLERANCE}–{MANA_BASE_TOLERANCE * 2} pts short, red = more than {MANA_BASE_TOLERANCE * 2} short, grey = surplus.
            {' '}Counts lands only (not rocks/dorks); fetch lands without listed mana aren't counted.
            {offColorLands > 0 && <> {offColorLands} land{offColorLands === 1 ? '' : 's'} make none of your spell colors.</>}
          </div>
        </>
      )}
    </div>
  );
}

function TypeBreakdown({ deck, filter, setFilter }: ChartProps) {
  const types = computeTypes(deck, boardEntries(deck, 'main'));
  const total = types.reduce((n, t) => n + t.count, 0);
  const max = Math.max(...types.map((t) => t.count), 1);

  return (
    <div className="detail-section">
      <h3>Card types</h3>
      {types.length === 0 ? (
        <div className="muted small">No cards yet.</div>
      ) : (
        <div className="type-bars">
          {types.map(({ type, count }) => {
            const active = filter.type === type;
            return (
              <button
                key={type}
                className={`type-row ${active ? 'active' : ''} ${filter.type && !active ? 'dim' : ''}`}
                onClick={() => setFilter({ ...filter, type: active ? undefined : (type as TypeCategory) })}
                aria-pressed={active}
              >
                <span className="type-name">{type}</span>
                <span className="type-track"><span className="type-bar" style={{ width: `${(count / max) * 100}%` }} /></span>
                <span className="type-count">{count}</span>
                <span className="type-pct muted">{((count / total) * 100).toFixed(0)}%</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="muted tiny">Each card is counted once under its primary type. Click a type to filter.</div>
    </div>
  );
}
