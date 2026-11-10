import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { api, apiData } from '@/api/client';
import { adoptMe, endLocalSessionQuietly, meKey, reconcileSettings, signOut, useSettingsSync, type Me } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { expireSession, restoreMember } from '@/features/auth/sessionLifecycle';
import i18n from '@/i18n';
import { setMember, useSessionStore } from '@/state/session';
import { getThemePreference, setThemePreference } from '@/theme';

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
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// The client is built at import time with the configured origin; native has none in Jest, and a relative URL is no Request.
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
} as const;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = jest.fn<Promise<Response>, [Request]>();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// adoptMe writes the app's own client, whose 24-hour collection timer would outlive the file.
afterAll(() => queryClient.clear());

beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(async () => {
  fetchMock.mockReset();
  mockKeychain.clear();
  await AsyncStorage.clear();
  queryClient.clear();
  useSessionStore.setState({ status: 'loading', member: null, promptOpen: false, intent: null, notice: null, passwordChangeEmail: null });
});

describe('restoring a session (AUTH-01)', () => {
  it('asks nobody without a token or a cached member', async () => {
    await expect(restoreMember()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('restores the member behind a token and caches it for an offline start', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    fetchMock.mockResolvedValueOnce(json(200, { data: ME }));
    const member = await restoreMember();
    expect(member).toEqual({ id: ME.id, username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null, nextStep: null, hasCover: false });
    expect(fetchMock.mock.calls[0]![0].headers.get('Authorization')).toBe('Bearer token-1');
    expect(queryClient.getQueryData(meKey)).toEqual(ME);
    expect(JSON.parse((await AsyncStorage.getItem('sc.sessionMember'))!)).toMatchObject({ id: ME.id, username: 'lukas.sc' });
  });

  it('keeps the cached member when the network is gone, and keeps the token', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    await AsyncStorage.setItem('sc.sessionMember', JSON.stringify({ id: ME.id, username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(restoreMember()).resolves.toMatchObject({ id: ME.id });
    expect(mockKeychain.get('sc.authToken')).toBe('token-1');
    expect(useSessionStore.getState().notice).toBeNull();
  });

  it('never hangs on a connection that does not answer', async () => {
    jest.useFakeTimers();
    mockKeychain.set('sc.authToken', 'token-1');
    await AsyncStorage.setItem('sc.sessionMember', JSON.stringify({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null }));
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));
    const restoring = restoreMember();
    await jest.advanceTimersByTimeAsync(3000);
    await expect(restoring).resolves.toMatchObject({ id: ME.id });
    jest.useRealTimers();
  });

  it('ends a session the server no longer knows, and says so', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Bitte melde dich an.', code: 'unauthenticated', errors: {} }));
    await expect(restoreMember()).resolves.toBeNull();
    expect(mockKeychain.has('sc.authToken')).toBe(false);
    expect(useSessionStore.getState().notice).toEqual({ kind: 'expired' });
  });

  it('shows a suspension with the server message', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    fetchMock.mockResolvedValueOnce(json(403, { message: 'Dein Konto ist gesperrt.', code: 'account_restricted', errors: {} }));
    await expect(restoreMember()).resolves.toBeNull();
    expect(useSessionStore.getState().notice).toEqual({ kind: 'restricted', message: 'Dein Konto ist gesperrt.' });
  });

  it('sends a member who must change the password to AUTH-07 with the address', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    fetchMock.mockResolvedValueOnce(
      json(403, { message: 'Neues Passwort nötig.', code: 'password_change_required', next: 'reset_password', email: ME.email, errors: {} }),
    );
    await expect(restoreMember()).resolves.toBeNull();
    await flush();
    expect(useSessionStore.getState().passwordChangeEmail).toBe(ME.email);
    expect(mockKeychain.has('sc.authToken')).toBe(false);
  });
});

describe('401 while signed in', () => {
  it('ends a held session through the API gate event, with the dialog', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Bitte melde dich an.', code: 'unauthenticated', errors: {} }));
    await expect(apiData(api.GET('/auth/me'))).rejects.toMatchObject({ kind: 'unauthenticated' });
    await flush();
    expect(useSessionStore.getState()).toMatchObject({ status: 'guest', member: null, notice: { kind: 'expired' } });
    expect(mockKeychain.has('sc.authToken')).toBe(false);
  });

  it('forgets the cached member and the persisted query cache with it', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    await AsyncStorage.setItem('sc.sessionMember', JSON.stringify({ id: ME.id, username: 'lukas.sc' }));
    await AsyncStorage.setItem('sc.queryCache', '{"clientState":{}}');
    queryClient.setQueryData(meKey, ME);
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    await expireSession();
    expect(await AsyncStorage.getItem('sc.sessionMember')).toBeNull();
    expect(await AsyncStorage.getItem('sc.queryCache')).toBeNull();
    expect(queryClient.getQueryData(meKey)).toBeUndefined();
  });

  it('raises nothing for a guest', async () => {
    useSessionStore.setState({ status: 'guest' });
    await expireSession();
    expect(useSessionStore.getState().notice).toBeNull();
  });
});

