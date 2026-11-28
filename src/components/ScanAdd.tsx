import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { Card } from '../types';
import { useToast } from './Toast';
import { applyDefaults, DefaultsRow, type Defaults } from './BulkDefaults';
import { getPrints } from '../lib/scryfall';
import { addItems, availableFinishes, defaultFinish, FINISH_LABEL, finishPrice, printBadges, today } from '../lib/collection';
import { cardImage, formatUSD, uid } from '../lib/rules';
import { stopOcr, warmUpOcr, type Rotation } from '../lib/scan/ocr';
import { cardByName, checkRank, getNameIndex, inSet, needsCheck, resolveDetections, scanPhoto, type PrintingCertainty, type ScanTile } from '../lib/scan/scan';
import type { NameIndex } from '../lib/scan/names';

interface Photo { id: string; file: File; url: string; rotation: Rotation; scanned: boolean; found?: number }

const STATUS: Record<PrintingCertainty, { label: string; cls: string }> = {
  exact: { label: 'Printing read from card', cls: 'scan-ok' },
  user: { label: 'Printing chosen', cls: 'scan-ok' },
  set: { label: 'Set matches · check the variant', cls: 'scan-maybe' },
  owned: { label: 'Printing you already own', cls: 'scan-maybe' },
  guess: { label: 'Printing guessed', cls: 'scan-warn' },
};

/** Tesseract's progress messages, in words. */
function stepLabel(status: string, progress: number, photo: string): string {
  if (/loading (tesseract core|language)/.test(status)) return `Getting the text reader ready (first time only, about 7 MB)… ${Math.round(progress * 100)}%`;
  if (/initializ/.test(status)) return 'Starting the text reader…';
  if (/recognizing/.test(status)) return `${photo}: reading text… ${Math.round(progress * 100)}%`;
  return `${photo}…`;
}

