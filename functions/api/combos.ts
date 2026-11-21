// Cloudflare Pages Function: POST /api/combos (The Grimoire's only server code).
// Forwards a deck's card names to Commander Spellbook, whose API sends no CORS header, and returns
// the combos trimmed down. Runs on the free Workers tier; nothing is stored or logged.
// The logic lives in shared/spellbook.ts so it is unit-tested and also served by the dev server.
import { handleCombos } from '../../shared/spellbook';

export const onRequest = ({ request }: { request: Request }): Promise<Response> => handleCombos(request);
