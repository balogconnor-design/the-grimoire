import { useState } from 'react';
import type { Deck } from '../types';
import { getFormat } from '../lib/formats';
import { BASIC_FOR_COLOR, deckIdentity } from '../lib/rules';
import { addBasics } from '../lib/actions';
import { ManaSymbol } from './Mana';
import { useToast } from './Toast';

/**
 * Adds basic lands. In commander formats only basics matching the commander's color identity
 * are offered (rule 903.5c); a colorless commander may only use Wastes.
 */
export function BasicLandAdder({ deck, onDone }: { deck: Deck; onDone?: () => void }) {
  const fmt = getFormat(deck.format);
  const identity = deckIdentity(deck);
  const toast = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  let colors: string[];
  let note = '';
  if (fmt.hasCommander) {
    if (!identity) {
      return <div className="basic-adder muted small">Choose a commander first — basic lands are limited to its color identity.</div>;
    }
    colors = identity.length ? ['W', 'U', 'B', 'R', 'G'].filter((c) => identity.includes(c)) : ['C'];
    note = identity.length ? "Limited to your commander's colors" : 'Colorless commander: Wastes only';
  } else {
    colors = ['W', 'U', 'B', 'R', 'G', 'C'];
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const set = (c: string, n: number) => setCounts((x) => ({ ...x, [c]: Math.max(0, Math.min(99, n)) }));

  const submit = async () => {
    setBusy(true);
    try {
      await addBasics(deck.id, counts);
      toast(`Added ${total} basic land${total === 1 ? '' : 's'}`, 'success');
      setCounts({});
      onDone?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="basic-adder">
      <div className="basic-grid">
        {colors.map((c) => (
          <div key={c} className="basic-item">
            <ManaSymbol symbol={c} size={22} />
            <span className="basic-name">{BASIC_FOR_COLOR[c]}</span>
            <div className="stepper">
              <button className="icon-btn" onClick={() => set(c, (counts[c] ?? 0) - 1)} aria-label={`Fewer ${BASIC_FOR_COLOR[c]}`}>−</button>
              <input
                className="input stepper-input" type="number" min={0} value={counts[c] ?? 0}
                onChange={(e) => set(c, parseInt(e.target.value, 10) || 0)} aria-label={`${BASIC_FOR_COLOR[c]} count`}
              />
              <button className="icon-btn" onClick={() => set(c, (counts[c] ?? 0) + 1)} aria-label={`More ${BASIC_FOR_COLOR[c]}`}>+</button>
            </div>
          </div>
        ))}
      </div>
      <div className="basic-foot">
        {note && <span className="muted small">{note}</span>}
        <button className="btn btn-primary" disabled={!total || busy} onClick={submit}>
          {busy ? 'Adding…' : `Add ${total || ''} land${total === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
