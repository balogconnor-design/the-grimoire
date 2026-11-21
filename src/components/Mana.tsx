import { Fragment, useState } from 'react';
import { symbolUrl } from '../lib/scryfall';
import { parseSymbols, COLOR_NAMES } from '../lib/rules';

export function ManaSymbol({ symbol, size = 16 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="mana-symbol mana-symbol-text" style={{ minWidth: size, height: size, fontSize: Math.max(9, size * 0.62) }} title={`{${symbol}}`}>{symbol}</span>;
  }
  return (
    <img
      className="mana-symbol"
      src={symbolUrl(symbol)}
      alt={`{${symbol}}`}
      title={`{${symbol}}`}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function ManaCost({ cost, size = 16 }: { cost?: string; size?: number }) {
  if (!cost) return null;
  const faces = cost.split(' // ');
  return (
    <span className="mana-cost">
      {faces.map((face, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="mana-sep">//</span>}
          {parseSymbols(face).map((s, j) => (
            <ManaSymbol key={j} symbol={s} size={size} />
          ))}
        </Fragment>
      ))}
    </span>
  );
}

/** Color identity as a row of pips. Empty identity shows the colorless symbol. */
export function ColorPips({ colors, size = 18 }: { colors: string[]; size?: number }) {
  const ordered = ['W', 'U', 'B', 'R', 'G'].filter((c) => colors.includes(c));
  const label = ordered.length ? ordered.map((c) => COLOR_NAMES[c]).join(', ') : 'Colorless';
  return (
    <span className="color-pips" title={label} aria-label={label}>
      {(ordered.length ? ordered : ['C']).map((c) => (
        <ManaSymbol key={c} symbol={c} size={size} />
      ))}
    </span>
  );
}

/** Rules text with {X} symbols rendered inline, and reminder text italicized. */
export function OracleText({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="oracle-text">
      {text.split('\n').map((para, i) => (
        <p key={i}>{renderInline(para)}</p>
      ))}
    </div>
  );
}

function renderInline(s: string) {
  const parts = s.split(/(\{[^}]+\}|\([^)]*\))/g);
  return parts.map((p, i) => {
    if (/^\{[^}]+\}$/.test(p)) return <ManaSymbol key={i} symbol={p.slice(1, -1)} size={14} />;
    if (/^\(.*\)$/.test(p)) return <em key={i} className="reminder">({renderSymbolsOnly(p.slice(1, -1))})</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

function renderSymbolsOnly(s: string) {
  return s.split(/(\{[^}]+\})/g).map((p, i) =>
    /^\{[^}]+\}$/.test(p) ? <ManaSymbol key={i} symbol={p.slice(1, -1)} size={13} /> : <Fragment key={i}>{p}</Fragment>,
  );
}
