/**
 * SEC-S-01 (security recheck 2026-11-07): a write that returns Me and is still under way when the member signs out must not sign the
 * device back in when its answer lands. With a logout the server did not hear, the browser would be the member again. The proposal of
 * the audit (scratchpad sess/lateAnswer.test.tsx) is the first case, unchanged in what it asserts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { meKey, refreshMe, signOut, type Me } from '@/api/queries/auth';
import { useSaveProfile } from '@/api/queries/profile';
import { queryClient } from '@/api/queryClient';
import { setMember, useSessionStore } from '@/state/session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
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
const NINA = { id: '01JNINA', username: 'nina.neu', displayName: 'Nina', avatarUrl: null };

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fetchMock = jest.fn<Promise<Response>, [Request]>();
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

/** The save goes out, and its answer waits for `deliver`. Everything else, the logout included, does not reach the server. */
async function saveUnderWay() {
  let deliver: (response: Response) => void = () => undefined;
  let sent: Request | null = null;
  fetchMock.mockImplementation((request: Request) => {
    if (request.url.endsWith('/me/profile')) {
      sent = request;
      return new Promise<Response>((resolve) => (deliver = resolve));
    }
    return Promise.reject(new TypeError('Network request failed'));
  });
  const { result } = await renderHook(() => useSaveProfile(), { wrapper });
  let save: Promise<unknown> = Promise.resolve();
  await act(async () => {
    save = result.current.mutateAsync({ city: 'Hamburg' }).catch(() => undefined);
  });
  return {
    request: () => sent,
    land: async (me: Me) => {
      await act(async () => {
        deliver(json({ data: me }));
        await save;
      });
    },
  };
}

afterAll(() => queryClient.clear());
beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
beforeEach(async () => {
  fetchMock.mockReset();
  queryClient.clear();
  await AsyncStorage.clear();
  setMember({ id: ME.id, username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null });
});

it('a Me answer that lands after the sign-out does not sign the member back in', async () => {
  const save = await saveUnderWay();
  await act(async () => {
    await signOut();
  });
  expect(useSessionStore.getState().status).toBe('guest');

  await save.land(ME as unknown as Me);

  expect(useSessionStore.getState()).toMatchObject({ status: 'guest', member: null });
  expect(await AsyncStorage.getItem('sc.sessionMember')).toBeNull();
  expect(queryClient.getQueryData(meKey)).toBeUndefined();
});

it('the sign-out aborts the write under way first, so its answer and, on web, its cookie never arrive', async () => {
  const save = await saveUnderWay();
  expect(save.request()?.signal.aborted).toBe(false);
  // Before the logout goes out: a logout that hangs for its 4 s must not leave the write's answer that time to land.
  let abortedAtLogout: boolean | undefined;
  const pending = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((request: Request) => {
    if (request.url.endsWith('/auth/logout')) abortedAtLogout = save.request()?.signal.aborted;
    return pending(request);
  });
  await act(async () => {
    await signOut();
  });
  expect(abortedAtLogout).toBe(true);
  expect(save.request()?.signal.aborted).toBe(true);
});

it('a late answer for the previous member never swaps in for the member signed in now', async () => {
  const save = await saveUnderWay();
  await act(async () => {
    await signOut();
  });
  setMember(NINA);
  await save.land(ME as unknown as Me);
  expect(useSessionStore.getState()).toMatchObject({ status: 'member', member: { id: NINA.id }, memberChanged: false });
});

it('a write of the member signed in still updates the member and the cache', async () => {
  const save = await saveUnderWay();
  await save.land({ ...ME, display_name: 'Lukas S.' } as unknown as Me);
  expect(useSessionStore.getState().member).toMatchObject({ id: ME.id, displayName: 'Lukas S.' });
  expect(queryClient.getQueryData<Me>(meKey)?.display_name).toBe('Lukas S.');
  expect(JSON.parse((await AsyncStorage.getItem('sc.sessionMember'))!)).toMatchObject({ id: ME.id, displayName: 'Lukas S.' });
});

it('refreshMe promotes nobody while the start is still deciding', () => {
  useSessionStore.setState({ status: 'loading', member: null });
  refreshMe(ME as unknown as Me);
  expect(useSessionStore.getState()).toMatchObject({ status: 'loading', member: null });
});
