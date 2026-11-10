// AUTH-10 in F1 and the push token on the server (docs/reports/phase-2/m2.2-contract.md §3, §5).
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { signOut } from '@/api/queries/auth';
import { PRIMER_PENDING_KEY, primerState, restorePrimer, usePrimerStore } from '@/features/auth/primer';
import { openPushResponse, pushTarget, registerPushToken, resetOpenedPushes, resetPushRegistration, usePushRegistration } from '@/features/auth/push';
import { routeForSession } from '@/features/auth/routing';
import { NotificationsPrimerScreen } from '@/features/auth/screens/NotificationsPrimerScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { callsTo, newQueryClient, stubFetch } from '../home/harness';
import { renderScreen } from '../settings/harness';

type Permission = { granted: boolean; canAskAgain: boolean; ios?: { status: number } };
const mockPermission: { current: Permission; asked: Permission } = {
  current: { granted: false, canAskAgain: true },
  asked: { granted: true, canAskAgain: true },
};
const mockTokenListeners = new Set<(token: { type: string; data: string }) => void>();
jest.mock('expo-notifications', () => ({
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(async () => mockPermission.current),
  requestPermissionsAsync: jest.fn(async () => {
    mockPermission.current = mockPermission.asked;
    return mockPermission.asked;
  }),
  setNotificationChannelAsync: jest.fn(async () => null),
  getExpoPushTokenAsync: jest.fn(async (options: { devicePushToken?: { data: string } }) => ({
    type: 'expo',
    data: options.devicePushToken ? `ExponentPushToken[${options.devicePushToken.data}]` : 'ExponentPushToken[first]',
  })),
  addPushTokenListener: jest.fn((listener: (token: { type: string; data: string }) => void) => {
    mockTokenListeners.add(listener);
    return { remove: () => mockTokenListeners.delete(listener) };
  }),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => mockLastResponse.current),
  clearLastNotificationResponse: jest.fn(() => {
    mockLastResponse.current = null;
  }),
}));
const mockLastResponse: { current: unknown } = { current: null };
const responseOf = (identifier: string, data: Record<string, unknown>) => ({
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: { date: 0, request: { identifier, content: { title: 'SPEED CLUB', body: null, data }, trigger: null } },
});
const mockNotifications = jest.requireMock<Record<string, jest.Mock>>('expo-notifications');
const mockDevice = { isDevice: true };
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockDevice.isDevice;
  },
  modelName: 'Pixel 9',
  osName: 'Android',
}));
const mockExtra: { projectId: string | undefined } = { projectId: 'eas-project' };
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { eas: { projectId: mockExtra.projectId } } };
    },
    easConfig: undefined,
  },
}));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => false) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  // Imports run first, before the const above has its value.
  get router() {
    return mockRouter;
  },
  usePathname: () => '/notifications-primer',
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => (key === 'sc.deviceId' ? 'device-1' : null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void mockStorage.set(key, value)),
    removeItem: jest.fn(async (key: string) => void mockStorage.delete(key)),
    multiRemove: jest.fn(async () => undefined),
  },
}));

const signIn = (id = 'm1') => useSessionStore.setState({ status: 'member', member: { id, username: 'lukas.sc', displayName: null, avatarUrl: null } });
const tokenCalls = (calls: readonly Request[]) => callsTo(calls, '/me/push-tokens').filter((request) => request.method === 'POST');

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  mockTokenListeners.clear();
  mockPermission.current = { granted: false, canAskAgain: true };
  mockPermission.asked = { granted: true, canAskAgain: true };
  mockDevice.isDevice = true;
  mockExtra.projectId = 'eas-project';
  resetPushRegistration();
  resetOpenedPushes();
  mockLastResponse.current = null;
  usePrimerStore.setState({ state: 'idle' });
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('AUTH-10 in the F1 routing (native)', () => {
  const member = { status: 'member' as const, nextStep: null, primer: true };

  it('follows the profile with the primer, and goes on to the garage once the member chose', () => {
    expect(routeForSession({ ...member, pathname: '/profile-setup' })).toEqual({ type: 'go', path: '/notifications-primer' });
    expect(routeForSession({ ...member, pathname: '/notifications-primer', primerState: 'due' })).toEqual({ type: 'stay' });
    expect(routeForSession({ ...member, pathname: '/notifications-primer', primerState: 'idle' })).toEqual({ type: 'stay' });
    expect(routeForSession({ ...member, pathname: '/notifications-primer', primerState: 'answered' })).toEqual({ type: 'finish', fallback: '/garage' });
  });

  it('resumes an open primer after a restart, with a link the app was opened on kept for after it', () => {
    expect(routeForSession({ ...member, pathname: '/', primerState: 'due' })).toEqual({ type: 'go', path: '/notifications-primer' });
    expect(routeForSession({ ...member, pathname: '/v/skyline', primerState: 'due' })).toEqual({ type: 'go', path: '/notifications-primer', resume: '/v/skyline' });
    expect(routeForSession({ ...member, pathname: '/', primerState: 'idle' })).toEqual({ type: 'stay' });
  });

  it('moves on at once on the web, which has no push, and sends a guest to sign in', () => {
    expect(routeForSession({ status: 'member', nextStep: null, pathname: '/profile-setup', primer: false })).toEqual({ type: 'finish', fallback: '/garage' });
    expect(routeForSession({ status: 'member', nextStep: null, pathname: '/notifications-primer', primer: false })).toEqual({ type: 'finish', fallback: '/garage' });
    expect(routeForSession({ status: 'guest', pathname: '/notifications-primer', primer: true })).toEqual({ type: 'go', path: '/sign-in' });
  });

  it('keeps an open primer per member on the device, and drops another member’s mark', async () => {
    mockStorage.set(PRIMER_PENDING_KEY, 'm1');
    await restorePrimer('m1');
    expect(primerState()).toBe('due');
    await restorePrimer('m2');
    expect(primerState()).toBe('idle');
    expect(mockStorage.has(PRIMER_PENDING_KEY)).toBe(false);
  });
});

