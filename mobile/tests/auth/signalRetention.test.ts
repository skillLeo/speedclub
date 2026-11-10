/**
 * SEC-S-04: WebKit drops a Request's signal, and the result of AbortSignal.any, once script holds none of them, and the session's
 * abort then no longer reaches the network. The client holds every signal of a request's chain until it settles. Jest cannot
 * show the garbage collection itself; this pins what is held, for how long, and that the abort reaches the fetched request.
 */
import { apiData, createApiClient, signalsHeldInFlight } from '@/api/client';
import { abortSessionRequests, setMember, useSessionStore } from '@/state/session';

jest.mock('@/lib/platform', () => ({ isWeb: true, isNative: false, isIOS: false, isAndroid: false }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

const LUKAS = { id: '01LUKAS', username: 'lukas.sc', displayName: null, avatarUrl: null };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Pending = { request: Request; settle: (response: Response) => void };
let pending: Pending[] = [];
const fetchImpl = jest.fn(
  (request: Request) =>
    new Promise<Response>((resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      pending.push({ request, settle: resolve });
    }),
);
const client = () => createApiClient({ origin: 'https://speedclub.test', cookieAuth: true, getCookies: () => 'XSRF-TOKEN=t', fetch: fetchImpl });
const ok = () => new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  pending = [];
  fetchImpl.mockClear();
  useSessionStore.setState({ status: 'guest', member: null, notice: null, expiredFrom: null, memberChanged: false });
});

describe('the signals of a request under way (SEC-S-04)', () => {
  it('holds the original, the combined and the bound signal of a member’s write until it answers', async () => {
    setMember(LUKAS);
    const write = apiData(client().PATCH('/me/profile', { body: { city: 'Hamburg' } }));
    await flush();
    const [sent] = pending;
    expect(sent).toBeDefined();
    const held = signalsHeldInFlight();
    // The request openapi-fetch made, AbortSignal.any's result, and the signal of the Request that goes out.
    expect(held).toHaveLength(3);
    expect(held).toContain(sent!.request.signal);
    expect(new Set(held).size).toBe(3);

    sent!.settle(ok());
    await write;
    expect(signalsHeldInFlight()).toEqual([]);
  });

  it('lets go once the session abort has ended the request, which the fetched request hears', async () => {
    setMember(LUKAS);
    const write = apiData(client().PATCH('/me/profile', { body: { city: 'Hamburg' } })).catch((error: unknown) => error);
    await flush();
    expect(signalsHeldInFlight()).toHaveLength(3);
    abortSessionRequests();
    expect(pending[0]?.request.signal.aborted).toBe(true);
    await expect(write).resolves.toMatchObject({ name: 'AbortError' });
    expect(signalsHeldInFlight()).toEqual([]);
  });

  it('holds a read’s own signal too, so a cancel from the query cache reaches the network', async () => {
    setMember(LUKAS);
    const controller = new AbortController();
    const read = apiData(client().GET('/me/vehicles', { signal: controller.signal })).catch((error: unknown) => error);
    await flush();
    expect(signalsHeldInFlight()).toEqual([pending[0]?.request.signal]);
    controller.abort();
    expect(pending[0]?.request.signal.aborted).toBe(true);
    await read;
    expect(signalsHeldInFlight()).toEqual([]);
  });

  it('keeps a signal two requests share held until the second one answers', async () => {
    setMember(LUKAS);
    const api = client();
    const first = apiData(api.PATCH('/me/profile', { body: { city: 'Hamburg' } }));
    const second = apiData(api.PATCH('/me/profile', { body: { city: 'Bremen' } }));
    await flush();
    expect(signalsHeldInFlight()).toHaveLength(6);
    pending[0]!.settle(ok());
    await first;
    expect(signalsHeldInFlight()).toHaveLength(3);
    expect(signalsHeldInFlight()).toContain(pending[1]!.request.signal);
    pending[1]!.settle(ok());
    await second;
    expect(signalsHeldInFlight()).toEqual([]);
  });
});
