import { useState } from 'react';
import type { Card, Condition, Finish, Intent } from '../types';
import { getPrints } from '../lib/scryfall';
import { cardImage, formatUSD } from '../lib/rules';
import {
  availableFinishes, CONDITIONS, defaultFinish, FINISH_LABEL, finishPrice, INTENTS, printBadges, SOURCES, today,
} from '../lib/collection';
import { useAllCollectionTags } from '../lib/hooks';
import { TagEditor } from './TagEditor';
import { useToast } from './Toast';

export interface ItemDraft {
  card: Card;
  finish: Finish;
  qty: number;
  condition?: Condition;
  purchasePrice?: number;
  acquiredAt?: string;
  source?: string;
  intent?: Intent;
  targetPrice?: number;
  tags: string[];
  notes?: string;
  favorite: boolean;
}

export const draftFor = (card: Card, patch: Partial<ItemDraft> = {}): ItemDraft => ({
  card, finish: defaultFinish(card), qty: 1, tags: [], favorite: false, acquiredAt: today(), ...patch,
});

const numOrUndef = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function ItemForm({ draft, onChange, showPrint = true }: { draft: ItemDraft; onChange: (d: ItemDraft) => void; showPrint?: boolean }) {
  const set = (patch: Partial<ItemDraft>) => onChange({ ...draft, ...patch });
  const [prints, setPrints] = useState<Card[] | null>(null);
  const [loadingPrints, setLoadingPrints] = useState(false);
  const [priceText, setPriceText] = useState(draft.purchasePrice?.toString() ?? '');
  const [targetText, setTargetText] = useState(draft.targetPrice?.toString() ?? '');
  const customSource = draft.source != null && draft.source !== '' && !SOURCES.includes(draft.source);
  const [otherSource, setOtherSource] = useState(customSource);
  const allTags = useAllCollectionTags();
  const toast = useToast();
  const finishes = availableFinishes(draft.card);
  const current = finishPrice(draft.card, draft.finish);
  const badges = printBadges(draft.card);

  const loadPrints = async () => {
    setLoadingPrints(true);
    try { setPrints(await getPrints(draft.card)); } catch (e) { toast((e as Error).message, 'error'); } finally { setLoadingPrints(false); }
  };
  const pickPrint = (c: Card) => {
    const f = availableFinishes(c);
    set({ card: c, finish: f.includes(draft.finish) ? draft.finish : defaultFinish(c) });
  };

  return (
    <div className="item-form">
      {showPrint && (
        <div className="if-print">
          <img src={cardImage(draft.card, 'small')} alt="" className="if-thumb" />
          <div className="if-print-info">
            <div className="if-print-name">{draft.card.name}</div>
            <div className="muted small">{draft.card.set_name} ({draft.card.set.toUpperCase()}) #{draft.card.collector_number}</div>
            {badges.length > 0 && <div className="badge-row">{badges.map((b) => <span key={b} className="print-badge">{b}</span>)}</div>}
            <button type="button" className="link-btn small" onClick={prints ? () => setPrints(null) : loadPrints} disabled={loadingPrints}>
              {loadingPrints ? 'Loading printings…' : prints ? 'Hide printings' : 'Change print / set'}
            </button>
          </div>
        </div>
      )}
      {prints && (
        <div className="print-grid">
          {prints.map((p) => (
            <button key={p.id} type="button" className={`print-tile ${p.id === draft.card.id ? 'selected' : ''}`} onClick={() => pickPrint(p)} title={`${p.set_name} #${p.collector_number} ${printBadges(p).join(' ')}`}>
              <img src={cardImage(p, 'small')} alt="" loading="lazy" />
              <span className="print-tile-set">{p.set.toUpperCase()} #{p.collector_number}</span>
              <span className="print-tile-price">{formatUSD(finishPrice(p, 'nonfoil') ?? finishPrice(p, 'foil'))}</span>
            </button>
          ))}
        </div>
      )}

      <div className="if-grid">
        <label className="if-field">
          <span className="label">Finish</span>
          <div className="status-toggle">
            {finishes.map((f) => (
              <button type="button" key={f} className={`seg ${draft.finish === f ? 'on' : ''}`} onClick={() => set({ finish: f })}>{FINISH_LABEL[f]}</button>
            ))}
          </div>
        </label>
        <label className="if-field">
          <span className="label">Quantity</span>
          <input className="input" type="number" min={1} value={draft.qty} onChange={(e) => set({ qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
        </label>
        <label className="if-field">
          <span className="label">Condition <span className="optional">optional</span></span>
          <select className="input" value={draft.condition ?? ''} onChange={(e) => set({ condition: (e.target.value || undefined) as Condition | undefined })}>
            <option value="">Not set</option>
            {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.label}</option>)}
          </select>
        </label>
        <div className="if-field">
          <span className="label">Price paid (each) <span className="optional">optional</span></span>
          <div className="adv-inline">
            <input className="input" type="number" min={0} step="0.01" value={priceText} placeholder="—"
              onChange={(e) => { setPriceText(e.target.value); set({ purchasePrice: numOrUndef(e.target.value) }); }} />
            {current != null && (
              <button type="button" className="btn btn-sm btn-ghost" title="Use today's market price"
                onClick={() => { setPriceText(current.toFixed(2)); set({ purchasePrice: current }); }}>Market {formatUSD(current)}</button>
            )}
          </div>
        </div>
        <label className="if-field">
          <span className="label">Acquired <span className="optional">optional</span></span>
          <input className="input" type="date" value={draft.acquiredAt ?? ''} onChange={(e) => set({ acquiredAt: e.target.value || undefined })} />
        </label>
        <div className="if-field">
          <span className="label">Source <span className="optional">optional</span></span>
          <select className="input" value={otherSource ? '__other' : draft.source ?? ''}
            onChange={(e) => {
              if (e.target.value === '__other') { setOtherSource(true); set({ source: '' }); }
              else { setOtherSource(false); set({ source: e.target.value || undefined }); }
            }}>
            <option value="">Not set</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="__other">Other…</option>
          </select>
          {otherSource && (
            <input className="input if-other" value={draft.source ?? ''} placeholder="Where did it come from?" autoFocus onChange={(e) => set({ source: e.target.value })} />
          )}
        </div>
        <div className="if-field">
          <span className="label">Market status</span>
          <select className="input" value={draft.intent ?? ''} onChange={(e) => set({ intent: (e.target.value || undefined) as Intent | undefined })}>
            <option value="">None</option>
            {INTENTS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </div>
        {draft.intent && draft.intent !== 'hold' && (
          <label className="if-field">
            <span className="label">{draft.intent === 'buy' ? 'Buy at or below (each)' : 'Target price (each)'}</span>
            <input className="input" type="number" min={0} step="0.01" value={targetText} placeholder="—"
              onChange={(e) => { setTargetText(e.target.value); set({ targetPrice: numOrUndef(e.target.value) }); }} />
          </label>
        )}
      </div>

      <div className="if-field">
        <span className="label">◈ Collection tags</span>
        <TagEditor scope="collection" tags={draft.tags} onChange={(tags) => set({ tags })} suggestions={[{ label: 'Your collection tags', tags: allTags.slice(0, 12) }]} />
      </div>
      <label className="if-field">
        <span className="label">Notes <span className="optional">optional</span></span>
        <input className="input" value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} placeholder="e.g. signed by the artist" />
      </label>
      <label className="radio">
        <input type="checkbox" checked={draft.favorite} onChange={(e) => set({ favorite: e.target.checked })} /> ★ Favorite
      </label>
    </div>
  );
}
