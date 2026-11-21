import { useState } from 'react';
import type { Board, Card, Deck, DeckChangeSession } from '../types';
import { BOARD_LABEL, commanderName, compareEntries, describeSession, sessionTotals, type CompareRow } from '../lib/deckHistory';
import { deckSnapshots, defaultSnapshotName, deleteSnapshot, renameSnapshot, restoreSnapshot, saveSnapshot } from '../lib/deckSnapshots';
import { averageMV, boardCount, boardEntries, boardPrice, formatUSD, isLand } from '../lib/rules';
import { snapshotsT, useDecks, wasReported } from '../lib/store';
import { Modal } from './Modal';
import { CardLink } from './CardLink';
import { CardModal } from './CardModal';

const when = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const boardSuffix = (b: Board) => (b === 'main' ? '' : ` (${BOARD_LABEL[b].toLowerCase()})`);

// ---------- History: changelog + snapshots ----------

export function DeckHistoryModal({ deck, onClose, onCompare }: {
  deck: Deck;
  onClose: () => void;
  /** Open the comparison with this snapshot. */
  onCompare: (snapId: string) => void;
}) {
  const [tab, setTab] = useState<'changes' | 'snapshots'>('changes');
  const sessions = deck.changelog ?? [];
  const snaps = deckSnapshots(snapshotsT.useAll(), deck.id);
  return (
    <Modal onClose={onClose} title="Deck history" wide>
      <div className="board-tabs">
        <button className={`tab ${tab === 'changes' ? 'active' : ''}`} onClick={() => setTab('changes')}>Changes<span className="tab-count">{sessions.length}</span></button>
        <button className={`tab ${tab === 'snapshots' ? 'active' : ''}`} onClick={() => setTab('snapshots')}>Snapshots<span className="tab-count">{snaps.length}</span></button>
      </div>
      {tab === 'changes' ? <Changelog sessions={sessions} /> : <Snapshots deck={deck} snaps={snaps} onCompare={onCompare} />}
    </Modal>
  );
}

function Changelog({ sessions }: { sessions: DeckChangeSession[] }) {
  if (!sessions.length) {
    return <p className="muted">No changes yet. From now on, every card you add, remove or move, and every commander change, is listed here.</p>;
  }
  return (
    <div className="history-list">
      <p className="muted small help">Changes made within 30 minutes of each other are grouped together. Adding a card and removing it again in the same session cancels out.</p>
      {[...sessions].reverse().map((s) => <SessionView key={s.id} s={s} />)}
    </div>
  );
}

