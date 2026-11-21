import { useAllCardTags, useAllCollectionTags, useAllDeckTags, useAllGlobalTags } from '../lib/hooks';
import { SCRYFALL_TAGS } from '../lib/scryfallTags';
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  COMMON_TYPES, CRITERIA, EMPTY_ADV, FORMATS, GAMES, LANGUAGES, OPS, RARITIES, STATS,
  type Adv, type FormatRow, type TagMode, type Op, type PriceRow, type StatRow,
} from '../lib/advanced';
import { getSets, type SetInfo } from '../lib/scryfall';
import { ManaSymbol } from './Mana';

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];
const MANA_BUTTONS = ['W', 'U', 'B', 'R', 'G', 'C', 'X', 'S', 'W/U', 'B/G', 'W/P', '2/W'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="adv-section">
      <legend>{title}</legend>
      <div className="adv-grid">{children}</div>
    </fieldset>
  );
}

function Field({ label, wide, children, hint }: { label: string; wide?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className={`adv-field ${wide ? 'adv-wide' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

function ColorPicker({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <>
      {COLORS.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c} type="button" className={`pip-toggle ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`${label}: ${c}`}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
          >
            <ManaSymbol symbol={c} size={20} />
          </button>
        );
      })}
    </>
  );
}

function OpSelect({ value, onChange }: { value: Op; onChange: (v: Op) => void }) {
  return (
    <select className="input input-sm adv-op" value={value} onChange={(e) => onChange(e.target.value as Op)} aria-label="Comparison">
      {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Text box that turns each entry into a removable chip (Enter or the Add button). */
function ChipEntry({ placeholder, options, onAdd, label }: {
  placeholder: string; label: string; options: { value: string; label?: string }[]; onAdd: (v: string) => void;
}) {
  const [text, setText] = useState('');
  const listId = useId();
  const add = () => { if (text.trim()) { onAdd(text.trim()); setText(''); } };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  return (
    <div className="adv-inline">
      <input
        className="input" list={listId} value={text} placeholder={placeholder} aria-label={label}
        onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
      />
      <datalist id={listId}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
      <button type="button" className="btn btn-ghost btn-sm" onClick={add}>Add</button>
    </div>
  );
}

function RowList<T>({ rows, onChange, blank, render, addLabel }: {
  rows: T[]; onChange: (rows: T[]) => void; blank: T; addLabel: string;
  render: (row: T, set: (patch: Partial<T>) => void) => ReactNode;
}) {
  return (
    <div className="adv-rows">
      {rows.map((r, i) => (
        <div className="adv-inline" key={i}>
          {render(r, (patch) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x))))}
          {rows.length > 1 && (
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
          )}
        </div>
      ))}
      <button type="button" className="link-btn small" onClick={() => onChange([...rows, blank])}>+ {addLabel}</button>
    </div>
  );
}

/**
 * Scryfall's advanced search form (scryfall.com/advanced), shared by the main-page and deck searches.
 * The parent owns the state and folds buildAdvanced(value) into its query.
 */
