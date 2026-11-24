/**
 * M5.2 Navigation 3.0 (10 §1, ADR-501) in the real router (expo-router/testing-library) on an in-memory tree that mirrors src/app:
 * the bar contents at each width (tab bar < 768, rail 768–1279, sidebar ≥ 1280), Nachrichten as a place of the rail and sidebar
 * and as the header link of Start and Entdecken (unread pill "9+"), and Entdecken's segments Builds · Treffen · Forum: a deep link
 * per segment, the segmented control and the swipe swapping the pages in place, Forum only behind its flag.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router as appRouter } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import SharedLayout, { unstable_settings } from '@/app/(tabs)/(home,discover,garage,shop,profile)/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import { DiscoverSegmentBar, SEGMENT_SWIPE_COMMIT, segmentFollow, SegmentSwipe, segmentSwipeDirection } from '@/features/discover/components/DiscoverSegments';
import { DISCOVER_SEGMENTS, isSegmentRoot, neighbourSegment, segmentMove, useIsSegmentRoot, visibleSegments } from '@/features/discover/segments';
import { LandInStart, resetLandingForTests, startHrefs } from '@/features/messages/coldLink';
import {
  activeItemKey,
  itemKey,
  RAIL_ITEMS,
  SIDEBAR_ITEMS,
  TAB_BAR_ITEMS,
  visibleItems,
} from '@/features/shell/destinations';
import { messagesInHeader, useInboxActions } from '@/features/shell/inboxActions';
import { useSessionStore } from '@/state/session';
import { useShellStore } from '@/state/shell';
import { hydrateThemePreference, ThemeProvider } from '@/theme';
import { Header, Text } from '@/ui';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => undefined), impactAsync: jest.fn(async () => undefined), notificationAsync: jest.fn(async () => undefined), performAndroidHapticsAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: {}, NotificationFeedbackType: {}, AndroidHaptics: {} }));

const mockChrome = jest.fn<'native' | 'js', []>(() => 'js');
jest.mock('@/features/shell/navMode', () => ({ ...jest.requireActual('@/features/shell/navMode'), useTabChrome: () => mockChrome() }));

const mockBadges = jest.fn(() => ({ messages: 0, home: false, notifications: 0 }));
jest.mock('@/features/shell/useTabBadges', () => ({ useTabBadges: () => mockBadges() }));

const mockFlags = jest.fn<Record<string, boolean>, []>(() => ({ events: true }));
jest.mock('@/api/queries/appConfig', () => {
  const actual = jest.requireActual('@/api/queries/appConfig');
  return {
    ...actual,
    useAppConfig: () => ({ config: { ...actual.BUNDLED_APP_CONFIG, flags: mockFlags() }, confirmed: true, released: false, refetch: jest.fn(), isFetching: false }),
    useFlag: (key: string) => mockFlags()[key] === true,
  };
});

const mockDimensions = jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDimensions() }));

configure({ asyncUtilTimeout: 30_000 });
jest.setTimeout(120_000);

const windowOf = (width: number) => mockDimensions.mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 });

/** A tab root with the real inbox actions in a real Header, as Start and Entdecken carry them. */
function InboxRoot({ routeId }: { routeId: string }) {
  const actions = useInboxActions(routeId);
  return (
    <View testID={`${routeId}.root`}>
      <Header variant="large" title={routeId} actions={actions} testID={`${routeId}.header`} />
    </View>
  );
}

/** A segment page: what EVT-01 and DISC-01 do with the segment bar and the swipe. */
function SegmentPage({ routeId, current }: { routeId: string; current: 'builds' | 'events' }) {
  const root = useIsSegmentRoot();
  return (
    <View testID={`${routeId}.root`} style={{ flex: 1 }}>
      <Text variant="body" testID={`${routeId}.mode`}>
        {root ? 'segment' : 'page'}
      </Text>
      {root ? <DiscoverSegmentBar current={current} testID={`${routeId}.segments`} /> : null}
      {/* As EVT-01 since SF-4: always the swipe, only `enabled` follows the segment state. */}
      <SegmentSwipe current={current} enabled={root} testID={`${routeId}.swipe`}>
        <View />
      </SegmentSwipe>
    </View>
  );
}

