import { useState, type ChangeEvent } from 'react';
import type { CollectionItem } from '../types';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { downloadBackup, exportCollection, parseBackup, restoreBackup, type Backup, type BackupSummary } from '../lib/backup';
import { decksT, salesT, useSettings } from '../lib/store';
import { exportSummary, exportTransactions, PERIODS, type Period } from '../lib/ledger';

/** Export (text / CSV), full JSON backup, and restore from a backup file. */
export function BackupModal({ items, selectedCount, onClose }: { items: CollectionItem[]; selectedCount?: number; onClose: () => void }) {
  const [tab, setTab] = useState<'export' | 'backup' | 'restore'>('export');
  const [pending, setPending] = useState<{ backup: Backup; summary: BackupSummary } | null>(null);
  const [error, setError] = useState('');
  const [safety, setSafety] = useState(true);
  const [busy, setBusy] = useState(false);
  const { lastBackupAt } = useSettings();
  const decks = decksT.useAll();
  const toast = useToast();
  const deckName = (id: string) => decks.find((d) => d.id === id)?.name ?? 'Deleted deck';
  const sales = salesT.useAll();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [period, setPeriod] = useState<Period>('month');
  const count = (n: number) => toast(n ? `Exported ${n} transaction${n === 1 ? '' : 's'}` : 'Nothing in that range — exported an empty file', n ? 'success' : 'info');

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setError('');
    setPending(null);
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setPending(parseBackup(await f.text()));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (safety) downloadBackup();
      await restoreBackup(pending.backup);
      const skipped = pending.summary.droppedTotal;
      toast(skipped ? `Backup restored (${skipped} damaged record${skipped === 1 ? '' : 's'} skipped)` : 'Backup restored', 'success');
      onClose();
    } catch (err) {
      setError(`Restore failed — nothing was changed. ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Export & backup">
      <div className="board-tabs">
        <button className={`tab ${tab === 'export' ? 'active' : ''}`} onClick={() => setTab('export')}>Export collection</button>
        <button className={`tab ${tab === 'backup' ? 'active' : ''}`} onClick={() => setTab('backup')}>Full backup</button>
        <button className={`tab ${tab === 'restore' ? 'active' : ''}`} onClick={() => setTab('restore')}>Restore</button>
      </div>

      {tab === 'export' && (
        <div className="ie-body">
          <p className="muted small">
            Exporting {selectedCount ? `${selectedCount} selected lot${selectedCount === 1 ? '' : 's'}` : `all ${items.length} lots`}.
          </p>
          <div className="export-choice">
            <div>
              <b>Text list</b>
              <p className="muted small">One line per lot: <code>4 Sol Ring (C21) 263 *F*</code>. Pastes into Moxfield, Archidekt and most collection tools.</p>
            </div>
            <button className="btn" onClick={() => exportCollection(items, 'text', deckName)}>Download .txt</button>
          </div>
          <div className="export-choice">
            <div>
              <b>Spreadsheet (CSV)</b>
              <p className="muted small">Every field: print, finish, condition, paid, current value, gain/loss, status, tags, deck allocation.</p>
            </div>
            <button className="btn" onClick={() => exportCollection(items, 'csv', deckName)}>Download .csv</button>
          </div>

          <h3 className="export-sub">Transactions</h3>
          <div className="if-grid">
            <label className="if-field"><span className="label">From</span>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="if-field"><span className="label">To</span>
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <div className="if-field"><span className="label">Earnings by</span>
              <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <p className="muted small">{from || to ? `Range ${from || 'start'} → ${to || 'today'}` : 'No range set — exports cover all time.'}</p>
          <div className="export-choice">
            <div><b>Cards purchased in range</b><p className="muted small">Every purchase (and card received in a trade): date, print, qty, price paid, source.</p></div>
            <button className="btn" onClick={() => count(exportTransactions(sales, 'purchased', from || undefined, to || undefined))}>Download .csv</button>
          </div>
          <div className="export-choice">
            <div><b>Cards sold in range</b><p className="muted small">Sales and trades: sale price, cost basis, gain/loss, where, buyer / trade partner, notes.</p></div>
            <button className="btn" onClick={() => count(exportTransactions(sales, 'sold', from || undefined, to || undefined))}>Download .csv</button>
          </div>
          <div className="export-choice">
            <div><b>Sale earnings / losses</b><p className="muted small">{PERIODS.find((p) => p.id === period)?.label} totals plus an overall total row: proceeds, cost, realized gain/loss, spend. Trades are listed on a separate line, not in the totals.</p></div>
            <button className="btn" onClick={() => exportSummary(sales, period, from || undefined, to || undefined)}>Download .csv</button>
          </div>
          <div className="export-choice">
            <div><b>Non-active cards</b><p className="muted small">The full record of every card you've sold or traded away, all time.</p></div>
            <button className="btn" onClick={() => count(exportTransactions(sales, 'inactive'))}>Download .csv</button>
          </div>
        </div>
      )}

      {tab === 'backup' && (
        <div className="ie-body">
          <p className="small">
            Everything is stored only in this browser. A backup file saves <b>all of it</b> — decks, collection, watchlist,
            sales, price history, saved searches and settings — so you can restore it here or on another computer.
          </p>
          <p className="muted small">Last backup: {lastBackupAt ? new Date(lastBackupAt).toLocaleString() : 'never'}</p>
          <div className="ie-actions">
            <button className="btn btn-primary" onClick={() => { downloadBackup(); toast('Backup downloaded', 'success'); }}>Download backup (.json)</button>
          </div>
        </div>
      )}

      {tab === 'restore' && (
        <div className="ie-body">
          <p className="small">Restoring <b>replaces everything</b> currently in the app with the contents of the backup file.</p>
          <input type="file" accept=".json,application/json" onChange={onFile} aria-label="Choose backup file" />
          {error && <div className="alert alert-error">{error}</div>}
          {pending && (
            <div className="restore-summary">
              <div className="label">Backup from {pending.summary.exportedAt ? new Date(pending.summary.exportedAt).toLocaleString() : 'unknown date'}</div>
              <ul>
                <li>{pending.summary.decks} decks</li>
                <li>{pending.summary.collection} collection lots ({pending.summary.copies} cards)</li>
                <li>{pending.summary.watchlist} watchlist · {pending.summary.sales} transactions · {pending.summary.ownedDecks} purchased decks · {pending.summary.searches} saved searches</li>
                <li>{pending.summary.prices} days of price history</li>
              </ul>
              <DroppedNotice summary={pending.summary} />
              <label className="radio"><input type="checkbox" checked={safety} onChange={(e) => setSafety(e.target.checked)} /> Download a backup of my current data first</label>
              <div className="ie-actions">
                <button className="btn btn-ghost" onClick={() => setPending(null)}>Cancel</button>
                <button className="btn btn-danger" disabled={busy} onClick={restore}>Replace my data with this backup</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const DROPPED_LABEL: [keyof BackupSummary['dropped'], string][] = [
  ['decks', 'decks'], ['deckCards', 'deck cards'], ['collection', 'collection lots'], ['watchlist', 'watchlist items'],
  ['sales', 'transactions'], ['prices', 'price-history days'], ['searches', 'saved searches'], ['ownedDecks', 'purchased decks'],
];

/** Which records were left out of the restore because they were incomplete or invalid. */
function DroppedNotice({ summary }: { summary: BackupSummary }) {
  const d = summary.dropped;
  const parts = DROPPED_LABEL.filter(([k]) => d[k] > 0).map(([k, l]) => `${d[k]} ${l}`);
  if (!parts.length && !d.allocationsClamped) return <p className="muted small">All records in the file are valid.</p>;
  return (
    <div className="alert alert-error">
      {parts.length > 0 && <div>Will be skipped because they're incomplete or damaged: {parts.join(', ')}.</div>}
      {d.allocationsClamped > 0 && <div>{d.allocationsClamped} collection lot{d.allocationsClamped === 1 ? '' : 's'} had more copies committed to decks than owned; those commitments will be trimmed.</div>}
    </div>
  );
}
