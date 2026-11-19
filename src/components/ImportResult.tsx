import type { ImportResult } from '../lib/actions';

/** Added count plus the cards that couldn't be found, each with a button that searches for it. */
export function ImportResultView({ result, onSearch }: { result: ImportResult; onSearch: (name: string) => void }) {
  const missingCards = result.missing.reduce((n, m) => n + m.qty, 0);
  return (
    <div className={`alert ${result.missing.length ? 'alert-error' : ''} import-result`}>
      <div>
        Imported <b>{result.added}</b> of {result.cards} card{result.cards === 1 ? '' : 's'}
        {result.missing.length > 0 && <> · couldn't find {missingCards} ({result.missing.length} line{result.missing.length === 1 ? '' : 's'})</>}.
      </div>
      {result.missing.length > 0 && (
        <ul className="import-missing">
          {result.missing.map((m, i) => (
            <li key={`${m.name}-${i}`}>
              <span>{m.qty > 1 ? `${m.qty}× ` : ''}{m.name}</span>
              <button type="button" className="btn btn-sm" onClick={() => onSearch(m.name)} title={`Search for ${m.name}`}>⌕ Search</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
