// The member web's session beyond the sign-in. BH-33: a logout that did not reach the server is remembered and retried, and a
// leftover cookie cannot turn a guest's request into the member's. BH-28: tabs of one browser share one cookie, so a tab whose
// member changed in another tab reloads, and never sends a write for the member it still shows.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';

import { api, apiData, createApiClient, onApiGateEvent } from '@/api/client';
import { signOut } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { restoreMember, watchOtherTabs } from '@/features/auth/sessionLifecycle';
import { abortSessionRequests, setGuest, setMember, useSessionStore } from '@/state/session';

jest.mock('@/lib/platform', () => ({ isWeb: true, isNative: false, isIOS: false, isAndroid: false }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const MARKER = 'sc.logoutPending';
const LUKAS = { id: '01LUKAS', username: 'lukas.sc', displayName: null, avatarUrl: null };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const UNAUTHENTICATED = { message: 'Bitte melde dich an.', code: 'unauthenticated', errors: {} };

const sent: Request[] = [];
let answer: (request: Request) => Promise<Response> = () => Promise.resolve(json(200, { data: [] }));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const to = (path: string) => sent.filter((request) => new URL(request.url).pathname.endsWith(path));

beforeAll(() => {
  globalThis.fetch = jest.fn((input: Request | string, init?: RequestInit) => {
    const request = typeof input === 'string' ? new Request(input, init) : input;
    sent.push(request);
    if (new URL(request.url).pathname.endsWith('/sanctum/csrf-cookie')) return Promise.resolve(new Response(null, { status: 204 }));
    return answer(request);
  }) as unknown as typeof fetch;
});
afterAll(() => queryClient.clear());
beforeEach(async () => {
  sent.length = 0;
  answer = () => Promise.resolve(json(200, { data: [] }));
  await AsyncStorage.clear();
  queryClient.clear();
  useSessionStore.setState({ status: 'guest', member: null, notice: null, intent: null, passwordChangeEmail: null, expiredFrom: null, memberChanged: false });
});

describe('a logout the server did not hear', () => {
  it('leaves a marker and signs out here all the same', async () => {
    setMember(LUKAS);
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    await signOut();
    expect(useSessionStore.getState().status).toBe('guest');
    expect(await AsyncStorage.getItem(MARKER)).toBe('1');
  });

  it.each([
    ['a 204', () => new Response(null, { status: 204 })],
    ['a 401', () => json(401, UNAUTHENTICATED)],
  ])('leaves no marker after %s', async (_name, response) => {
    setMember(LUKAS);
    answer = () => Promise.resolve(response());
    await signOut();
    expect(await AsyncStorage.getItem(MARKER)).toBeNull();
  });

  it('is retried from the restore, with the cookie, and ends with a 204', async () => {
    await AsyncStorage.setItem(MARKER, '1');
    answer = () => Promise.resolve(new Response(null, { status: 204 }));
    await expect(restoreMember()).resolves.toBeNull();
    await flush();
    await flush();
    const [logout] = to('/auth/logout');
    expect(logout?.method).toBe('POST');
    expect(logout?.credentials).toBe('include');
    expect(await AsyncStorage.getItem(MARKER)).toBeNull();
  });

  it('also ends with a 401: the session is gone, which is the point', async () => {
    await AsyncStorage.setItem(MARKER, '1');
    answer = () => Promise.resolve(json(401, UNAUTHENTICATED));
    await restoreMember();
    await flush();
    await flush();
    expect(await AsyncStorage.getItem(MARKER)).toBeNull();
    expect(useSessionStore.getState().notice).toBeNull();
  });

  it('stays while the server is out of reach, and goes out again when the browser is online', async () => {
    await AsyncStorage.setItem(MARKER, '1');
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    await restoreMember();
    await flush();
    await flush();
    expect(await AsyncStorage.getItem(MARKER)).toBe('1');
    answer = () => Promise.resolve(new Response(null, { status: 204 }));
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await flush();
    await flush();
    expect(to('/auth/logout')).toHaveLength(2);
    expect(await AsyncStorage.getItem(MARKER)).toBeNull();
  });

  it('never fires for a member: that sign-in replaced the session the marker meant', async () => {
    await AsyncStorage.setItem(MARKER, '1');
    setMember(LUKAS);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await flush();
    await flush();
    expect(to('/auth/logout')).toEqual([]);
  });

  it('asks nothing without a marker', async () => {
    await restoreMember();
    await flush();
    expect(sent).toEqual([]);
  });
});

describe('credentials on web API calls', () => {
  it('a guest sends none on a read, so a leftover cookie cannot make it the member', async () => {
    setGuest();
    await apiData(api.GET('/home/new-builds'));
    expect(to('/home/new-builds')[0]?.credentials).toBe('omit');
  });

  it('a member sends them', async () => {
    setMember(LUKAS);
    await apiData(api.GET('/me/vehicles'));
    expect(to('/me/vehicles')[0]?.credentials).toBe('include');
  });

  it('so does the start, which is asking whose cookie it has', async () => {
    useSessionStore.setState({ status: 'loading' });
    await apiData(api.GET('/auth/me'));
    expect(to('/auth/me')[0]?.credentials).toBe('include');
  });

  it.each([
    ['/auth/login', { email: 'a@b.de', password: 'x' }],
    ['/auth/register', { email: 'a@b.de', password: 'x', accepted_age_16: true, accepted_terms: true, accepted_privacy: true, marketing_consent: false }],
    ['/auth/email/verify', { email: 'a@b.de', code: '123456' }],
    ['/auth/email/resend', { email: 'a@b.de' }],
    ['/auth/password/forgot', { email: 'a@b.de' }],
    ['/auth/password/reset', { email: 'a@b.de', code: '123456', password: 'x' }],
    ['/auth/two-factor/challenge', { challenge: 'c', code: '123456' }],
  ] as const)('a guest still sends them to the sign-in family: %s', async (path, body) => {
    setGuest();
    const post = api.POST as unknown as (path: string, init: { body: unknown }) => Promise<{ response: Response }>;
    await post(path, { body });
    expect(to(path)[0]?.credentials).toBe('include');
  });

  it('keeps the body of a guest write it strips the cookie from', async () => {
    setGuest();
    const post = api.POST as unknown as (path: string, init: { body: unknown }) => Promise<{ response: Response }>;
    await post('/catalog/requests', { body: { name: 'Skyline' } });
    const [request] = to('/catalog/requests');
    expect(request?.credentials).toBe('omit');
    expect(await request?.json()).toEqual({ name: 'Skyline' });
  });
});

describe('the requests of a session end with it (SEC-S-01)', () => {
  it('aborts a member’s write under way, before its answer can set the cookie again', async () => {
    setMember(LUKAS);
    answer = () => new Promise<Response>(() => undefined);
    const client = createApiClient({ origin: 'https://speedclub.test', cookieAuth: true, getCookies: () => 'XSRF-TOKEN=t' });
    const write = apiData(client.PATCH('/me/profile', { body: { city: 'Hamburg' } })).catch((error: unknown) => error);
    await flush();
    const [request] = to('/me/profile');
    expect(request?.signal.aborted).toBe(false);
    abortSessionRequests();
    expect(request?.signal.aborted).toBe(true);
    void write;
  });

  it('leaves a guest’s request alone: a guest has no session to end', async () => {
    setGuest();
    answer = () => new Promise<Response>(() => undefined);
    void apiData(api.POST('/auth/login', { body: { email: 'a@b.de', password: 'x' } })).catch(() => undefined);
    await flush();
    abortSessionRequests();
    expect(to('/auth/login')[0]?.signal.aborted).toBe(false);
  });
});

describe('another tab changed the member (BH-28)', () => {
  type Listener = (event: { key: string | null; newValue: string | null }) => void;
  const stored = (id: string | null) => (id ? JSON.stringify({ ...LUKAS, id }) : null);
  let listeners: Listener[];
  let reload: jest.Mock;
  let stop: () => void;
  let unloadGuards: ((event: { stopImmediatePropagation: () => void }) => void)[];
  const fire = (key: string | null, newValue: string | null) => listeners.forEach((listener) => listener({ key, newValue }));

  beforeEach(() => {
    listeners = [];
    unloadGuards = [];
    reload = jest.fn();
    const host = globalThis.window as unknown as Record<string, unknown>;
    host.addEventListener = (type: string, listener: Listener, options?: { capture?: boolean }) => {
      if (type === 'storage') listeners.push(listener);
      if (type === 'beforeunload' && options?.capture) unloadGuards.push(listener as unknown as (event: { stopImmediatePropagation: () => void }) => void);
    };
    host.removeEventListener = jest.fn();
    host.location = { reload };
    stop = watchOtherTabs();
  });
  afterEach(() => {
    stop();
    const host = globalThis.window as unknown as Record<string, unknown>;
    delete host.addEventListener;
    delete host.removeEventListener;
    delete host.location;
  });

  it('reloads when the id changes', () => {
    setMember(LUKAS);
    fire('sc.sessionMember', stored('01NINA'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('comes before the discard guard of a form, whose text belonged to the other member', () => {
    // Chromium runs a window's listeners in the order they were added, the capture flag notwithstanding: the stopper must be there
    // before any screen adds a guard, so the client adds it as it loads (BH-28, recheck). A fresh copy of the module, for that load.
    let isolated!: typeof import('@/api/client');
    // A fresh load runs the native modules' setup again, which installs its own globals: the file's fetch stub has to stay.
    const globals = ['fetch', 'Request', 'Response', 'Headers', 'AbortController', 'AbortSignal'] as const;
    const kept = globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    jest.isolateModules(() => {
      isolated = jest.requireActual<typeof import('@/api/client')>('@/api/client');
    });
    for (const [name, descriptor] of kept) if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    expect(unloadGuards).toHaveLength(1);
    const stopImmediatePropagation = jest.fn();
    // A guard's own prompt for a plain reload or a closed tab is the member's to see.
    unloadGuards.forEach((guard) => guard({ stopImmediatePropagation }));
    expect(stopImmediatePropagation).not.toHaveBeenCalled();

    setMember(LUKAS);
    isolated.reloadTab();
    unloadGuards.forEach((guard) => guard({ stopImmediatePropagation }));
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('adds nothing at reload time, when a guard would already have run first', () => {
    setMember(LUKAS);
    fire('sc.sessionMember', stored('01NINA'));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(unloadGuards).toEqual([]);
  });

  it('reloads when it goes away', () => {
    setMember(LUKAS);
    fire('sc.sessionMember', null);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads a guest tab when another tab signed in', () => {
    setGuest();
    fire('sc.sessionMember', stored(LUKAS.id));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when the storage was cleared', () => {
    setMember(LUKAS);
    fire(null, null);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stays for a refresh of the same member, for another key, and in a start that is still deciding', () => {
    setMember(LUKAS);
    fire('sc.sessionMember', stored(LUKAS.id));
    fire('sc.queryCache', '{}');
    useSessionStore.setState({ status: 'loading', member: null });
    fire('sc.sessionMember', stored('01NINA'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('refuses a write for a member the cookie no longer belongs to, and reloads', async () => {
    setMember(LUKAS);
    const host = globalThis.window as unknown as { localStorage?: unknown };
    const descriptor = Object.getOwnPropertyDescriptor(host, 'localStorage');
    Object.defineProperty(host, 'localStorage', { configurable: true, value: { getItem: () => stored('01NINA') } });
    try {
      const client = createApiClient({ origin: 'https://speedclub.test', cookieAuth: true, getCookies: () => 'XSRF-TOKEN=t' });
      const events: string[] = [];
      const stopListening = onApiGateEvent((event) => events.push(event));
      // Its own error and copy, never the network's: nothing is wrong with the connection (BH-28, recheck).
      await expect(apiData(client.PATCH('/me/profile', { body: { city: 'Hamburg' } }))).rejects.toMatchObject({
        kind: 'session_moved',
        message: 'In einem anderen Tab ist jetzt ein anderes Konto angemeldet. Lade die Seite neu, um damit weiterzumachen.',
      });
      stopListening();
      expect(events).toEqual(['session_moved']);
      expect(to('/me/profile')).toEqual([]);
      expect(reload).toHaveBeenCalledTimes(1);

      // A read says nothing to anybody, and the reload sorts out the rest.
      await apiData(client.GET('/me/vehicles'));
      expect(to('/me/vehicles')).toHaveLength(1);
    } finally {
      if (descriptor) Object.defineProperty(host, 'localStorage', descriptor);
      else delete host.localStorage;
    }
  });

  it('a sign-out in a tab the cookie moved away from leaves the new member’s session alone (BH-28 with BH-33)', async () => {
    setMember(LUKAS);
    const nina = stored('01NINA')!;
    // The shared storage, as the browser has it after another tab signed in as Nina.
    await AsyncStorage.setItem('sc.sessionMember', nina);
    await AsyncStorage.setItem('sc.queryCache', '{"owner":"01NINA"}');
    const host = globalThis.window as unknown as { localStorage?: unknown };
    const descriptor = Object.getOwnPropertyDescriptor(host, 'localStorage');
    Object.defineProperty(host, 'localStorage', { configurable: true, value: { getItem: () => nina } });
    try {
      answer = () => Promise.resolve(new Response(null, { status: 204 }));
      await signOut();
      expect(to('/auth/logout')).toEqual([]);
      expect(reload).toHaveBeenCalledTimes(1);
      // No marker, which a guest start would retry with Nina's cookie, and Nina's member and cache stay where they are.
      expect(await AsyncStorage.getItem(MARKER)).toBeNull();
      expect(await AsyncStorage.getItem('sc.sessionMember')).toBe(nina);
      expect(await AsyncStorage.getItem('sc.queryCache')).toBe('{"owner":"01NINA"}');
    } finally {
      if (descriptor) Object.defineProperty(host, 'localStorage', descriptor);
      else delete host.localStorage;
    }
  });

  it('sends the write when the stored member is still this one, or storage has nothing to say', async () => {
    setMember(LUKAS);
    const host = globalThis.window as unknown as { localStorage?: unknown };
    const descriptor = Object.getOwnPropertyDescriptor(host, 'localStorage');
    const client = createApiClient({ origin: 'https://speedclub.test', cookieAuth: true, getCookies: () => 'XSRF-TOKEN=t' });
    try {
      Object.defineProperty(host, 'localStorage', { configurable: true, value: { getItem: () => stored(LUKAS.id) } });
      await apiData(client.PATCH('/me/profile', { body: { city: 'Hamburg' } }));
      Object.defineProperty(host, 'localStorage', { configurable: true, value: { getItem: () => null } });
      await apiData(client.PATCH('/me/profile', { body: { city: 'Bremen' } }));
      expect(to('/me/profile')).toHaveLength(2);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(host, 'localStorage', descriptor);
      else delete host.localStorage;
    }
  });
});
