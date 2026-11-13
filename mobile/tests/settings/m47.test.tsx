// M4.7 account security (09 §7.9, §8.3, §8.4): SET-06 restyle, SET-21 Sicherheitsaktivität with "Das war ich nicht", AUTH-17
// /auth/secure (a tap before any POST), SET-20 App-Sperre and AUTH-15 behind the biometrics adapter, os_version at sign-in.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import type { QueryClient } from '@tanstack/react-query';

import { secureTokenFromHash } from '@/api/queries/accountSecurity';
import { deviceFields, meKey, type Me } from '@/api/queries/auth';
import { useRecentAuthStore } from '@/api/queries/recentAuth';
import { queryClient } from '@/api/queryClient';
import { SecureAccountScreen } from '@/features/auth/screens/SecureAccountScreen';
import { forgetSecuredAccount, holdSecuredAccount, useSecuredAccountStore } from '@/features/auth/securedAccount';
import { routeForSession, isGuestPath } from '@/features/auth/routing';
import { APP_LOCK_DEFAULTS, locksAfter, parseAppLock, saveAppLock, useAppLockStore } from '@/features/settings/appLock/appLock';
import { AppLockHost } from '@/features/settings/appLock/AppLockHost';
import { __setLocalAuthenticationForTests, biometricSupport } from '@/features/settings/appLock/biometrics';
import { visibleGroups } from '@/features/settings/navigation';
import { AppLockScreen } from '@/features/settings/screens/AppLockScreen';
import { SecurityActivityScreen } from '@/features/settings/screens/SecurityActivityScreen';
import { SessionsScreen } from '@/features/settings/screens/SessionsScreen';
import { setGuest, setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { dismissToast } from '@/ui/toast';

import { newQueryClient, renderScreen as renderWith, stubFetch, type Answer } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
const mockKeychain = new Map<string, string>();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/settings/security/activity',
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Redirect: () => null,
  Link: ({ children }: { children: unknown }) => children,
}));
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
jest.mock('expo-crypto', () => ({ randomUUID: () => '0d4c6a0e-7a3b-4c1e-9d55-3f1a2b3c4d5e' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  AndroidHaptics: {},
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ME = {
  id: '01m6f7ztzfs0gd39t08rs9zmmp',
  email: 'sven.e30@speedclub.test',
  email_verified: true,
  username: 'sven.e30',
  display_name: 'Sven',
  next_step: null,
  password_set: true,
  two_factor_enabled: false,
} as unknown as Me;

const EVENT_ID = '01jcz8q3m5w6x7y8z9a0b1c2d3';
const OTHER_ID = '01jcz8q3m5w6x7y8z9a0b1c2d4';
const TOKEN = `${EVENT_ID}.0f1e2d3c4b5a69788796a5b4c3d2e1f0`;

const event = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: 'new_device',
  occurred_at: '2026-11-12T18:30:00+00:00',
  device: { name: 'Pixel 9', platform: 'android' },
  this_device: false,
  approx_city: null,
  method: 'email_code',
  by_staff: false,
  details: {},
  can_secure: true,
  ...overrides,
});

const SECURED = {
  signed_out: true,
  ticket_reference: 'SC-7H2KQXMB',
  devices_signed_out: 2,
  sessions_signed_out: 1,
  password_reset_required: true,
  removed: { passkeys: 1, providers: 0, email_change: true, two_factor: false },
};

async function bodiesTo(calls: Request[], path: string, method = 'POST'): Promise<Record<string, unknown>[]> {
  const matching = calls.filter((request) => request.method === method && new URL(request.url).pathname.endsWith(path));
  return Promise.all(matching.map(async (request) => JSON.parse((await request.clone().text()) || '{}') as Record<string, unknown>));
}

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) => renderWith(element, client);

