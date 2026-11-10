import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { rememberSearch, resetRecentSearchesForTests } from '@/features/discover/recentSearches';
import { DiscoverScreen } from '@/features/discover/screens/DiscoverScreen';
import { SEARCH_DEBOUNCE_MS, SearchScreen } from '@/features/discover/screens/SearchScreen';
import i18n from '@/i18n';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { KENJI, M4, MAKES, overview, page, R34 } from '../home/fixtures';
import { callsTo, newQueryClient, renderWithProviders, setNetwork, stubFetch, withProviders, type NetInfoListener } from '../home/harness';

const mockParams: Record<string, string | undefined> = {};
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/discover',
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
  keyboardDismissMode?: string;
  maintainVisibleContentPosition?: { disabled?: boolean };
};
/** What the last rendered list was given. */
const mockLastList: { props: MockListProps | null } = { props: null };
const mockScrollToOffset = jest.fn();
// Items render in place: virtualisation is FlashList's own business and needs a layout Jest does not have.
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: mockScrollToOffset, getScrollableNode: () => null }));
    mockLastList.props = props;
    const { data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, ListHeaderComponent, data.length === 0 ? ListEmptyComponent : items, ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'dismiss' })) }));
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

const setParams = (next: Record<string, string>) => {
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  Object.assign(mockParams, next);
};
const queryOf = (request: Request) => new URL(request.url).searchParams.get('q');
/** A second discoverable member, for the pages after the overview. */
const NIKO = { ...KENJI, username: 'niko.e46', display_name: 'Niko Berger', garage: { vehicles: 1, makes: ['BMW'], line: '1 Fahrzeug · BMW' } };

beforeAll(hydrateThemePreference);
beforeEach(async () => {
  jest.clearAllMocks();
  setParams({});
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
  resetRecentSearchesForTests();
  await AsyncStorage.clear();
  mockLastList.props = null;
});
afterEach(() => setNetwork(true, mockNetListeners));

/** The footer row is a row of the cards' column (`columnStyle`), with its content on the column's start edge (RESULT 11). */
function expectInColumn(testID: string) {
  const style = StyleSheet.flatten(screen.getByTestId(testID).props.style);
  expect(style).toMatchObject({ alignItems: 'flex-start', paddingHorizontal: expect.any(Number), width: '100%' });
  expect(style.paddingHorizontal).toBeGreaterThan(0);
  expect(style.maxWidth).toEqual(expect.any(Number));
}

