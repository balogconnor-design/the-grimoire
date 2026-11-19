import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * A <table> that copies each column's header text onto its body cells as `data-label`.
 * On phones, `.inv-table` stacks each row into a card and shows those labels next to the values
 * (see "Tables on phones" in styles.css), since the column headers are hidden there.
 */
export function LabeledTable({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const heads = [...table.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').replace(/[↑↓]/g, '').trim());
    for (const row of table.querySelectorAll('tbody tr')) {
      let col = 0;
      for (const cell of row.children as HTMLCollectionOf<HTMLTableCellElement>) {
        const label = heads[col];
        if (label && cell.colSpan === 1) cell.setAttribute('data-label', label);
        else cell.removeAttribute('data-label');
        col += cell.colSpan || 1;
      }
    }
  });
  return <table ref={ref} className={className}>{children}</table>;
}
