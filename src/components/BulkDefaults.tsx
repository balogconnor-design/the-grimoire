import type { Card, Condition, Finish } from '../types';
import { CONDITIONS, finishPrice, SOURCES, type NewItemInput } from '../lib/collection';

/** Condition / source / date shared by every card in a bulk add (paste, from a deck, scan). */
export interface Defaults {
  condition?: Condition;
  source?: string;
  acquiredAt?: string;
  useMarket: boolean;
}

export function DefaultsRow({ value, onChange }: { value: Defaults; onChange: (d: Defaults) => void }) {
  return (
    <div className="if-grid defaults-row">
      <label className="if-field"><span className="label">Condition</span>
        <select className="input" value={value.condition ?? ''} onChange={(e) => onChange({ ...value, condition: (e.target.value || undefined) as Condition | undefined })}>
          <option value="">Not set</option>
          {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
        </select>
      </label>
      <label className="if-field"><span className="label">Source</span>
        <input className="input" list="source-list" value={value.source ?? ''} onChange={(e) => onChange({ ...value, source: e.target.value || undefined })} placeholder="Not set" />
        <datalist id="source-list">{SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="if-field"><span className="label">Acquired</span>
        <input className="input" type="date" value={value.acquiredAt ?? ''} onChange={(e) => onChange({ ...value, acquiredAt: e.target.value || undefined })} />
      </label>
      <label className="radio"><input type="checkbox" checked={value.useMarket} onChange={(e) => onChange({ ...value, useMarket: e.target.checked })} /> Record today's market price as the price paid</label>
    </div>
  );
}

export const applyDefaults = (card: Card, finish: Finish, qty: number, d: Defaults): NewItemInput => ({
  card, finish, qty, condition: d.condition, source: d.source, acquiredAt: d.acquiredAt,
  purchasePrice: d.useMarket ? finishPrice(card, finish) ?? undefined : undefined,
});
