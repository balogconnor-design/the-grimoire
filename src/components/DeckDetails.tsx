import { Fragment, useMemo, useState } from 'react';
import type { Deck, DeckEntry, DeckFilter, TypeCategory } from '../types';
import { getFormat } from '../lib/formats';
import {
  averageMV, boardCount, boardEntries, boardPrice, cardPrice, COLOR_NAMES, computeColorStats, computeCurve,
  commanderEntry, computeManaBase, computeManaProducers, computeTypes, formatUSD, MANA_BASE_TOLERANCE, type ManaBaseStatus, type ProducerKind,
  type Validation,
} from '../lib/rules';
import { refreshPrices, setTargetBracket } from '../lib/actions';
import { BRACKET_GC_LIMIT, BRACKETS, bracketName, estimateBracket, type BracketNumber } from '../lib/bracket';
import { ManaSymbol } from './Mana';
import { EdhrecPanel } from './EdhrecPanel';
import { CardLink } from './CardLink';
import { CardModal } from './CardModal';
import { useToast } from './Toast';
import { useGlobalTags, usePool } from '../lib/hooks';
import { planAllocation, releaseAllocation } from '../lib/ownership';
import { collectionT, useSettings } from '../lib/store';
import { navigate } from '../lib/router';
import { useScryfallTags, useScryfallTagStatus } from '../lib/scryfallTags';
import { atLeast, oddsGroups, SEEN_MAX, SEEN_MIN, turnHint, type OddsGroup } from '../lib/drawOdds';

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
  // Card window for cards named in the panels below (mana producers, bracket flags).
  const [viewing, setViewing] = useState<DeckEntry | null>(null);

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

      {fmt.hasCommander && <BracketSection deck={deck} filter={filter} setFilter={setFilter} onView={setViewing} />}
      {fmt.hasCommander && <EdhrecPanel deck={deck} />}

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
      <ManaProducers deck={deck} filter={filter} setFilter={setFilter} onView={setViewing} />
      <TypeBreakdown deck={deck} filter={filter} setFilter={setFilter} />
      <DrawOdds deck={deck} filter={filter} setFilter={setFilter} />
      {viewing && <CardModal card={viewing.card} deckId={deck.id} entryUid={viewing.uid} onClose={() => setViewing(null)} />}
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
/** Panels that name cards open them in the card window through this. */
type ViewProps = { onView: (e: DeckEntry) => void };

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

/** "+3 MDFC" beside a source count; hover lists the spell // land cards behind it. */
function MdfcExtra({ count, names, short }: { count: number; names: string[]; short?: boolean }) {
  if (!count) return null;
  const title = `${count} spell // land card${count === 1 ? '' : 's'} — a source only when played as the land side:\n${names.join('\n')}`;
  return <span className="mdfc-extra" title={title}>+{count}{short ? '' : ' MDFC'}</span>;
}