const plain = (id: string) =>
  function Plain() {
    return <View testID={`${id}.root`} />;
  };

/** A message route as src/app wraps it: a landing outside Start moves into Start (DQ-M52-02). */
const message = (id: string) =>
  function Message() {
    return (
      <LandInStart>
        <View testID={`${id}.root`} />
      </LandInStart>
    );
  };

const tree = () =>
  Object.fromEntries(
    Object.entries({
      '(tabs)/_layout': { default: TabsLayout },
      '(tabs)/(home,discover,garage,shop,profile)/_layout': { default: SharedLayout, unstable_settings },
      '(tabs)/(home,discover,garage,shop,profile)/events/index': () => <SegmentPage routeId="EVT-01" current="events" />,
      '(tabs)/(home,discover,garage,shop,profile)/messages/index': message('MSG-01'),
      '(tabs)/(home,discover,garage,shop,profile)/messages/[conversationId]/index': message('MSG-02'),
      '(tabs)/(home)/index': () => <InboxRoot routeId="HOME-01" />,
      '(tabs)/(discover)/discover/index': () => <SegmentPage routeId="DISC-01" current="builds" />,
      '(tabs)/(garage)/garage/index': plain('GAR-01'),
      '(tabs)/(shop)/shop/index': plain('SHOP-01'),
      '(tabs)/(profile)/profile/index': plain('PROF-01'),
      // The bundler lists route files alphabetically; of two equal routes a cold link takes the group listed first.
    }).sort(([a], [b]) => a.localeCompare(b)),
  );

const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Providers = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>
    <QueryClientProvider client={queries}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  </GestureHandlerRootView>
);

const open = (initialUrl = '/') => renderRouter(tree() as never, { initialUrl, wrapper: Providers });

/** The visible labels of a bar's tabs and places, in order. */
const barLabels = (bar: string) =>
  within(screen.getByTestId(`${bar}.list`))
    .getAllByRole('tab')
    .map((node) => node.props.accessibilityLabel as string);

type NavState = { routeNames?: readonly string[]; routes: readonly { name: string; state?: NavState }[] } | undefined;

/** The screen names of the stack whose route names include `marker`, bottom first. */
function stackWith(state: NavState, marker: string): string[] {
  if (!state) return [];
  if (state.routeNames?.includes(marker)) return state.routes.map((route) => route.name);
  for (const route of state.routes) {
    const found = stackWith(route.state, marker);
    if (found.length > 0) return found;
  }
  return [];
}

/** The screen names of Entdecken's stack, bottom first. */
const discoverStack = (state: NavState) => stackWith(state, 'discover/index');
/** Start's stack: the only clone with `index`. */
const homeStack = (state: NavState) => stackWith(state, 'index');

const isSelected = (id: string) => screen.getByTestId(id).props.accessibilityState?.selected === true;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  resetLandingForTests();
  windowOf(390);
  mockChrome.mockReturnValue('js');
  mockBadges.mockReturnValue({ messages: 0, home: false, notifications: 0 });
  mockFlags.mockReturnValue({ events: true });
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null });
  useShellStore.setState({ tabBarHidden: false });
});

