import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Deck, DeckEntry } from '../types';
import { useDecks, saveDeck, deleteDeck, pricesT, wasReported } from '../lib/store';
import { deckTrend } from '../lib/collection';
import { DeltaBadge } from '../components/Money';
import type { PriceSnapshot } from '../types';
import { FORMATS, getFormat } from '../lib/formats';
import { boardCount, boardPrice, cardImage, COLOR_NAMES, commanderEntry, formatUSD, isLand, validateDeck } from '../lib/rules';
import { defaultImportName, ImportError, importNewDeck, importSummary, newDeck, parseDecklist, toggleDeckFavorite, type ImportResult } from '../lib/actions';
import { requestCardSearch, setPendingImport } from '../lib/searchBus';
import { useToast } from '../components/Toast';
import { ImportResultView } from '../components/ImportResult';
import { ColorPips } from '../components/Mana';
import { colorBarBackground, colorShares, frontPips } from '../lib/deckColors';
import { Modal } from '../components/Modal';
import { BackupModal } from '../components/BackupModal';
import { GlobalSearch } from '../components/GlobalSearch';
import { FavStar, Tag, TagList } from '../components/TagEditor';
import { navigate } from '../lib/router';
import { useAllDeckTags, usePool } from '../lib/hooks';
import type { DeckCoverage } from '../lib/ownership';

type StatusFilter = 'all' | 'in-progress' | 'finished';
const BOARD_LABEL = { main: 'Main', side: 'Sideboard', maybe: 'Maybe' } as const;

