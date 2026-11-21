/**
 * Commander Spellbook combo lookup, shared by the Cloudflare Pages Function (functions/api/combos.ts),
 * the dev/preview server plugin (vite.config.ts) and the app. Spellbook's API sends no CORS header, so
 * browsers can't call it directly; this small proxy forwards card names only and trims the answer.
 * Nothing is stored or logged.
 */
export const SPELLBOOK_URL = 'https://backend.commanderspellbook.com/find-my-combos';
export const MAX_CARDS = 250;
const MAX_NAME = 200;
/** "One card away" combos kept in the answer, most popular first. */
export const MAX_ALMOST = 40;

/** Spellbook's own rating of a combo, named after the brackets. */
export type ComboTag = 'E' | 'C' | 'O' | 'P' | 'S' | 'R' | 'B';
export const COMBO_TAG_LABEL: Record<ComboTag, string> = {
  E: 'Exhibition', C: 'Core', O: 'Oddball', P: 'Powerful', S: 'Spicy', R: 'Ruthless', B: 'Banned',
};

export interface Combo {
  id: string;
  /** Every card the combo uses, in Spellbook's order. */
  cards: string[];
  /** Cards that must be the commander. */
  commanderCards: string[];
  /** What it does, e.g. "Infinite colorless mana", "Win the game". */
  produces: string[];
  tag: ComboTag | null;
  popularity: number;
  /** Mana needed to start it, e.g. "{U}{U}{B}". */
  mana: string;
  prerequisites: string;
  steps: string;
  /** Cards of the combo that aren't in the deck (one card for "almost" combos). */
  missing: string[];
}
export interface ComboResult { included: Combo[]; almost: Combo[] }
export interface ComboRequest { commanders: string[]; main: string[] }

/** Check and tidy a request body. Returns an error message for anything that isn't a plain list of card names. */
export function cleanRequest(body: unknown): ComboRequest | string {
  if (!body || typeof body !== 'object') return 'Expected a JSON object';
  const b = body as Record<string, unknown>;
  const list = (v: unknown): string[] | null => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim() && x.length <= MAX_NAME)) return null;
    return [...new Set(v.map((x: string) => x.trim()))];
  };
  const commanders = list(b.commanders);
  const main = list(b.main);
  if (!commanders || !main) return 'commanders and main must be lists of card names';
  if (commanders.length > 2) return 'At most two commanders';
  if (commanders.length + main.length === 0) return 'No cards';
  if (commanders.length + main.length > MAX_CARDS) return `At most ${MAX_CARDS} cards`;
  return { commanders, main };
}

/** The body Spellbook expects. */
export const spellbookBody = (r: ComboRequest) =>
  ({ commanders: r.commanders.map((card) => ({ card })), main: r.main.map((card) => ({ card })) });

interface RawVariant {
  id?: string;
  uses?: { card?: { name?: string }; mustBeCommander?: boolean }[];
  produces?: { feature?: { name?: string } }[];
  bracketTag?: string;
  popularity?: number | null;
  manaNeeded?: string;
  easyPrerequisites?: string;
  notablePrerequisites?: string;
  description?: string;
}

const TAGS = new Set(Object.keys(COMBO_TAG_LABEL));
function trimVariant(v: RawVariant, inDeck: Set<string>): Combo | null {
  const cards = (v.uses ?? []).map((u) => u.card?.name).filter((n): n is string => !!n);
  if (!v.id || !cards.length) return null;
  const has = (n: string) => inDeck.has(n.toLowerCase()) || inDeck.has(n.split(' // ')[0].toLowerCase());
  return {
    id: v.id,
    cards,
    commanderCards: (v.uses ?? []).filter((u) => u.mustBeCommander && u.card?.name).map((u) => u.card!.name!),
    produces: (v.produces ?? []).map((p) => p.feature?.name).filter((n): n is string => !!n),
    tag: v.bracketTag && TAGS.has(v.bracketTag) ? (v.bracketTag as ComboTag) : null,
    popularity: v.popularity ?? 0,
    mana: v.manaNeeded ?? '',
    prerequisites: [v.easyPrerequisites, v.notablePrerequisites].filter(Boolean).join('\n'),
    steps: v.description ?? '',
    missing: cards.filter((n) => !has(n)),
  };
}

/** Keep what the app shows: combos in the deck, and the most popular combos one card away (within the deck's colors). */
export function trimResponse(raw: unknown, req: ComboRequest): ComboResult {
  const results = (raw as { results?: { included?: RawVariant[]; almostIncluded?: RawVariant[] } })?.results ?? {};
  const inDeck = new Set([...req.commanders, ...req.main].flatMap((n) => [n.toLowerCase(), n.split(' // ')[0].toLowerCase()]));
  const trim = (list: RawVariant[] | undefined) => (list ?? []).map((v) => trimVariant(v, inDeck)).filter((c): c is Combo => !!c);
  const byPopularity = (a: Combo, b: Combo) => b.popularity - a.popularity;
  return {
    included: trim(results.included).sort(byPopularity),
    almost: trim(results.almostIncluded).filter((c) => c.missing.length === 1).sort(byPopularity).slice(0, MAX_ALMOST),
  };
}

/** Origins allowed to use the proxy: the site, its Pages preview addresses, and local dev/preview servers. */
export function allowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return origin === 'https://the-grimoire.app'
    || /^https:\/\/([a-z0-9-]+\.)?the-grimoire-4rq\.pages\.dev$/.test(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/**
 * Handle POST /api/combos: check the caller and body, ask Spellbook, return the trimmed answer.
 * `fetcher` is the network (replaced in tests).
 */
export async function handleCombos(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Use POST' });
  if (!allowedOrigin(request.headers.get('origin'))) return json(403, { error: 'Not allowed' });
  let body: unknown;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const req = cleanRequest(body);
  if (typeof req === 'string') return json(400, { error: req });
  let res: Response;
  try {
    res = await fetcher(SPELLBOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'TheGrimoire-combo-proxy' },
      body: JSON.stringify(spellbookBody(req)),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return json(502, { error: 'Commander Spellbook could not be reached' });
  }
  if (!res.ok) return json(502, { error: `Commander Spellbook answered ${res.status}` });
  return json(200, trimResponse(await res.json(), req));
}