function SessionView({ s }: { s: DeckChangeSession }) {
  const lines = describeSession(s);
  const { added, removed } = sessionTotals(s);
  const moved = lines.filter((l) => l.kind === 'move').reduce((n, l) => n + l.qty, 0);
  return (
    <section className="history-session">
      <header className="history-session-head">
        <span className="history-when">{when(s.startedAt)}{s.at - s.startedAt > 60_000 ? ` – ${new Date(s.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        {s.note && <span className="history-note">{s.note}</span>}
        <span className="history-totals small">
          {added - moved > 0 && <span className="pos">+{added - moved}</span>}
          {removed - moved > 0 && <span className="neg">−{removed - moved}</span>}
          {moved > 0 && <span className="muted">{moved} moved</span>}
        </span>
      </header>
      <ul className="history-lines">
        {s.commander && (
          <li className="history-cmd">
            ♛ Commander: {s.commander.from ? <s>{s.commander.from}</s> : <span className="muted">none</span>} → {s.commander.to ?? <span className="muted">none</span>}
          </li>
        )}
        {lines.map((l, i) => (
          <li key={i} className={l.kind === 'add' ? 'pos' : l.kind === 'remove' ? 'neg' : 'moved'}>
            {l.kind === 'move'
              ? <>⇄ {l.qty > 1 ? `${l.qty}× ` : ''}{l.name} <span className="muted">{BOARD_LABEL[l.from]} → {BOARD_LABEL[l.to]}</span></>
              : <>{l.kind === 'add' ? '+' : '−'}{l.qty} {l.name}<span className="muted">{boardSuffix(l.board)}</span></>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Snapshots({ deck, snaps, onCompare }: { deck: Deck; snaps: ReturnType<typeof deckSnapshots>; onCompare: (id: string) => void }) {
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'restore' | 'delete' } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const run = async (p: Promise<unknown>) => {
    setError('');
    try { await p; } catch (e) { if (!wasReported(e)) setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="snapshots">
      <form className="snapshot-new" onSubmit={(e) => { e.preventDefault(); run(saveSnapshot(deck.id, name)).then(() => setName('')); }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Name (optional), e.g. ${defaultSnapshotName()}`} aria-label="Snapshot name" maxLength={80} />
        <button className="btn btn-primary" type="submit">Save snapshot</button>
      </form>
      <p className="muted small help">
        A snapshot keeps a copy of this deck’s cards (all boards, the commander, tags and printings) in this browser. Compare it with the deck as it is now, or restore it: restoring first saves the current cards as a snapshot, so you can always go back.
      </p>
      {error && <p className="error-text small">{error}</p>}
      {!snaps.length ? <p className="muted">No snapshots yet.</p> : (
        <ul className="snapshot-list">
          {snaps.map((s) => {
            const asDeck = { ...deck, entries: s.entries, commanderUid: s.commanderUid };
            return (
              <li key={s.id} className="snapshot-row">
                <div className="snapshot-info">
                  {renaming?.id === s.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); renameSnapshot(s.id, renaming.name); setRenaming(null); }}>
                      <input className="input input-sm" autoFocus value={renaming.name} maxLength={80} aria-label="New snapshot name"
                        onChange={(e) => setRenaming({ id: s.id, name: e.target.value })} onBlur={() => { renameSnapshot(s.id, renaming.name); setRenaming(null); }} />
                    </form>
                  ) : (
                    <button type="button" className="link-btn snapshot-name" title="Rename" onClick={() => setRenaming({ id: s.id, name: s.name })}>{s.name}</button>
                  )}
                  <span className="muted small">{when(s.createdAt)} · {boardCount(asDeck, 'main')} card{boardCount(asDeck, 'main') === 1 ? '' : 's'} · {formatUSD(boardPrice(asDeck, 'main'))} at the time{commanderName(s) ? ` · ♛ ${commanderName(s)}` : ''}</span>
                </div>
                <div className="snapshot-actions">
                  {confirm?.id === s.id ? (
                    <>
                      <span className="small">{confirm.action === 'restore' ? 'Replace the deck’s cards with this snapshot?' : 'Delete this snapshot?'}</span>
                      <button className={`btn btn-sm ${confirm.action === 'delete' ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() => { setConfirm(null); run(confirm.action === 'restore' ? restoreSnapshot(s.id) : deleteSnapshot(s.id)); }}>
                        {confirm.action === 'restore' ? 'Restore' : 'Delete'}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-sm" onClick={() => onCompare(s.id)}>Compare</button>
                      <button className="btn btn-sm" onClick={() => setConfirm({ id: s.id, action: 'restore' })}>Restore</button>
                      <button className="btn btn-sm btn-danger-outline" onClick={() => setConfirm({ id: s.id, action: 'delete' })} aria-label={`Delete ${s.name}`}>🗑</button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- Compare ----------

/** 'now' = this deck as it is; 'snap:<id>' = one of its snapshots; 'deck:<id>' = another deck. */
export type CompareTarget = string;

function useSides(deck: Deck) {
  const { decks } = useDecks();
  const snaps = deckSnapshots(snapshotsT.useAll(), deck.id);
  const others = decks.filter((d) => d.id !== deck.id).sort((a, b) => a.name.localeCompare(b.name));
  const resolve = (t: CompareTarget): { label: string; deck: Deck } | undefined => {
    if (t === 'now') return { label: `${deck.name} (now)`, deck };
    if (t.startsWith('snap:')) {
      const s = snaps.find((x) => x.id === t.slice(5));
      return s && { label: s.name, deck: { ...deck, entries: s.entries, commanderUid: s.commanderUid } };
    }
    const d = others.find((x) => x.id === t.slice(5));
    return d && { label: d.name, deck: d };
  };
  return { snaps, others, resolve };
}

function SidePicker({ value, onChange, snaps, others, label }: {
  value: CompareTarget; onChange: (v: CompareTarget) => void; snaps: { id: string; name: string; createdAt: number }[]; others: Deck[]; label: string;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="now">This deck (now)</option>
      {snaps.length > 0 && (
        <optgroup label="Snapshots of this deck">
          {snaps.map((s) => <option key={s.id} value={`snap:${s.id}`}>{s.name}</option>)}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Other decks">
          {others.map((d) => <option key={d.id} value={`deck:${d.id}`}>{d.name}</option>)}
        </optgroup>
      )}
    </select>
  );
}

export function CompareModal({ deck, initial, onClose }: { deck: Deck; initial?: CompareTarget; onClose: () => void }) {
  const { snaps, others, resolve } = useSides(deck);
  const [aT, setA] = useState<CompareTarget>('now');
  const [bT, setB] = useState<CompareTarget>(() => initial ?? (snaps[0] ? `snap:${snaps[0].id}` : others[0] ? `deck:${others[0].id}` : 'now'));
  const [board, setBoard] = useState<Board>('main');
  const [viewing, setViewing] = useState<Card | null>(null);
  const a = resolve(aT);
  const b = resolve(bT);
  const cmp = a && b ? compareEntries(a.deck.entries, b.deck.entries, board) : null;

  if (!snaps.length && !others.length) {
    return (
      <Modal onClose={onClose} title="Compare decks">
        <p className="muted">There is nothing to compare with yet. Save a snapshot of this deck (History → Snapshots) or make another deck first.</p>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Compare decks" wide>
      <div className="compare-pickers">
        <span className="compare-side-tag a">A</span>
        <SidePicker value={aT} onChange={setA} snaps={snaps} others={others} label="Deck A" />
        <button type="button" className="icon-btn" title="Swap A and B" aria-label="Swap A and B" onClick={() => { setA(bT); setB(aT); }}>⇄</button>
        <span className="compare-side-tag b">B</span>
        <SidePicker value={bT} onChange={setB} snaps={snaps} others={others} label="Deck B" />
      </div>
      <div className="status-toggle compare-board" role="radiogroup" aria-label="Board">
        {(['main', 'side', 'maybe'] as Board[]).map((x) => (
          <button key={x} role="radio" aria-checked={board === x} className={`seg ${board === x ? 'on' : ''}`} onClick={() => setBoard(x)}>{BOARD_LABEL[x]}</button>
        ))}
      </div>
      {a && b && cmp && (
        <>
          {aT === bT && <p className="muted small">A and B are the same list.</p>}
          <CompareSummary a={a} b={b} board={board} />
          <div className="compare-grid">
            <CompareSection title={`Only in A`} rows={cmp.onlyA} side="a" onOpen={setViewing} />
            <CompareSection title={`Only in B`} rows={cmp.onlyB} side="b" onOpen={setViewing} />
            <CompareSection title="Different counts" rows={cmp.changed} side="both" onOpen={setViewing} />
            <CompareSection title="In both" rows={cmp.same} side="same" onOpen={setViewing} collapsed />
          </div>
        </>
      )}
      {viewing && <CardModal card={viewing} deckId={deck.id} onClose={() => setViewing(null)} />}
    </Modal>
  );
}

function stats(d: Deck, board: Board) {
  const entries = boardEntries(d, board);
  return {
    cards: boardCount(d, board),
    price: boardPrice(d, board),
    avg: averageMV(entries),
    lands: entries.filter((e) => isLand(e.card)).reduce((n, e) => n + e.qty, 0),
    commander: board === 'main' ? commanderName(d) : undefined,
  };
}

function CompareSummary({ a, b, board }: { a: { label: string; deck: Deck }; b: { label: string; deck: Deck }; board: Board }) {
  const sa = stats(a.deck, board);
  const sb = stats(b.deck, board);
  const diff = (x: number, y: number, fmt: (n: number) => string) => {
    const d = y - x;
    if (Math.abs(d) < 0.005) return <span className="muted">same</span>;
    return <span>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))}</span>;
  };
  return (
    <table className="compare-summary">
      <thead><tr><th /><th><span className="compare-side-tag a">A</span> {a.label}</th><th><span className="compare-side-tag b">B</span> {b.label}</th><th>B − A</th></tr></thead>
      <tbody>
        <tr><th>Cards</th><td>{sa.cards}</td><td>{sb.cards}</td><td>{diff(sa.cards, sb.cards, String)}</td></tr>
        <tr><th>Lands</th><td>{sa.lands}</td><td>{sb.lands}</td><td>{diff(sa.lands, sb.lands, String)}</td></tr>
        <tr><th>Avg mana value</th><td>{sa.avg.toFixed(2)}</td><td>{sb.avg.toFixed(2)}</td><td>{diff(sa.avg, sb.avg, (n) => n.toFixed(2))}</td></tr>
        <tr><th>Price</th><td>{formatUSD(sa.price)}</td><td>{formatUSD(sb.price)}</td><td>{diff(sa.price, sb.price, formatUSD)}</td></tr>
        {board === 'main' && (sa.commander || sb.commander) && (
          <tr><th>Commander</th><td>{sa.commander ?? '—'}</td><td>{sb.commander ?? '—'}</td><td>{sa.commander === sb.commander ? <span className="muted">same</span> : ''}</td></tr>
        )}
      </tbody>
    </table>
  );
}

function CompareSection({ title, rows, side, onOpen, collapsed }: {
  title: string; rows: CompareRow[]; side: 'a' | 'b' | 'both' | 'same'; onOpen: (c: Card) => void; collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const copies = rows.reduce((n, r) => n + (side === 'b' ? r.b : side === 'a' ? r.a : 0), 0);
  return (
    <section className={`compare-section compare-${side}`}>
      <button type="button" className="compare-section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev">{open ? '▾' : '▸'}</span> {title} <span className="tab-count">{rows.length}{(side === 'a' || side === 'b') && rows.length ? ` · ${copies} cop${copies === 1 ? 'y' : 'ies'}` : ''}</span>
      </button>
      {open && (rows.length === 0 ? <p className="muted small">None.</p> : (
        <ul className="compare-rows">
          {rows.map((r) => (
            <li key={r.name}>
              <span className="compare-qty">
                {side === 'a' ? r.a : side === 'b' ? r.b : side === 'same' ? r.a : <>{r.a} → {r.b}</>}
              </span>
              <CardLink card={r.card} name={r.name} onOpen={() => onOpen(r.card)} draggable={false} />
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