export function Library() {
  const { decks, loaded } = useDecks();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [format, setFormat] = useState('all');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const allTags = useAllDeckTags();
  const pool = usePool();
  const snaps = pricesT.useAll();

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    return decks
      .filter((d) => status === 'all' || d.status === status)
      .filter((d) => format === 'all' || d.format === format)
      .filter((d) => !favOnly || d.favorite)
      .filter((d) => tagFilter.every((t) => d.tags?.includes(t)))
      .map((d) => {
        const matches: DeckEntry[] = q.length >= 2
          ? d.entries.filter((e) => e.card.name.toLowerCase().includes(q) || e.card.card_faces?.some((f) => f.name.toLowerCase().includes(q)))
          : [];
        const nameMatch = q.length >= 2 && (d.name.toLowerCase().includes(q) || !!d.tags?.some((t) => t.includes(q)));
        return { deck: d, matches, nameMatch };
      })
      .filter((r) => q.length < 2 || r.matches.length > 0 || r.nameMatch)
      .sort((a, b) => Number(!!b.deck.favorite) - Number(!!a.deck.favorite));
  }, [decks, status, format, q, favOnly, tagFilter]);
  const toggleTag = (t: string) => setTagFilter((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));

  const usedFormats = [...new Set(decks.map((d) => d.format))];

  return (
    <div className="library">
      <div className="library-head">
        <div>
          <h1>Card Search</h1>
          <p className="muted">Every card on Scryfall, with what you own, which decks use it, and your tags.</p>
        </div>
      </div>
      <GlobalSearch />

      <div className="library-head library-head-decks">
        <div>
          <h2 className="section-title">Your Decks</h2>
          <p className="muted">
            {decks.length} deck{decks.length === 1 ? '' : 's'} saved on this device
            {decks.length > 0 && ` · ${pool.fullyCovered} buildable from your collection${pool.allBuildable ? ' (all at once ✓)' : ''}`}
          </p>
        </div>
        <div className="library-head-actions">
          <button className="btn btn-lg" onClick={() => setImporting(true)}>⇪ Import deck</button>
          <button className="btn btn-primary btn-lg" onClick={() => setCreating(true)}>+ New deck</button>
        </div>
      </div>

      <div className="library-toolbar">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden>⌕</span>
          <input
            className="input library-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter decks by name, tag, or a card they contain…" aria-label="Filter decks"
          />
        </div>
        <button className={`chip ${favOnly ? 'chip-gold' : ''}`} onClick={() => setFavOnly((f) => !f)} aria-pressed={favOnly}>★ Favorites</button>
        <div className="status-toggle">
          {(['all', 'in-progress', 'finished'] as StatusFilter[]).map((s) => (
            <button key={s} className={`seg ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>
              {s === 'all' ? 'All' : s === 'in-progress' ? 'In progress' : 'Finished'}
            </button>
          ))}
        </div>
        {usedFormats.length > 1 && (
          <select className="input input-sm" value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Filter by format">
            <option value="all">All formats</option>
            {usedFormats.map((f) => <option key={f} value={f}>{getFormat(f).name}</option>)}
          </select>
        )}
      </div>
      {allTags.length > 0 && (
        <div className="tag-filter-row">
          <span className="muted small">Deck tags:</span>
          {allTags.map((t) => (
            <span key={t} className={tagFilter.includes(t) ? 'tag-selected' : ''}>
              <Tag scope="deck" small onClick={() => toggleTag(t)}>{t}</Tag>
            </span>
          ))}
          {tagFilter.length > 0 && <button className="link-btn small" onClick={() => setTagFilter([])}>Clear</button>}
        </div>
      )}

      {q.length >= 2 && (
        <p className="muted small">
          {rows.reduce((n, r) => n + r.matches.length, 0)} matching card{rows.length === 1 ? '' : 's'} in {rows.length} deck{rows.length === 1 ? '' : 's'}
        </p>
      )}

      {!loaded ? (
        <div className="loading">Loading decks…</div>
      ) : decks.length === 0 ? (
        <div className="empty-hero">
          <h2>Build your first deck</h2>
          <p className="muted">Search the entire Scryfall card database, pick a commander, and track your curve, colors and price as you go.</p>
          <div className="library-head-actions">
            <button className="btn btn-primary btn-lg" onClick={() => setCreating(true)}>+ New deck</button>
            <button className="btn btn-lg" onClick={() => setImporting(true)}>⇪ Import deck</button>
          </div>
          <p className="muted small empty-restore">
            Moving from another device or browser? <button className="link-btn" onClick={() => setRestoring(true)}>Restore a backup</button>
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">No decks match.</div>
      ) : (
        <div className="deck-grid">
          {rows.map(({ deck, matches }) => <DeckTile key={deck.id} deck={deck} matches={matches} coverage={pool.byDeck.get(deck.id)} snaps={snaps} onTagClick={toggleTag} />)}
        </div>
      )}

      {creating && <NewDeckModal onClose={() => setCreating(false)} />}
      {importing && <ImportDeckModal onClose={() => setImporting(false)} />}
      {restoring && <BackupModal initialTab="restore" onClose={() => setRestoring(false)} />}
    </div>
  );
}

function DeckTile({ deck, matches, coverage, snaps, onTagClick }: { deck: Deck; matches: DeckEntry[]; coverage?: DeckCoverage; snaps: PriceSnapshot[]; onTagClick: (t: string) => void }) {
  const trend = useMemo(() => deckTrend(snaps, deck, 7), [snaps, deck]);
  const fmt = getFormat(deck.format);
  const cmd = commanderEntry(deck);
  const count = boardCount(deck, 'main');
  const legal = useMemo(() => validateDeck(deck).legal, [deck]);
  const cover = cmd?.card ?? [...deck.entries].sort((a, b) => (b.card.prices?.usd ? parseFloat(b.card.prices.usd) : 0) - (a.card.prices?.usd ? parseFloat(a.card.prices.usd) : 0))[0]?.card;
  // Colours the deck casts: front-face casting costs only (not colour identity). See lib/deckColors.ts.
  const shares = useMemo(() => colorShares(frontPips(deck)), [deck]);
  const hasSpells = deck.entries.some((e) => e.board === 'main' && !isLand(e.card));
  const shareTitle = shares.length
    ? shares.map((s) => `${COLOR_NAMES[s.color]} ${Math.round(s.share * 100)}%`).join(' · ')
    : 'Colorless';
  const pct = Math.min(100, (count / fmt.deckSize) * 100);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="deck-tile" role="link" tabIndex={0} onClick={() => navigate(`/deck/${deck.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/deck/${deck.id}`)}>
      <div className="tile-art" style={cover ? { backgroundImage: `url(${cardImage(cover, 'art_crop')})` } : undefined}>
        <span className={`status-badge ${deck.status}`}>{deck.status === 'finished' ? 'Finished' : 'In progress'}</span>
        {!legal && <span className="warn-badge" title="Deck doesn't meet format requirements yet">⚠</span>}
        <span className="tile-fav"><FavStar on={!!deck.favorite} onToggle={() => toggleDeckFavorite(deck.id)} label="favorite deck" /></span>
      </div>
      {hasSpells && <div className="tile-colors" style={{ background: colorBarBackground(shares) }} title={shareTitle} aria-label={`Deck colours: ${shareTitle}`} role="img" />}
      <div className="tile-body">
        <div className="tile-title">
          <span className="truncate">{deck.name}</span>
          {hasSpells && <ColorPips colors={shares.map((s) => s.color)} size={15} />}
        </div>
        <div className="tile-sub muted small">
          {fmt.name}{cmd ? ` · ${cmd.card.name}` : ''}
        </div>
        <div className="tile-stats">
          <span className="tile-count">{count}/{fmt.deckSize}</span>
          <span className="tile-price">
            <span className="price">{formatUSD(boardPrice(deck, 'main'))}</span>
            <DeltaBadge diff={trend?.diff} pct={trend?.pct} />
          </span>
        </div>
        <div className="progress thin"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        {coverage && coverage.totalNeed > 0 && (
          <div className="tile-own small" title="Copies available from your collection (shared pool)">
            <span className={`own-dot ${coverage.complete ? 'full' : coverage.covered ? 'part' : 'none'}`} aria-hidden />
            {coverage.complete ? 'All cards owned' : `${coverage.covered}/${coverage.totalNeed} owned · ${formatUSD(coverage.missingCost)} to finish`}
          </div>
        )}
        <TagList groups={[{ scope: 'deck', tags: deck.tags ?? [] }]} max={4} onTagClick={(_, t) => onTagClick(t)} />
        {matches.length > 0 && (
          <ul className="tile-matches">
            {matches.slice(0, 4).map((m) => (
              <li key={m.uid}><span>{m.qty}× {m.card.name}</span><span className="muted">{BOARD_LABEL[m.board]}</span></li>
            ))}
            {matches.length > 4 && <li className="muted">+{matches.length - 4} more</li>}
          </ul>
        )}
        <div className="tile-foot" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {confirmDelete ? (
            <>
              <span className="small">Delete “{deck.name}”?</span>
              <span className="tile-foot-actions">
                <button className="btn btn-sm btn-danger" onClick={() => void deleteDeck(deck.id)}>Delete</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
              </span>
            </>
          ) : (
            <>
              <span className="muted tiny">Edited {new Date(deck.updatedAt).toLocaleDateString()}</span>
              <button className="btn btn-sm btn-ghost tile-delete" onClick={() => setConfirmDelete(true)} aria-label={`Delete deck ${deck.name}`}>🗑 Delete</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NewDeckModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState('commander');
  const fmt = getFormat(format);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const d = newDeck(name.trim() || 'Untitled deck', format);
    await saveDeck(d);
    navigate(`/deck/${d.id}`);
  };

  return (
    <Modal onClose={onClose} title="New deck">
      <form className="new-deck-form" onSubmit={submit}>
        <label>
          <span className="label">Deck name</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Elf Tribal" />
        </label>
        <label>
          <span className="label">Format</span>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
            {(['Commander', 'Constructed', 'Digital', 'Other'] as const).map((g) => (
              <optgroup key={g} label={g}>
                {FORMATS.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="muted small">{fmt.description}</p>
        <div className="ie-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Create deck</button>
        </div>
      </form>
    </Modal>
  );
}

const FORMAT_GROUPS = ['Commander', 'Constructed', 'Digital', 'Other'] as const;

/** Main-menu import: paste or pick a .txt list, and create a new deck from it. */
function ImportDeckModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [format, setFormat] = useState('commander');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<ImportResult>();
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const suggested = defaultImportName(text, fileName);
  const lineCount = useMemo(() => parseDecklist(text).length, [text]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      setText(await f.text());
      setFileName(f.name);
      setError('');
      setFailed(undefined);
    } catch {
      setError(`Couldn't read ${f.name}.`);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setFailed(undefined);
    if (!parseDecklist(text).length) {
      setError('No card lines found. Paste a list like "1 Sol Ring", one card per line.');
      return;
    }
    setBusy(true);
    try {
      const { deck, result } = await importNewDeck({ text, format, name, fileName });
      toast(importSummary(result), 'success');
      setPendingImport(deck.id, result);
      navigate(`/deck/${deck.id}`);
    } catch (err) {
      if (err instanceof ImportError && err.result) setFailed(err.result);
      if (!wasReported(err)) setError((err as Error).message);
      else setError('The deck could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Import deck">
      <form className="new-deck-form" onSubmit={submit}>
        <p className="muted small">
          Paste a decklist (Moxfield, Archidekt, MTGO or Arena format) or choose a .txt file. Section headers <code>Commander</code>,{' '}
          <code>Deck</code>, <code>Sideboard</code>, <code>Maybeboard</code> and the <code>*CMDR*</code> tag are recognized. Archidekt categories (<code>[Ramp]</code>) become card tags.
        </p>
        <textarea
          className="input textarea" rows={12} value={text} aria-label="Decklist"
          onChange={(e) => { setText(e.target.value); setFailed(undefined); }}
          placeholder={'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n10 Forest'}
        />
        <div className="ie-actions">
          <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={onFile} />
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Choose .txt file</button>
          <span className="muted small">{fileName ? `${fileName} · ` : ''}{lineCount} card line{lineCount === 1 ? '' : 's'}</span>
        </div>
        <label>
          <span className="label">Deck name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} />
        </label>
        <label>
          <span className="label">Format</span>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMAT_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {FORMATS.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        {failed && <ImportResultView result={failed} onSearch={(n) => { onClose(); requestCardSearch(n); }} />}
        <div className="ie-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? 'Looking up cards…' : 'Import deck'}</button>
        </div>
      </form>
    </Modal>
  );
}
