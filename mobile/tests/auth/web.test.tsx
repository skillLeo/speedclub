// The member web (/app): a cookie session instead of a token. ADR-124: login and email/verify fetch a fresh CSRF cookie
// right before they run, whatever cookie the browser already holds, and a stale one gets one more try.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useLogin, useVerifyEmail } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { restoreMember } from '@/features/auth/sessionLifecycle';
import { useSessionStore } from '@/state/session';

jest.mock('@/lib/platform', () => ({ isWeb: true, isNative: false, isIOS: false, isAndroid: false }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ME = {
  id: '01JMEMBER',
  email: 'lukas@speedclub.test',
  email_verified: true,
  has_username: true,
  profile_complete: true,
  next_step: null,
  force_password_change: false,
  username: 'lukas.sc',
  username_change_available_at: null,
  display_name: 'Lukas',
  city: 'Stuttgart',
  bio: null,
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'ps',
  member_since: '2023-03-01T00:00:00Z',
  stats: { vehicles: 3, followers: 128, following: 87 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
};
const SESSION = { data: { token: null, token_expires_at: null, member: ME } };
const STALE = { message: 'Die Sitzung ist abgelaufen.', code: 'session_expired', errors: {} };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Every call as "METHOD /path", the cookie request of auth.ts (a plain URL) and of the client (a Request) alike. */
const calls: string[] = [];
let answer: (call: string) => Response = () => json(200, {});

const fetchMock = jest.fn((input: Request | string, init?: RequestInit) => {
  const request = typeof input === 'string' ? new Request(input, init) : input;
  const call = `${request.method} ${new URL(request.url).pathname}`;
  calls.push(call);
  return Promise.resolve(call.endsWith('/sanctum/csrf-cookie') ? new Response(null, { status: 204 }) : answer(call));
});

const CSRF = 'GET /sanctum/csrf-cookie';

/** The call right before each one to `path`. */
function before(path: string): (string | undefined)[] {
  return calls.flatMap((call, index) => (call === path ? [calls[index - 1]] : []));
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let client: QueryClient;

// adoptMe writes the app's own client, whose 24-hour collection timer would outlive the file.
afterAll(() => queryClient.clear());

beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // The browser already holds an XSRF cookie: the API client alone would send it and fetch nothing.
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=held' }, configurable: true, writable: true });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'document');
});

beforeEach(async () => {
  calls.length = 0;
  fetchMock.mockClear();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
  await AsyncStorage.clear();
  queryClient.clear();
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null, notice: null, passwordChangeEmail: null });
});

afterEach(() => client.clear());

describe('ADR-124 on web', () => {
  it('login fetches the cookie right before it runs, even with one held', async () => {
    answer = (call) => (call === 'POST /api/v1/auth/login' ? json(200, SESSION) : json(200, { data: {} }));
    const { result } = await renderHook(() => useLogin(), { wrapper });
    await act(() => result.current.mutateAsync({ email: ME.email, password: 'richtig-lang-genug' }));
    expect(calls[0]).toBe(CSRF);
    expect(before('POST /api/v1/auth/login')).toEqual([CSRF]);
    expect(useSessionStore.getState().status).toBe('member');
  });

  it('login tries once more with a new cookie after a 419, and no more', async () => {
    let logins = 0;
    answer = (call) => {
      if (call !== 'POST /api/v1/auth/login') return json(200, { data: {} });
      logins += 1;
      return logins === 1 ? json(419, STALE) : json(200, SESSION);
    };
    const { result } = await renderHook(() => useLogin(), { wrapper });
    await act(() => result.current.mutateAsync({ email: ME.email, password: 'richtig-lang-genug' }));
    expect(before('POST /api/v1/auth/login')).toEqual([CSRF, CSRF]);
    expect(logins).toBe(2);

    calls.length = 0;
    logins = 0;
    answer = (call) => (call === 'POST /api/v1/auth/login' ? json(419, STALE) : json(200, { data: {} }));
    await expect(result.current.mutateAsync({ email: ME.email, password: 'richtig-lang-genug' })).rejects.toMatchObject({
      kind: 'session_expired',
    });
    expect(calls.filter((call) => call === 'POST /api/v1/auth/login')).toHaveLength(2);
  });

  it('email/verify fetches the cookie right before it runs, even with one held', async () => {
    answer = (call) => (call === 'POST /api/v1/auth/email/verify' ? json(200, SESSION) : json(200, { data: {} }));
    const { result } = await renderHook(() => useVerifyEmail(), { wrapper });
    await act(() => result.current.mutateAsync({ email: ME.email, code: '123456', password: 'richtig-lang-genug' }));
    expect(calls[0]).toBe(CSRF);
    expect(before('POST /api/v1/auth/email/verify')).toEqual([CSRF]);
  });
});

describe('restoring a web session', () => {
  it('takes the address of a required password change from the answer (AUTH-07)', async () => {
    useSessionStore.setState({ status: 'loading' });
    await AsyncStorage.setItem('sc.sessionMember', JSON.stringify({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null }));
    answer = () =>
      json(403, { message: 'Neues Passwort nötig.', code: 'password_change_required', next: 'reset_password', email: ME.email, errors: {} });
    await expect(restoreMember()).resolves.toBeNull();
    expect(useSessionStore.getState().passwordChangeEmail).toBe(ME.email);
    expect(await AsyncStorage.getItem('sc.sessionMember')).toBeNull();
  });
});