export function AdvancedSearch({ value: a, onChange, collection = true }: {
  value: Adv; onChange: (a: Adv) => void; collection?: boolean;
}) {
  const set = (patch: Partial<Adv>) => onChange({ ...a, ...patch });
  const toggle = (key: 'games' | 'rarities', v: string) =>
    set({ [key]: a[key].includes(v) ? a[key].filter((x) => x !== v) : [...a[key], v] });

  const [sets, setSets] = useState<SetInfo[]>([]);
  useEffect(() => { let live = true; void getSets().then((s) => live && setSets(s)); return () => { live = false; }; }, []);
  const setName = (code: string) => sets.find((s) => s.code === code)?.name;
  const addSet = (v: string) => {
    const lower = v.toLowerCase();
    const hit = sets.find((s) => s.code === lower || s.name.toLowerCase() === lower);
    const code = hit?.code ?? lower;
    if (!a.sets.includes(code)) set({ sets: [...a.sets, code] });
  };

  const cycleCriterion = (k: string) => {
    const next = { ...a.criteria };
    if (!next[k]) next[k] = 'is';
    else if (next[k] === 'is') next[k] = 'not';
    else delete next[k];
    set({ criteria: next });
  };

  return (
    <div className="advanced">
      {collection && <TagsSection value={a} set={set} />}
      <Section title="Card">
        <Field label="Card name"><input className="input" value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Any words in the name" /></Field>
        {collection && (
          <Field label="Ownership">
            <select className="input" value={a.owned} onChange={(e) => set({ owned: e.target.value as Adv['owned'] })}>
              <option value="">Any</option>
              <option value="owned">In my collection</option>
              <option value="unowned">Not in my collection</option>
            </select>
          </Field>
        )}
        <Field label="Rules text" hint="Use ~ for the card's own name.">
          <input className="input" value={a.oracle} onChange={(e) => set({ oracle: e.target.value })} placeholder='e.g. draw a card' />
        </Field>
        <div className="adv-field adv-wide">
          <span className="label">Type line</span>
          <ChipEntry label="Add a type" placeholder="Creature, Legendary, Elf…" options={COMMON_TYPES.map((t) => ({ value: t }))}
            onAdd={(v) => a.types.some((t) => t.value.toLowerCase() === v.toLowerCase()) || set({ types: [...a.types, { value: v, mode: 'is' }] })} />
          {a.types.length > 0 && (
            <div className="adv-chips">
              {a.types.map((t, i) => (
                <span key={t.value} className={`chip ${t.mode === 'not' ? 'chip-not' : 'chip-on'}`}>
                  <button type="button" className="link-btn" title="Click to switch between is / is not"
                    onClick={() => set({ types: a.types.map((x, j) => (j === i ? { ...x, mode: x.mode === 'is' ? 'not' : 'is' } : x)) })}>
                    {t.mode === 'not' ? 'not ' : ''}{t.value}
                  </button>
                  <button type="button" className="link-btn" aria-label={`Remove ${t.value}`} onClick={() => set({ types: a.types.filter((_, j) => j !== i) })}>✕</button>
                </span>
              ))}
              {a.types.filter((t) => t.mode === 'is').length > 1 && (
                <select className="input input-sm" value={a.typesAny ? 'any' : 'all'} onChange={(e) => set({ typesAny: e.target.value === 'any' })} aria-label="Type matching">
                  <option value="all">Match all types</option>
                  <option value="any">Match any type</option>
                </select>
              )}
            </div>
          )}
          <span className="muted small">Click a type to exclude it instead.</span>
        </div>
      </Section>

      <Section title="Colors & cost">
        <div className="adv-field">
          <span className="label">Colors</span>
          <div className="adv-colors">
            <ColorPicker label="Color" value={a.colors} onChange={(colors) => set({ colors })} />
            <select className="input input-sm" value={a.colorMode} onChange={(e) => set({ colorMode: e.target.value as Adv['colorMode'] })} aria-label="Color match">
              <option value="exactly">Exactly these</option>
              <option value="including">Including these</option>
              <option value="atmost">At most these</option>
            </select>
          </div>
        </div>
        <div className="adv-field">
          <span className="label">Commander (color identity)</span>
          <div className="adv-colors"><ColorPicker label="Identity" value={a.identity} onChange={(identity) => set({ identity })} /></div>
        </div>
        <div className="adv-field adv-wide">
          <span className="label">Mana cost</span>
          <input className="input" value={a.mana} onChange={(e) => set({ mana: e.target.value })} placeholder="e.g. {2}{W}{W}" aria-label="Mana cost" />
          <div className="adv-colors adv-symbols">
            {MANA_BUTTONS.map((s) => (
              <button key={s} type="button" className="pip-toggle on" aria-label={`Add {${s}}`} onClick={() => set({ mana: `${a.mana}{${s}}` })}>
                <ManaSymbol symbol={s} size={18} />
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Stats">
        <div className="adv-field adv-wide">
          <RowList<StatRow>
            rows={a.stats} onChange={(stats) => set({ stats })} blank={{ stat: 'mv', op: '=', value: '' }} addLabel="Add stat"
            render={(r, upd) => (
              <>
                <select className="input input-sm adv-stat" value={r.stat} onChange={(e) => upd({ stat: e.target.value })} aria-label="Stat">
                  {STATS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <OpSelect value={r.op} onChange={(op) => upd({ op })} />
                <input className="input" value={r.value} onChange={(e) => upd({ value: e.target.value })} placeholder="number, or pow / tou" aria-label="Stat value" />
              </>
            )}
          />
        </div>
      </Section>

      <Section title="Legality & printing">
        <div className="adv-field adv-wide">
          <span className="label">Formats</span>
          <RowList<FormatRow>
            rows={a.formats} onChange={(formats) => set({ formats })} blank={{ status: 'f', format: '' }} addLabel="Add format"
            render={(r, upd) => (
              <>
                <select className="input input-sm adv-stat" value={r.status} onChange={(e) => upd({ status: e.target.value as FormatRow['status'] })} aria-label="Legality">
                  <option value="f">Legal in</option>
                  <option value="restricted">Restricted in</option>
                  <option value="banned">Banned in</option>
                </select>
                <select className="input adv-grow" value={r.format} onChange={(e) => upd({ format: e.target.value })} aria-label="Format">
                  <option value="">Any format</option>
                  {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </>
            )}
          />
        </div>
        <div className="adv-field">
          <span className="label">Games</span>
          <div className="adv-chips">
            {GAMES.map((g) => (
              <button key={g.value} type="button" className={`chip ${a.games.includes(g.value) ? 'chip-on' : ''}`} aria-pressed={a.games.includes(g.value)} onClick={() => toggle('games', g.value)}>{g.label}</button>
            ))}
          </div>
        </div>
        <div className="adv-field">
          <span className="label">Rarity</span>
          <div className="adv-chips">
            {RARITIES.map((r) => (
              <button key={r.value} type="button" className={`chip ${a.rarities.includes(r.value) ? 'chip-on' : ''}`} aria-pressed={a.rarities.includes(r.value)} onClick={() => toggle('rarities', r.value)}>{r.label}</button>
            ))}
          </div>
        </div>
        <div className="adv-field">
          <span className="label">Sets</span>
          <ChipEntry label="Add a set" placeholder="Set code or name" options={sets.map((s) => ({ value: s.code, label: s.name }))} onAdd={addSet} />
          {a.sets.length > 0 && (
            <div className="adv-chips">
              {a.sets.map((code) => (
                <span key={code} className="chip chip-on" title={setName(code)}>
                  {code.toUpperCase()}{setName(code) ? ` · ${setName(code)}` : ''}
                  <button type="button" className="link-btn" aria-label={`Remove ${code}`} onClick={() => set({ sets: a.sets.filter((x) => x !== code) })}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <Field label="Block"><input className="input" value={a.block} onChange={(e) => set({ block: e.target.value })} placeholder="e.g. zendikar or khm" /></Field>
        <Field label="Language">
          <select className="input" value={a.lang} onChange={(e) => set({ lang: e.target.value })}>
            <option value="">Default (English)</option>
            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </Field>
        <div className="adv-field adv-wide">
          <span className="label">Prices</span>
          <RowList<PriceRow>
            rows={a.prices} onChange={(prices) => set({ prices })} blank={{ currency: 'usd', op: '<=', value: '' }} addLabel="Add price"
            render={(r, upd) => (
              <>
                <select className="input input-sm adv-stat" value={r.currency} onChange={(e) => upd({ currency: e.target.value as PriceRow['currency'] })} aria-label="Currency">
                  <option value="usd">USD</option>
                  <option value="eur">EUR</option>
                  <option value="tix">MTGO tix</option>
                </select>
                <OpSelect value={r.op} onChange={(op) => upd({ op })} />
                <input className="input" type="number" min={0} step="0.01" value={r.value} onChange={(e) => upd({ value: e.target.value })} placeholder="any" aria-label="Price" />
              </>
            )}
          />
        </div>
      </Section>

      <Section title="Criteria">
        <div className="adv-field adv-wide">
          <span className="muted small">Click once to require, again to exclude, a third time to clear.</span>
          {CRITERIA.map((g) => {
            const active = g.items.filter((i) => a.criteria[i.value]).length;
            return (
              <details key={g.group} className="adv-criteria" open={active > 0 || undefined}>
                <summary>{g.group}{active > 0 && <span className="muted"> · {active} set</span>}</summary>
                <div className="adv-chips">
                  {g.items.map((i) => {
                    const mode = a.criteria[i.value];
                    return (
                      <button
                        key={i.value} type="button" onClick={() => cycleCriterion(i.value)}
                        className={`chip ${mode === 'is' ? 'chip-on' : mode === 'not' ? 'chip-not' : ''}`}
                        title={`is:${i.value}`}
                      >
                        {mode === 'not' ? 'not ' : ''}{i.label}
                      </button>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </Section>

      <Section title="Art & lore">
        <Field label="Artist"><input className="input" value={a.artist} onChange={(e) => set({ artist: e.target.value })} placeholder="e.g. Rebecca Guay" /></Field>
        <Field label="Flavor text"><input className="input" value={a.flavor} onChange={(e) => set({ flavor: e.target.value })} placeholder="Words in the flavor text" /></Field>
        <Field label="Lore finder" wide hint="Searches names, types, rules, flavor and artist at once.">
          <input className="input" value={a.lore} onChange={(e) => set({ lore: e.target.value })} placeholder="e.g. Urza" />
        </Field>
      </Section>

      <Section title="Results">
        <Field label="Show">
          <select className="input" value={a.unique} onChange={(e) => set({ unique: e.target.value as Adv['unique'] })}>
            <option value="cards">One per card</option>
            <option value="art">One per artwork</option>
            <option value="prints">Every printing</option>
          </select>
        </Field>
        <Field label="Sort direction">
          <select className="input" value={a.dir} onChange={(e) => set({ dir: e.target.value as Adv['dir'] })}>
            <option value="auto">Auto</option>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </Field>
        <label className="adv-check adv-wide">
          <input type="checkbox" checked={a.extras} onChange={(e) => set({ extras: e.target.checked })} />
          Include extras (tokens, emblems, art cards, planes…)
        </label>
      </Section>

      <div className="adv-actions">
        <button type="button" className="btn btn-ghost" onClick={() => onChange(EMPTY_ADV)}>Clear</button>
        <button type="submit" className="btn btn-primary">Apply</button>
      </div>
    </div>
  );
}

const TAG_MODES: { value: TagMode; label: string; hint: string }[] = [
  { value: 'all', label: 'All', hint: 'Cards with every selected tag' },
  { value: 'any', label: 'Any', hint: 'Cards with at least one selected tag' },
  { value: 'none', label: 'None', hint: 'Cards with none of the selected tags' },
];

/**
 * Pick tags to search by: Scryfall's automatic tags (in their colour) and every tag you've made
 * (global, card, collection, deck). Click to select; match all, any or none of them.
 */
function TagsSection({ value: a, set }: { value: Adv; set: (patch: Partial<Adv>) => void }) {
  const global = useAllGlobalTags();
  const card = useAllCardTags();
  const coll = useAllCollectionTags();
  const deck = useAllDeckTags();
  const scryfall = SCRYFALL_TAGS.map((t) => t.label);
  const own = [...new Set([...global, ...card, ...coll, ...deck])].filter((t) => !scryfall.includes(t)).sort((x, y) => x.localeCompare(y));
  const toggle = (t: string) => set({ tags: a.tags.includes(t) ? a.tags.filter((x) => x !== t) : [...a.tags, t] });
  const chip = (t: string, kind: 'scryfall' | 'own') => {
    const on = a.tags.includes(t);
    return (
      <button key={t} type="button" aria-pressed={on} onClick={() => toggle(t)}
        className={`tag-pick-chip ${kind} ${on ? 'on' : ''} ${on && a.tagMode === 'none' ? 'not' : ''}`}>
        {kind === 'scryfall' && <span aria-hidden>◆ </span>}{t}
      </button>
    );
  };
  return (
    <fieldset className="adv-section adv-tags">
      <legend>Tags</legend>
      <div className="adv-tags-head">
        <div className="status-toggle" role="radiogroup" aria-label="Match tags">
          {TAG_MODES.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={a.tagMode === m.value} title={m.hint}
              className={`seg ${a.tagMode === m.value ? 'on' : ''}`} onClick={() => set({ tagMode: m.value })}>{m.label}</button>
          ))}
        </div>
        <span className="muted small">{a.tags.length ? `${a.tags.length} selected` : 'Click tags to search by them'}</span>
        {a.tags.length > 0 && <button type="button" className="link-btn small" onClick={() => set({ tags: [] })}>Clear tags</button>}
      </div>
      <div className="tag-pick-group">
        <span className="label">Scryfall</span>
        <div className="tag-pick-chips">{scryfall.map((t) => chip(t, 'scryfall'))}</div>
      </div>
      <div className="tag-pick-group">
        <span className="label">Yours</span>
        <div className="tag-pick-chips">
          {own.length ? own.map((t) => chip(t, 'own')) : <span className="muted small">No tags yet. Tag a card with 🏷 and it shows here.</span>}
        </div>
      </div>
    </fieldset>
  );
}
