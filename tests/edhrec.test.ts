import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  edhrecSlug, ensureSalt, getCommanderData, parseCommander, parseSalt, resetEdhrecForTests, saltOf, setEdhrecFetchForTests,
  SALT_MAX_AGE, COMMANDER_MAX_AGE,
} from '../src/lib/edhrec';
import { freshDb } from './helpers';

const page = (cardlists: unknown[], card?: unknown) => ({ container: { json_dict: { cardlists, card } } });
const saltPage = page([{ header: '', cardviews: [
  { name: 'Stasis', salt: 3.0530035 },
  { name: 'Boom // Bust', salt: 2.1 },
  { name: 'Plains', salt: 0 },
] }]);
const atraxaPage = page([
  { header: 'Top Cards', cardviews: [{ name: 'Sol Ring', num_decks: 900, potential_decks: 1000, synergy: 0.01 }] },
  { header: 'Creatures', cardviews: [
    { name: 'Sol Ring', num_decks: 1, potential_decks: 1, synergy: 0 }, // listed again: first one wins
    { name: 'Deepglow Skate', num_decks: 300, potential_decks: 1000, synergy: 0.25 },
    { name: 'Broken', num_decks: 5 },
  ] },
], { num_decks: 46414 });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('EDHREC parsing', () => {
  it('builds EDHREC slugs', () => {
    expect(edhrecSlug("Atraxa, Praetors' Voice")).toBe('atraxa-praetors-voice');
    expect(edhrecSlug('Jötun Grunt')).toBe('jotun-grunt');
    expect(edhrecSlug('Esika, God of the Tree // The Prismatic Bridge')).toBe('esika-god-of-the-tree');
    expect(edhrecSlug('Y’shtola, Night’s Blessed')).toBe('yshtola-nights-blessed');
  });

  it('keeps cards with a salt score', () => {
    expect(parseSalt(saltPage)).toEqual([['Stasis', 3.05], ['Boom // Bust', 2.1]]);
    expect(parseSalt({})).toEqual([]);
  });

  it('lists each suggested card once with inclusion and synergy', () => {
    const d = parseCommander("Atraxa, Praetors' Voice", atraxaPage, 1);
    expect(d.decks).toBe(46414);
    expect(d.suggestions).toEqual([
      { name: 'Sol Ring', inclusion: 0.9, synergy: 0.01, list: 'Top Cards' },
      { name: 'Deepglow Skate', inclusion: 0.3, synergy: 0.25, list: 'Creatures' },
    ]);
  });
});

describe('EDHREC downloads', () => {
  let calls: string[];
  let respond: (url: string) => Response | Promise<Response>;
  beforeEach(async () => {
    await freshDb();
    resetEdhrecForTests();
    calls = [];
    respond = () => json({}, 500);
    setEdhrecFetchForTests(async (url) => { calls.push(url); return respond(url); });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('downloads the salt list once, saves it, and reads it back without the network', async () => {
    respond = () => json(saltPage);
    await ensureSalt();
    expect(calls).toEqual(['https://json.edhrec.com/pages/top/salt-1.json']);
    expect(saltOf('Stasis')).toBe(3.05);
    expect(saltOf('Boom')).toBe(2.1); // front face of a split card

    resetEdhrecForTests(); // a new visit: memory empty, IndexedDB kept
    await ensureSalt();
    expect(calls).toHaveLength(1);
    expect(saltOf('Stasis')).toBe(3.05);
  });

  it('refreshes salt after a week, and keeps the old list quietly when that fails', async () => {
    respond = () => json(saltPage);
    await ensureSalt();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + SALT_MAX_AGE + 1000);
    respond = () => { throw new TypeError('Failed to fetch'); };
    await ensureSalt();
    expect(calls).toHaveLength(2);
    expect(saltOf('Stasis')).toBe(3.05);
  });

  it('caches a commander page for a day, then refetches; unknown commanders give null', async () => {
    respond = (url) => (url.endsWith('/atraxa-praetors-voice.json') ? json(atraxaPage) : json({}, 404));
    const a = await getCommanderData("Atraxa, Praetors' Voice");
    expect(a?.suggestions).toHaveLength(2);
    await getCommanderData("Atraxa, Praetors' Voice");
    expect(calls).toEqual(['https://json.edhrec.com/pages/commanders/atraxa-praetors-voice.json']);
    expect(await getCommanderData('Nobody Special')).toBeNull();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + COMMANDER_MAX_AGE + 1000);
    respond = () => json({}, 503);
    const stale = await getCommanderData("Atraxa, Praetors' Voice"); // fails, falls back to the saved copy
    expect(stale?.decks).toBe(46414);
    expect(calls.filter((u) => u.includes('atraxa'))).toHaveLength(2);
  });

  it('throws when a commander page fails and nothing is saved', async () => {
    respond = () => json({}, 503);
    await expect(getCommanderData('Krenko, Mob Boss')).rejects.toThrow('503');
  });
});
