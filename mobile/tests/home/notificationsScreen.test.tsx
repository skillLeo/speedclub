import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState, StyleSheet, type AppStateStatus } from 'react-native';
import type { ReactNode } from 'react';

import { meKey } from '@/api/queries/auth';
import { notificationKeys } from '@/api/queries/notifications';
import { NotificationsScreen } from '@/features/home/screens/NotificationsScreen';
import i18n from '@/i18n';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { notification, page } from './fixtures';
import { callsTo, newQueryClient, renderWithProviders, setNetwork, stubFetch, type NetInfoListener } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/notifications',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
type MockListProps = { data: readonly unknown[]; renderItem: (info: { item: unknown; index: number }) => ReactNode; keyExtractor?: (item: unknown) => string; ListEmptyComponent?: ReactNode; ListFooterComponent?: ReactNode };
jest.mock('@/features/shell/useRetainedListScroll', () => ({ useRetainedListScroll: () => ({ forget: jest.fn() }) }));
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), getScrollableNode: () => null }));
    const { data, renderItem, keyExtractor, ListEmptyComponent, ListFooterComponent } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, data.length === 0 ? ListEmptyComponent : items, ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => {
  const listeners = new Set<NetInfoListener>();
  return {
    listeners,
    addEventListener: jest.fn((listener: NetInfoListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
});
const mockNetListeners = jest.requireMock<{ listeners: Set<NetInfoListener> }>('@react-native-community/netinfo').listeners;
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
jest.mock('@/ui/toast', () => ({ ...jest.requireActual<object>('@/ui/toast'), toast: jest.fn() }));
const mockToast = jest.requireMock<{ toast: jest.Mock }>('@/ui/toast').toast;
const mockClock = { now: new Date('2026-11-08T12:00:00+01:00') };
jest.mock('@/lib/clock', () => ({ now: () => mockClock.now }));

const R34 = { id: '01r34', slug: 'nissan-skyline-gt-r-r34-xmeypf41', full_title: 'Nissan Skyline GT-R R34', cover: null };
const ROWS = [
  notification({ id: 'n-new', created_at: '2026-11-08T09:00:00+01:00' }),
  notification({
    id: 'n-pub',
    type: 'followed_published',
    vehicle: R34,
    details: { kind: 'vehicle', update_id: null, vehicles: 1, updates: 0 },
    read_at: '2026-11-07T20:00:00+01:00',
    created_at: '2026-11-07T19:00:00+01:00',
  }),
];
/** The dot is decorative (aria-hidden): the row's name says "Ungelesen". */
const HIDDEN = { includeHiddenElements: true };
const UNREAD = { body: { data: { notifications: 1, messages: 0, requests: 0 } } };

function signIn() {
  useSessionStore.setState({ status: 'member', member: { id: 'm1', username: 'nina.neu', displayName: null, avatarUrl: null } });
}

/** The app-state listeners the screen added: a return to the foreground is how a day change is noticed after the phone slept. */
const listeners: ((status: AppStateStatus) => void)[] = [];
beforeAll(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (status: AppStateStatus) => void);
    return { remove: () => listeners.splice(listeners.indexOf(listener as (status: AppStateStatus) => void), 1) } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});
