import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { meKey } from '@/api/queries/auth';
import { homeKeys, type FeedVehicle } from '@/api/queries/home';
import { HomeScreen, rememberHomeTab } from '@/features/home/screens/HomeScreen';
import { MessagingContext, unavailableMessaging } from '@/features/messages/data';
import { MessagesScreen } from '@/features/messages/screens/MessagesScreen';
import i18n from '@/i18n';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, space } from '@/theme';

import { activeMember, buildUpdate, FEATURED, feedPage, feedVehicle, GTI, M4, modules, page, R34, updateItem, vehicleItem } from './fixtures';
import { callsTo, newQueryClient, renderWithProviders, setNetwork, stubFetch, type Answer, type NetInfoListener } from './harness';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
  onEndReached?: (() => void) | null;
  scrollEnabled?: boolean;
  horizontal?: boolean;
};
/** What the last rendered list was given, so a test can reach its end. */
const mockLastList: { props: MockListProps | null } = { props: null };
const mockScrollToOffset = jest.fn();
const mockRetained = jest.fn((_list: unknown) => ({ forget: jest.fn() }));
jest.mock('@/features/shell/useRetainedListScroll', () => ({ useRetainedListScroll: (list: unknown) => mockRetained(list) }));
// Items render in place: virtualisation is FlashList's own business and needs a layout Jest does not have.
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: mockScrollToOffset, getScrollableNode: () => null }));
    // The page's own list, not the horizontal strip of Aktive Mitglieder inside it.
    if (!props.horizontal) mockLastList.props = props;
    const { data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, ListHeaderComponent, data.length === 0 ? ListEmptyComponent : items, ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
// The listeners live in the mock: the app's query client subscribes while this file's imports load.
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

beforeAll(hydrateThemePreference);
afterEach(() => setNetwork(true, mockNetListeners));
beforeEach(() => {
  jest.clearAllMocks();
  mockLastList.props = null;
  rememberHomeTab('for_you');
  mockParams = {};
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

/**
 * The footer row is the cards' row: the centred frame, and in it the column, with the footer's content on the column's start edge.
 * The frame is `HOME-01.footer`, the column carries the branch's own ID.
 */
function expectInColumn(columnTestID: string) {
  const frame = StyleSheet.flatten(screen.getByTestId('HOME-01.footer').props.style);
  const column = StyleSheet.flatten(screen.getByTestId(columnTestID).props.style);
  expect(frame).toMatchObject({ alignSelf: 'center', width: expect.any(Number) });
  expect(column).toMatchObject({ alignItems: 'flex-start', width: expect.any(Number) });
  expect(column.width).toBeGreaterThan(0);
  expect(column.width).toBeLessThanOrEqual(frame.width as number);
}

const ERROR = { status: 500, body: { message: 'Serverfehler', code: 'server', errors: {} } };
const cursorOf = (request: Request) => new URL(request.url).searchParams.get('cursor');
const tabOf = (request: Request) => new URL(request.url).searchParams.get('tab');
const feedCalls = (calls: readonly Request[], tab: string = 'for_you') => callsTo(calls, '/feed').filter((request) => tabOf(request) === tab);

/** Start as the API answers it: nothing featured, no Neue Builds, no modules, and the stream as given. */
function answers(overrides: Record<string, Answer | ((request: Request) => Answer)> = {}) {
  return {
    '/home/featured': { body: { data: [] } },
    '/home/new-builds': { body: page([]) },
    '/home/modules': { body: { data: { build_updates: [], active_members: [], popular_mods: [] } } },
    '/feed': { body: feedPage([]) },
    ...overrides,
  };
}

function signIn(client = newQueryClient()) {
  useSessionStore.setState({ status: 'member', member: { id: 'm1', username: 'lukas.sc', displayName: null, avatarUrl: null } });
  return client;
}

describe('HOME-01 Start', () => {
  it('keeps its place while a pushed page or another tab hides it (BH-41)', async () => {
    stubFetch(answers({ '/feed': { body: feedPage([vehicleItem(R34)]) } }));
    await renderWithProviders(<HomeScreen />);
    await screen.findByTestId(`HOME-01.card.${R34.id}`);
    expect(mockRetained).toHaveBeenCalled();
    expect(mockRetained.mock.calls[0]?.[0]).toHaveProperty('current.scrollToOffset', mockScrollToOffset);
  });

  it('lays Für dich out in the FS-2 order, with no counts of any kind', async () => {
    const update = buildUpdate();
    stubFetch(
      answers({
        '/home/featured': { body: { data: FEATURED } },
        '/home/new-builds': { body: page([R34, M4]) },
        '/home/modules': { body: { data: modules() } },
        '/feed': { body: feedPage([updateItem(buildUpdate({ id: 'stream-u' }))]) },
      }),
    );
    await renderWithProviders(<HomeScreen />);

    expect(await screen.findByTestId('HOME-01.featured')).toBeTruthy();
    expect(screen.getByTestId('HOME-01.featured.eyebrow')).toHaveTextContent('FEATURED BUILD');
    expect(screen.getByTestId('HOME-01.featured.byline')).toHaveTextContent('@kenji.r34 · Düsseldorf');
    expect(screen.getByTestId('HOME-01.tabs')).toBeTruthy();
    expect(screen.getByText('Für dich')).toBeTruthy();
    expect(screen.getByText('Folge ich')).toBeTruthy();
    expect(screen.getByTestId('HOME-01.newBuilds')).toHaveTextContent(/Neue Builds/);
    expect(screen.getByTestId(`HOME-01.card.${R34.id}.owner`)).toHaveTextContent(/@kenji\.r34/);
    expect(screen.getByTestId(`HOME-01.card.${R34.id}.latest`)).toHaveTextContent(/Volk Racing TE37 SL/);
    // ADR-148 a: the M4's owner is hidden, so its card names nobody.
    expect(screen.queryByTestId(`HOME-01.card.${M4.id}.owner`)).toBeNull();
    expect(screen.getByTestId('HOME-01.updates')).toHaveTextContent('Build-Updates');
    expect(screen.getByTestId(`HOME-01.update.${update.id}`)).toHaveTextContent(/Fahrwerk geändert/);
    // DQ-309: the module takes back its first row's 12, so the first thumb sits 12 under the header like the other modules.
    expect(StyleSheet.flatten(screen.getByTestId('HOME-01.updates.list').props.style)).toMatchObject({ marginTop: -space[12] });
    expect(screen.getByTestId('HOME-01.members')).toHaveTextContent('Aktive Mitglieder');
    expect(screen.getByTestId('HOME-01.activeMembers.member.jann.ptrs.car')).toHaveTextContent('BMW M4 Competition');
    expect(screen.getByTestId('HOME-01.mods')).toHaveTextContent('Beliebte Mods diese Woche');
    expect(screen.getByTestId('HOME-01.mods.list.chip.0')).toBeTruthy();
    expect(screen.getByTestId('HOME-01.stream.update.stream-u')).toBeTruthy();
    // FS-2 order in the list's data.
    const kinds = (mockLastList.props?.data as { kind: string; section?: string }[]).map((row) => row.section ?? row.kind);
    expect(kinds).toEqual(['hero', 'newBuilds', 'card', 'card', 'updates', 'updates', 'members', 'members', 'mods', 'mods', 'streamUpdates']);
    expect(screen.queryByText(/Likes?|Gefällt|Follower/)).toBeNull();
  });

  it('shows two Neue Builds, never the featured one, and none of them again in the stream (DQ-188)', async () => {
    stubFetch(
      answers({
        '/home/featured': { body: { data: [{ source: 'editorial', vehicle: R34 }] } },
        '/home/new-builds': { body: page([R34, M4, GTI]) },
        '/feed': { body: feedPage([vehicleItem(M4), vehicleItem(GTI)]) },
      }),
    );
    await renderWithProviders(<HomeScreen />);

    expect(await screen.findByTestId('HOME-01.featured')).toBeTruthy();
    expect(screen.queryByTestId(`HOME-01.card.${R34.id}`)).toBeNull();
    expect(screen.getAllByTestId(`HOME-01.card.${M4.id}`)).toHaveLength(1);
    expect(screen.getAllByTestId(`HOME-01.card.${GTI.id}`)).toHaveLength(1);
  });

  it('opens the vehicle, its latest change, the owner, an update, a member and a mod search', async () => {
    stubFetch(
      answers({
        '/home/featured': { body: { data: FEATURED } },
        '/home/modules': { body: { data: modules() } },
        '/feed': { body: feedPage([vehicleItem(R34)]) },
      }),
    );
    await renderWithProviders(<HomeScreen />);

    await fireEvent.press(await screen.findByTestId(`HOME-01.card.${R34.id}.body`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${R34.slug}`);
    await fireEvent.press(screen.getByTestId(`HOME-01.card.${R34.id}.latest`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${R34.slug}/updates/update-1`);
    await fireEvent.press(screen.getByTestId(`HOME-01.card.${R34.id}.owner`));
    expect(mockRouter.push).toHaveBeenCalledWith('/u/kenji.r34');
    await fireEvent.press(screen.getByTestId('HOME-01.update.update-kw.body'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${M4.slug}/updates/update-kw`);
    await fireEvent.press(screen.getByTestId('HOME-01.activeMembers.member.jann.ptrs'));
    expect(mockRouter.push).toHaveBeenCalledWith('/u/jann.ptrs');
    await fireEvent.press(screen.getByTestId('HOME-01.mods.list.chip.0'));
    expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/discover/search', params: { q: 'KW V3' } });
  });

  it('opens your own profile from your own owner row', async () => {
    const client = signIn();
    stubFetch(answers({ '/feed': { body: feedPage([vehicleItem(feedVehicle({ owner: { username: 'lukas.sc', display_name: null, city: null, avatar: null } }))]) } }));
    await renderWithProviders(<HomeScreen />, client);
    await fireEvent.press(await screen.findByTestId(`HOME-01.card.${R34.id}.owner`));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/profile');
  });

  it('leads "Alle" of Neue Builds to the search in the same order, the last change first', async () => {
    stubFetch(answers({ '/home/new-builds': { body: page([R34]) } }));
    await renderWithProviders(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId('HOME-01.newBuilds.action'));
    expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/discover/search', params: { sort: 'updated' } });
  });

  it('asks for two Neue Builds and one more, for when the featured build is one of them', async () => {
    const { calls } = stubFetch(answers());
    await renderWithProviders(<HomeScreen />);
    await waitFor(() => expect(callsTo(calls, '/home/new-builds')).toHaveLength(1));
    expect(new URL(callsTo(calls, '/home/new-builds')[0]?.url ?? '').searchParams.get('per_page')).toBe('3');
  });

  it('hides a module the API leaves empty', async () => {
    stubFetch(answers({ '/home/modules': { body: { data: modules({ popular_mods: [], active_members: [] }) } }, '/feed': { body: feedPage([vehicleItem(R34)]) } }));
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByTestId('HOME-01.updates')).toBeTruthy();
    expect(screen.queryByTestId('HOME-01.members')).toBeNull();
    expect(screen.queryByTestId('HOME-01.mods')).toBeNull();
  });

  it('loads the next page of the stream with the cursor at the end of the list, then says it was all', async () => {
    const { calls } = stubFetch(
      answers({ '/feed': (request) => (cursorOf(request) === 'next-1' ? { body: feedPage([vehicleItem(M4)]) } : { body: feedPage([vehicleItem(R34)], 'next-1') }) }),
    );
    await renderWithProviders(<HomeScreen />);

    await screen.findByTestId(`HOME-01.card.${R34.id}`);
    expect(screen.queryByTestId('HOME-01.featured')).toBeNull();
    await act(async () => mockLastList.props?.onEndReached?.());
    expect(await screen.findByTestId(`HOME-01.card.${M4.id}`)).toBeTruthy();
    expect(feedCalls(calls).some((request) => cursorOf(request) === 'next-1')).toBe(true);
    expect(screen.getByTestId('HOME-01.end')).toHaveTextContent('Das waren alle öffentlichen Builds.');
  });

  it('does not scroll while only the skeleton is shown, because nothing in it can take keyboard focus', async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    let answer: (response: Response) => void = () => {};
    globalThis.fetch = jest.fn((input: Request | string) => {
      const path = new URL(typeof input === 'string' ? input : input.url).pathname;
      if (path.endsWith('/feed')) return new Promise<Response>((resolve) => (answer = resolve));
      if (path.endsWith('/home/modules')) return Promise.resolve(json({ data: { build_updates: [], active_members: [], popular_mods: [] } }));
      return Promise.resolve(json(page([])));
    }) as unknown as typeof fetch;
    await renderWithProviders(<HomeScreen />);

    expect(await screen.findByTestId('HOME-01.skeleton')).toBeTruthy();
    expect(mockLastList.props?.scrollEnabled).toBe(false);
    // DQ-205: most cards of the feed have no latest change, and a skeleton never runs longer than the page.
    expect(screen.getByTestId('HOME-01.skeleton.card')).toBeTruthy();
    expect(screen.queryByTestId('HOME-01.skeleton.card.latest')).toBeNull();
    await act(async () => answer(json(feedPage([vehicleItem(R34)]))));
    expect(await screen.findByTestId(`HOME-01.card.${R34.id}`)).toBeTruthy();
    expect(mockLastList.props?.scrollEnabled).toBe(true);
  });

  it('has a designed empty state while no build is public', async () => {
    stubFetch(answers());
    await renderWithProviders(<HomeScreen />);

    expect(await screen.findByTestId('HOME-01.empty')).toBeTruthy();
    expect(screen.getByTestId('HOME-01.empty.title')).toHaveTextContent('Noch keine öffentlichen Builds');
  });

  it('shows the error with a retry that loads again', async () => {
    let fail = true;
    const { calls } = stubFetch(answers({ '/feed': () => (fail ? ERROR : { body: feedPage([vehicleItem(R34)]) }) }));
    await renderWithProviders(<HomeScreen />);

    // A server error is retried twice before the state shows (the harness takes the backoff's waiting out).
    expect(await screen.findByTestId('HOME-01.error')).toBeTruthy();
    expect(feedCalls(calls)).toHaveLength(3);
    fail = false;
    await fireEvent.press(screen.getByTestId('HOME-01.error.action'));
    expect(await screen.findByTestId(`HOME-01.card.${R34.id}`)).toBeTruthy();
  });

  it('says it is offline, with a retry, when there is no copy on the device', async () => {
    const { calls } = stubFetch(answers({ '/feed': { body: feedPage([vehicleItem(R34)]) } }));
    await setNetwork(false, mockNetListeners);
    await renderWithProviders(<HomeScreen />);

    expect(await screen.findByTestId('HOME-01.offline')).toBeTruthy();
    expect(screen.getByTestId('HOME-01.offline.title')).toHaveTextContent(i18n.t('error.offlineTitle', { ns: 'home', lng: 'de' }));
    expect(screen.queryByTestId('HOME-01.skeleton')).toBeNull();
    expect(feedCalls(calls)).toHaveLength(0);

    await setNetwork(true, mockNetListeners);
    expect(await screen.findByTestId(`HOME-01.card.${R34.id}`)).toBeTruthy();
  });

  it('keeps the list when the next page fails, says so at the end, and the retry loads it', async () => {
    let fail = true;
    stubFetch(
      answers({
        '/feed': (request) => {
          if (cursorOf(request) !== 'next-1') return { body: feedPage([vehicleItem(R34)], 'next-1') };
          return fail ? ERROR : { body: feedPage([vehicleItem(M4)]) };
        },
      }),
    );
    await renderWithProviders(<HomeScreen />);

    await screen.findByTestId(`HOME-01.card.${R34.id}`);
    await act(async () => mockLastList.props?.onEndReached?.());
    expect(await screen.findByTestId('HOME-01.moreError')).toHaveTextContent(i18n.t('list.moreError', { ns: 'home', lng: 'de' }), { exact: false });
    expect(screen.getByTestId(`HOME-01.card.${R34.id}`)).toBeTruthy();
    expectInColumn('HOME-01.moreError');
    // No new attempt by itself while the footer offers the retry.
    await act(async () => mockLastList.props?.onEndReached?.());
    expect(screen.getByTestId('HOME-01.moreError')).toBeTruthy();

    fail = false;
    await fireEvent.press(screen.getByTestId('HOME-01.moreRetry'));
    expect(await screen.findByTestId(`HOME-01.card.${M4.id}`)).toBeTruthy();
    expect(screen.queryByTestId('HOME-01.moreError')).toBeNull();
  });

  it('keeps only the first page of the stream for an offline start and asks again for that page alone (ADR-155 g)', async () => {
    const { calls } = stubFetch(
      answers({ '/feed': (request) => (cursorOf(request) === 'next-1' ? { body: feedPage([vehicleItem(M4)]) } : { body: feedPage([vehicleItem(R34)], 'next-1') }) }),
    );
    const client = newQueryClient();
    await renderWithProviders(<HomeScreen />, client);

    await screen.findByTestId(`HOME-01.card.${R34.id}`);
    await act(async () => mockLastList.props?.onEndReached?.());
    await screen.findByTestId(`HOME-01.card.${M4.id}`);
    expect(feedCalls(calls)).toHaveLength(2);

    // What the persister may store: the first page; the pages after it opt out.
    const queries = client.getQueryCache().findAll({ queryKey: homeKeys.all }).filter((query) => query.queryKey.includes('for_you'));
    const more = queries.filter((query) => query.queryKey.at(-1) === 'more');
    const first = queries.filter((query) => query.queryKey.at(-1) === 'first');
    expect(more).toHaveLength(1);
    expect(more[0]?.meta?.persist).toBe(false);
    expect(first).toHaveLength(1);
    expect(first[0]?.meta?.persist).not.toBe(false);

    // Stale on focus or reconnect: one request for the first page, not one per page scrolled.
    await act(async () => client.invalidateQueries({ queryKey: homeKeys.all }));
    await waitFor(() => expect(feedCalls(calls)).toHaveLength(3));
    expect(cursorOf(feedCalls(calls)[2] as Request)).toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(feedCalls(calls)).toHaveLength(3);
    expect(screen.getByTestId(`HOME-01.card.${M4.id}`)).toBeTruthy();
  });

  describe('the bell', () => {
    it('asks a guest to sign in, and goes to Mitteilungen afterwards', async () => {
      stubFetch(answers());
      await renderWithProviders(<HomeScreen />);
      await fireEvent.press(await screen.findByTestId('HOME-01.bell'));
      expect(useSessionStore.getState().promptOpen).toBe(true);
      expect(mockRouter.push).not.toHaveBeenCalledWith('/notifications');
    });

    it('opens Mitteilungen for a member and says how many are unread', async () => {
      const client = signIn();
      stubFetch(answers({ '/notifications/unread-count': { body: { data: { notifications: 3, messages: 0, requests: 0 } } } }));
      await renderWithProviders(<HomeScreen />, client);
      await waitFor(() => expect(screen.getByTestId('HOME-01.bell')).toHaveAccessibleName('Mitteilungen, 3 ungelesen'));
      await fireEvent.press(screen.getByTestId('HOME-01.bell'));
      expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
    });

    it('has no dot without unread notifications', async () => {
      const client = signIn();
      stubFetch(answers({ '/notifications/unread-count': { body: { data: { notifications: 0, messages: 2, requests: 0 } } } }));
      await renderWithProviders(<HomeScreen />, client);
      await waitFor(() => expect(screen.getByTestId('HOME-01.bell')).toHaveAccessibleName('Mitteilungen'));
    });
  });

  describe('Folge ich', () => {
    it('shows a guest the way to an account, and asks the API nothing', async () => {
      const { calls } = stubFetch(answers());
      await renderWithProviders(<HomeScreen />);
      await screen.findByTestId('HOME-01.empty');
      await fireEvent.press(screen.getByTestId('HOME-01.tab.following'));
      expect(await screen.findByTestId('HOME-01.following.guest')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('HOME-01.following.guest.action'));
      expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/' } });
      expect(feedCalls(calls, 'following')).toHaveLength(0);
    });

    it('lists the followed members’ builds and updates in the server’s order, without the modules', async () => {
      const client = signIn();
      const update = buildUpdate({ id: 'followed-u' });
      stubFetch(
        answers({
          '/home/modules': { body: { data: modules() } },
          '/feed': (request) =>
            tabOf(request) === 'following' ? { body: feedPage([updateItem(update), vehicleItem(R34)]) } : { body: feedPage([vehicleItem(M4)]) },
        }),
      );
      await renderWithProviders(<HomeScreen />, client);
      await screen.findByTestId(`HOME-01.card.${M4.id}`);
      await fireEvent.press(screen.getByTestId('HOME-01.tab.following'));

      expect(await screen.findByTestId(`HOME-01.card.${R34.id}`)).toBeTruthy();
      expect(screen.getByTestId('HOME-01.stream.update.followed-u')).toBeTruthy();
      expect(screen.queryByTestId('HOME-01.updates')).toBeNull();
      expect(screen.queryByTestId(`HOME-01.card.${M4.id}`)).toBeNull();
      expect(screen.getByTestId('HOME-01.end')).toHaveTextContent('Das war alles von Mitgliedern, denen du folgst.');
    });

    it('suggests members to follow when the stream is empty, with Folgen that changes at once', async () => {
      const client = signIn();
      const suggestion = activeMember({ username: 'aylin.vtec', display_name: 'Aylin', car_line: 'Honda Civic Type R' });
      const { calls } = stubFetch(
        answers({
          '/feed': (request) => (tabOf(request) === 'following' ? { body: feedPage([], null, [suggestion]) } : { body: feedPage([]) }),
          '/users/aylin.vtec/follow': { body: { data: { username: 'aylin.vtec', is_following: true, followers: 4 } } },
        }),
      );
      await renderWithProviders(<HomeScreen />, client);
      await screen.findByTestId('HOME-01.empty');
      await fireEvent.press(screen.getByTestId('HOME-01.tab.following'));

      expect(await screen.findByTestId('HOME-01.following.empty')).toBeTruthy();
      expect(screen.getByTestId('HOME-01.suggestion.aylin.vtec')).toHaveTextContent(/Honda Civic Type R/);
      const follow = screen.getByTestId('HOME-01.suggestion.aylin.vtec.follow');
      expect(follow).toHaveTextContent('Folgen');
      await fireEvent.press(follow);
      await waitFor(() => expect(screen.getByTestId('HOME-01.suggestion.aylin.vtec.follow')).toHaveTextContent('Folge ich'));
      expect(callsTo(calls, '/users/aylin.vtec/follow')).toHaveLength(1);
    });

    it('names the suggestions once: "Gerade aktiv" without a car of your own, "Vorschläge für dich" with one (DQ-304)', async () => {
      const suggestion = activeMember({ username: 'aylin.vtec', display_name: 'Aylin', car_line: 'Honda Civic Type R' });
      const feed = { '/feed': (request: Request) => (tabOf(request) === 'following' ? { body: feedPage([], null, [suggestion]) } : { body: feedPage([]) }) };
      for (const [garage, header] of [
        [[{ status: 'draft' }], 'Gerade aktiv'],
        [[{ status: 'published' }], 'Vorschläge für dich'],
      ] as const) {
        rememberHomeTab('for_you');
        const client = signIn();
        stubFetch(answers({ ...feed, '/me/vehicles': { body: { data: garage } } }));
        const view = await renderWithProviders(<HomeScreen />, client);
        await screen.findByTestId('HOME-01.empty');
        await fireEvent.press(screen.getByTestId('HOME-01.tab.following'));
        await waitFor(() => expect(screen.getByTestId('HOME-01.suggestions.header')).toHaveTextContent(header));
        // The body no longer names the list a second time.
        expect(screen.getByTestId('HOME-01.following.empty')).toHaveTextContent(/deren Builds dich interessieren\.$/);
        expect(screen.queryByText(/gerade aktiv\./)).toBeNull();
        await view.unmount();
      }
    });

    it('opens on Folge ich from `/?tab=following`', async () => {
      mockParams = { tab: 'following' };
      stubFetch(answers());
      await renderWithProviders(<HomeScreen />);
      expect(await screen.findByTestId('HOME-01.following.guest')).toBeTruthy();
    });

    it('leads to Entdecken when there is nobody to suggest', async () => {
      const client = signIn();
      stubFetch(answers({ '/feed': { body: feedPage([], null, null) } }));
      await renderWithProviders(<HomeScreen />, client);
      await screen.findByTestId('HOME-01.empty');
      await fireEvent.press(screen.getByTestId('HOME-01.tab.following'));
      await fireEvent.press(await screen.findByTestId('HOME-01.following.empty.action'));
      expect(mockRouter.navigate).toHaveBeenCalledWith('/discover');
    });
  });

  // BH-43: the end of the list is reported once, so a turn missed offline is taken when the connection is back.
  describe('reaching the end offline', () => {
    const offlineAnswers = () =>
      answers({ '/feed': (request) => (cursorOf(request) === 'next-1' ? { body: feedPage([vehicleItem(M4)]) } : { body: feedPage([vehicleItem(R34)], 'next-1') }) });

    it('loads the next page on reconnect', async () => {
      const { calls } = stubFetch(offlineAnswers());
      await renderWithProviders(<HomeScreen />);
      await screen.findByTestId(`HOME-01.card.${R34.id}`);

      await setNetwork(false, mockNetListeners);
      await act(async () => mockLastList.props?.onEndReached?.());
      expect(feedCalls(calls)).toHaveLength(1);

      await setNetwork(true, mockNetListeners);
      expect(await screen.findByTestId(`HOME-01.card.${M4.id}`)).toBeTruthy();
      expect(screen.getByTestId('HOME-01.end')).toBeTruthy();
    });

    it('asks for nothing on reconnect when the end was not reached', async () => {
      const { calls } = stubFetch(offlineAnswers());
      await renderWithProviders(<HomeScreen />);
      await screen.findByTestId(`HOME-01.card.${R34.id}`);

      await setNetwork(false, mockNetListeners);
      await setNetwork(true, mockNetListeners);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(calls.some((request) => cursorOf(request) === 'next-1')).toBe(false);
    });

    it('offers "Mehr laden" at the end while more is there, not a blank footer, and it loads the page', async () => {
      stubFetch(offlineAnswers());
      await renderWithProviders(<HomeScreen />);
      await screen.findByTestId(`HOME-01.card.${R34.id}`);

      const button = screen.getByTestId('HOME-01.more');
      expect(button).toHaveTextContent(i18n.t('list.more', { ns: 'home', lng: 'de' }));
      // Its own ID: `.moreRetry` means a page failed (BH-43 review).
      expect(screen.queryByTestId('HOME-01.moreRetry')).toBeNull();
      await fireEvent.press(button);
      expect(await screen.findByTestId(`HOME-01.card.${M4.id}`)).toBeTruthy();
      expect(screen.queryByTestId('HOME-01.more')).toBeNull();
      expect(screen.getByTestId('HOME-01.end')).toBeTruthy();
    });

    // RESULT 11: the footer sat at x 0 on a phone and against the sidebar at 1280, outside the cards' column.
    it('puts every footer in the cards’ column, starting on its edge', async () => {
      stubFetch(offlineAnswers());
      await renderWithProviders(<HomeScreen />);
      await screen.findByTestId(`HOME-01.card.${R34.id}`);
      expectInColumn('HOME-01.moreRow');
      await fireEvent.press(screen.getByTestId('HOME-01.more'));
      await screen.findByTestId('HOME-01.end');
      expectInColumn('HOME-01.end');
    });
  });

  // BH-42: the first page is refreshed alone. What it pushes out belongs in front of the pages already loaded.
  describe('a refresh of the first page that moves its end', () => {
    const build = (name: string) => feedVehicle({ id: `01${name}`, slug: `build-${name}`, full_title: `Build ${name}`, owner: null, latest_update: null });
    const [fresh, a, b, c, d, e, f] = ['fresh', 'a', 'b', 'c', 'd', 'e', 'f'].map(build) as [FeedVehicle, FeedVehicle, FeedVehicle, FeedVehicle, FeedVehicle, FeedVehicle, FeedVehicle];
    const items = (vehicles: FeedVehicle[], next: string | null = null) => ({ body: feedPage(vehicles.map(vehicleItem), next) });
    const shownOnce = (ids: readonly FeedVehicle[]) => {
      for (const vehicle of ids) expect(screen.getAllByTestId(`HOME-01.card.${vehicle.id}`)).toHaveLength(1);
    };
    const cursorsAsked = (calls: readonly Request[]) => feedCalls(calls).map(cursorOf);

    async function scrolledToTail(answer: (cursor: string | null) => { body: unknown }) {
      const { calls } = stubFetch(answers({ '/feed': (request) => answer(cursorOf(request)) }));
      const client = newQueryClient();
      await renderWithProviders(<HomeScreen />, client);
      await screen.findByTestId(`HOME-01.card.${a.id}`);
      await act(async () => mockLastList.props?.onEndReached?.());
      await screen.findByTestId(`HOME-01.card.${c.id}`);
      return { calls, client };
    }

    it('reads from the new cursor to the first card already loaded, so every build appears once', async () => {
      let shifted = false;
      const { calls, client } = await scrolledToTail((cursor) => {
        if (cursor === 'old') return items([c, d]);
        if (cursor === 'new') return items([b, c], 'old');
        return shifted ? items([fresh, a], 'new') : items([a, b], 'old');
      });

      shifted = true;
      await act(async () => client.invalidateQueries({ queryKey: homeKeys.all }));
      await screen.findByTestId(`HOME-01.card.${fresh.id}`);
      await screen.findByTestId(`HOME-01.card.${b.id}`);
      shownOnce([fresh, a, b, c, d]);
      // One read of what was pushed out; the pages already loaded are not asked again.
      expect(cursorsAsked(calls)).toEqual([null, 'old', null, 'new']);
    });

    it('walks several pages for a large shift, and only ever a few', async () => {
      let shifted = false;
      const { calls, client } = await scrolledToTail((cursor) => {
        if (cursor === 'old') return items([c, d]);
        if (cursor === 'p2') return items([e, f], 'p3');
        if (cursor === 'p3') return items([b, c], 'old');
        return shifted ? items([fresh, a], 'p2') : items([a, b], 'old');
      });

      shifted = true;
      await act(async () => client.invalidateQueries({ queryKey: homeKeys.all }));
      await screen.findByTestId(`HOME-01.card.${e.id}`);
      shownOnce([fresh, a, e, f, b, c, d]);
      expect(cursorsAsked(calls)).toEqual([null, 'old', null, 'p2', 'p3']);
    });

    it('starts the pages over when the first card loaded is not reached within the cap', async () => {
      let shifted = false;
      const { calls, client } = await scrolledToTail((cursor) => {
        if (cursor === 'old') return items([c, d]);
        if (cursor?.startsWith('w')) return items([build(cursor)], `w${Number(cursor.slice(1)) + 1}`);
        return shifted ? items([fresh, a], 'w1') : items([a, b], 'old');
      });

      shifted = true;
      await act(async () => client.invalidateQueries({ queryKey: homeKeys.all }));
      await waitFor(() => expect(screen.queryByTestId(`HOME-01.card.${c.id}`)).toBeNull());
      await screen.findByTestId(`HOME-01.card.${fresh.id}`);
      expect(cursorsAsked(calls).filter((cursor) => cursor?.startsWith('w'))).toEqual(['w1', 'w2', 'w3']);
      // The end of the list continues from the new first page.
      await act(async () => mockLastList.props?.onEndReached?.());
      await waitFor(() => expect(cursorsAsked(calls).filter((cursor) => cursor === 'w1')).toHaveLength(2));
    });

    it('closes the seam at the next tail card when the first one went away meanwhile', async () => {
      let shifted = false;
      const { calls, client } = await scrolledToTail((cursor) => {
        if (cursor === 'old') return items([c, d]);
        if (cursor === 'new') return items([b, d]);
        // A new build, and c is no longer public.
        return shifted ? items([fresh, a], 'new') : items([a, b], 'old');
      });

      shifted = true;
      await act(async () => client.invalidateQueries({ queryKey: homeKeys.all }));
      await screen.findByTestId(`HOME-01.card.${fresh.id}`);
      expect(await screen.findByTestId(`HOME-01.card.${b.id}`)).toBeTruthy();
      shownOnce([fresh, a, b, d]);
      expect(cursorsAsked(calls)).toEqual([null, 'old', null, 'new']);
      expect(screen.getByTestId('HOME-01.end')).toBeTruthy();
    });

    it('asks for nothing when the end of the first page stayed', async () => {
      const { calls, client } = await scrolledToTail((cursor) => (cursor === 'old' ? items([c, d]) : items([a, b], 'old')));

      await act(async () => client.invalidateQueries({ queryKey: homeKeys.all }));
      await waitFor(() => expect(cursorsAsked(calls)).toHaveLength(3));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(cursorsAsked(calls)).toEqual([null, 'old', null]);
      shownOnce([a, b, c, d]);
    });
  });

  it('notes a restriction and still lists the builds', async () => {
    stubFetch(answers({ '/feed': { body: feedPage([vehicleItem(R34)]) } }));
    const client = signIn();
    client.setQueryData(meKey, {
      restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: true, until: null } },
    });
    await renderWithProviders(<HomeScreen />, client);
    await waitFor(() => expect(screen.getByTestId(`HOME-01.card.${R34.id}`)).toBeTruthy());
    expect(screen.getByTestId('HOME-01.restricted')).toHaveTextContent(/Builds ansehen und suchen kannst du weiterhin/);
  });
});

describe('MSG-01 Nachrichten', () => {
  // M2.4 replaced the P1 placeholder with the inbox; the placeholder stays for a build without the messaging adapter.
  it('shows one honest "Bald verfügbar" state and leads to Entdecken', async () => {
    await renderWithProviders(
      <MessagingContext value={unavailableMessaging}>
        <MessagesScreen />
      </MessagingContext>,
    );
    // The approved copy lives in the locale file; the test follows the key, not a sentence of its own.
    expect(screen.getByTestId('MSG-01.soon.title')).toHaveTextContent(i18n.t('soon.title', { ns: 'messages', lng: 'de' }));
    expect(screen.getByTestId('MSG-01.soon.body')).toHaveTextContent(i18n.t('soon.body', { ns: 'messages', lng: 'de' }));
    // No promise of a near release (§10: honest copy).
    expect(screen.queryByText(/bald|demnächst/i)).toBeNull();
    expect(screen.getByTestId('MSG-01.soon.frame', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('MSG-01.soon.action'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/discover');
  });
});