function ColorSplit({ deck, filter, setFilter }: ChartProps) {
  const stats = computeColorStats(boardEntries(deck, 'main'));
  const totalPips = stats.reduce((n, s) => n + s.pips, 0);
  const shown = stats.filter((s) => s.pips > 0 || s.sources > 0 || s.mdfcSources > 0 || s.cards > 0);

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
            <tr><th>Color</th><th>Pips</th><th>%</th><th title="Nonland cards of this color">Cards</th><th title="Lands that can produce this color (+ spell // land MDFCs)">Land sources</th></tr>
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
                  <td>{s.sources}<MdfcExtra count={s.mdfcSources} names={s.mdfcNames} /></td>
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
  const { rows, lands, offColorLands, mdfcLands, worst, moves } = mb;
  const fmtDelta = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}`;
  const plural = (n: number) => `${n} land${n === 1 ? '' : 's'}`;
  const fromName = (c: string) => (c === 'other' ? 'utility/colorless' : COLOR_NAMES[c]);

  let verdict: { tone: 'ok' | 'warn' | 'bad'; text: string };
  if (worst) {
    const name = COLOR_NAMES[worst.color];
    verdict = worst.sources === 0
      ? { tone: 'bad', text: worst.mdfcSources ? `No lands produce ${name} — only ${worst.mdfcSources} MDFC${worst.mdfcSources === 1 ? '' : 's'}.` : `No lands produce ${name}.` }
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
        <span className="muted small">{lands} land{lands === 1 ? '' : 's'}{mdfcLands > 0 && ` · ${mdfcLands} MDFC`}</span>
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
                <th title="Share of land color-production (a dual counts for both colors; MDFC land faces count too)">Sources</th>
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
                    <td><span title={`${r.coverage.toFixed(0)}% of lands`}>{r.sources}/{lands}</span><MdfcExtra count={r.mdfcSources} names={r.mdfcNames} short /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="muted tiny">
            Green = within ±{MANA_BASE_TOLERANCE} pts, amber = {MANA_BASE_TOLERANCE}–{MANA_BASE_TOLERANCE * 2} pts short, red = more than {MANA_BASE_TOLERANCE * 2} short, grey = surplus.
            {' '}Counts lands only (not rocks/dorks); fetch lands without listed mana aren't counted.
            {mdfcLands > 0 && <> Spell // land MDFCs count as full sources and are shown as “+N”.</>}
            {offColorLands > 0 && <> {offColorLands} land{offColorLands === 1 ? '' : 's'} make none of your spell colors.</>}
          </div>
        </>
      )}
    </div>
  );
}

/** Text with inline mana symbols, e.g. "{U} or {R}" or "1 of any color". */
function ManaText({ text, size = 13 }: { text: string; size?: number }) {
  return (
    <span className="mana-text">
      {text.split(/(\{[^}]+\})/).filter(Boolean).map((part, i) =>
        /^\{[^}]+\}$/.test(part) ? <ManaSymbol key={i} symbol={part.slice(1, -1)} size={size} /> : <span key={i}>{part}</span>)}
    </span>
  );
}

const PRODUCER_KIND_LABEL: Record<'all' | ProducerKind, string> = { all: 'All', rock: 'Rocks', dork: 'Dorks', other: 'Other' };

function ManaProducers({ deck, filter, setFilter, onView }: ChartProps & ViewProps) {
  const main = boardEntries(deck, 'main');
  const sum = computeManaProducers(main);
  const mb = computeManaBase(main);
  const needed = computeColorStats(main).filter((s) => s.pips > 0 && s.color !== 'C').map((s) => s.color);
  const fixingColors = (needed.length ? needed : ['W', 'U', 'B', 'R', 'G']).filter((c) => sum.fixing[c] > 0);
  const signed = (n: number | null) => (n == null ? 'X' : `${n >= 0 ? '+' : '−'}${Math.abs(n)}`);
  const kinds = (['all', 'rock', 'dork', 'other'] as const).filter((k) => k === 'all' || sum.byKind[k] > 0);

  return (
    <div className="detail-section">
      <div className="section-head">
        <h3>Mana producers</h3>
        <span className="muted small">
          {sum.count} card{sum.count === 1 ? '' : 's'}{sum.count > 0 && ` · ${signed(sum.netTotal)} net${sum.variable ? ' + X' : ''}`}
        </span>
      </div>
      {sum.count === 0 ? (
        <div className="muted small">No mana rocks or dorks in the main deck.</div>
      ) : (
        <>
          <div className="producer-kinds">
            {kinds.map((k) => {
              const active = filter.producer === k;
              return (
                <button key={k} className={`chip ${active ? 'chip-on' : ''}`} aria-pressed={active}
                  onClick={() => setFilter({ ...filter, producer: active ? undefined : k })}>
                  {PRODUCER_KIND_LABEL[k]} {k === 'all' ? sum.count : sum.byKind[k]}
                </button>
              );
            })}
          </div>
          <div className="muted small">
            {mb.lands} land{mb.lands === 1 ? '' : 's'}{mb.mdfcLands > 0 && ` + ${mb.mdfcLands} MDFC`} + {sum.count} producer{sum.count === 1 ? '' : 's'}
            {' · '}avg MV {sum.avgMV.toFixed(1)}
          </div>
          <table className="color-table producer-table">
            <thead>
              <tr>
                <th>Card</th>
                <th title="Mana value">MV</th>
                <th title="Mana the ability adds">Gross</th>
                <th title="Mana added minus the mana spent to activate it">Net</th>
                <th title="Colors it can make">Makes</th>
              </tr>
            </thead>
            <tbody>
              {sum.producers.map((p) => (
                <tr key={p.entry.uid}>
                  <td>
                    <div className="producer-name">{p.entry.qty > 1 && <span className="muted">{p.entry.qty}× </span>}<CardLink card={p.entry.card} name={p.entry.card.name} onOpen={() => onView(p.entry)} /></div>
                    {p.filter && (
                      <div className="muted tiny-label producer-note">
                        Filters <ManaText text={p.filter.from} size={12} /> → <ManaText text={p.filter.into} size={12} />
                      </div>
                    )}
                    {p.restricted && <div className="muted tiny-label producer-note">Restricted (“spend this mana only…”)</div>}
                  </td>
                  <td>{p.mv}</td>
                  <td>{signed(p.gross)}</td>
                  <td className={p.net != null && p.net <= 0 ? 'muted' : ''}>{signed(p.net)}</td>
                  <td>
                    {p.anyColor ? <span className="small">Any</span> : (
                      <span className="mana-text">{p.colors.map((col) => <ManaSymbol key={col} symbol={col} size={14} />)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small producer-fixing">
            <span className="muted">Fixing:</span>
            {fixingColors.map((c) => <span key={c} className="color-cell"><ManaSymbol symbol={c} size={14} /> {sum.fixing[c]}</span>)}
            {sum.colorlessOnly > 0 && <span className="color-cell"><ManaSymbol symbol="C" size={14} /> only {sum.colorlessOnly}</span>}
          </div>
        </>
      )}
      <div className="muted tiny">
        Nonland permanents with a repeatable mana ability. Gross = mana the ability adds, net = gross minus its activation cost; X = variable.
        {' '}Not counted in the mana base check. Rituals, Treasure makers and land-search ramp aren’t included.
      </div>
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

const ODDS_TAGS_SHOWN = 8;
const ODDS_KEY = 'grimoire.drawOdds';
interface OddsPrefs { min: number; seen: number; onDraw: boolean }
function readOddsPrefs(): OddsPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(ODDS_KEY) ?? '{}');
    return {
      min: v.min >= 1 && v.min <= 4 ? v.min : 1,
      seen: Number.isInteger(v.seen) && v.seen >= SEEN_MIN && v.seen <= SEEN_MAX ? v.seen : SEEN_MIN,
      onDraw: !!v.onDraw,
    };
  } catch { return { min: 1, seen: SEEN_MIN, onDraw: false }; }
}
const tagQuery = (t: string) => `#${/\s/.test(t) ? `"${t}"` : t}`;
const fmtChance = (p: number) => (p >= 0.995 && p < 1 ? '>99' : p > 0 && p < 0.005 ? '<1' : (p * 100).toFixed(0));