beforeAll(hydrateThemePreference);
afterEach(() => setNetwork(true, mockNetListeners));
beforeEach(() => {
  jest.clearAllMocks();
  mockClock.now = new Date('2026-11-08T12:00:00+01:00');
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('HOME-02 Mitteilungen', () => {
  it('groups by day, marks unread rows in text and weight, and opens a row as read', async () => {
    signIn();
    const { calls } = stubFetch({
      '/notifications': { body: page(ROWS) },
      '/notifications/unread-count': UNREAD,
      '/notifications/n-new': { body: { data: { ...ROWS[0], read_at: '2026-11-08T12:00:00+01:00' } } },
    });
    await renderWithProviders(<NotificationsScreen />);

    expect(await screen.findByTestId('HOME-02.day.2026-11-08')).toHaveTextContent('Heute');
    expect(screen.getByTestId('HOME-02.day.2026-11-07')).toHaveTextContent('Gestern');
    expect(screen.getByTestId('HOME-02.row.n-new.text')).toHaveTextContent('@lukas.sc folgt dir jetzt');
    expect(screen.getByTestId('HOME-02.row.n-new.unread', HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('HOME-02.row.n-new.body')).toHaveAccessibleName(/^Ungelesen, @lukas\.sc folgt dir jetzt/);
    expect(screen.queryByTestId('HOME-02.row.n-pub.unread', HIDDEN)).toBeNull();
    // DQ-292: "vor 3 Std." only under Heute; under any other day header the clock time, never the date again.
    expect(screen.getByTestId('HOME-02.row.n-new')).toHaveTextContent(/vor 3 Std\./);
    expect(screen.getByTestId('HOME-02.row.n-pub')).toHaveTextContent(/19:00/);
    expect(screen.getByTestId('HOME-02.row.n-pub')).not.toHaveTextContent(/07\.11\.2026|gestern/);

    await fireEvent.press(screen.getByTestId('HOME-02.row.n-new.body'));
    expect(mockRouter.push).toHaveBeenCalledWith('/u/lukas.sc');
    await waitFor(() => expect(callsTo(calls, '/notifications/n-new')).toHaveLength(1));
    const patch = callsTo(calls, '/notifications/n-new')[0];
    expect(patch?.method).toBe('PATCH');
    expect(await patch?.clone().json()).toEqual({ read: true });
    await waitFor(() => expect(screen.queryByTestId('HOME-02.row.n-new.unread', HIDDEN)).toBeNull());

    await fireEvent.press(screen.getByTestId('HOME-02.row.n-pub.body'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${R34.slug}`);
    // A read row is not sent again.
    expect(callsTo(calls, '/notifications/n-pub')).toHaveLength(0);
  });

  it('marks all as read at once, and brings the marks back when the server refuses', async () => {
    signIn();
    let fail = false;
    const { calls } = stubFetch({
      '/notifications': { body: page(ROWS) },
      '/notifications/unread-count': UNREAD,
      '/notifications/read-all': () => (fail ? { status: 500, body: { message: 'Serverfehler', code: 'server', errors: {} } } : { status: 200, body: {} }),
    });
    const client = newQueryClient();
    // The badge's count, as the shell read it.
    client.setQueryData(notificationKeys.unread('m1'), { notifications: 1, messages: 0, requests: 0 });
    await renderWithProviders(<NotificationsScreen />, client);
    await screen.findByTestId('HOME-02.row.n-new.unread', HIDDEN);

    fail = true;
    await fireEvent.press(screen.getByTestId('HOME-02.readAll'));
    await waitFor(() => expect(screen.getByTestId('HOME-02.row.n-new.unread', HIDDEN)).toBeTruthy());
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Serverfehler', expect.objectContaining({ testID: 'HOME-02.toast' })));
    expect(client.getQueryData(notificationKeys.unread('m1'))).toMatchObject({ notifications: 1 });

    fail = false;
    await fireEvent.press(screen.getByTestId('HOME-02.readAll'));
    await waitFor(() => expect(screen.queryByTestId('HOME-02.row.n-new.unread', HIDDEN)).toBeNull());
    expect(client.getQueryData(notificationKeys.unread('m1'))).toMatchObject({ notifications: 0 });
    expect(callsTo(calls, '/notifications/read-all').every((request) => request.method === 'POST')).toBe(true);
    // Nothing unread: the action rests.
    await waitFor(() => expect(screen.getByTestId('HOME-02.readAll')).toBeDisabled());
  });

  // M2.2 review 25: a screen left open over midnight must not keep calling yesterday "Heute".
  it('moves "Heute" to "Gestern" when the day changes while it stays open', async () => {
    signIn();
    stubFetch({ '/notifications': { body: page(ROWS) }, '/notifications/unread-count': UNREAD });
    await renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByTestId('HOME-02.day.2026-11-08')).toHaveTextContent('Heute');

    mockClock.now = new Date('2026-11-09T07:30:00+01:00');
    await act(async () => listeners.forEach((listener) => listener('active')));
    expect(screen.getByTestId('HOME-02.day.2026-11-08')).toHaveTextContent('Gestern');
    expect(screen.getByTestId('HOME-02.day.2026-11-07')).toHaveTextContent('Sa., 7. Nov.');
  });

  it('waits with "Alle als gelesen markieren" while offline, and lines it up with the column (DQ-301, DQ-284)', async () => {
    signIn();
    stubFetch({ '/notifications': { body: page(ROWS) }, '/notifications/unread-count': UNREAD });
    await renderWithProviders(<NotificationsScreen />);
    await screen.findByTestId('HOME-02.row.n-new');
    expect(screen.getByTestId('HOME-02.readAll')).toBeEnabled();
    await setNetwork(false, mockNetListeners);
    expect(screen.getByTestId('HOME-02.readAll')).toBeDisabled();
    // Back online while mounted: the network state lives on after the screen.
    await setNetwork(true, mockNetListeners);
    expect(screen.getByTestId('HOME-02.readAll')).toBeEnabled();
  });

  it('says what still works for a restricted member: the notifications, not the builds (DQ-300)', async () => {
    signIn();
    const client = newQueryClient();
    client.setQueryData(meKey, {
      restrictions: { suspended: false, messaging: { restricted: true, until: null }, publishing: { restricted: false, until: null } },
    });
    stubFetch({ '/notifications': { body: page(ROWS) }, '/notifications/unread-count': UNREAD });
    await renderWithProviders(<NotificationsScreen />, client);
    expect(await screen.findByTestId('HOME-02.restricted')).toHaveTextContent(i18n.t('notifications.restricted', { ns: 'home', lng: 'de' }));
  });

  it('draws the loading state where the page will be: the band, a day header and the rows, without the state gap (DQ-286)', async () => {
    signIn();
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    await renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByTestId('HOME-02.skeleton')).toBeTruthy();
    expect(screen.getByTestId('HOME-02.skeleton.readAll')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('HOME-02.skeleton').parent?.props.style)?.paddingTop).toBeUndefined();
  });

  it('has a designed empty state', async () => {
    signIn();
    stubFetch({ '/notifications': { body: page([]) }, '/notifications/unread-count': UNREAD });
    await renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByTestId('HOME-02.empty')).toBeTruthy();
    expect(screen.getByTestId('HOME-02.empty.title')).toHaveTextContent('Noch keine Mitteilungen');
    expect(screen.queryByTestId('HOME-02.readAll')).toBeNull();
  });

  it('shows the error with a retry, and the offline state without a copy', async () => {
    signIn();
    let fail = true;
    stubFetch({
      '/notifications': () => (fail ? { status: 500, body: { message: 'Serverfehler', code: 'server', errors: {} } } : { body: page(ROWS) }),
      '/notifications/unread-count': UNREAD,
    });
    await renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByTestId('HOME-02.error')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByTestId('HOME-02.error.action'));
    expect(await screen.findByTestId('HOME-02.row.n-new')).toBeTruthy();
  });

  it('says it is offline when there is nothing on the device', async () => {
    signIn();
    stubFetch({ '/notifications': { body: page(ROWS) }, '/notifications/unread-count': UNREAD });
    await setNetwork(false, mockNetListeners);
    await renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByTestId('HOME-02.offline')).toBeTruthy();
    await setNetwork(true, mockNetListeners);
    expect(await screen.findByTestId('HOME-02.row.n-new')).toBeTruthy();
  });

  it('asks a guest to sign in and reads nothing', async () => {
    const { calls } = stubFetch({ '/notifications': { body: page(ROWS) } });
    await renderWithProviders(<NotificationsScreen />);
    expect(screen.getByTestId('HOME-02.guest')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('HOME-02.guest.action'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/notifications' } });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(callsTo(calls, '/notifications')).toHaveLength(0);
  });
});