export function ScanAdd({ onDone }: { onDone: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tiles, setTiles] = useState<ScanTile[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [view, setView] = useState<'pick' | 'review'>('pick');
  const [busy, setBusy] = useState<string | null>(null);
  const [printsFor, setPrintsFor] = useState<string | null>(null);
  const [carry, setCarry] = useState<{ set: string; setName: string; from: string } | null>(null);
  const [defaults, setDefaults] = useState<Defaults>({ acquiredAt: today(), useMarket: false });
  const [showConfirmed, setShowConfirmed] = useState(false);
  const urls = useRef(new Set<string>());
  const toast = useToast();

  // Free the photos, crops and the OCR worker when the window closes.
  useEffect(() => () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    void stopOcr();
  }, []);

  const addFiles = (files: FileList | File[] | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const next = list.map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return { id: uid(), file, url, rotation: 0 as Rotation, scanned: false };
    });
    setPhotos((p) => [...p, ...next]);
    // Start downloading the reader and the card names while the user gets ready.
    warmUpOcr().catch(() => undefined);
    getNameIndex().catch(() => undefined);
  };
  const onInput = (e: ChangeEvent<HTMLInputElement>) => { addFiles(e.target.files); e.target.value = ''; };
  const onDrop = (e: DragEvent) => { e.preventDefault(); addFiles(e.dataTransfer.files); };

  const pending = photos.filter((p) => !p.scanned);

  const scan = async () => {
    const todo = pending;
    const found: ScanTile[] = [];
    const miss: string[] = [];
    let failed = false;
    try {
      for (const [i, p] of todo.entries()) {
        const label = todo.length > 1 ? `Photo ${i + 1} of ${todo.length}` : 'Your photo';
        setBusy(`${label}…`);
        const { detections } = await scanPhoto(p.file, p.rotation, (s, prog) => setBusy(stepLabel(s, prog, label)));
        setBusy(`${label}: looking up ${detections.length} card${detections.length === 1 ? '' : 's'}…`);
        const res = await resolveDetections(p.id, detections);
        res.tiles.forEach((t) => t.crop && urls.current.add(t.crop));
        found.push(...res.tiles);
        miss.push(...res.missing);
        setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, scanned: true, found: res.tiles.length } : x)));
      }
    } catch (e) {
      failed = true;
      toast(`Scanning stopped: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
    setTiles((t) => [...t, ...found]);
    setMissing((m) => [...m, ...miss]);
    if (found.length || tiles.length) setView('review');
    else if (!miss.length && !failed) toast('No card names found. Try a closer, flatter photo with even light.', 'error');
  };

  const update = (id: string, fn: (t: ScanTile) => ScanTile) => setTiles((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  const remove = (id: string) => setTiles((ts) => ts.filter((t) => t.id !== id));
  const setAllFinish = (foil: boolean) => setTiles((ts) => ts.map((t) => {
    const fins = availableFinishes(t.card);
    return { ...t, finish: foil ? (fins.includes('foil') ? 'foil' : t.finish) : (fins.includes('nonfoil') ? 'nonfoil' : t.finish) };
  }));

  const pickPrint = (tile: ScanTile, card: Card) => {
    const finish = availableFinishes(card).includes(tile.finish) ? tile.finish : defaultFinish(card);
    update(tile.id, (t) => ({ ...t, card, finish, printing: 'user' }));
    setPrintsFor(null);
    const others = tiles.filter((t) => t.id !== tile.id && (t.printing === 'guess' || t.printing === 'owned') && t.card.set !== card.set);
    setCarry(others.length ? { set: card.set, setName: card.set_name, from: tile.id } : null);
  };

  const applyCarry = async () => {
    if (!carry) return;
    const others = tiles.filter((t) => t.id !== carry.from && (t.printing === 'guess' || t.printing === 'owned') && t.card.set !== carry.set);
    setCarry(null);
    setBusy(`Looking for ${others.length} card${others.length === 1 ? '' : 's'} in ${carry.setName}…`);
    try {
      const got = await inSet([...new Set(others.map((t) => t.card.name))], carry.set);
      setTiles((ts) => ts.map((t) => {
        const c = others.some((o) => o.id === t.id) ? got.get(t.card.name) : undefined;
        if (!c) return t;
        return { ...t, card: c, printing: 'set', finish: availableFinishes(c).includes(t.finish) ? t.finish : defaultFinish(c) };
      }));
      const n = others.filter((o) => got.has(o.card.name)).length;
      toast(`${n} of ${others.length} found in ${carry.setName}`, n ? 'success' : 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    const n = await addItems(tiles.map((t) => applyDefaults(t.card, t.finish, t.qty, defaults)));
    toast(`Added ${n} card${n === 1 ? '' : 's'} to your collection`, 'success');
    onDone();
  };

  const check = useMemo(() => tiles.filter(needsCheck).sort((a, b) => checkRank(a) - checkRank(b)), [tiles]);
  const confirmed = useMemo(() => tiles.filter((t) => !needsCheck(t)), [tiles]);
  const total = tiles.reduce((n, t) => n + t.qty, 0);

  const printTile = tiles.find((t) => t.id === printsFor);
  if (printTile) return <PrintPicker tile={printTile} onPick={(c) => pickPrint(printTile, c)} onBack={() => setPrintsFor(null)} />;

  if (view === 'pick') {
    return (
      <div className="ie-body">
        <div className="scan-drop" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <p className="muted small">
            Photograph one card, or a few laid out flat. Hold the phone straight above them, use even light without glare, and keep
            the cards upright. English cards only for now. Nothing leaves your device except the card names, looked up on Scryfall.
          </p>
          <div className="ie-actions ie-left">
            <label className="btn btn-primary">📷 Take a photo<input type="file" accept="image/*" capture="environment" hidden onChange={onInput} /></label>
            <label className="btn">Choose photos<input type="file" accept="image/*" multiple hidden onChange={onInput} data-testid="scan-files" /></label>
            <span className="muted small">or drop images here</span>
          </div>
        </div>
        {photos.length > 0 && (
          <div className="scan-photos">
            {photos.map((p, i) => (
              <div key={p.id} className={`scan-photo ${p.scanned ? 'done' : ''}`}>
                <img src={p.url} alt={`Photo ${i + 1}`} style={{ transform: `rotate(${p.rotation}deg)` }} />
                {p.scanned ? (
                  <span className="tiny-label">{p.found ? `${p.found} found` : 'none found'}</span>
                ) : (
                  <span className="scan-photo-actions">
                    <button className="btn btn-ghost btn-sm" title="Rotate a quarter turn" aria-label={`Rotate photo ${i + 1}`} disabled={!!busy}
                      onClick={() => setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, rotation: ((x.rotation + 90) % 360) as Rotation } : x)))}>⟳</button>
                    <button className="btn btn-ghost btn-sm" title="Remove" aria-label={`Remove photo ${i + 1}`} disabled={!!busy}
                      onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}>✕</button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {busy && <div className="scan-busy" role="status">{busy}</div>}
        <div className="ie-actions">
          {tiles.length > 0 && <button className="btn btn-ghost" disabled={!!busy} onClick={() => setView('review')}>Back to review ({tiles.length})</button>}
          <button className="btn btn-primary" disabled={!pending.length || !!busy} onClick={scan}>
            {busy ? 'Scanning…' : pending.length > 1 ? `Scan ${pending.length} photos` : 'Scan photo'}
          </button>
        </div>
      </div>
    );
  }

  const tileProps = { onChange: update, onRemove: remove, onPrints: setPrintsFor };
  return (
    <div className="ie-body">
      <div className="scan-summary">
        <span><b>{tiles.length}</b> card{tiles.length === 1 ? '' : 's'} found{check.length ? <> · <b>{check.length}</b> to check</> : ''}</span>
        <span className="scan-summary-actions">
          <button className="btn btn-sm" onClick={() => setAllFinish(true)}>All foil</button>
          <button className="btn btn-sm" onClick={() => setAllFinish(false)}>All non-foil</button>
          <button className="btn btn-sm" onClick={() => setView('pick')}>+ More photos</button>
        </span>
      </div>
      {carry && (
        <div className="alert alert-warn scan-carry">
          <span>Use <b>{carry.setName}</b> for the other cards whose printing was guessed?</span>
          <span>
            <button className="btn btn-sm btn-primary" onClick={applyCarry}>Use {carry.set.toUpperCase()}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setCarry(null)}>No thanks</button>
          </span>
        </div>
      )}
      {busy && <div className="scan-busy" role="status">{busy}</div>}
      {missing.length > 0 && <div className="alert alert-error">Read but not found on Scryfall: {missing.join(', ')}</div>}
      {!tiles.length && <div className="empty">Nothing left to add.</div>}
      {check.length > 0 && (
        <section className="scan-group">
          <h4>Check these</h4>
          {check.map((t) => <Tile key={t.id} tile={t} {...tileProps} />)}
        </section>
      )}
      {confirmed.length > 0 && (
        <section className="scan-group">
          <h4>
            <button className="link-btn" aria-expanded={showConfirmed || !check.length} onClick={() => setShowConfirmed((s) => !s)}>
              {showConfirmed || !check.length ? '▾' : '▸'} Confirmed ({confirmed.length})
            </button>
          </h4>
          {(showConfirmed || !check.length) && confirmed.map((t) => <Tile key={t.id} tile={t} {...tileProps} />)}
        </section>
      )}
      <DefaultsRow value={defaults} onChange={setDefaults} />
      <div className="ie-actions">
        <button className="btn btn-primary" disabled={!total || !!busy} onClick={add}>Add {total} card{total === 1 ? '' : 's'} to collection</button>
      </div>
    </div>
  );
}

// ---------- One scanned card ----------

function Tile({ tile, onChange, onRemove, onPrints }: {
  tile: ScanTile;
  onChange: (id: string, fn: (t: ScanTile) => ScanTile) => void;
  onRemove: (id: string) => void;
  onPrints: (id: string) => void;
}) {
  const [fixing, setFixing] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { card } = tile;
  const status = tile.nameSure ? STATUS[tile.printing] : { label: 'Check the name', cls: 'scan-bad' };
  const badges = printBadges(card);
  const alts = tile.matches.filter((m) => m.name !== card.name).slice(0, 3);

  const rename = async (name: string) => {
    setBusy(true);
    try {
      const got = await cardByName(name);
      if (!got) { toast(`${name} wasn't found on Scryfall`, 'error'); return; }
      onChange(tile.id, (t) => ({ ...t, card: got.card, printing: got.printing, nameSure: true, finish: defaultFinish(got.card) }));
      setFixing(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scan-tile" data-testid="scan-tile">
      <div className="scan-pics">
        {tile.crop && <img className="scan-crop" src={tile.crop} alt="From your photo" />}
        <img src={cardImage(card, 'small')} alt={card.name} loading="lazy" />
      </div>
      <div className="scan-info">
        <div className="scan-title">
          <b className="truncate">{card.name}</b>
          <span className={`scan-status ${status.cls}`}>{status.label}</span>
        </div>
        <div className="muted small">
          {card.set.toUpperCase()} #{card.collector_number} · {card.set_name}{badges.length ? ` · ${badges.join(', ')}` : ''}
        </div>
        {!tile.nameSure && (
          <div className="small">
            {tile.read ? `Read as “${tile.read}”.` : 'Name not readable: found by its set and number.'}{' '}
            <button className="link-btn" disabled={busy} onClick={() => rename(card.name)}>Yes, it's {card.name}</button>
            {alts.map((m) => <span key={m.name}> · <button className="link-btn" disabled={busy} onClick={() => rename(m.name)}>{m.name}</button></span>)}
          </div>
        )}
        <div className="scan-controls">
          <span className="scan-qty">
            <button className="btn btn-sm" aria-label="One fewer" disabled={tile.qty <= 1} onClick={() => onChange(tile.id, (t) => ({ ...t, qty: t.qty - 1 }))}>−</button>
            <span aria-label="Quantity">{tile.qty}</span>
            <button className="btn btn-sm" aria-label="One more" onClick={() => onChange(tile.id, (t) => ({ ...t, qty: t.qty + 1 }))}>+</button>
          </span>
          <select className="input input-sm" aria-label="Finish" value={tile.finish} onChange={(e) => onChange(tile.id, (t) => ({ ...t, finish: e.target.value as ScanTile['finish'] }))}>
            {availableFinishes(card).map((f) => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
          </select>
          <span className="price small">{formatUSD(finishPrice(card, tile.finish))}</span>
          <button className="btn btn-sm" onClick={() => onPrints(tile.id)}>Change printing</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setFixing((f) => !f)}>Wrong card?</button>
          <button className="btn btn-sm btn-ghost" aria-label={`Remove ${card.name}`} title="Don't add this card" onClick={() => onRemove(tile.id)}>✕</button>
        </div>
        {fixing && <NameFix busy={busy} onPick={rename} onCancel={() => setFixing(false)} />}
      </div>
    </div>
  );
}

/** Type the right name; suggestions come from the same name index the scanner uses (no network). */
function NameFix({ busy, onPick, onCancel }: { busy: boolean; onPick: (name: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState<NameIndex | null>(null);
  useEffect(() => { getNameIndex().then(setIndex).catch(() => undefined); }, []);
  const hits = index && q.trim().length >= 3 ? index.match(q, 6) : [];
  return (
    <div className="scan-fix">
      <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type the card's name" aria-label="Card name" />
      <div className="scan-fix-hits">
        {hits.map((h) => <button key={h.name} className="chip" disabled={busy} onClick={() => onPick(h.name)}>{h.name}</button>)}
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- Printing picker ----------

function PrintPicker({ tile, onPick, onBack }: { tile: ScanTile; onPick: (c: Card) => void; onBack: () => void }) {
  const [prints, setPrints] = useState<Card[] | null>(null);
  const toast = useToast();
  useEffect(() => {
    getPrints(tile.card).then(setPrints).catch((e) => { toast((e as Error).message, 'error'); setPrints([tile.card]); });
  }, [tile.card, toast]);
  return (
    <div className="ie-body">
      <div className="scan-print-head">
        {tile.crop && <img className="scan-crop big" src={tile.crop} alt="From your photo" />}
        <div>
          <b>{tile.card.name}</b>
          <p className="muted small">Match the art, frame and set symbol to your card. Prices are for the finish you picked ({FINISH_LABEL[tile.finish].toLowerCase()} where it exists).</p>
          <button className="btn btn-ghost" onClick={onBack}>← Back to review</button>
        </div>
      </div>
      {!prints ? <div className="loading">Loading printings…</div> : (
        <div className="results-grid compact">
          {prints.map((c) => {
            const badges = printBadges(c);
            const fin = availableFinishes(c).includes(tile.finish) ? tile.finish : defaultFinish(c);
            return (
              <button key={c.id} className={`print-pick ${c.id === tile.card.id ? 'on' : ''}`} onClick={() => onPick(c)}>
                <img src={cardImage(c, 'small')} alt={`${c.name} (${c.set.toUpperCase()} #${c.collector_number})`} loading="lazy" />
                <span className="muted tiny-label">{c.set.toUpperCase()} #{c.collector_number}{badges.length ? ` · ${badges.join(', ')}` : ''}</span>
                <span className="truncate tiny-label">{c.set_name}</span>
                <span className="price tiny-label">{formatUSD(finishPrice(c, fin))}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