describe('signing out', () => {
  it('clears token, cached member and query cache, and keeps the theme', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    await AsyncStorage.setItem('sc.sessionMember', '{}');
    await AsyncStorage.setItem('sc.theme', 'light');
    await AsyncStorage.setItem('sc.queryCache', '{"clientState":{}}');
    queryClient.setQueryData(meKey, ME);
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await signOut();

    expect(fetchMock.mock.calls[0]![0].url).toMatch(/\/auth\/logout$/);
    expect(mockKeychain.has('sc.authToken')).toBe(false);
    expect(await AsyncStorage.getItem('sc.sessionMember')).toBeNull();
    expect(queryClient.getQueryData(meKey)).toBeUndefined();
    // The persisted cache too: the next start must not show the member's data to whoever comes next.
    expect(await AsyncStorage.getItem('sc.queryCache')).toBeNull();
    expect(await AsyncStorage.getItem('sc.theme')).toBe('light');
    expect(useSessionStore.getState()).toMatchObject({ status: 'guest', notice: null });
  });

  it('signs out offline too', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await signOut();
    expect(useSessionStore.getState().status).toBe('guest');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('sc.authToken');
  });
});

describe('the server answers for another member (BH-28)', () => {
  const OTHER = { ...ME, id: '01JOTHER', username: 'nina.neu', email: 'nina@speedclub.test' } as unknown as Me;
  const garageKey = ['garage', 'vehicle', '01H'];

  it('adoptMe drops what the previous member loaded, and asks to go home', async () => {
    await AsyncStorage.setItem('sc.queryCache', '{"clientState":{}}');
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    queryClient.setQueryData(garageKey, { title: 'Lukas Entwurf' });
    adoptMe(OTHER);
    await flush();
    expect(queryClient.getQueryData(garageKey)).toBeUndefined();
    expect(queryClient.getQueryData(meKey)).toEqual(OTHER);
    expect(await AsyncStorage.getItem('sc.queryCache')).toBeNull();
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', member: { id: OTHER.id }, memberChanged: true });
    expect(JSON.parse((await AsyncStorage.getItem('sc.sessionMember'))!)).toMatchObject({ id: OTHER.id });
  });

  it('adoptMe keeps everything for the same member', async () => {
    useSessionStore.setState({ memberChanged: false });
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    queryClient.setQueryData(garageKey, { title: 'Lukas Entwurf' });
    adoptMe(ME as unknown as Me);
    expect(queryClient.getQueryData(garageKey)).toEqual({ title: 'Lukas Entwurf' });
    expect(useSessionStore.getState().memberChanged).toBe(false);
  });

  it('a restore that confirms another member than the cached one drops what is cached', async () => {
    useSessionStore.setState({ memberChanged: false });
    mockKeychain.set('sc.authToken', 'token-1');
    await AsyncStorage.setItem('sc.sessionMember', JSON.stringify({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null }));
    queryClient.setQueryData(garageKey, { title: 'Lukas Entwurf' });
    fetchMock.mockResolvedValueOnce(json(200, { data: OTHER }));
    await expect(restoreMember()).resolves.toMatchObject({ id: OTHER.id });
    expect(queryClient.getQueryData(garageKey)).toBeUndefined();
    expect(useSessionStore.getState().memberChanged).toBe(true);
  });

  it('a restore that confirms the cached member keeps it all', async () => {
    useSessionStore.setState({ memberChanged: false });
    mockKeychain.set('sc.authToken', 'token-1');
    await AsyncStorage.setItem('sc.sessionMember', JSON.stringify({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null }));
    queryClient.setQueryData(garageKey, { title: 'Lukas Entwurf' });
    fetchMock.mockResolvedValueOnce(json(200, { data: ME }));
    await restoreMember();
    expect(queryClient.getQueryData(garageKey)).toEqual({ title: 'Lukas Entwurf' });
    expect(useSessionStore.getState().memberChanged).toBe(false);
  });
});