describe('the bar items (10 §1)', () => {
  it('lists five tabs in the bar, the tabs + Nachrichten in the rail, and the nine places of the sidebar', () => {
    expect(TAB_BAR_ITEMS.map(itemKey)).toEqual(['home', 'discover', 'garage', 'shop', 'profile']);
    expect(RAIL_ITEMS.map(itemKey)).toEqual(['home', 'discover', 'garage', 'shop', 'messages', 'profile']);
    expect(SIDEBAR_ITEMS.map(itemKey)).toEqual(['home', 'discover', 'events', 'forum', 'crews', 'garage', 'shop', 'messages', 'profile']);
  });

  it('shows Treffen and Forum only while their flags are on', () => {
    expect(visibleItems(SIDEBAR_ITEMS, {}).map(itemKey)).toEqual(['home', 'discover', 'garage', 'shop', 'messages', 'profile']);
    expect(visibleItems(SIDEBAR_ITEMS, { events: true }).map(itemKey)).toContain('events');
    expect(visibleItems(SIDEBAR_ITEMS, { events: true }).map(itemKey)).not.toContain('forum');
    expect(visibleItems(SIDEBAR_ITEMS, { events: true, forum: true }).map(itemKey)).not.toContain('crews');
    // 11 R4-2.3: Crews, like Treffen and Forum, only while its flag is on.
    expect(visibleItems(SIDEBAR_ITEMS, { events: true, forum: true, crews: true }).map(itemKey)).toEqual(SIDEBAR_ITEMS.map(itemKey));
  });

  it('marks a place current on its path: Nachrichten in any tab, Treffen and Forum only in Entdecken', () => {
    expect(activeItemKey(SIDEBAR_ITEMS, 'home', '/messages')).toBe('messages');
    expect(activeItemKey(SIDEBAR_ITEMS, 'garage', '/messages/01J')).toBe('messages');
    expect(activeItemKey(SIDEBAR_ITEMS, 'discover', '/events')).toBe('events');
    expect(activeItemKey(SIDEBAR_ITEMS, 'discover', '/events/treffen-hockenheim')).toBe('events');
    expect(activeItemKey(SIDEBAR_ITEMS, 'home', '/events')).toBe('home');
    expect(activeItemKey(SIDEBAR_ITEMS, 'discover', '/discover')).toBe('discover');
    expect(activeItemKey(SIDEBAR_ITEMS, 'discover', '/messages-foo')).toBe('discover');
    expect(activeItemKey(TAB_BAR_ITEMS, 'home', '/messages')).toBe('home');
  });
});

describe('the bars at each width', () => {
  it('< 768: the floating bar has the five tabs and no Nachrichten', async () => {
    await open();
    await screen.findByTestId('HOME-01.root');
    expect(barLabels('shell.tabbar')).toEqual(['Start', 'Entdecken', 'Garage', 'Shop', 'Profil']);
    expect(screen.queryByTestId('shell.place.messages')).toBeNull();
  });

  it('768–1279: the rail has the five tabs and Nachrichten with its count', async () => {
    windowOf(1000);
    mockBadges.mockReturnValue({ messages: 3, home: false, notifications: 0 });
    await open();
    await screen.findByTestId('HOME-01.root');
    expect(barLabels('shell.rail')).toEqual(['Start', 'Entdecken', 'Garage', 'Shop', 'Nachrichten, 3 ungelesen', 'Profil']);
  });

  it('≥ 1280: the sidebar lists Start · Entdecken · Treffen · Garage · Shop · Nachrichten · Profil, Forum with its flag', async () => {
    windowOf(1280);
    await open();
    await screen.findByTestId('HOME-01.root');
    expect(barLabels('shell.sidebar')).toEqual(['Start', 'Entdecken', 'Treffen', 'Garage', 'Shop', 'Nachrichten', 'Profil']);
  });

  it('≥ 1280 with the forum flag: Forum after Treffen', async () => {
    windowOf(1280);
    mockFlags.mockReturnValue({ events: true, forum: true });
    await open();
    await screen.findByTestId('HOME-01.root');
    expect(barLabels('shell.sidebar')).toEqual(['Start', 'Entdecken', 'Treffen', 'Forum', 'Garage', 'Shop', 'Nachrichten', 'Profil']);
  });

  it('the sidebar opens Nachrichten in the tab that shows and marks it, and Start returns to its root', async () => {
    windowOf(1280);
    const router = await open();
    await screen.findByTestId('HOME-01.root');
    await fireEvent.press(screen.getByTestId('shell.place.messages'));
    await screen.findByTestId('MSG-01.root');
    expect(router.getPathname()).toBe('/messages');
    expect(isSelected('shell.place.messages')).toBe(true);
    expect(isSelected('tab.home')).toBe(false);

    await fireEvent.press(screen.getByTestId('tab.home'));
    await waitFor(() => expect(router.getPathname()).toBe('/'));
    expect(isSelected('tab.home')).toBe(true);
    expect(isSelected('shell.place.messages')).toBe(false);
  });

  it('the sidebar opens Treffen inside Entdecken, as its segment', async () => {
    windowOf(1280);
    const router = await open();
    await screen.findByTestId('HOME-01.root');
    await fireEvent.press(screen.getByTestId('shell.place.events'));
    await screen.findByTestId('EVT-01.root');
    expect(router.getPathname()).toBe('/events');
    expect(router.getSegments()).toContain('(discover)');
    expect(screen.getByTestId('EVT-01.mode')).toHaveTextContent('segment');
    expect(isSelected('shell.place.events')).toBe(true);
    expect(isSelected('tab.discover')).toBe(false);
  });
});

