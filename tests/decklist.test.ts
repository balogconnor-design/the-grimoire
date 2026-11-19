import { describe, expect, it } from 'vitest';
import type { Card, Deck } from '../src/types';
import { exportDecklist, parseDecklist } from '../src/lib/actions';
import { getFormat } from '../src/lib/formats';
import { copyLimit, validateDeck } from '../src/lib/rules';
import { basic, card, hasFixture, readFixture } from './helpers';

const JHOIRA = 'jhoira-artifacts.txt';
const haveJhoira = hasFixture(JHOIRA);
if (!haveJhoira) console.warn(`tests/fixtures/${JHOIRA} is missing: the Jhoira tests are skipped until it is added.`);

describe('parseDecklist: sample with sideboard', () => {
  const lines = parseDecklist(readFixture('sample-with-sideboard.txt'));

  it('reads every section', () => {
    expect(lines.map((l) => [l.qty, l.name, l.board, l.commander])).toEqual([
      [1, "Atraxa, Praetors' Voice", 'main', true],
      [1, 'Sol Ring', 'main', false],
      [1, 'Arcane Signet', 'main', false],
      [1, 'Fire // Ice', 'main', false],
      [10, 'Forest', 'main', false],
      [2, 'Swords to Plowshares', 'side', false],
      [1, 'Path to Exile', 'side', false],
      [1, 'Doubling Season', 'maybe', false],
    ]);
  });

  it('keeps set and collector number, and full two-faced names', () => {
    expect(lines[2]).toMatchObject({ set: 'cmm', collector: '361' });
    expect(lines[3].name).toBe('Fire // Ice');
  });
});

describe.skipIf(!haveJhoira)('Jhoira fixture', () => {
  const text = haveJhoira ? readFixture(JHOIRA) : '';
  const lines = parseDecklist(text);

  it('parses 1 commander, 79 single-copy cards, 15 Island and 5 Mountain', () => {
    const cmd = lines.filter((l) => l.commander);
    expect(cmd).toHaveLength(1);
    expect(cmd[0].name).toBe('Jhoira, Ageless Innovator');
    const rest = lines.filter((l) => !l.commander);
    expect(rest.filter((l) => l.qty === 1 && l.name !== 'Island' && l.name !== 'Mountain')).toHaveLength(79);
    expect(rest.find((l) => l.name === 'Island')?.qty).toBe(15);
    expect(rest.find((l) => l.name === 'Mountain')?.qty).toBe(5);
    expect(lines.reduce((n, l) => n + l.qty, 0)).toBe(100);
    expect(lines.every((l) => l.board === 'main')).toBe(true);
  });

  /** Build the deck with stand-in card data (no network): legal, colorless or U/R cards. */
  function jhoiraDeck(): Deck {
    const toCard = (name: string): Card =>
      name === 'Island' || name === 'Mountain' ? basic(name)
        : name === 'Jhoira, Ageless Innovator'
          ? card(name, { type_line: 'Legendary Creature — Human Artificer', color_identity: ['U', 'R'], mana_cost: '{U}{R}' })
          : card(name);
    const entries = lines.map((l, i) => ({ uid: `e${i}`, qty: l.qty, board: l.board, card: toCard(l.name) }));
    return {
      id: 'jhoira', name: 'Jhoira, Ageless Innovator', format: 'commander', status: 'in-progress', createdAt: 0, updatedAt: 0,
      entries, commanderUid: entries[lines.findIndex((l) => l.commander)].uid,
    };
  }

  it('validateDeck: a legal 100-card Commander deck', () => {
    const v = validateDeck(jhoiraDeck());
    const size = v.requirements.find((r) => r.label.includes('100'));
    expect(size?.ok).toBe(true);
    expect(v.legal).toBe(true);
  });

  it('copyLimit: basics unlimited, everything else singleton', () => {
    const fmt = getFormat('commander');
    const deck = jhoiraDeck();
    for (const e of deck.entries) {
      const expected = e.card.name === 'Island' || e.card.name === 'Mountain' ? Infinity : 1;
      expect(copyLimit(e.card, fmt)).toBe(expected);
      if (expected === 1) expect(e.qty).toBeLessThanOrEqual(1);
    }
  });

  it('exportDecklist round trip keeps every card name and quantity', () => {
    const qty = (t: string) => {
      const m = new Map<string, number>();
      for (const l of parseDecklist(t)) m.set(l.name, (m.get(l.name) ?? 0) + l.qty);
      return m;
    };
    expect(qty(exportDecklist(jhoiraDeck()))).toEqual(qty(text));
  });
});
