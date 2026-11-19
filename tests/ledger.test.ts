import { describe, expect, it } from 'vitest';
import { realizedPL, splitCost, splitTotal } from '../src/lib/collection';
import { periodOf, summarizeByPeriod, summaryToCSV } from '../src/lib/ledger';
import { tx } from './helpers';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('splitTotal', () => {
  it('splits in proportion to weight × qty', () => {
    const s = splitTotal(100, [{ weight: 3, qty: 1 }, { weight: 1, qty: 2 }]);
    expect(s[0]).toBeCloseTo(60);
    expect(s[1]).toBeCloseTo(40);
    expect(sum(s)).toBeCloseTo(100);
  });

  it('falls back to an even split per copy when every weight is zero', () => {
    const s = splitTotal(30, [{ weight: 0, qty: 1 }, { weight: 0, qty: 2 }]);
    expect(s).toEqual([10, 20]);
  });

  it('gives zero-weight lines nothing when others are priced', () => {
    const s = splitTotal(50, [{ weight: 0, qty: 3 }, { weight: 2, qty: 1 }]);
    expect(s).toEqual([0, 50]);
  });

  it('treats negative weights as zero and handles no copies', () => {
    expect(splitTotal(10, [{ weight: -5, qty: 1 }, { weight: 5, qty: 1 }])).toEqual([0, 10]);
    expect(splitTotal(10, [])).toEqual([]);
    expect(splitTotal(10, [{ weight: 0, qty: 0 }])).toEqual([0]);
  });
});

describe('splitCost (buyDeck cost basis)', () => {
  const cents = (groups: { qty: number; each: number }[][]) => sum(groups.flat().map((g) => Math.round(g.each * 100) * g.qty));

  it('per-copy costs add up exactly to the deck price', () => {
    const lines = [{ weight: 9.99, qty: 1 }, { weight: 3.33, qty: 1 }, { weight: 0.1, qty: 15 }, { weight: 1.27, qty: 1 }, { weight: 0, qty: 5 }];
    for (const price of [49.99, 100, 0.01, 333.33, 7]) expect(cents(splitCost(price, lines))).toBe(Math.round(price * 100));
  });

  it('puts the rounding remainder on the line with the largest value', () => {
    const g = splitCost(10, [{ weight: 1, qty: 1 }, { weight: 1, qty: 1 }, { weight: 2, qty: 1 }]);
    expect(g[0][0].each).toBe(2.5);
    expect(g[2][0].each).toBe(5);
    const h = splitCost(1, [{ weight: 1, qty: 1 }, { weight: 1, qty: 1 }, { weight: 1.001, qty: 1 }]);
    expect(h[0][0].each).toBe(0.33);
    expect(h[1][0].each).toBe(0.33);
    expect(h[2][0].each).toBe(0.34); // largest line absorbs the extra cent
  });

  it('splits a multi-copy line when the remainder is not divisible by its qty', () => {
    const g = splitCost(1, [{ weight: 1, qty: 3 }]);
    expect(g[0]).toEqual([{ qty: 2, each: 0.33 }, { qty: 1, each: 0.34 }]);
  });

  it('works with zero weights everywhere', () => {
    const g = splitCost(10, [{ weight: 0, qty: 1 }, { weight: 0, qty: 2 }]);
    expect(cents(g)).toBe(1000);
  });
});

describe('periodOf', () => {
  it('weeks start on Monday', () => {
    expect(periodOf('2026-11-16', 'week').key).toBe('2026-11-16'); // Monday
    expect(periodOf('2026-11-19', 'week').key).toBe('2026-11-16'); // Thursday
    expect(periodOf('2026-11-22', 'week').key).toBe('2026-11-16'); // Sunday belongs to the week before
    expect(periodOf('2026-11-23', 'week').key).toBe('2026-11-23');
    expect(periodOf('2027-01-01', 'week')).toEqual({ key: '2026-12-28', label: 'Week of Dec 28, 2026' }); // across a year
  });
  it('month, quarter and year', () => {
    expect(periodOf('2026-02-28', 'month')).toEqual({ key: '2026-02', label: 'Feb 2026' });
    expect(periodOf('2026-03-31', 'quarter')).toEqual({ key: '2026-Q1', label: 'Q1 2026' });
    expect(periodOf('2026-04-01', 'quarter').key).toBe('2026-Q2');
    expect(periodOf('2026-12-31', 'quarter').key).toBe('2026-Q4');
    expect(periodOf('2026-07-04', 'year')).toEqual({ key: '2026', label: '2026' });
  });
});

describe('summarizeByPeriod and earnings', () => {
  const txs = [
    tx({ kind: 'sold', date: '2026-03-02', qty: 2, price: 10, costBasis: 4 }),
    tx({ kind: 'traded', date: '2026-03-05', qty: 3, price: 5, costBasis: 1 }),
    tx({ kind: 'received', date: '2026-03-05', qty: 1, price: 15 }),
    tx({ kind: 'bought', date: '2026-03-10', qty: 4, price: 2.5 }),
    tx({ kind: 'sold', date: '2026-05-01', qty: 1, price: 8 }), // unknown cost
  ];

  it('excludes traded rows from the earnings totals by default', () => {
    const [may, mar] = summarizeByPeriod(txs, 'month');
    expect(mar.key).toBe('2026-03');
    expect(mar).toMatchObject({ sales: 1, copiesOut: 2, proceeds: 20, cost: 8, pl: 12, bought: 1, copiesIn: 4, spent: 10 });
    expect(mar).toMatchObject({ trades: 1, tradeCards: 3, tradeValue: 15, tradesIn: 1, tradeCardsIn: 1, tradeValueIn: 15 });
    expect(mar.pct).toBeCloseTo(150);
    expect(may).toMatchObject({ sales: 1, proceeds: 8, unknownCost: 1, trades: 0 });
  });

  it('can include trades when asked', () => {
    const [, mar] = summarizeByPeriod(txs, 'month', { includeTrades: true });
    expect(mar).toMatchObject({ sales: 2, copiesOut: 5, proceeds: 35, pl: 24 });
  });

  it('summaryToCSV totals exclude trades and add separate traded-away and received lines', () => {
    const csv = summaryToCSV(txs, 'quarter');
    const lines = csv.trim().split('\n');
    expect(lines[0].split(',')[1]).toBe('Sales');
    const total = lines.find((l) => l.startsWith('TOTAL,'))!.split(',');
    expect(total.slice(1, 4)).toEqual(['2', '3', '28.00']); // 2 sales, 3 cards out, $28 proceeds
    expect(lines.slice(-2)).toEqual(['TRADED AWAY,1,3,15.00', 'RECEIVED IN TRADE,1,1,15.00']);
  });

  it('realizedPL excludes trades by default and reports them separately', () => {
    const r = realizedPL(txs);
    expect(r).toMatchObject({ proceeds: 28, cost: 8, pl: 12, count: 2, copies: 3 });
    expect(r.trades).toEqual({ count: 2, out: { count: 1, cards: 3, value: 15 }, in: { count: 1, cards: 1, value: 15 } });
    expect(realizedPL(txs, { includeTrades: true })).toMatchObject({ proceeds: 43, count: 3 });
  });
});