describe('Nachrichten in the header (10 §1)', () => {
  it('shows only where no rail or sidebar lists it', () => {
    expect(messagesInHeader('native', 'phone')).toBe(true);
    expect(messagesInHeader('native', 'tablet')).toBe(true);
    expect(messagesInHeader('native', 'desktop')).toBe(true);
    expect(messagesInHeader('js', 'phone')).toBe(true);
    expect(messagesInHeader('js', 'tablet')).toBe(false);
    expect(messagesInHeader('js', 'desktop')).toBe(false);
  });

  it('is a link after the bell, named with the unread count, and opens MSG-01 in the Start stack', async () => {
    mockBadges.mockReturnValue({ messages: 3, home: false, notifications: 0 });
    const router = await open();
    await screen.findByTestId('HOME-01.root');
    const link = screen.getByTestId('HOME-01.messages');
    expect(link.props.role ?? link.props.accessibilityRole).toBe('link');
    expect(link.props.accessibilityLabel).toBe('Nachrichten, 3 ungelesen');
    expect(screen.getByTestId('HOME-01.messages.badge', { includeHiddenElements: true })).toHaveTextContent('3');
    // Bell first, Nachrichten on the trailing edge.
    const buttons = within(screen.getByTestId('HOME-01.header')).getAllByRole(/button|link/);
    expect(buttons.map((node) => node.props.testID as string).filter((id) => /^HOME-01\.(bell|messages)$/.test(id))).toEqual(['HOME-01.bell', 'HOME-01.messages']);

    useSessionStore.setState({ status: 'member', member: { id: 'm1', username: 'lukas.sc', displayName: null, avatarUrl: null } });
    await fireEvent.press(link);
    await screen.findByTestId('MSG-01.root');
    expect(router.getPathname()).toBe('/messages');
    expect(router.getSegments()).toContain('(home)');
  });

  it('asks a guest to sign in first, as the bell does (DQ-M52-16)', async () => {
    const router = await open();
    await screen.findByTestId('HOME-01.root');
    await fireEvent.press(screen.getByTestId('HOME-01.messages'));
    expect(useSessionStore.getState().promptOpen).toBe(true);
    expect(router.getPathname()).toBe('/');
  });

  it('caps the pill at "9+" and says the same', async () => {
    mockBadges.mockReturnValue({ messages: 12, home: false, notifications: 0 });
    await open();
    await screen.findByTestId('HOME-01.root');
    expect(screen.getByTestId('HOME-01.messages.badge', { includeHiddenElements: true })).toHaveTextContent('9+');
    expect(screen.getByTestId('HOME-01.messages').props.accessibilityLabel).toBe('Nachrichten, 9+ ungelesen');
  });

  it('has no pill and the plain name when nothing is unread', async () => {
    await open();
    await screen.findByTestId('HOME-01.root');
    expect(screen.getByTestId('HOME-01.messages').props.accessibilityLabel).toBe('Nachrichten');
    expect(screen.queryByTestId('HOME-01.messages.badge', { includeHiddenElements: true })).toBeNull();
  });

  it('leaves the header from 768 in the JS shell, where the rail lists Nachrichten; native tabs keep it at every width', async () => {
    windowOf(1000);
    await open();
    await screen.findByTestId('HOME-01.root');
    expect(screen.queryByTestId('HOME-01.messages')).toBeNull();
    expect(screen.getByTestId('HOME-01.bell')).toBeTruthy();
  });

  it('a push or deep link still opens a conversation directly', async () => {
    const router = await open('/');
    await screen.findByTestId('HOME-01.root');
    await act(async () => appRouter.push('/messages/01JCONVERSATION'));
    await screen.findByTestId('MSG-02.root');
    expect(router.getPathname()).toBe('/messages/01JCONVERSATION');
  });
});

