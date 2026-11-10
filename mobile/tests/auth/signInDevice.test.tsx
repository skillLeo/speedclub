/**
 * Native sign-in and what a device keeps: its own id (recheck, two phones of one model), the token of a logout the server did not
 * hear (BH-33 native, RESULT 12), and the persisted cache without the member's address (SEC-S-03, ADR-152(e)).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dehydrate, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { meKey, useLogin } from '@/api/queries/auth';
import { persistOptions, queryClient } from '@/api/queryClient';
// The lifecycle hears the API's gate events: a 401 for the session held would end it here.
import '@/features/auth/sessionLifecycle';
import { setGuest, useSessionStore } from '@/state/session';

const mockKeychain = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockKeychain.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockKeychain.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockKeychain.delete(key);
    return Promise.resolve();
  }),
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `5e0c2a8e-0000-4000-8000-00000000000${++mockUuid}` }));
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
  city: 'Hamburg',
  bio: null,
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'ps',
  member_since: '2023-03-01T00:00:00Z',
  stats: { vehicles: 3, followers: 128, following: 87 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
} as const;
const SLOT = 'sc.logoutPending';
const SESSION = { member: ME, token: 'token-new', token_expires_at: '2027-02-05T00:00:00Z' };
const UNAUTHENTICATED = { message: 'Bitte melde dich an.', code: 'unauthenticated', errors: {} };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = jest.fn<Promise<Response>, [Request]>();
const sent = () => fetchMock.mock.calls.map(([request]) => request);
const to = (path: string) => sent().filter((request) => new URL(request.url).pathname.endsWith(path));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

/** Signs in through AUTH-03's mutation, with `logout` as the answer to a revoke. */
async function signIn(logout: () => Response = () => new Response(null, { status: 204 })) {
  fetchMock.mockImplementation((request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/login')) return Promise.resolve(json(200, { data: SESSION }));
    if (path.endsWith('/auth/logout')) return Promise.resolve(logout());
    return Promise.resolve(json(200, { data: [] }));
  });
  const { result } = await renderHook(() => useLogin(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ email: ME.email, password: 'Boxer-Motor-2002' });
    await flush();
  });
  await act(flush);
}

afterAll(() => queryClient.clear());
beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
beforeEach(async () => {
  fetchMock.mockReset();
  mockKeychain.clear();
  queryClient.clear();
  await AsyncStorage.clear();
  setGuest();
  useSessionStore.setState({ notice: null });
});

describe('the device id (two phones of one model)', () => {
  it('is made once per install, kept in the keychain, and sent with the sign-in', async () => {
    await signIn();
    const id = mockKeychain.get('sc.deviceId');
    expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(await to('/auth/login')[0]!.json()).toMatchObject({ device_id: id, device_name: expect.any(String) });

    setGuest();
    await signIn();
    expect(mockKeychain.get('sc.deviceId')).toBe(id);
    expect(await to('/auth/login')[1]!.json()).toMatchObject({ device_id: id });
  });
});

