/**
 * The M2.5 client against the exported endpoints: the sign-in's two-factor answer reaches AUTH-11 without adopting anything,
 * the challenge adopts the session like a sign-in, and the settings hooks map the answers to their UI shapes.
 */
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { Me } from '@/api/queries/auth';
import { useLogin, useTwoFactorChallenge } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { recoveryCodesOf, useDataExports, useDeviceSessions } from '@/api/queries/settings';
import { forgetTwoFactorChallenge, heldTwoFactorChallenge } from '@/features/auth/twoFactorChallenge';
import { SignInScreen } from '@/features/auth/screens/SignInScreen';
import { webDeletionUrl } from '@/features/settings/screens/DeleteAccountScreen';
import { getPowerDisplay, setPowerDisplay } from '@/lib/powerDisplay';
import { formatPower } from '@/lib/units';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
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
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const EMAIL = 'lukas.sc@speedclub.test';
const ME: Me = {
  id: '01m6f7ztzfs0gd39t08rs9zmmp',
  email: EMAIL,
  email_verified: true,
  is_sample: false,
  is_editorial: false,
  has_username: true,
  profile_complete: true,
  next_step: null,
  force_password_change: false,
  password_set: true,
  two_factor_enabled: true,
  username: 'lukas.sc',
  username_change_available_at: null,
  display_name: null,
  city: null,
  bio: null,
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'hp',
  member_since: '2023-03-12T10:00:00+00:00',
  stats: { vehicles: 0, followers: 0, following: 0 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
};

beforeAll(hydrateThemePreference);
// A sign-in writes Me to the app's own client, whose collection timers would keep Jest running.
afterAll(() => queryClient.clear());
beforeEach(async () => {
  jest.clearAllMocks();
  mockKeychain.clear();
  forgetTwoFactorChallenge();
  await act(async () => useSessionStore.setState({ status: 'guest', member: null }));
});

describe('AUTH-11 through the sign-in', () => {
  it('holds the challenge in memory and opens AUTH-11, adopting nothing', async () => {
    const { calls } = stubFetch({
      '/auth/login': { body: { data: { two_factor_required: true, challenge: 'c'.repeat(40), expires_in: 300 } } },
    });
    await renderScreen(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-03.email'), EMAIL);
    await fireEvent.changeText(screen.getByTestId('AUTH-03.password'), 'Boxer-Motor-2002');
    await fireEvent.press(screen.getByTestId('AUTH-03.cta.primary'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/two-factor'));
    expect(heldTwoFactorChallenge()).toBe('c'.repeat(40));
    expect(useSessionStore.getState().status).toBe('guest');
    expect(mockKeychain.has('sc.authToken')).toBe(false);
    // Never a parameter, never in storage.
    expect(JSON.stringify(mockRouter.replace.mock.calls)).not.toContain('cccc');
    expect(calls.some((request) => new URL(request.url).pathname.endsWith('/auth/me'))).toBe(false);
  });

  it('adopts the session of a passed challenge like a sign-in, and the account display applies', async () => {
    const { calls } = stubFetch({
      '/auth/two-factor/challenge': { body: { data: { member: ME, token: 'token-2fa', token_expires_at: '2027-02-05T00:00:00Z' } } },
    });
    const client = newQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = await renderHook(() => useTwoFactorChallenge(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ challenge: 'c'.repeat(40), code: '123456' });
    });
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', member: { id: ME.id } });
    expect(mockKeychain.get('sc.authToken')).toBe('token-2fa');
    expect(getPowerDisplay()).toBe('hp');
    const sent = calls.find((request) => new URL(request.url).pathname.endsWith('/auth/two-factor/challenge'));
    expect(JSON.parse((await sent?.clone().text()) ?? '{}')).toMatchObject({ challenge: 'c'.repeat(40), code: '123456' });
  });
});

describe('AUTH-11 device fields', () => {
  it('sends exactly the device fields the sign-in sends', async () => {
    const { calls } = stubFetch({
      '/auth/login': { body: { data: { two_factor_required: true, challenge: 'd'.repeat(40), expires_in: 300 } } },
      '/auth/two-factor/challenge': { body: { data: { member: ME, token: 'token-2fa', token_expires_at: '2027-02-05T00:00:00Z' } } },
    });
    const client = newQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const login = await renderHook(() => useLogin(), { wrapper });
    await act(async () => {
      await login.result.current.mutateAsync({ email: EMAIL, password: 'Boxer-Motor-2002' });
    });
    const challenge = await renderHook(() => useTwoFactorChallenge(), { wrapper });
    await act(async () => {
      await challenge.result.current.mutateAsync({ challenge: 'd'.repeat(40), recoveryCode: 'ABCDE-FGHJK' });
    });
    const body = async (path: string) => {
      const sent = calls.find((request) => new URL(request.url).pathname.endsWith(path));
      return JSON.parse((await sent?.clone().text()) ?? '{}') as Record<string, unknown>;
    };
    const device = (fields: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(fields).filter(([key]) => ['device_name', 'platform', 'app_version', 'device_id'].includes(key)));
    const signIn = device(await body('/auth/login'));
    expect(Object.keys(signIn).sort()).toEqual(['app_version', 'device_id', 'device_name', 'platform']);
    expect(device(await body('/auth/two-factor/challenge'))).toEqual(signIn);
    expect(await body('/auth/two-factor/challenge')).toMatchObject({ recovery_code: 'ABCDE-FGHJK' });
  });
});

describe('M2.5 settings answers', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={newQueryClient()}>{children}</QueryClientProvider>;

  beforeEach(async () => {
    await act(async () => setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null }));
  });

  it('SET-06 lists the devices without IP or place', async () => {
    stubFetch({
      '/me/sessions': {
        body: {
          data: [
            { id: 't1', kind: 'app', device_name: 'iPhone 15 Pro', platform: 'ios', app_version: '0.4.0', last_used_at: '2026-11-08T10:00:00Z', current: true },
            { id: 'w9', kind: 'web', device_name: 'Chrome auf macOS', platform: 'web', app_version: null, last_used_at: '2026-11-07T10:00:00Z', current: false, os_version: null, approx_city: null, signed_in_at: null },
          ],
        },
      },
    });
    const { result } = await renderHook(() => useDeviceSessions(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.[1]).toEqual({
      id: 'w9',
      kind: 'web',
      deviceName: 'Chrome auf macOS',
      platform: 'web',
      appVersion: null,
      lastUsedAt: '2026-11-07T10:00:00Z',
      current: false,
      osVersion: null,
      signedInAt: null,
      approxCity: null,
    });
  });

  it('SET-12 keeps the signed download link of a ready export', async () => {
    const url = 'https://speedclub.test/api/v1/me/exports/01x/download?expires=1&signature=abc';
    stubFetch({
      '/me/exports': {
        body: {
          data: [
            { id: '01x', status: 'ready', requested_at: '2026-11-08T09:00:00Z', ready_at: '2026-11-08T09:01:00Z', expires_at: '2026-11-15T09:01:00Z', bytes: 70_600_000, download_url: url },
          ],
        },
      },
    });
    const { result } = await renderHook(() => useDataExports(), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]?.downloadUrl).toBe(url));
    expect(result.current.data?.[0]?.bytes).toBe(70_600_000);
  });

  it('reads ten recovery codes from the array the server sends', () => {
    const codes = Array.from({ length: 10 }, (_, index) => `ABCDE-FGH${index}K`);
    expect(recoveryCodesOf(codes)).toEqual(codes);
  });
});

describe('cross-cutting', () => {
  it('SET-11: every power value follows the chosen display', () => {
    setPowerDisplay('kw_ps');
    expect(getPowerDisplay()).toBe('kw_ps');
    expect(formatPower(510, 'ps', getPowerDisplay())).toBe('375 kW (510 PS)');
    setPowerDisplay('nonsense');
    expect(getPowerDisplay()).toBe('kw_ps');
    setPowerDisplay('ps_kw');
  });

  it('SET-13 links to WEB-05 on the public site', () => {
    expect(webDeletionUrl('https://speedclub.de/')).toBe('https://speedclub.de/konto-loeschen');
    expect(webDeletionUrl(null)).toBeNull();
  });
});