describe('a sign-out the server did not hear (BH-33, native)', () => {
  const SLOT = 'sc.logoutPending';
  const signedInWithToken = () => {
    mockKeychain.set('sc.authToken', 'token-1');
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
  };

  afterEach(() => onlineManager.setOnline(true));

  it('keeps the old token in a slot of its own, and sends it no other way', async () => {
    signedInWithToken();
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await signOut();
    expect(mockKeychain.has('sc.authToken')).toBe(false);
    // With its member: a sign-in of somebody else revokes it first, a sign-in of the same member replaced it.
    expect(JSON.parse(mockKeychain.get(SLOT)!)).toEqual({ token: 'token-1', member: ME.id });

    fetchMock.mockResolvedValueOnce(json(200, { data: [] }));
    await apiData(api.GET('/catalog/makes'));
    expect(fetchMock.mock.calls[1]![0].headers.get('Authorization')).toBeNull();
  });

  it('remembers nothing after a 204 or a 401', async () => {
    signedInWithToken();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await signOut();
    expect(mockKeychain.has(SLOT)).toBe(false);

    signedInWithToken();
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Bitte melde dich an.', code: 'unauthenticated', errors: {} }));
    await signOut();
    expect(mockKeychain.has(SLOT)).toBe(false);
  });

  it('retries from the restore, with that token, and clears the slot on a 204', async () => {
    mockKeychain.set(SLOT, 'token-1');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(restoreMember()).resolves.toBeNull();
    await flush();
    const request = fetchMock.mock.calls[0]![0];
    expect(request.url).toMatch(/\/auth\/logout$/);
    expect(request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(mockKeychain.has(SLOT)).toBe(false);
  });

  it('clears the slot on a 401 too, without raising the expired dialog', async () => {
    mockKeychain.set(SLOT, 'token-1');
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Bitte melde dich an.', code: 'unauthenticated', errors: {} }));
    await restoreMember();
    await flush();
    expect(mockKeychain.has(SLOT)).toBe(false);
    expect(useSessionStore.getState().notice).toBeNull();
  });

  it('keeps the slot while the server stays out of reach, and retries once the device is online', async () => {
    mockKeychain.set(SLOT, 'token-1');
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await restoreMember();
    await flush();
    expect(mockKeychain.get(SLOT)).toBe('token-1');

    useSessionStore.setState({ status: 'guest' });
    onlineManager.setOnline(false);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    onlineManager.setOnline(true);
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockKeychain.has(SLOT)).toBe(false);
  });

  it('asks nothing while a member is signed in: that sign-in already replaced the token', async () => {
    mockKeychain.set(SLOT, 'token-1');
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    mockKeychain.delete(SLOT);
  });
});

describe('a password reset while signed in (AUTH-07)', () => {
  it('forgets the session the reset ended, without the expired dialog and without a call', async () => {
    mockKeychain.set('sc.authToken', 'token-1');
    await AsyncStorage.setItem('sc.sessionMember', '{}');
    await AsyncStorage.setItem('sc.queryCache', '{}');
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    await endLocalSessionQuietly();
    expect(useSessionStore.getState()).toMatchObject({ status: 'guest', member: null, notice: null });
    expect(mockKeychain.has('sc.authToken')).toBe(false);
    expect(await AsyncStorage.getItem('sc.sessionMember')).toBeNull();
    expect(await AsyncStorage.getItem('sc.queryCache')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves a guest as it is', async () => {
    useSessionStore.setState({ status: 'guest' });
    await AsyncStorage.setItem('sc.settingsSynced', '{}');
    await endLocalSessionQuietly();
    expect(useSessionStore.getState()).toMatchObject({ status: 'guest', notice: null });
    expect(await AsyncStorage.getItem('sc.settingsSynced')).toBe('{}');
  });
});

describe('settings sync (§11)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  it('sends nothing while a sign-in applies the account, with the change watcher running (BH-35)', async () => {
    setThemePreference('carbon');
    await AsyncStorage.removeItem('sc.theme');
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    await renderHook(() => useSettingsSync());

    await act(async () => {
      await reconcileSettings({ theme: 'light', locale: 'en' });
      await flush();
    });
    await act(flush);

    expect(getThemePreference()).toBe('light');
    expect(i18n.language).toBe('en');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem('sc.settingsSynced'))!)).toEqual({ theme: 'light', locale: 'en' });
    await i18n.changeLanguage('de');
    setThemePreference('carbon');
  });

  it('still sends a choice the member makes while signed in', async () => {
    setThemePreference('carbon');
    await AsyncStorage.setItem('sc.settingsSynced', JSON.stringify({ theme: 'carbon', locale: 'de' }));
    setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null });
    await renderHook(() => useSettingsSync());
    fetchMock.mockResolvedValue(json(200, { data: { theme: 'black', locale: 'de', power_display: 'ps' } }));

    await act(async () => {
      setThemePreference('black');
      await flush();
    });
    await act(flush);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await fetchMock.mock.calls[0]![0].json()).toEqual({ theme: 'black' });
    setThemePreference('carbon');
  });

  it('applies the account when the device made no newer choice', async () => {
    await reconcileSettings({ theme: 'light', locale: 'en' });
    expect(getThemePreference()).toBe('light');
    expect(i18n.language).toBe('en');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem('sc.settingsSynced'))!)).toEqual({ theme: 'light', locale: 'en' });
    await i18n.changeLanguage('de');
  });

  it('sends a choice made on the device since the last sync', async () => {
    await AsyncStorage.setItem('sc.settingsSynced', JSON.stringify({ theme: 'carbon', locale: 'de' }));
    setThemePreference('black');
    await AsyncStorage.setItem('sc.theme', 'black');
    fetchMock.mockResolvedValueOnce(json(200, { data: { theme: 'black', locale: 'de', power_display: 'ps' } }));

    await reconcileSettings({ theme: 'carbon', locale: 'de' });

    const request = fetchMock.mock.calls[0]![0];
    expect(request.method).toBe('PATCH');
    expect(await request.json()).toEqual({ theme: 'black' });
    expect(getThemePreference()).toBe('black');
  });
});