describe('a logout still owed when somebody signs in (BH-33 native)', () => {
  it('revokes another member’s token with its own header first, then forgets it, and the new session stays', async () => {
    mockKeychain.set(SLOT, JSON.stringify({ token: 'token-anna', member: '01JANNA' }));
    // Gone already, so the server answers 401: that must not end the session that just started.
    await signIn(() => json(401, UNAUTHENTICATED));
    // The slot goes once the answer was heard, after the client has dealt with it.
    await waitFor(() => expect(mockKeychain.has(SLOT)).toBe(false));
    await act(flush);
    const revokes = to('/auth/logout');
    expect(revokes).toHaveLength(1);
    expect(revokes[0]!.headers.get('Authorization')).toBe('Bearer token-anna');
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', member: { id: ME.id }, notice: null });
    expect(mockKeychain.get('sc.authToken')).toBe('token-new');
  });

  it('revokes a bare token of an earlier build too, since nothing says whose it was', async () => {
    mockKeychain.set(SLOT, 'token-old');
    await signIn();
    expect(to('/auth/logout').map((request) => request.headers.get('Authorization'))).toEqual(['Bearer token-old']);
    expect(mockKeychain.has(SLOT)).toBe(false);
  });

  it('revokes the member’s own token too, before the sign-in: a token without device_id would outlive it (SEC-S-05)', async () => {
    mockKeychain.set(SLOT, JSON.stringify({ token: 'token-lukas-old', member: ME.id }));
    await signIn();
    const revokes = to('/auth/logout');
    expect(revokes.map((request) => request.headers.get('Authorization'))).toEqual(['Bearer token-lukas-old']);
    // Before, never after: a revoke with a token of the same device_id would end the new one as well.
    const order = sent().map((request) => new URL(request.url).pathname);
    expect(order.indexOf('/api/v1/auth/logout')).toBeLessThan(order.indexOf('/api/v1/auth/login'));
    expect(mockKeychain.has(SLOT)).toBe(false);
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', member: { id: ME.id } });
    expect(mockKeychain.get('sc.authToken')).toBe('token-new');
  });

  it('revokes another member’s token before the sign-in as well, once', async () => {
    mockKeychain.set(SLOT, JSON.stringify({ token: 'token-anna', member: '01JANNA' }));
    await signIn();
    const order = sent().map((request) => new URL(request.url).pathname);
    expect(order.filter((path) => path.endsWith('/auth/logout'))).toHaveLength(1);
    expect(order.indexOf('/api/v1/auth/logout')).toBeLessThan(order.indexOf('/api/v1/auth/login'));
    expect(mockKeychain.has(SLOT)).toBe(false);
  });

  it('keeps another member’s token when the revoke got no answer, and tries once more after the sign-in (ADR-185(e))', async () => {
    mockKeychain.set(SLOT, JSON.stringify({ token: 'token-anna', member: '01JANNA' }));
    let calls = 0;
    await signIn(() => {
      calls += 1;
      if (calls === 1) throw new TypeError('Network request failed');
      return new Response(null, { status: 204 });
    });
    await waitFor(() => expect(mockKeychain.has(SLOT)).toBe(false));
    const order = sent().map((request) => new URL(request.url).pathname);
    expect(order.filter((path) => path.endsWith('/auth/logout'))).toHaveLength(2);
    expect(order.lastIndexOf('/api/v1/auth/logout')).toBeGreaterThan(order.indexOf('/api/v1/auth/login'));
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', member: { id: ME.id } });
  });

  it('only forgets the member’s own token after the sign-in when the revoke before it got no answer', async () => {
    mockKeychain.set(SLOT, JSON.stringify({ token: 'token-lukas-old', member: ME.id }));
    await signIn(() => {
      throw new TypeError('Network request failed');
    });
    await waitFor(() => expect(mockKeychain.has(SLOT)).toBe(false));
    const order = sent().map((request) => new URL(request.url).pathname);
    expect(order.filter((path) => path.endsWith('/auth/logout'))).toHaveLength(1);
    expect(order.indexOf('/api/v1/auth/logout')).toBeLessThan(order.indexOf('/api/v1/auth/login'));
  });
});

describe('the persisted cache (SEC-S-03, ADR-152(e))', () => {
  it('holds no address: Me stays in memory, whichever way its query came to be', async () => {
    await signIn();
    queryClient.setQueryData(['garage', 'vehicle', '01H'], { title: 'Lukas Entwurf' });
    expect(queryClient.getQueryData(meKey)).toMatchObject({ email: ME.email });
    const persisted = dehydrate(queryClient, persistOptions.dehydrateOptions);
    expect(persisted.queries.map((query) => query.queryKey)).toContainEqual(['garage', 'vehicle', '01H']);
    expect(persisted.queries.map((query) => query.queryKey)).not.toContainEqual(meKey);
    expect(JSON.stringify(persisted)).not.toContain(ME.email);
  });
});