describe('AUTH-10 Mitteilungen', () => {
  it('explains first, asks the OS only on "Mitteilungen erlauben", and sends the token', async () => {
    signIn();
    const { calls } = stubFetch({ '/me/push-tokens': { body: {} } });
    await renderScreen(<NotificationsPrimerScreen />);
    expect(screen.getByTestId('AUTH-10.title')).toHaveTextContent('Bleib auf dem Laufenden');
    await waitFor(() => expect(primerState()).toBe('due'));
    expect(mockStorage.get(PRIMER_PENDING_KEY)).toBe('m1');
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('AUTH-10.cta.primary'));
    await waitFor(() => expect(primerState()).toBe('answered'));
    // The channel Android 13 needs before its prompt; the test renderer runs as iOS, which has none.
    expect(mockNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(tokenCalls(calls)).toHaveLength(1));
    expect(await tokenCalls(calls)[0]?.clone().json()).toEqual({ token: 'ExponentPushToken[first]', platform: 'ios', device_id: 'device-1' });
    expect(mockStorage.has(PRIMER_PENDING_KEY)).toBe(false);
  });

  it('goes on without the OS prompt on "Später"', async () => {
    signIn();
    const { calls } = stubFetch({});
    await renderScreen(<NotificationsPrimerScreen />);
    await waitFor(() => expect(primerState()).toBe('due'));
    await fireEvent.press(screen.getByTestId('AUTH-10.later'));
    await waitFor(() => expect(primerState()).toBe('answered'));
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(tokenCalls(calls)).toHaveLength(0);
  });

  it('passes by itself when the OS has decided already: allowed sends the token, refused sends nothing', async () => {
    signIn();
    mockPermission.current = { granted: true, canAskAgain: true };
    const { calls } = stubFetch({ '/me/push-tokens': { body: {} } });
    await renderScreen(<NotificationsPrimerScreen />);
    await waitFor(() => expect(primerState()).toBe('answered'));
    await waitFor(() => expect(tokenCalls(calls)).toHaveLength(1));
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('answers a denied OS prompt and goes on, with nothing sent', async () => {
    signIn();
    mockPermission.asked = { granted: false, canAskAgain: false };
    const { calls } = stubFetch({});
    await renderScreen(<NotificationsPrimerScreen />);
    await waitFor(() => expect(primerState()).toBe('due'));
    await fireEvent.press(screen.getByTestId('AUTH-10.cta.primary'));
    await waitFor(() => expect(primerState()).toBe('answered'));
    expect(tokenCalls(calls)).toHaveLength(0);
  });
});

describe('push token registration', () => {
  it('sends nothing without the permission, on a simulator, or without an EAS project id', async () => {
    signIn();
    const { calls } = stubFetch({ '/me/push-tokens': { body: {} } });
    expect(await registerPushToken()).toBe('not_permitted');
    mockPermission.current = { granted: true, canAskAgain: true };
    mockDevice.isDevice = false;
    expect(await registerPushToken()).toBe('unavailable');
    mockDevice.isDevice = true;
    mockExtra.projectId = undefined;
    expect(await registerPushToken()).toBe('unavailable');
    expect(tokenCalls(calls)).toHaveLength(0);
  });

  it('sends a token once per member, again for a new token or another member, and reports a refused call', async () => {
    mockPermission.current = { granted: true, canAskAgain: true };
    let fail = false;
    const { calls } = stubFetch({ '/me/push-tokens': () => (fail ? { status: 500, body: { message: 'Serverfehler', code: 'server', errors: {} } } : { body: {} }) });
    expect(await registerPushToken()).toBe('unavailable');
    signIn();
    expect(await registerPushToken()).toBe('sent');
    expect(await registerPushToken()).toBe('sent');
    expect(tokenCalls(calls)).toHaveLength(1);
    expect(await registerPushToken({ type: 'android', data: 'fcm-2' })).toBe('sent');
    expect(await tokenCalls(calls)[1]?.clone().json()).toMatchObject({ token: 'ExponentPushToken[fcm-2]' });
    signIn('m2');
    fail = true;
    expect(await registerPushToken()).toBe('failed');
  });

  it('deletes the device’s token at sign-out, before the logout', async () => {
    signIn();
    mockPermission.current = { granted: true, canAskAgain: true };
    const order: string[] = [];
    stubFetch({
      '/me/push-tokens': { body: {} },
      '/me/push-tokens/device-1': (request) => {
        order.push(`${request.method} push`);
        return { body: {} };
      },
      '/auth/logout': () => {
        order.push('logout');
        return { body: {} };
      },
    });
    await registerPushToken();
    await act(() => signOut());
    expect(order).toEqual(['DELETE push', 'logout']);
  });

  it('opens Mitteilungen from a tapped push unless it names an internal page', () => {
    expect(pushTarget({ type: 'new_follower', notification_id: 'n1' })).toBe('/notifications');
    expect(pushTarget({ path: '/v/skyline' })).toBe('/v/skyline');
    expect(pushTarget({ path: '/u/lukas.sc' })).toBe('/u/lukas.sc');
    for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/%2F%2Fevil.example', 'u/lukas.sc', 'speedclub://u/x', 42]) {
      expect(pushTarget({ path })).toBe('/notifications');
    }
    expect(pushTarget(null)).toBe('/notifications');
  });
});