/** Hypergeometric odds of seeing at least N cards of each type / tag by a given turn. */
function DrawOdds({ deck, filter, setFilter }: ChartProps) {
  const globalTags = useGlobalTags();
  const stags = useScryfallTags();
  const [prefs, setPrefsState] = useState<OddsPrefs>(readOddsPrefs);
  const [allTags, setAllTags] = useState(false);
  const setPrefs = (p: Partial<OddsPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefsState(next);
    try { localStorage.setItem(ODDS_KEY, JSON.stringify(next)); } catch { /* storage unavailable: only this session remembers */ }
  };
  const g = useMemo(() => oddsGroups(deck, { global: globalTags, scryfall: stags }), [deck, globalTags, stags]);
  const seen = prefs.seen;
  const tags = allTags ? g.tags : g.tags.slice(0, ODDS_TAGS_SHOWN);

  const row = (r: OddsGroup) => {
    const p = atLeast(g.library, r.count, seen, prefs.min);
    const active = r.kind === 'type' ? filter.type === r.key : filter.text === tagQuery(r.key);
    const toggle = () => setFilter(r.kind === 'type'
      ? { ...filter, type: active ? undefined : (r.key as TypeCategory) }
      : { ...filter, text: active ? undefined : tagQuery(r.key) });
    return (
      <tr key={`${r.kind}:${r.key}`} className={`clickable ${active ? 'active' : ''}`} onClick={toggle} tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && toggle()}
        title={`${r.count} of ${g.library} cards · at least ${prefs.min} in ${seen} cards: ${(p * 100).toFixed(1)}%`}>
        <td><span className="truncate">{r.kind === 'tag' ? `#${r.key}` : r.key}</span></td>
        <td>{r.count}</td>
        <td>
          <div className="pct-cell">
            <div className="pct-bar"><div style={{ width: `${p * 100}%`, background: 'var(--accent)' }} /></div>
            <span>{fmtChance(p)}%</span>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="detail-section">
      <div className="section-head">
        <h3>Draw odds</h3>
        <span className="muted small">{g.library} in library · {seen} cards seen</span>
      </div>
      {g.library === 0 ? (
        <div className="muted small">Add cards to see the odds of drawing them.</div>
      ) : (
        <>
          <div className="odds-controls small">
            <label>At least{' '}
              <select className="input input-sm" value={prefs.min} onChange={(e) => setPrefs({ min: Number(e.target.value) })} aria-label="At least this many">
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>by card{' '}
              <select className="input input-sm" value={seen} onChange={(e) => setPrefs({ seen: Number(e.target.value) })} aria-label="By card">
                {Array.from({ length: SEEN_MAX - SEEN_MIN + 1 }, (_, i) => SEEN_MIN + i).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="odds-draw">
              <input type="checkbox" checked={prefs.onDraw} onChange={(e) => setPrefs({ onDraw: e.target.checked })} /> On the draw
            </label>
            <span className="muted">= {turnHint(seen, prefs.onDraw)}</span>
          </div>
          <table className="color-table odds-table">
            <thead><tr><th>Type</th><th title="Copies in the library">Cards</th><th title={`Chance of at least ${prefs.min} in ${seen} cards`}>Chance</th></tr></thead>
            <tbody>{g.types.map(row)}</tbody>
          </table>
          {g.tags.length > 0 && (
            <table className="color-table odds-table">
              <thead><tr><th>Tag</th><th>Cards</th><th>Chance</th></tr></thead>
              <tbody>{tags.map(row)}</tbody>
            </table>
          )}
          {g.tags.length > ODDS_TAGS_SHOWN && (
            <button className="link-btn small" onClick={() => setAllTags(!allTags)}>
              {allTags ? 'Show fewer tags' : `Show all ${g.tags.length} tags`}
            </button>
          )}
        </>
      )}
      <div className="muted tiny">
        Chance of at least {prefs.min} card{prefs.min === 1 ? '' : 's'} of each kind among the first {seen} cards you see
        {' '}(a 7-card hand, then one draw a turn; no draw on turn 1 on the play).
        {' '}{commanderEntry(deck) ? 'The commander isn’t in the library. ' : ''}Ignores mulligans, tutors and extra draws. A card counts under each of its tags. Click a row to filter the deck list.
      </div>
    </div>
  );
}

const bracketRange = (floor: BracketNumber) => (floor === 1 ? '1–2' : `${floor}+`);
const bracketRangeName = (floor: BracketNumber) =>
  floor === 1 ? 'Exhibition or Core' : floor === 4 ? 'Optimized or cEDH' : `${bracketName(floor)} or higher`;

/** Lowest Commander bracket the cards allow, the cards behind it, and an optional target bracket. */
function BracketSection({ deck, filter, setFilter, onView }: ChartProps & ViewProps) {
  const stags = useScryfallTags();
  const stagStatus = useScryfallTagStatus();
  const est = useMemo(() => estimateBracket(deck, stags), [deck, stags]);
  const mainByName = useMemo(() => new Map(deck.entries.filter((e) => e.board === 'main').map((e) => [e.card.name, e])), [deck.entries]);
  const target = deck.targetBracket;
  const over = target != null && est.floor > target;
  const overReasons = target != null ? est.reasons.filter((r) => r.bracket > target) : [];

  const groups: { label: string; query: string; cards: string[]; note?: string; info?: boolean }[] = [
    { label: 'Game Changers', query: 'is:gamechanger', cards: est.gameChangers, note: `${est.gameChangers.length}/${BRACKET_GC_LIMIT} for Bracket 3` },
    { label: 'Mass land denial', query: 'stag:mass-land-denial', cards: est.massLandDenial, note: 'Bracket 4+' },
    { label: 'Extra turns', query: 'stag:extra-turn', cards: est.extraTurns, note: 'none in Bracket 1' },
    { label: 'Land destruction', query: 'stag:land-removal', cards: est.landDestruction, note: 'no bracket rule', info: true },
  ];

  return (
    <div className="detail-section">
      <div className="section-head">
        <h3>Bracket estimate</h3>
        <span className="muted small">Commander Brackets (beta)</span>
      </div>
      <div className="bracket-headline">
        <span className={`bracket-badge ${over ? 'bad' : ''}`}>Bracket {bracketRange(est.floor)}</span>
        <span className="muted small">{bracketRangeName(est.floor)}</span>
      </div>

      <div className="bracket-target small" role="group" aria-label="Target bracket">
        <span className="muted">Target:</span>
        <button className={`chip ${target == null ? 'chip-on' : ''}`} aria-pressed={target == null} onClick={() => setTargetBracket(deck.id, undefined)}>None</button>
        {BRACKETS.map((b) => (
          <button key={b.n} className={`chip ${target === b.n ? 'chip-on' : ''}`} aria-pressed={target === b.n} title={`Bracket ${b.n}: ${b.name}`}
            onClick={() => setTargetBracket(deck.id, target === b.n ? undefined : b.n)}>{b.n}</button>
        ))}
      </div>

      {over ? (
        <div className="mb-verdict bad">
          Over your target, Bracket {target} ({bracketName(target)}):
          <ul className="mb-moves">{overReasons.map((r) => <li key={r.text}>{r.text}</li>)}</ul>
        </div>
      ) : target != null ? (
        <div className="mb-verdict ok">Cards fit Bracket {target} ({bracketName(target)}).</div>
      ) : est.reasons.length > 0 && (
        <ul className="bracket-reasons small">{est.reasons.map((r) => <li key={r.text}>{r.text}</li>)}</ul>
      )}

      {groups.filter((g) => g.cards.length > 0).map((g) => {
        const active = filter.text === g.query;
        return (
          <div key={g.label} className={`bracket-group ${g.info ? 'info' : ''}`}>
            <button className={`link-btn small bracket-group-head ${active ? 'active' : ''}`} aria-pressed={active}
              title="Show these cards in the deck list" onClick={() => setFilter({ ...filter, text: active ? undefined : g.query })}>
              <b>{g.label}</b> {g.cards.length}
            </button>
            {g.note && <span className="muted tiny"> · {g.note}</span>}
            <div className="small bracket-cards">
              {g.cards.map((n, i) => {
                const entry = mainByName.get(n);
                return (
                  <Fragment key={n}>
                    {i > 0 && ' · '}
                    {entry ? <CardLink card={entry.card} name={n} onOpen={() => onView(entry)} /> : n}
                  </Fragment>
                );
              })}
            </div>
          </div>
        );
      })}
      {stags.size === 0 && (
        <div className="muted small">
          {stagStatus.state === 'updating' ? `Downloading Scryfall tags… ${stagStatus.done}/${stagStatus.total}. ` : 'Scryfall tags aren’t downloaded yet, so '}
          {stagStatus.state === 'updating' ? 'Extra turns and land denial are checked once that finishes.' : 'extra turns and land denial aren’t checked.'}
        </div>
      )}
      <div className="muted tiny">
        Brackets describe how a deck plays, so the cards only set the lowest bracket it fits. Bracket 1 vs 2 and 4 vs 5 depend on intent.
        {' '}Rules as of Wizards’ February 9, 2026 update. Game Changer flags come from Scryfall (↻ Refresh prices updates them); extra turns and land denial use Scryfall tags.
        {' '}Two-card combos aren’t checked yet.
      </div>
    </div>
  );
}
