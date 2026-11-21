import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, Deck, DeckEntry } from '../src/types';
import { allowedOrigin, cleanRequest, handleCombos, MAX_CARDS, trimResponse, type Combo } from '../shared/spellbook';
import { checkCombos, comboRequest, currentCombos, deckSignature, resetCombosForTests, setCombosFetchForTests } from '../src/lib/combos';
import { estimateBracket } from '../src/lib/bracket';
import { card, freshDb } from './helpers';

const variant = (id: string, names: string[], tag: string, popularity = 1, extra: Record<string, unknown> = {}) => ({
  id, bracketTag: tag, popularity, manaNeeded: '{U}{U}{B}', description: 'Step one.\nStep two.', easyPrerequisites: 'All cards in hand.',
  uses: names.map((name) => ({ card: { name }, mustBeCommander: false })),
  produces: [{ feature: { name: 'Win the game' } }, { feature: { name: 'Exile your library' } }],
  ...extra,
});
const spellbookAnswer = {
  count: null, next: null, previous: null,
  results: {
    identity: 'UB',
    included: [variant('742-1295', ['Demonic Consultation', "Thassa's Oracle"], 'R', 151714), variant('1-2', ['Isochron Scepter', 'Dramatic Reversal'], 'S', 9000)],
    almostIncluded: [
      variant('9-9', ['Hullbreaker Horror', 'Sol Ring'], 'E', 50),
      variant('8-8', ['Two', 'Missing', 'Sol Ring'], 'C', 5000), // two cards missing: dropped
    ],
  },
};
const request = { commanders: ['Kinnan, Bonder Prodigy'], main: ['Demonic Consultation', "Thassa's Oracle", 'Isochron Scepter', 'Dramatic Reversal', 'Sol Ring'] };

describe('combo proxy (shared/spellbook.ts)', () => {
  it('accepts plain lists of card names only', () => {
    expect(cleanRequest({ commanders: ['A'], main: ['B', 'B', ' C '] })).toEqual({ commanders: ['A'], main: ['B', 'C'] });
    expect(cleanRequest({ main: ['Sol Ring'] })).toEqual({ commanders: [], main: ['Sol Ring'] });
    expect(cleanRequest({ main: [1] })).toMatch(/lists of card names/);
    expect(cleanRequest({ main: [] })).toBe('No cards');
    expect(cleanRequest({ commanders: ['a', 'b', 'c'], main: ['x'] })).toMatch(/two commanders/);
    expect(cleanRequest({ main: Array.from({ length: MAX_CARDS + 1 }, (_, i) => `Card ${i}`) })).toMatch(/At most/);
    expect(cleanRequest('nope')).toMatch(/JSON object/);
  });

  it('trims the answer: combos in the deck by popularity, and combos missing exactly one card', () => {
    const r = trimResponse(spellbookAnswer, request);
    expect(r.included.map((c) => c.id)).toEqual(['742-1295', '1-2']);
    expect(r.included[0]).toMatchObject({ cards: ['Demonic Consultation', "Thassa's Oracle"], tag: 'R', produces: ['Win the game', 'Exile your library'], missing: [], mana: '{U}{U}{B}' });
    expect(r.almost.map((c) => [c.id, c.missing])).toEqual([['9-9', ['Hullbreaker Horror']]]);
  });

  it('only serves the site, its previews and local servers', () => {
    expect(allowedOrigin('https://the-grimoire.app')).toBe(true);
    expect(allowedOrigin('https://combos.the-grimoire-4rq.pages.dev')).toBe(true);
    expect(allowedOrigin('http://localhost:5173')).toBe(true);
    expect(allowedOrigin('https://evil.example')).toBe(false);
    expect(allowedOrigin('https://the-grimoire.app.evil.example')).toBe(false);
    expect(allowedOrigin(null)).toBe(false);
  });

  const post = (body: unknown, origin = 'https://the-grimoire.app') =>
    new Request('https://the-grimoire.app/api/combos', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('forwards names to Spellbook and returns the trimmed answer', async () => {
    let sent: unknown;
    const res = await handleCombos(post(request), (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify(spellbookAnswer), { status: 200 });
    }) as typeof fetch);
    expect(res.status).toBe(200);
    expect(sent).toEqual({ commanders: [{ card: 'Kinnan, Bonder Prodigy' }], main: request.main.map((card) => ({ card })) });
    expect((await res.json()).included).toHaveLength(2);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses other sites, bad bodies and GETs, and reports Spellbook failures as 502', async () => {
    const never = (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch;
    expect((await handleCombos(post(request, 'https://evil.example'), never)).status).toBe(403);
    expect((await handleCombos(post({ main: 'x' }), never)).status).toBe(400);
    expect((await handleCombos(new Request('https://the-grimoire.app/api/combos'), never)).status).toBe(405);
    const down = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    expect((await handleCombos(post(request), down)).status).toBe(502);
    const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect((await handleCombos(post(request), offline)).status).toBe(502);
  });
});

describe('combo checks in the app', () => {
  let n = 0;
  const e = (c: Card, board: DeckEntry['board'] = 'main'): DeckEntry => ({ uid: `c${++n}`, qty: 1, board, card: c });
  const cmd = e(card('Kinnan, Bonder Prodigy', { type_line: 'Legendary Creature — Human Druid' }));
  const deck = (): Deck => ({
    id: 'combo-deck', name: 'C', format: 'commander', status: 'in-progress', createdAt: 0, updatedAt: 0, commanderUid: cmd.uid,
    entries: [cmd, e(card('Demonic Consultation')), e(card("Thassa's Oracle")), e(card('Isochron Scepter')), e(card('Dramatic Reversal')), e(card('Sol Ring')), e(card('Side Card'), 'side')],
  });
  beforeEach(async () => { await freshDb(); resetCombosForTests(); });

  it('sends the commander and the other main-deck names only', () => {
    expect(comboRequest(deck())).toEqual(request);
  });

  it('saves the answer with a signature that changes when the deck does', async () => {
    let sent: unknown;
    setCombosFetchForTests(async (_url, init) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify(trimResponse(spellbookAnswer, request)), { status: 200 });
    });
    const d = deck();
    await checkCombos(d);
    expect(sent).toEqual(request);
    const changed = { ...d, entries: d.entries.filter((x) => x.card.name !== 'Dramatic Reversal') };
    expect(deckSignature(changed)).not.toBe(deckSignature(d));
    // Combos that lost a card no longer count.
    const saved = { result: trimResponse(spellbookAnswer, request), signature: deckSignature(d), checkedAt: 1 };
    expect(currentCombos(changed, saved).map((c) => c.id)).toEqual(['742-1295']);
  });

  it('feeds the bracket estimate from Spellbook ratings', () => {
    const combos = trimResponse(spellbookAnswer, request).included;
    const est = estimateBracket(deck(), new Map(), combos);
    expect(est.floor).toBe(4);
    expect(est.combos.map((c) => [c.combo.id, c.bracket])).toEqual([['742-1295', 4], ['1-2', 3]]);
    expect(est.reasons.map((r) => r.bracket)).toEqual([4, 3]);
    const gentle: Combo[] = [{ ...combos[1], tag: 'E' }];
    expect(estimateBracket(deck(), new Map(), gentle).floor).toBe(1); // Exhibition combos don't raise it
  });
});