describe('cold links to Nachrichten open in Start (DQ-M52-02, review SF-1)', () => {
  it('builds the inbox below the page, keeping the query', () => {
    expect(startHrefs('/messages', '')).toEqual(['/(tabs)/(home)/messages']);
    expect(startHrefs('/messages', '?folder=requests')).toEqual(['/(tabs)/(home)/messages?folder=requests']);
    expect(startHrefs('/messages/01J', '')).toEqual(['/(tabs)/(home)/messages', '/(tabs)/(home)/messages/01J']);
    expect(startHrefs('/messages/requests/01J', 'x=1')).toEqual(['/(tabs)/(home)/messages', '/(tabs)/(home)/messages/requests/01J?x=1']);
  });

  it('a cold link to a conversation opens it in Start over the inbox; back goes to the inbox, then to Start', async () => {
    const router = await open('/messages/01JCONVERSATION');
    await screen.findByTestId('MSG-02.root');
    await waitFor(() => expect(router.getSegments()).toContain('(home)'));
    expect(router.getPathname()).toBe('/messages/01JCONVERSATION');
    expect(homeStack(router.getRouterState())).toEqual(['index', 'messages/index', 'messages/[conversationId]/index']);
    // Entdecken, where the link fell, keeps nothing of it.
    expect(discoverStack(router.getRouterState())).not.toContain('messages/[conversationId]/index');
    expect(isSelected('tab.home')).toBe(true);

    await act(async () => appRouter.back());
    await screen.findByTestId('MSG-01.root');
    expect(router.getPathname()).toBe('/messages');
    expect(router.getSegments()).toContain('(home)');
    await act(async () => appRouter.back());
    await screen.findByTestId('HOME-01.root');
    expect(router.getPathname()).toBe('/');
  });

  it('a cold link to the inbox opens it in Start', async () => {
    const router = await open('/messages');
    await screen.findByTestId('MSG-01.root');
    await waitFor(() => expect(router.getSegments()).toContain('(home)'));
    expect(homeStack(router.getRouterState())).toEqual(['index', 'messages/index']);
    expect(isSelected('tab.home')).toBe(true);
  });

  it('a conversation opened from Entdecken stays in Entdecken', async () => {
    const router = await open('/discover');
    await screen.findByTestId('DISC-01.root');
    await act(async () => appRouter.push('/messages/01JCONVERSATION'));
    await screen.findByTestId('MSG-02.root');
    expect(router.getSegments()).toContain('(discover)');
    expect(discoverStack(router.getRouterState())).toEqual(['discover/index', 'messages/[conversationId]/index']);
  });
});