function signIn() {
  mockKeychain.set('sc.authToken', 'token-1');
  setMember({ id: ME.id, username: 'sven.e30', displayName: 'Sven', avatarUrl: null, nextStep: null });
  client.setQueryData(meKey, ME);
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  mockParams = {};
  mockKeychain.clear();
  forgetSecuredAccount();
  useRecentAuthStore.setState({ pending: null });
  useAppLockStore.setState({ settings: APP_LOCK_DEFAULTS, hydrated: false, locked: false, covered: false });
  __setLocalAuthenticationForTests(undefined);
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null, notice: null, passwordChangeEmail: null });
});
afterEach(() => {
  client.clear();
  queryClient.clear();
  dismissToast();
});
afterAll(() => setGuest());

describe('sign-in and token rotation carry the system version (09 §8.4)', () => {
  it('sends os_version with the device fields', async () => {
    expect(await deviceFields()).toEqual(expect.objectContaining({ os_version: expect.any(String), app_version: expect.any(String) }));
  });
});

describe('SET-06 Geräte & Sitzungen', () => {
  const sessions = (rows: unknown[]): Answer => ({ body: { data: rows } });
  const row = (overrides: Record<string, unknown>) => ({
    id: 't1',
    kind: 'app',
    device_name: 'iPhone 15 Pro',
    platform: 'ios',
    app_version: '1.4.0',
    last_used_at: '2026-11-12T10:00:00Z',
    current: true,
    os_version: '26.1',
    approx_city: null,
    signed_in_at: '2026-11-03T09:00:00Z',
    ...overrides,
  });

  it('puts this device in its own group with system version and sign-in date, and shows a place only when there is one', async () => {
    signIn();
    stubFetch({
      '/me/sessions': sessions([
        row({}),
        row({ id: 't2', device_name: 'Pixel 9', platform: 'android', os_version: '16', current: false, approx_city: 'München' }),
        row({ id: 'w9', kind: 'web', device_name: 'Chrome auf macOS', platform: 'web', os_version: null, current: false, signed_in_at: null, app_version: null }),
      ]),
    });
    await renderScreen(<SessionsScreen />);
    expect(await screen.findByTestId('SET-06.current')).toBeTruthy();
    expect(screen.getByTestId('SET-06.others')).toBeTruthy();
    expect(screen.getByTestId('SET-06.row.t1.meta')).toHaveTextContent(/iOS.26\.1/);
    expect(screen.getByTestId('SET-06.row.t1.detail')).toHaveTextContent(/Angemeldet seit 3\. November 2026/);
    expect(screen.getByTestId('SET-06.row.t1.detail')).not.toHaveTextContent(/ungefähr/);
    expect(screen.getByTestId('SET-06.row.t2.detail')).toHaveTextContent(/ungefähr.München/);
    // A browser has no system version and no sign-in date: no second line.
    expect(screen.queryByTestId('SET-06.row.w9.detail')).toBeNull();
    expect(screen.getByTestId('SET-06.row.t1.glyph')).toBeTruthy();
  });

  it('"Alle anderen abmelden" asks first, then for recent authentication when the server wants it', async () => {
    signIn();
    let deletes = 0;
    stubFetch({
      '/me/sessions': () => {
        deletes += 1;
        return deletes === 1
          ? sessions([row({}), row({ id: 't2', current: false })])
          : { status: 403, body: { message: 'Bitte bestätige kurz, dass du es bist.', code: 'reauthentication_required', errors: {}, methods: ['password'] } };
      },
    });
    await renderScreen(<SessionsScreen />);
    await fireEvent.press(await screen.findByTestId('SET-06.signOutOthers'));
    await fireEvent.press(screen.getByTestId('SET-06.dialog.confirm'));
    await waitFor(() => expect(useRecentAuthStore.getState().pending).not.toBeNull());
    await act(async () => useRecentAuthStore.getState().pending?.settle(false));
  });

  it('links to the security activity', async () => {
    signIn();
    stubFetch({ '/me/sessions': sessions([row({})]) });
    await renderScreen(<SessionsScreen />);
    await fireEvent.press(await screen.findByTestId('SET-06.activity'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/security/activity');
  });
});

describe('SET-21 Sicherheitsaktivität', () => {
  const page = (rows: unknown[], next: string | null = null): Answer => ({ body: { data: rows, meta: { next_cursor: next } } });

  it('lists what happened with device, method and time, and offers "Das war ich nicht" only where the server does', async () => {
    signIn();
    stubFetch({
      '/me/security-events': page([
        event(EVENT_ID),
        event(OTHER_ID, { type: 'sign_in_failed', can_secure: false, device: null, method: null, details: { count: 3, last_at: '2026-11-12T19:42:00+00:00' } }),
      ]),
    });
    await renderScreen(<SecurityActivityScreen />);
    expect(await screen.findByTestId(`SET-21.row.${EVENT_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`SET-21.row.${EVENT_ID}.title`)).toHaveTextContent('Anmeldung auf einem neuen Gerät');
    expect(screen.getByTestId(`SET-21.row.${EVENT_ID}.meta`)).toHaveTextContent(/Pixel.9 · mit E.*Mail.*Code/);
    expect(screen.getByTestId(`SET-21.row.${EVENT_ID}.when`)).toHaveTextContent(/12\. November 2026, \d\d:30 Uhr/);
    expect(screen.getByTestId(`SET-21.row.${OTHER_ID}.detail`)).toHaveTextContent(/3 falsche Versuche/);
    expect(screen.getByTestId(`SET-21.row.${EVENT_ID}.notMe`)).toBeTruthy();
    expect(screen.queryByTestId(`SET-21.row.${OTHER_ID}.notMe`)).toBeNull();
  });

  it('DQ-1014: red inline only on risky or marked rows, a "···" menu on routine ones, nothing on this device', async () => {
    signIn();
    const ROUTINE = '01JC0000000000000000000003';
    const MINE = '01JC0000000000000000000004';
    stubFetch({
      '/me/security-events': page([
        event(EVENT_ID),
        event(ROUTINE, { type: 'signed_in', device: { name: 'Chrome auf Windows', platform: 'web' } }),
        event(MINE, { type: 'signed_in', this_device: true }),
      ]),
    });
    await renderScreen(<SecurityActivityScreen />);
    expect(await screen.findByTestId(`SET-21.row.${EVENT_ID}.notMe`)).toBeTruthy();
    expect(screen.queryByTestId(`SET-21.row.${EVENT_ID}.more`)).toBeNull();
    expect(screen.queryByTestId(`SET-21.row.${ROUTINE}.notMe`)).toBeNull();
    expect(screen.getByTestId(`SET-21.row.${ROUTINE}.more`)).toBeTruthy();
    expect(screen.queryByTestId(`SET-21.row.${MINE}.notMe`)).toBeNull();
    expect(screen.queryByTestId(`SET-21.row.${MINE}.more`)).toBeNull();
    // The menu leads to the same question (the jest mocks never report the trigger's place: give it one).
    const native = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>('@react-native/jest-preset/jest/MockNativeMethods');
    native.default.measureInWindow.mockImplementation((done: (x: number, y: number, width: number, height: number) => void) => done(300, 400, 44, 44));
    await fireEvent.press(screen.getByTestId(`SET-21.row.${ROUTINE}.more`));
    await fireEvent.press(await screen.findByTestId(`SET-21.row.${ROUTINE}.more.menu.notMe`));
    expect(await screen.findByTestId('SET-21.dialog')).toBeTruthy();
  });

  it('DQ-1014: a marked routine row shows the inline action; DQ-1015: the question names every consequence, as AUTH-17 does', async () => {
    signIn();
    const ROUTINE = '01JC0000000000000000000003';
    mockParams = { event: ROUTINE };
    stubFetch({ '/me/security-events': page([event(ROUTINE, { type: 'signed_in' })]) });
    await renderScreen(<SecurityActivityScreen />);
    await fireEvent.press(await screen.findByTestId(`SET-21.row.${ROUTINE}.notMe`));
    const dialog = await screen.findByTestId('SET-21.dialog');
    expect(dialog).toHaveTextContent(/Anmeldemethoden, die nach dieser Anmeldung dazugekommen sind, entfernen wir/);
    expect(dialog).toHaveTextContent(/auf allen Geräten ab, auch hier/);
  });

  it('marks the row a link names (?event=)', async () => {
    signIn();
    mockParams = { event: OTHER_ID.toUpperCase() };
    stubFetch({ '/me/security-events': page([event(EVENT_ID), event(OTHER_ID)]) });
    await renderScreen(<SecurityActivityScreen />);
    expect(await screen.findByTestId(`SET-21.row.${OTHER_ID}.marked`)).toBeTruthy();
    expect(screen.queryByTestId(`SET-21.row.${EVENT_ID}.marked`)).toBeNull();
  });

  it('"Das war ich nicht" asks first, then secures with the row and an idempotency key, ends the session and shows the result', async () => {
    signIn();
    const { calls } = stubFetch({
      '/me/security-events': page([event(EVENT_ID)]),
      '/me/security/secure': { body: { data: SECURED } },
    });
    await renderScreen(<SecurityActivityScreen />);
    await fireEvent.press(await screen.findByTestId(`SET-21.row.${EVENT_ID}.notMe`));
    expect(screen.getByTestId('SET-21.dialog')).toBeTruthy();
    expect(await bodiesTo(calls, '/me/security/secure')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('SET-21.dialog.confirm'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/auth/secure'));
    expect(await bodiesTo(calls, '/me/security/secure')).toEqual([{ security_event_id: EVENT_ID }]);
    const request = calls.find((call) => call.url.endsWith('/me/security/secure'));
    expect(request?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(useSecuredAccountStore.getState().result?.ticket_reference).toBe('SC-7H2KQXMB');
    await waitFor(() => expect(useSessionStore.getState().status).toBe('guest'));
  });

  it('a refused secure says why and keeps the session', async () => {
    signIn();
    stubFetch({
      '/me/security-events': page([event(EVENT_ID)]),
      '/me/security/secure': { status: 500, body: { message: 'Das hat gerade nicht geklappt.', code: 'server_error', errors: {} } },
    });
    await renderScreen(<SecurityActivityScreen />);
    await fireEvent.press(await screen.findByTestId(`SET-21.row.${EVENT_ID}.notMe`));
    await fireEvent.press(screen.getByTestId('SET-21.dialog.confirm'));
    await waitFor(() => expect(screen.queryByTestId('SET-21.dialog')).toBeNull());
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe('member');
  });

  it('an empty log shows a badged sample row, an error offers a retry, a guest the invitation', async () => {
    signIn();
    stubFetch({ '/me/security-events': page([]) });
    const first = await renderScreen(<SecurityActivityScreen />);
    expect(await screen.findByTestId('SET-21.empty')).toBeTruthy();
    await first.unmount();
    client.clear();
    stubFetch({ '/me/security-events': { status: 403, body: { message: 'Nicht erlaubt.', code: 'forbidden', errors: {} } } });
    const second = await renderScreen(<SecurityActivityScreen />);
    expect(await screen.findByTestId('SET-21.error')).toBeTruthy();
    await second.unmount();
    setGuest();
    await renderScreen(<SecurityActivityScreen />);
    expect(screen.getByTestId('SET-21.guest')).toBeTruthy();
  });
});

describe('AUTH-17 /auth/secure', () => {
  it('reads the token and sends nothing until the tap (mail scanners open links)', async () => {
    mockParams = { t: TOKEN };
    const { calls } = stubFetch({ '/auth/secure-account': { body: { data: SECURED } }, '/sanctum/csrf-cookie': { status: 204, body: {} } });
    await renderScreen(<SecureAccountScreen />);
    expect(screen.getByTestId('AUTH-17.ready')).toBeTruthy();
    await act(async () => undefined);
    expect(calls.filter((call) => call.url.endsWith('/auth/secure-account'))).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('AUTH-17.cta.primary'));
    expect(await screen.findByTestId('AUTH-17.done')).toBeTruthy();
    expect(await bodiesTo(calls, '/auth/secure-account')).toEqual([{ token: TOKEN }]);
    expect(screen.getByTestId('AUTH-17.ticket')).toHaveTextContent('SC-7H2KQXMB');
    expect(screen.getByTestId('AUTH-17.removed')).toHaveTextContent(/1 Passkey/);
    expect(screen.getByTestId('AUTH-17.password')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('AUTH-17.cta.primary'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/auth/email'));
  });

  it('a used or expired link (422) and a link without a token say it no longer works', async () => {
    mockParams = { t: TOKEN };
    stubFetch({
      '/auth/secure-account': { status: 422, body: { message: 'Ungültig', code: 'validation_failed', errors: { token: ['Dieser Link funktioniert nicht mehr.'] } } },
      '/sanctum/csrf-cookie': { status: 204, body: {} },
    });
    const first = await renderScreen(<SecureAccountScreen />);
    await fireEvent.press(screen.getByTestId('AUTH-17.cta.primary'));
    expect(await screen.findByTestId('AUTH-17.invalid')).toBeTruthy();
    await first.unmount();
    mockParams = { t: 'not-a-token' };
    await renderScreen(<SecureAccountScreen />);
    expect(screen.getByTestId('AUTH-17.invalid')).toBeTruthy();
  });

  it('shows the result SET-21 handed over', async () => {
    holdSecuredAccount({ ...SECURED, removed: { passkeys: 0, providers: 0, email_change: false, two_factor: false }, password_reset_required: false });
    await renderScreen(<SecureAccountScreen />);
    expect(screen.getByTestId('AUTH-17.done')).toBeTruthy();
    expect(screen.queryByTestId('AUTH-17.removed')).toBeNull();
  });

  it('takes the token only in its shape from the fragment', () => {
    expect(secureTokenFromHash(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(secureTokenFromHash(`#t=${TOKEN}&t=${TOKEN}`)).toBeNull();
    expect(secureTokenFromHash('#t=abc')).toBeNull();
  });

  it('is never redirected away, and a guest may stay on it', () => {
    expect(routeForSession({ status: 'member', pathname: '/auth/secure' })).toEqual({ type: 'stay' });
    expect(routeForSession({ status: 'member', nextStep: 'accept_terms', pathname: '/auth/secure' })).toEqual({ type: 'stay' });
    expect(isGuestPath('/auth/secure')).toBe(true);
  });
});

describe('SET-20 App-Sperre and AUTH-15', () => {
  type Fake = Parameters<typeof __setLocalAuthenticationForTests>[0];
  const fake = (overrides: Partial<NonNullable<Fake>> = {}): NonNullable<Fake> => ({
    hasHardwareAsync: jest.fn(async () => true),
    isEnrolledAsync: jest.fn(async () => true),
    supportedAuthenticationTypesAsync: jest.fn(async () => [1]),
    getEnrolledLevelAsync: jest.fn(async () => 3),
    authenticateAsync: jest.fn(async () => ({ success: true })),
    ...overrides,
  });

  it('reads the device: fingerprint, face, a passcode only, or nothing', async () => {
    __setLocalAuthenticationForTests(fake());
    expect(await biometricSupport('android')).toEqual({ available: true, kind: 'fingerprint' });
    __setLocalAuthenticationForTests(fake({ supportedAuthenticationTypesAsync: jest.fn(async () => [2]) }));
    expect(await biometricSupport('ios')).toEqual({ available: true, kind: 'faceId' });
    __setLocalAuthenticationForTests(fake({ isEnrolledAsync: jest.fn(async () => false), getEnrolledLevelAsync: jest.fn(async () => 1) }));
    expect(await biometricSupport('android')).toEqual({ available: true, kind: 'passcode' });
    __setLocalAuthenticationForTests(fake({ isEnrolledAsync: jest.fn(async () => false), getEnrolledLevelAsync: jest.fn(async () => 0) }));
    expect(await biometricSupport('android')).toEqual({ available: false, reason: 'notEnrolled' });
    __setLocalAuthenticationForTests(null);
    expect(await biometricSupport('android')).toEqual({ available: false, reason: 'module' });
  });

  it('says "nicht verfügbar" where the build has no module, with nothing to switch on', async () => {
    signIn();
    __setLocalAuthenticationForTests(null);
    await renderScreen(<AppLockScreen />);
    expect(await screen.findByTestId('SET-20.unavailable')).toBeTruthy();
    expect(screen.getByText('In dieser App-Version noch nicht verfügbar.')).toBeTruthy();
  });

  it('turns on only after the device confirmed it is the owner, then offers the timeout and keeps the cover on', async () => {
    signIn();
    const module = fake();
    __setLocalAuthenticationForTests(module);
    await renderScreen(<AppLockScreen />);
    // Jest runs as iOS: a fingerprint there is Touch ID.
    expect(await screen.findByText('Mit Touch ID sperren')).toBeTruthy();
    await fireEvent(screen.getByTestId('SET-20.toggle.switch'), 'valueChange', true);
    await waitFor(() => expect(useAppLockStore.getState().settings.enabled).toBe(true));
    expect(module.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(useAppLockStore.getState().settings.cover).toBe(true);
    expect(await screen.findByTestId('SET-20.after.300')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('SET-20.after.300'));
    expect(useAppLockStore.getState().settings.after).toBe(300);
  });

  it('a cancelled prompt leaves it off', async () => {
    signIn();
    __setLocalAuthenticationForTests(fake({ authenticateAsync: jest.fn(async () => ({ success: false, error: 'user_cancel' })) }));
    await renderScreen(<AppLockScreen />);
    await fireEvent(await screen.findByTestId('SET-20.toggle.switch'), 'valueChange', true);
    await act(async () => undefined);
    expect(useAppLockStore.getState().settings.enabled).toBe(false);
  });

  it('parses only what it wrote, and locks after the chosen time away', () => {
    expect(parseAppLock('{"enabled":true,"after":300}')).toEqual({ enabled: true, after: 300, cover: true });
    expect(parseAppLock('{"enabled":true,"after":42}')).toEqual({ enabled: true, after: 0, cover: true });
    expect(parseAppLock('nonsense')).toEqual(APP_LOCK_DEFAULTS);
    expect(locksAfter({ enabled: true, after: 60, cover: true }, 59)).toBe(false);
    expect(locksAfter({ enabled: true, after: 60, cover: true }, 60)).toBe(true);
    expect(locksAfter({ enabled: false, after: 0, cover: true }, 999)).toBe(false);
  });

  it('covers the app in the switcher, locks on return and unlocks with the device', async () => {
    signIn();
    let answer: (value: { success: boolean }) => void = () => undefined;
    const module = fake({ authenticateAsync: jest.fn(() => new Promise<{ success: boolean }>((resolve) => (answer = resolve))) });
    __setLocalAuthenticationForTests(module);
    const listeners: ((state: AppStateStatus) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'change') listeners.push(handler as (state: AppStateStatus) => void);
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    const listener = (state: AppStateStatus) => listeners.forEach((handler) => handler(state));
    saveAppLock({ enabled: true, after: 0, cover: true });
    useAppLockStore.setState({ hydrated: true });
    await renderScreen(<AppLockHost />);
    await act(async () => listener('background'));
    expect(screen.getByTestId('AUTH-15.cover')).toBeTruthy();
    await act(async () => listener('active'));
    expect(screen.queryByTestId('AUTH-15.cover')).toBeNull();
    expect(useAppLockStore.getState().locked).toBe(true);
    expect(await screen.findByTestId('AUTH-15.root')).toBeTruthy();
    // The prompt runs as the lock appears; the device says yes.
    await waitFor(() => expect(module.authenticateAsync).toHaveBeenCalledTimes(1));
    await act(async () => answer({ success: true }));
    await waitFor(() => expect(useAppLockStore.getState().locked).toBe(false));
    spy.mockRestore();
  });

  it('is hidden on the web and listed natively (09 §7.15)', () => {
    const keys = (web: boolean) => visibleGroups(true, web).flatMap((group) => group.rows.map((row) => row.key));
    expect(keys(true)).not.toContain('appLock');
    expect(keys(false)).toContain('appLock');
    expect(keys(true)).toContain('activity');
  });
});
