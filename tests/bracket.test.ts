import { describe, expect, it } from 'vitest';
import type { Card, Deck, DeckEntry } from '../src/types';
import { cleanTargetBracket, estimateBracket } from '../src/lib/bracket';
import { parseBackup } from '../src/lib/backup';
import { card } from './helpers';

let n = 0;
const e = (c: Card, board: DeckEntry['board'] = 'main'): DeckEntry => ({ uid: `b${++n}`, qty: 1, board, card: c });
const deckOf = (entries: DeckEntry[], extra: Partial<Deck> = {}): Deck =>
  ({ id: 'd', name: 'B', format: 'commander', status: 'building', entries, createdAt: 0, updatedAt: 0, ...extra }) as Deck;
const gc = (name: string) => card(name, { game_changer: true });

const tags = new Map<string, string[]>([
  ['Armageddon', ['mass land denial', 'land destruction']],
  ['Stone Rain', ['land destruction']],
  ['Time Warp', ['extra turn']],
  ['Temporal Manipulation', ['extra turn']],
  ['Capture of Jingzhou', ['extra turn']],
]);

describe('bracket estimate', () => {
  it('puts a deck with nothing restricted in Bracket 1–2', () => {
    const est = estimateBracket(deckOf([e(card('Sol Ring')), e(card('Stone Rain'))]), tags);
    expect(est.floor).toBe(1);
    expect(est.reasons).toEqual([]);
    expect(est.landDestruction).toEqual(['Stone Rain']); // listed, but no bracket rule
  });

  it('counts Game Changers: 1–3 is Bracket 3, more is Bracket 4', () => {
    const three = [gc('Rhystic Study'), gc('Cyclonic Rift'), gc('Smothering Tithe')].map((c) => e(c));
    expect(estimateBracket(deckOf(three), tags).floor).toBe(3);
    const four = estimateBracket(deckOf([...three, e(gc('Demonic Tutor'))]), tags);
    expect(four.floor).toBe(4);
    expect(four.gameChangers).toEqual(['Cyclonic Rift', 'Demonic Tutor', 'Rhystic Study', 'Smothering Tithe']);
  });

  it('ignores the sideboard and maybeboard but counts the commander', () => {
    const cmd = e(gc('Kinnan, Bonder Prodigy'));
    const est = estimateBracket(deckOf([cmd, e(gc('Mana Vault'), 'side'), e(gc('Grim Monolith'), 'maybe')], { commanderUid: cmd.uid }), tags);
    expect(est.gameChangers).toEqual(['Kinnan, Bonder Prodigy']);
  });

  it('puts mass land denial in Bracket 4 and lists it once', () => {
    const est = estimateBracket(deckOf([e(card('Armageddon'))]), tags);
    expect(est.floor).toBe(4);
    expect(est.massLandDenial).toEqual(['Armageddon']);
    expect(est.landDestruction).toEqual([]);
  });

  it('allows a few extra-turn cards from Bracket 2, many only from Bracket 4', () => {
    expect(estimateBracket(deckOf([e(card('Time Warp'))]), tags).floor).toBe(2);
    expect(estimateBracket(deckOf([e(card('Time Warp')), e(card('Temporal Manipulation')), e(card('Capture of Jingzhou'))]), tags).floor).toBe(4);
  });

  it('orders reasons from the highest bracket down', () => {
    const est = estimateBracket(deckOf([e(gc('Rhystic Study')), e(card('Time Warp')), e(card('Armageddon'))]), tags);
    expect(est.reasons.map((r) => r.bracket)).toEqual([4, 3, 2]);
  });
});

describe('target bracket', () => {
  it('accepts only whole numbers 1–5', () => {
    expect(cleanTargetBracket(3)).toBe(3);
    expect([0, 6, 2.5, '3', null, undefined].map(cleanTargetBracket)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('survives a backup and drops bad values', () => {
    const decks = [
      { id: 'a', name: 'A', format: 'commander', entries: [], targetBracket: 2 },
      { id: 'b', name: 'B', format: 'commander', entries: [], targetBracket: 9 },
    ];
    const { backup } = parseBackup(JSON.stringify({ app: 'deckforge', version: 1, decks }));
    expect(backup.decks[0].targetBracket).toBe(2);
    expect('targetBracket' in backup.decks[1]).toBe(false);
  });
});
