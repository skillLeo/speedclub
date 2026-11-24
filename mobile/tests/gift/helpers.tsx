/** M5.9d tests: the providers of tests/qr/harness and a fetch stub that answers by method, path and query, and records each call. */
export { newQueryClient, renderScreen, signIn, signOut } from '../qr/harness';

export type Answer = { status?: number; body?: unknown };
export type Call = { method: string; path: string; search: string; body: unknown };

/** "METHOD /path?query" or "/path": the longest key whose path the request ends with (and whose query it carries) wins; else 404. */
export function stubApi(answers: Record<string, Answer | ((call: Call) => Answer)>) {
  const calls: Call[] = [];
  const keys = Object.keys(answers).sort((a, b) => b.length - a.length);
  const fetchMock = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.text();
    const call: Call = { method: request.method, path: url.pathname, search: url.search, body: text ? (JSON.parse(text) as unknown) : null };
    calls.push(call);
    const key = keys.find((candidate) => {
      const [method, target] = candidate.includes(' ') ? candidate.split(' ') : [null, candidate];
      const [path = '', query] = (target ?? '').split('?');
      return (!method || method === request.method) && url.pathname.endsWith(path) && (query === undefined ? url.search === '' : url.search === `?${query}`);
    });
    const entry = key ? answers[key] : undefined;
    const answer = typeof entry === 'function' ? entry(call) : (entry ?? { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } });
    const status = answer.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(answer.body ?? null), { status, headers: { 'Content-Type': 'application/json' } });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}

/** The mocks every M5.9d screen test needs (hoisted jest.mock calls stay in each file). */
export const BADGES = [
  { key: 'founding_member', name: 'Founding Member', description: 'Eines der ersten 1.000 Konten.', hint: null, hidden: false, tier: 'gold', category: 'founding', earned_at: '2026-10-02T18:12:00Z', sort: 1 },
  { key: 'crew_starter', name: 'Crew Starter', description: 'Über einen Einladungscode.', hint: null, hidden: false, tier: 1, category: 'community', earned_at: '2026-11-12T20:30:00Z', sort: 4 },
  { key: 'street_famous_10', name: 'Street Famous', description: 'Zehn Leute haben dein Auto gespottet.', hint: null, hidden: false, tier: 1, category: 'spotting', earned_at: null, sort: 5 },
  { key: 'hidden_night', name: null, description: null, hint: 'Hat etwas mit deinem Sticker zu tun.', hidden: true, tier: null, category: 'sticker', earned_at: null, sort: 8 },
];