describe('a tapped push (M2.2 review 16, 17)', () => {
  const READ = { body: { data: {} } };

  it('marks its row read and opens its page, once per tap', async () => {
    signIn();
    const { calls } = stubFetch({ '/notifications/n-7': READ });
    const client = newQueryClient();
    const response = responseOf('push-1', { type: 'new_follower', notification_id: 'n-7', path: '/u/lukas.sc' });
    expect(openPushResponse(client, response as never)).toBe(true);
    expect(mockRouter.push).toHaveBeenCalledWith('/u/lukas.sc');
    await waitFor(() => expect(callsTo(calls, '/notifications/n-7')).toHaveLength(1));
    const patch = callsTo(calls, '/notifications/n-7')[0];
    expect(patch?.method).toBe('PATCH');
    expect(await patch?.clone().json()).toEqual({ read: true });
    // The cold start and the listener may both report it.
    expect(openPushResponse(client, response as never)).toBe(false);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('opens nothing for a guest', () => {
    const { calls } = stubFetch({});
    expect(openPushResponse(newQueryClient(), responseOf('push-2', { notification_id: 'n-8', path: '/u/x' }) as never)).toBe(false);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('opens the push that started the app once the session is restored and the navigator is ready, then clears it', async () => {
    jest.useFakeTimers();
    try {
      const { calls } = stubFetch({ '/notifications/n-9': READ, '/me/push-tokens': { body: {} } });
      mockLastResponse.current = responseOf('cold-1', { notification_id: 'n-9', path: '/v/skyline' });
      useSessionStore.setState({ status: 'loading', member: null });
      const client = newQueryClient();
      const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
      const { rerender } = await renderHook(({ ready }: { ready: boolean }) => usePushRegistration(ready), { wrapper, initialProps: { ready: false } });
      await act(async () => jest.advanceTimersByTimeAsync(10));
      expect(mockNotifications.getLastNotificationResponse).not.toHaveBeenCalled();

      await act(async () => signIn());
      await act(async () => jest.advanceTimersByTimeAsync(10));
      expect(mockNotifications.getLastNotificationResponse).not.toHaveBeenCalled();

      await rerender({ ready: true });
      await act(async () => jest.advanceTimersByTimeAsync(10));
      expect(mockRouter.push).toHaveBeenCalledWith('/v/skyline');
      expect(mockNotifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTimeAsync(10));
      expect(callsTo(calls, '/notifications/n-9')).toHaveLength(1);

      // Read once per start: a later render or member change does not open it again.
      await rerender({ ready: true });
      await act(async () => jest.advanceTimersByTimeAsync(10));
      expect(mockNotifications.getLastNotificationResponse).toHaveBeenCalledTimes(1);
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