describe('DISC-01 Entdecken', () => {
  it('shows the make tiles with their real counts and opens the make page (DISC-03)', async () => {
    stubFetch({ '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<DiscoverScreen />);

    expect(await screen.findByTestId('DISC-01.makes.bmw')).toHaveTextContent(/BMW.*12 Builds/);
    expect(screen.getByTestId('DISC-01.makes.nissan')).toHaveTextContent(/Nissan.*1 Build$/);
    await fireEvent.press(screen.getByTestId('DISC-01.makes.bmw'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/discover/make/[make]', params: { make: 'bmw' } });
  });

  it('searches what was typed and keeps it as a recent search on the device', async () => {
    stubFetch({ '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<DiscoverScreen />);

    await fireEvent.changeText(screen.getByTestId('DISC-01.search'), '  m4 ');
    expect(screen.getByTestId('DISC-01.searchSubmit')).toHaveTextContent('Nach „m4“ suchen');
    await fireEvent(screen.getByTestId('DISC-01.search'), 'submitEditing');
    // Submitted, so DISC-02 reads it for filter chips (contract §3).
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/discover/search', params: { q: 'm4', understand: '1' } });
    expect(await screen.findByTestId('DISC-01.recent.0')).toHaveTextContent('m4');
    await fireEvent.press(screen.getByTestId('DISC-01.recent.header.action'));
    await waitFor(() => expect(screen.queryByTestId('DISC-01.recent')).toBeNull());
  });

  it('has a designed empty state while no make has a public build', async () => {
    stubFetch({ '/discover': { body: { data: { makes: [] } } } });
    await renderWithProviders(<DiscoverScreen />);
    expect(await screen.findByTestId('DISC-01.empty')).toBeTruthy();
    // DQ-201, §8 one button: the first build is what fills the tiles. A guest is asked to sign in first.
    const action = screen.getByTestId('DISC-01.empty.action');
    expect(action).toHaveTextContent('Fahrzeug hinzufügen');
    await fireEvent.press(action);
    expect(useSessionStore.getState().promptOpen).toBe(true);
  });

  it('says it is offline, with a retry, when there is no copy on the device', async () => {
    const { calls } = stubFetch({ '/discover': { body: { data: { makes: MAKES } } } });
    await setNetwork(false, mockNetListeners);
    await renderWithProviders(<DiscoverScreen />);

    expect(await screen.findByTestId('DISC-01.offline')).toBeTruthy();
    expect(screen.queryByTestId('DISC-01.skeleton')).toBeNull();
    expect(callsTo(calls, '/discover')).toHaveLength(0);

    await setNetwork(true, mockNetListeners);
    expect(await screen.findByTestId('DISC-01.makes.bmw')).toBeTruthy();
  });
});

describe('DISC-02 Suche', () => {
  it('shows Fahrzeuge and Mitglieder with their counts, and the members with their garage line', async () => {
    setParams({ q: 'r34' });
    const { calls } = stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);

    expect(await screen.findByTestId('DISC-02.tab.vehicles')).toHaveTextContent('Fahrzeuge (1)');
    expect(screen.getByTestId('DISC-02.tab.members')).toHaveTextContent('Mitglieder (1)');
    expect(screen.getByTestId(`DISC-02.vehicle.${R34.id}`)).toBeTruthy();
    expect(calls.some((request) => new URL(request.url).pathname.endsWith('/search') && queryOf(request) === 'r34')).toBe(true);

    await fireEvent.press(screen.getByTestId('DISC-02.tab.members'));
    expect(await screen.findByTestId(`DISC-02.member.${KENJI.username}.garage`)).toHaveTextContent('4 Fahrzeuge · Nissan, Toyota');
    expect(screen.queryByTestId(`DISC-02.vehicle.${R34.id}`)).toBeNull();
  });

  it('does not scroll while only the skeleton is shown, because nothing in it can take keyboard focus', async () => {
    setParams({ q: 'r34' });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    let answer: (response: Response) => void = () => {};
    globalThis.fetch = jest.fn((input: Request | string) => {
      const path = new URL(typeof input === 'string' ? input : input.url).pathname;
      if (path.endsWith('/search')) return new Promise<Response>((resolve) => (answer = resolve));
      return Promise.resolve(json({ data: { makes: MAKES } }));
    }) as unknown as typeof fetch;
    await renderWithProviders(<SearchScreen />);

    expect(await screen.findByTestId('DISC-02.skeleton')).toBeTruthy();
    expect(mockLastList.props?.scrollEnabled).toBe(false);
    // DQ-205: a result usually carries a change, so the first card keeps its place for one.
    expect(screen.getByTestId('DISC-02.skeleton.card.latest')).toBeTruthy();
    await act(async () => answer(json({ data: overview() })));
    expect(await screen.findByTestId(`DISC-02.vehicle.${R34.id}`)).toBeTruthy();
    expect(mockLastList.props?.scrollEnabled).toBe(true);
  });

  it('opens a vehicle inside the tab and remembers the search', async () => {
    setParams({ q: 'r34' });
    stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);

    await fireEvent.press(await screen.findByTestId(`DISC-02.vehicle.${R34.id}.body`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${R34.slug}`);
  });

  it('opens the Mitglieder tab first when only members match, and shows "1000+" when the server stopped counting', async () => {
    setParams({ q: 'kenji' });
    stubFetch({
      '/search': { body: { data: overview({ query: 'kenji', vehicles: { count: 0, count_capped: false, items: [], next_cursor: null }, members: { count: 1000, count_capped: true, items: [KENJI], next_cursor: 'c1' } }) } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);

    expect(await screen.findByTestId(`DISC-02.member.${KENJI.username}`)).toBeTruthy();
    expect(screen.getByTestId('DISC-02.tab.members')).toHaveTextContent('Mitglieder (1.000+)');
  });

  it('says when nothing matches and offers the real makes', async () => {
    setParams({ q: 'trabant' });
    stubFetch({
      '/search': {
        body: { data: overview({ query: 'trabant', vehicles: { count: 0, count_capped: false, items: [], next_cursor: null }, members: { count: 0, count_capped: false, items: [], next_cursor: null } }) },
      },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);

    expect(await screen.findByTestId('DISC-02.noResults.title')).toHaveTextContent('Keine Treffer für „trabant“');
    expect(await screen.findByTestId('DISC-02.suggestions.0')).toHaveTextContent('BMW');
    await fireEvent.press(screen.getByTestId('DISC-02.suggestions.0'));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ q: 'BMW' });
  });

  it('shows the server sentence for a query it refuses', async () => {
    setParams({ q: '!!' });
    stubFetch({
      '/search': {
        status: 422,
        body: { message: 'Ungültige Eingabe', code: 'validation_failed', errors: { q: ['Der Suchbegriff braucht mindestens einen Buchstaben oder eine Ziffer.'] } },
      },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    expect(await screen.findByTestId('DISC-02.invalid.body')).toHaveTextContent('Der Suchbegriff braucht mindestens einen Buchstaben oder eine Ziffer.');
  });

  it('puts the query in the URL only after typing settles', async () => {
    jest.useFakeTimers();
    try {
      setParams({ q: 'r34' });
      stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
      await renderWithProviders(<SearchScreen />);

      await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'm');
      await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'm4');
      await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
      expect(mockRouter.setParams).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTime(1));
      expect(mockRouter.setParams).toHaveBeenCalledTimes(1);
      expect(mockRouter.setParams).toHaveBeenCalledWith({ q: 'm4' });
    } finally {
      jest.useRealTimers();
    }
  });

  // BH-40: the URL's echo of what this field sent is not a change from outside.
  it('keeps what was typed after the debounce fired when the older value comes back from the URL', async () => {
    jest.useFakeTimers();
    try {
      setParams({ q: 'niss' });
      stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
      const client = newQueryClient();
      const view = await renderWithProviders(<SearchScreen />, client);

      await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'nissa');
      await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
      expect(mockRouter.setParams).toHaveBeenLastCalledWith({ q: 'nissa' });

      // A key in the moment between the timer and the URL's answer.
      await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'nissan');
      setParams({ q: 'nissa' });
      await view.rerender(withProviders(<SearchScreen />, client));
      expect(screen.getByTestId('DISC-02.search').props.value).toBe('nissan');

      await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
      expect(mockRouter.setParams).toHaveBeenLastCalledWith({ q: 'nissan' });
    } finally {
      jest.useRealTimers();
    }
  });

  // BH-40 (RESULT 9): the debounce and Enter both sent before the URL answered the first: that older echo is not a change from outside.
  it('keeps the newer text when the echo of an older value sent comes after a newer send', async () => {
    jest.useFakeTimers();
    try {
      setParams({ q: 'niss' });
      stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
      const client = newQueryClient();
      const view = await renderWithProviders(<SearchScreen />, client);

      await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'nissa');
      await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
      expect(mockRouter.setParams).toHaveBeenLastCalledWith({ q: 'nissa' });
      await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'nissan');
      await fireEvent(screen.getByTestId('DISC-02.search'), 'submitEditing');
      expect(mockRouter.setParams).toHaveBeenLastCalledWith({ q: 'nissan' });

      // The URL answers the first send only now.
      setParams({ q: 'nissa' });
      await view.rerender(withProviders(<SearchScreen />, client));
      expect(screen.getByTestId('DISC-02.search').props.value).toBe('nissan');
      setParams({ q: 'nissan' });
      await view.rerender(withProviders(<SearchScreen />, client));
      expect(screen.getByTestId('DISC-02.search').props.value).toBe('nissan');
      await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
      expect(mockRouter.setParams).toHaveBeenCalledTimes(2);

      // Both echoes are used up: the older value, now from outside, is followed.
      setParams({ q: 'nissa' });
      await view.rerender(withProviders(<SearchScreen />, client));
      expect(screen.getByTestId('DISC-02.search').props.value).toBe('nissa');
    } finally {
      jest.useRealTimers();
    }
  });

  it('still follows the URL when it changes from outside, also to a value it sent before', async () => {
    jest.useFakeTimers();
    try {
      setParams({ q: 'r34' });
      stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
      const client = newQueryClient();
      const view = await renderWithProviders(<SearchScreen />, client);

      await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'm4');
      await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
      setParams({ q: 'm4' });
      await view.rerender(withProviders(<SearchScreen />, client));
      expect(screen.getByTestId('DISC-02.search').props.value).toBe('m4');

      // Back, a chip or a link.
      setParams({ q: 'gti' });
      await view.rerender(withProviders(<SearchScreen />, client));
      expect(screen.getByTestId('DISC-02.search').props.value).toBe('gti');

      // The value it sent earlier, now from outside: the echo above used up the mark.
      setParams({ q: 'm4' });
      await view.rerender(withProviders(<SearchScreen />, client));
      expect(screen.getByTestId('DISC-02.search').props.value).toBe('m4');
    } finally {
      jest.useRealTimers();
    }
  });

  // BH-39: a new query starts at its best result.
  it('starts a new query at the top, keeps no anchor, and leaves the place alone otherwise', async () => {
    setParams({ q: 'm4' });
    stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
    const client = newQueryClient();
    const view = await renderWithProviders(<SearchScreen />, client);
    await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);
    expect(mockLastList.props?.maintainVisibleContentPosition).toEqual({ disabled: true });
    expect(mockScrollToOffset).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('DISC-02.tab.members'));
    await view.rerender(withProviders(<SearchScreen />, client));
    expect(mockScrollToOffset).not.toHaveBeenCalled();

    setParams({ q: 'm' });
    await view.rerender(withProviders(<SearchScreen />, client));
    expect(mockScrollToOffset).toHaveBeenCalledTimes(1);
    expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
  });

  it('dismisses the keyboard on a drag on native (BH-38)', async () => {
    setParams({ q: 'm4' });
    stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);
    await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);
    expect(mockLastList.props?.keyboardDismissMode).toBe('on-drag');
  });

  // BH-43: the end of the list is reported once, so a turn missed offline is taken when the connection is back.
  describe('reaching the end offline', () => {
    const more = () => overview({ vehicles: { count: 2, count_capped: false, items: [R34], next_cursor: 'v1' } });

    it('loads the page on reconnect, through the same steps as the end of the list', async () => {
      setParams({ q: 'r34' });
      const { calls } = stubFetch({
        '/search/vehicles': { body: page([M4]) },
        '/search': { body: { data: more() } },
        '/discover': { body: { data: { makes: MAKES } } },
      });
      await renderWithProviders(<SearchScreen />);
      await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);

      await setNetwork(false, mockNetListeners);
      await act(async () => mockLastList.props?.onEndReached?.());
      expect(callsTo(calls, '/search/vehicles')).toHaveLength(0);

      await setNetwork(true, mockNetListeners);
      expect(await screen.findByTestId(`DISC-02.vehicle.${M4.id}`)).toBeTruthy();
      expect(callsTo(calls, '/search/vehicles')).toHaveLength(1);
    });

    it('asks for nothing on reconnect when the end was not reached', async () => {
      setParams({ q: 'r34' });
      const { calls } = stubFetch({
        '/search/vehicles': { body: page([M4]) },
        '/search': { body: { data: more() } },
        '/discover': { body: { data: { makes: MAKES } } },
      });
      await renderWithProviders(<SearchScreen />);
      await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);

      await setNetwork(false, mockNetListeners);
      await setNetwork(true, mockNetListeners);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(callsTo(calls, '/search/vehicles')).toHaveLength(0);
    });

    it('offers "Mehr laden" at the end while more is there, not a blank footer, and it loads the page', async () => {
      setParams({ q: 'r34' });
      const { calls } = stubFetch({
        '/search/vehicles': { body: page([M4]) },
        '/search': { body: { data: more() } },
        '/discover': { body: { data: { makes: MAKES } } },
      });
      await renderWithProviders(<SearchScreen />);
      await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);

      const button = screen.getByTestId('DISC-02.more');
      expect(button).toHaveTextContent(i18n.t('list.more', { ns: 'discover', lng: 'de' }));
      // Its own ID: `.moreRetry` means a page failed (BH-43 review).
      expect(screen.queryByTestId('DISC-02.moreRetry')).toBeNull();
      expectInColumn('DISC-02.moreRow');
      await fireEvent.press(button);
      expect(await screen.findByTestId(`DISC-02.vehicle.${M4.id}`)).toBeTruthy();
      expect(callsTo(calls, '/search/vehicles')).toHaveLength(1);
      expect(screen.queryByTestId('DISC-02.more')).toBeNull();
    });

    // RESULT 9: the spinner is for a page on its way, and a turn at the end during a refresh of the pages is kept, not dropped.
    it('shows the spinner for a new page only, and takes the end missed during a refresh on reconnect once it settles', async () => {
      setParams({ q: 'r34' });
      const X = { ...M4, id: '01x', slug: 'build-x', full_title: 'Build X' };
      const { calls } = stubFetch({
        '/search/vehicles': (request) => (new URL(request.url).searchParams.get('cursor') === 'v2' ? { body: page([X]) } : { body: page([M4], 'v2') }),
        '/search': { body: { data: more() } },
        '/discover': { body: { data: { makes: MAKES } } },
      });
      const answer = globalThis.fetch;
      let hold = true;
      const held: (() => void)[] = [];
      const release = () => {
        for (const resolve of held.splice(0)) resolve();
      };
      globalThis.fetch = (async (input: Request) => {
        const url = new URL(input.url);
        if (hold && url.pathname.endsWith('/search/vehicles') && url.searchParams.get('cursor') === 'v1') {
          await new Promise<void>((resolve) => held.push(resolve));
        }
        return answer(input);
      }) as typeof fetch;
      const asked = (cursor: string) => calls.filter((request) => new URL(request.url).searchParams.get('cursor') === cursor);
      await renderWithProviders(<SearchScreen />);
      await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);

      // The first page after the overview: the spinner, in the column.
      await act(async () => mockLastList.props?.onEndReached?.());
      expect(await screen.findByTestId('DISC-02.loadingMore')).toBeTruthy();
      expectInColumn('DISC-02.loadingMore');
      await act(async () => release());
      expect(await screen.findByTestId(`DISC-02.vehicle.${M4.id}`)).toBeTruthy();

      // Offline the end comes into view. Back online, TanStack hears it first here and refreshes the pages (refetchOnReconnect); the
      // screen hears it while that refresh runs.
      await setNetwork(false, mockNetListeners);
      await act(async () => mockLastList.props?.onEndReached?.());
      await act(async () => onlineManager.setOnline(true));
      await waitFor(() => expect(held.length).toBeGreaterThan(0));
      await act(async () => {
        for (const listener of mockNetListeners) listener({ isConnected: true });
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      // A refresh brings no new page: no "Weitere Ergebnisse werden geladen", and "Mehr laden" stays.
      expect(screen.queryByTestId('DISC-02.loadingMore')).toBeNull();
      expect(screen.getByTestId('DISC-02.more')).toBeTruthy();
      expect(asked('v2')).toHaveLength(0);

      hold = false;
      await act(async () => release());
      expect(await screen.findByTestId(`DISC-02.vehicle.${X.id}`)).toBeTruthy();
      expect(asked('v2')).toHaveLength(1);
    });

    it('offers nothing when the results end with the overview', async () => {
      setParams({ q: 'r34' });
      stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
      await renderWithProviders(<SearchScreen />);
      await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);
      expect(screen.queryByTestId('DISC-02.moreRetry')).toBeNull();
      expect(screen.queryByTestId('DISC-02.more')).toBeNull();
    });
  });

  it('offers recent searches and makes on an empty field', async () => {
    rememberSearch('e46');
    stubFetch({ '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);

    expect(await screen.findByTestId('DISC-02.recent.0')).toHaveTextContent('e46');
    expect(await screen.findByTestId('DISC-02.suggestions.1')).toHaveTextContent('Nissan');
    expect(screen.queryByTestId(`DISC-02.vehicle.${M4.id}`)).toBeNull();
  });

  it('says it is offline, with a retry, when there is no copy on the device', async () => {
    setParams({ q: 'r34' });
    const { calls } = stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
    await setNetwork(false, mockNetListeners);
    await renderWithProviders(<SearchScreen />);

    expect(await screen.findByTestId('DISC-02.offline')).toBeTruthy();
    expect(screen.queryByTestId('DISC-02.skeleton')).toBeNull();
    expect(callsTo(calls, '/search')).toHaveLength(0);

    await setNetwork(true, mockNetListeners);
    expect(await screen.findByTestId(`DISC-02.vehicle.${R34.id}`)).toBeTruthy();
  });

  it('never shows the last query’s results under a new query that cannot be sent offline', async () => {
    setParams({ q: 'r34' });
    const golf = overview({ query: 'golf gti', vehicles: { count: 1, count_capped: false, items: [M4], next_cursor: null } });
    stubFetch({
      '/search': (request) => ({ body: { data: queryOf(request) === 'golf gti' ? golf : overview() } }),
      '/discover': { body: { data: { makes: MAKES } } },
    });
    const client = newQueryClient();
    const view = await renderWithProviders(<SearchScreen />, client);
    expect(await screen.findByTestId('DISC-02.tab.vehicles')).toHaveTextContent('Fahrzeuge (1)');

    await setNetwork(false, mockNetListeners);
    setParams({ q: 'golf gti' });
    await view.rerender(withProviders(<SearchScreen />, client));

    expect(await screen.findByTestId('DISC-02.offline')).toBeTruthy();
    expect(screen.queryByTestId(`DISC-02.vehicle.${R34.id}`)).toBeNull();
    expect(screen.queryByTestId('DISC-02.tabs')).toBeNull();
    expect(screen.queryByTestId('DISC-02.searching')).toBeNull();

    // Back online, the paused query is sent and answers for itself.
    await setNetwork(true, mockNetListeners);
    expect(await screen.findByTestId(`DISC-02.vehicle.${M4.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`DISC-02.vehicle.${R34.id}`)).toBeNull();
  });

  describe('while the next query is on its way', () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    /** Answers `/search` at once, except for `held`, which waits for `release`. */
    function holdQuery(answers: Record<string, unknown>, held: string) {
      const calls: Request[] = [];
      let release: (body: unknown) => void = () => {};
      globalThis.fetch = jest.fn(async (input: Request | string) => {
        const request = typeof input === 'string' ? new Request(input) : input;
        calls.push(request);
        const path = new URL(request.url).pathname;
        if (path.endsWith('/discover')) return json({ data: { makes: MAKES } });
        if (path.endsWith('/search/users')) return json(page([NIKO]));
        const q = queryOf(request) ?? '';
        if (q === held) return new Promise<Response>((resolve) => (release = (body) => resolve(json({ data: body }))));
        return json({ data: answers[q] });
      }) as unknown as typeof fetch;
      return { calls, release: (body: unknown) => release(body) };
    }

    it('keeps the last results under the busy sign and starts no page of them', async () => {
      setParams({ q: 'kenji' });
      const kenji = overview({ query: 'kenji', vehicles: { count: 0, count_capped: false, items: [], next_cursor: null }, members: { count: 21, count_capped: false, items: [KENJI], next_cursor: 'c1' } });
      const held = holdQuery({ kenji }, 'niko');
      const client = newQueryClient();
      const view = await renderWithProviders(<SearchScreen />, client);
      expect(await screen.findByTestId(`DISC-02.member.${KENJI.username}`)).toBeTruthy();

      setParams({ q: 'niko' });
      await view.rerender(withProviders(<SearchScreen />, client));
      expect(await screen.findByTestId('DISC-02.searching')).toBeTruthy();
      expect(screen.getByTestId(`DISC-02.member.${KENJI.username}`)).toBeTruthy();
      await act(async () => mockLastList.props?.onEndReached?.());
      await act(async () => mockLastList.props?.onEndReached?.());
      expect(callsTo(held.calls, '/search/users')).toHaveLength(0);

      await act(async () =>
        held.release(overview({ query: 'niko', vehicles: { count: 0, count_capped: false, items: [], next_cursor: null }, members: { count: 1, count_capped: false, items: [NIKO], next_cursor: null } })),
      );
      expect(await screen.findByTestId(`DISC-02.member.${NIKO.username}`)).toBeTruthy();
      expect(screen.queryByTestId(`DISC-02.member.${KENJI.username}`)).toBeNull();
      expect(screen.queryByTestId('DISC-02.searching')).toBeNull();
    });

    it('shows the skeleton, not the last query’s "Keine Treffer"', async () => {
      setParams({ q: 'trabant' });
      const none = { count: 0, count_capped: false, items: [], next_cursor: null };
      const held = holdQuery({ trabant: overview({ query: 'trabant', vehicles: none, members: none }) }, 'r34');
      const client = newQueryClient();
      const view = await renderWithProviders(<SearchScreen />, client);
      expect(await screen.findByTestId('DISC-02.noResults')).toBeTruthy();

      setParams({ q: 'r34' });
      await view.rerender(withProviders(<SearchScreen />, client));
      expect(await screen.findByTestId('DISC-02.skeleton')).toBeTruthy();
      expect(screen.queryByTestId('DISC-02.noResults')).toBeNull();

      await act(async () => held.release(overview()));
      expect(await screen.findByTestId(`DISC-02.vehicle.${R34.id}`)).toBeTruthy();
    });
  });

  it('continues the members from the overview’s cursor at the end of the list, each member once', async () => {
    setParams({ q: 'kenji' });
    const { calls } = stubFetch({
      '/search/users': { body: page([KENJI, NIKO]) },
      '/search': {
        body: { data: overview({ query: 'kenji', vehicles: { count: 0, count_capped: false, items: [], next_cursor: null }, members: { count: 2, count_capped: false, items: [KENJI], next_cursor: 'c1' } }) },
      },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    expect(await screen.findByTestId(`DISC-02.member.${KENJI.username}`)).toBeTruthy();
    expect(callsTo(calls, '/search/users')).toHaveLength(0);

    await act(async () => mockLastList.props?.onEndReached?.());
    expect(await screen.findByTestId(`DISC-02.member.${NIKO.username}`)).toBeTruthy();
    expect(screen.getAllByTestId(`DISC-02.member.${KENJI.username}`)).toHaveLength(1);
    const pages = callsTo(calls, '/search/users');
    expect(pages).toHaveLength(1);
    const params = new URL(pages[0]?.url ?? 'https://speedclub.test').searchParams;
    expect([params.get('q'), params.get('cursor'), params.get('per_page')]).toEqual(['kenji', 'c1', '20']);

    // The last page had no cursor: the end of the list asks for nothing more.
    await act(async () => mockLastList.props?.onEndReached?.());
    expect(callsTo(calls, '/search/users')).toHaveLength(1);
  });

  it('keeps the results when a page fails, says so at the end, and the retry loads it', async () => {
    setParams({ q: 'r34' });
    let fail = true;
    stubFetch({
      '/search/vehicles': () => (fail ? { status: 500, body: { message: 'Serverfehler', code: 'server', errors: {} } } : { body: page([M4]) }),
      '/search': { body: { data: overview({ vehicles: { count: 2, count_capped: false, items: [R34], next_cursor: 'v1' } }) } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    await screen.findByTestId(`DISC-02.vehicle.${R34.id}`);

    await act(async () => mockLastList.props?.onEndReached?.());
    expect(await screen.findByTestId('DISC-02.moreError')).toHaveTextContent(i18n.t('list.moreError', { ns: 'discover', lng: 'de' }), { exact: false });
    expect(screen.getByTestId(`DISC-02.vehicle.${R34.id}`)).toBeTruthy();
    expectInColumn('DISC-02.moreError');

    fail = false;
    await fireEvent.press(screen.getByTestId('DISC-02.moreRetry'));
    expect(await screen.findByTestId(`DISC-02.vehicle.${M4.id}`)).toBeTruthy();
    expect(screen.queryByTestId('DISC-02.moreError')).toBeNull();
  });

  it('says how long to wait after too many searches, in the server’s words', async () => {
    setParams({ q: 'r34' });
    const sentence = 'Zu viele Suchanfragen. Versuch es in 30 Sekunden noch einmal.';
    stubFetch({
      '/search': { status: 429, body: { message: sentence, code: 'rate_limited', errors: {} } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    expect(await screen.findByTestId('DISC-02.error.body')).toHaveTextContent(sentence);
    expect(screen.getByTestId('DISC-02.error.action')).toBeTruthy();
  });
});