describe('Entdecken › Builds · Treffen · Forum (10 §1)', () => {
  it('shows a segment only while its flag is on', () => {
    expect(visibleSegments({}).map((entry) => entry.value)).toEqual(['builds']);
    expect(visibleSegments({ events: true }).map((entry) => entry.value)).toEqual(['builds', 'events']);
    expect(visibleSegments({ events: true, forum: true }).map((entry) => entry.value)).toEqual(['builds', 'events', 'forum']);
    expect(visibleSegments({}, (flag) => flag === 'events').map((entry) => entry.value)).toEqual(['builds', 'events']);
  });

  it('knows a segment page from a pushed one', () => {
    const names = ['discover/index', 'events/index', 'v/[slug]/index'];
    const routes = (list: string[]) => ({ routeNames: names, routes: list.map((name, index) => ({ key: `k${index}`, name })) });
    expect(isSegmentRoot(routes(['events/index']), 'k0')).toBe(true);
    expect(isSegmentRoot(routes(['discover/index', 'events/index']), 'k1')).toBe(true);
    expect(isSegmentRoot(routes(['discover/index', 'v/[slug]/index', 'events/index']), 'k2')).toBe(false);
    // Start's stack has no discover/index: EVT-01 there is a page of its own.
    expect(isSegmentRoot({ routeNames: ['index', 'events/index'], routes: [{ key: 'a', name: 'index' }, { key: 'b', name: 'events/index' }] }, 'b')).toBe(false);
  });

  it('turns a page at 40 % of its width or with a fling, towards the side the finger went', () => {
    expect(SEGMENT_SWIPE_COMMIT).toBeCloseTo(0.4);
    expect(segmentSwipeDirection(-100, 0, 390)).toBe(0);
    expect(segmentSwipeDirection(-200, 0, 390)).toBe(1);
    expect(segmentSwipeDirection(200, 0, 390)).toBe(-1);
    expect(segmentSwipeDirection(-40, -900, 390)).toBe(1);
    expect(segmentSwipeDirection(-40, 900, 390)).toBe(0);
    expect(segmentSwipeDirection(-200, 0, 0)).toBe(0);
    const segments = visibleSegments({ events: true });
    expect(neighbourSegment(segments, 'builds', 1)?.value).toBe('events');
    expect(neighbourSegment(segments, 'builds', -1)).toBeNull();
    expect(neighbourSegment(segments, 'events', 1)).toBeNull();
  });

  it('each segment has its own deep link: /discover is Builds, /events is Treffen inside Entdecken', async () => {
    const router = await open('/discover');
    await screen.findByTestId('DISC-01.root');
    expect(screen.getByTestId('DISC-01.segments.builds').props.accessibilityState?.selected).toBe(true);

    await act(async () => appRouter.navigate('/events'));
    await screen.findByTestId('EVT-01.root');
    expect(router.getPathname()).toBe('/events');
    expect(router.getSegments()).toContain('(discover)');
    expect(screen.getByTestId('EVT-01.mode')).toHaveTextContent('segment');
    expect(screen.getByTestId('EVT-01.segments.events').props.accessibilityState?.selected).toBe(true);
  });

  it('a cold link to /events opens Treffen as Entdecken\'s segment', async () => {
    const router = await open('/events');
    await screen.findByTestId('EVT-01.root');
    expect(router.getSegments()).toContain('(discover)');
    expect(screen.getByTestId('EVT-01.mode')).toHaveTextContent('segment');
  });

  it('the segmented control swaps the pages in place, without stacking them', async () => {
    const router = await open('/discover');
    await screen.findByTestId('DISC-01.root');
    await fireEvent.press(screen.getByTestId('DISC-01.segments.events'));
    await screen.findByTestId('EVT-01.root');
    expect(router.getPathname()).toBe('/events');

    await fireEvent.press(screen.getByTestId('EVT-01.segments.builds'));
    await waitFor(() => expect(router.getPathname()).toBe('/discover'));
    // Builds is the stack's root again: nothing piled up below it.
    expect(discoverStack(router.getRouterState())).toEqual(['discover/index']);
    await fireEvent.press(screen.getByTestId('DISC-01.segments.events'));
    await waitFor(() => expect(router.getPathname()).toBe('/events'));
    await fireEvent.press(screen.getByTestId('EVT-01.segments.builds'));
    await fireEvent.press(screen.getByTestId('DISC-01.segments.events'));
    await waitFor(() => expect(router.getPathname()).toBe('/events'));
    // At most Builds below Treffen, never Builds → Treffen → Builds → ….
    expect(discoverStack(router.getRouterState()).length).toBeLessThanOrEqual(2);
    expect(discoverStack(router.getRouterState()).at(-1)).toBe('events/index');
  });

  it('a swipe to the left on Builds opens Treffen, a swipe to the right on Treffen goes back to Builds', async () => {
    const router = await open('/discover');
    await screen.findByTestId('DISC-01.root');
    await fireEvent(screen.getByTestId('DISC-01.swipe'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('DISC-01.swipe.pan'), [
        { translationX: 0, velocityX: 0 },
        { translationX: -120, velocityX: 0 },
        { translationX: -220, velocityX: 0 },
      ]);
    });
    await screen.findByTestId('EVT-01.root');
    expect(router.getPathname()).toBe('/events');

    await fireEvent(screen.getByTestId('EVT-01.swipe'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('EVT-01.swipe.pan'), [
        { translationX: 0, velocityX: 0 },
        { translationX: 220, velocityX: 0 },
      ]);
    });
    await waitFor(() => expect(router.getPathname()).toBe('/discover'));
  });

  it('moves like a pager: right pushes (the page behind keeps its state), left pops, at most two pages (review SF-2)', () => {
    const [builds, events, forum] = DISCOVER_SEGMENTS as [typeof DISCOVER_SEGMENTS[number], typeof DISCOVER_SEGMENTS[number], typeof DISCOVER_SEGMENTS[number]];
    const stack = (...names: string[]) => ({ routes: names.map((name, index) => ({ key: `k${index}`, name })) });
    expect(segmentMove(stack('discover/index'), events)).toEqual({ kind: 'push', path: '/events' });
    expect(segmentMove(stack('discover/index', 'events/index'), builds)).toEqual({ kind: 'pop', path: '/discover' });
    // Two segment pages already: Forum takes Treffen's place, Builds stays below.
    expect(segmentMove(stack('discover/index', 'events/index'), forum)).toEqual({ kind: 'replace', path: '/forum' });
    expect(segmentMove(stack('discover/index', 'forum/index'), events)).toEqual({ kind: 'replace', path: '/events' });
    // A lone Treffen never pushes Builds on top of itself (that would be a page to the left).
    expect(segmentMove(stack('events/index'), builds)).toEqual({ kind: 'replace', path: '/discover' });
  });

  it('keeps Builds mounted below Treffen, and back on Builds nothing is left above it', async () => {
    const router = await open('/discover');
    await screen.findByTestId('DISC-01.root');
    await fireEvent.press(screen.getByTestId('DISC-01.segments.events'));
    await screen.findByTestId('EVT-01.root');
    expect(discoverStack(router.getRouterState())).toEqual(['discover/index', 'events/index']);
    expect(screen.getByTestId('DISC-01.root', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('EVT-01.segments.builds'));
    await waitFor(() => expect(router.getPathname()).toBe('/discover'));
    expect(discoverStack(router.getRouterState())).toEqual(['discover/index']);
  });

  it('follows the finger one to one towards a neighbour and rubber-bands where there is none', () => {
    expect(segmentFollow(-100, true, false)).toBe(-100);
    expect(segmentFollow(100, true, false)).toBeCloseTo(55, 5);
    expect(segmentFollow(100, false, true)).toBe(100);
    expect(segmentFollow(-100, false, true)).toBeLessThan(0);
    expect(Math.abs(segmentFollow(-100, false, true))).toBeLessThan(100);
  });

  it('≥ 1280 the sidebar lists the segments, so neither Builds nor Treffen shows the segmented control (DQ-M52-03)', async () => {
    windowOf(1280);
    await open('/discover');
    await screen.findByTestId('DISC-01.root');
    expect(screen.getByTestId('DISC-01.mode')).toHaveTextContent('segment');
    expect(screen.queryByTestId('DISC-01.segments')).toBeNull();
    expect(isSelected('tab.discover')).toBe(true);
  });

  it('≥ 1280 Treffen shows no segmented control either, and its sidebar place is current', async () => {
    windowOf(1280);
    await open('/events');
    await screen.findByTestId('EVT-01.root');
    expect(screen.getByTestId('EVT-01.mode')).toHaveTextContent('segment');
    expect(screen.queryByTestId('EVT-01.segments')).toBeNull();
    expect(isSelected('shell.place.events')).toBe(true);
  });

  it('a short drag stays on the page', async () => {
    const router = await open('/discover');
    await screen.findByTestId('DISC-01.root');
    await fireEvent(screen.getByTestId('DISC-01.swipe'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('DISC-01.swipe.pan'), [
        { translationX: 0, velocityX: 0 },
        { translationX: -60, velocityX: -100 },
      ]);
    });
    expect(router.getPathname()).toBe('/discover');
  });

  it('Treffen pushed from Start is a page of its own, with no segments', async () => {
    const router = await open('/');
    await screen.findByTestId('HOME-01.root');
    await act(async () => appRouter.push('/events'));
    await screen.findByTestId('EVT-01.root');
    expect(router.getSegments()).toContain('(home)');
    expect(screen.getByTestId('EVT-01.mode')).toHaveTextContent('page');
    expect(screen.queryByTestId('EVT-01.segments')).toBeNull();
  });

  it('hides the control while Builds is the only segment (Treffen and Forum off)', async () => {
    mockFlags.mockReturnValue({});
    await open('/discover');
    await screen.findByTestId('DISC-01.root');
    expect(screen.queryByTestId('DISC-01.segments')).toBeNull();
  });
});

// The bundled config has no `forum` flag: the segment hides until M5.8 and the lead add it.
it('ships no forum flag in the bundled config', () => {
  expect(BUNDLED_APP_CONFIG.flags.forum).toBeUndefined();
});
