import { useState } from 'react';
import type { Deck } from '../types';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { exportDecklist, importDecklist, importSummary, parseDecklist, type ImportResult } from '../lib/actions';
import { requestCardSearch } from '../lib/searchBus';
import { wasReported } from '../lib/store';
import { ImportResultView } from './ImportResult';

export function ImportExportModal({ deck, initialTab = 'import', onClose }: { deck: Deck; initialTab?: 'import' | 'export'; onClose: () => void }) {
  const [tab, setTab] = useState(initialTab);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>(deck.entries.length ? 'append' : 'replace');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [withSets, setWithSets] = useState(false);
  const toast = useToast();
  const exported = exportDecklist(deck, withSets);

  const doImport = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (!parseDecklist(text).length) {
        toast('No card lines found. Paste a list like "1 Sol Ring", one card per line.', 'error');
        return;
      }
      const r = await importDecklist(deck.id, text, mode);
      setResult(r);
      toast(importSummary(r), r.added ? 'success' : 'error');
      if (!r.missing.length) onClose();
    } catch (e) {
      if (!wasReported(e)) toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported);
      toast('Decklist copied to clipboard', 'success');
    } catch {
      toast('Could not access the clipboard', 'error');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([exported], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.name.replace(/[^\w\- ]+/g, '').trim() || 'deck'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal onClose={onClose} title="Import / Export">
      <div className="board-tabs">
        <button className={`tab ${tab === 'import' ? 'active' : ''}`} onClick={() => setTab('import')}>Import</button>
        <button className={`tab ${tab === 'export' ? 'active' : ''}`} onClick={() => setTab('export')}>Export</button>
      </div>

      {tab === 'import' ? (
        <div className="ie-body">
          <p className="muted small">
            Paste a decklist (Moxfield, Archidekt, MTGO or Arena format). One card per line, like <code>1 Sol Ring</code> or{' '}
            <code>1 Sol Ring (CMM) 400</code>. Section headers <code>Commander</code>, <code>Deck</code>, <code>Sideboard</code>,{' '}
            <code>Maybeboard</code> and the <code>*CMDR*</code> tag are recognized.
          </p>
          <textarea
            className="input textarea" rows={14} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n10 Forest'}
          />
          <div className="ie-actions">
            <label className="radio"><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> Add to deck</label>
            <label className="radio"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace deck</label>
            <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={doImport}>
              {busy ? 'Looking up cards…' : 'Import'}
            </button>
          </div>
          {result && result.missing.length > 0 && (
            <ImportResultView result={result} onSearch={(name) => { onClose(); requestCardSearch(name); }} />
          )}
        </div>
      ) : (
        <div className="ie-body">
          <textarea className="input textarea" rows={16} readOnly value={exported} onFocus={(e) => e.target.select()} />
          <div className="ie-actions">
            <label className="radio"><input type="checkbox" checked={withSets} onChange={(e) => setWithSets(e.target.checked)} /> Include set &amp; collector number</label>
            <button className="btn" onClick={download}>Download .txt</button>
            <button className="btn btn-primary" onClick={copy}>Copy</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
