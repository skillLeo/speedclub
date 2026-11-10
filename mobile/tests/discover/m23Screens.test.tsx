import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { DiscoverCollection, MakePage, ModelPage, WheelSetup } from '@/api/queries/discover';
import type { Facets } from '@/api/queries/search';
import { forgetLabelsForTests } from '@/features/discover/chipLabels';
import { resetRecentSearchesForTests } from '@/features/discover/recentSearches';
import { DiscoverScreen } from '@/features/discover/screens/DiscoverScreen';
import { MakeScreen } from '@/features/discover/screens/MakeScreen';
import { ModelScreen } from '@/features/discover/screens/ModelScreen';
import { FACETS_DEBOUNCE_MS, SearchScreen } from '@/features/discover/screens/SearchScreen';
import { similarSearchHref, similarSearchState } from '@/features/discover/similarSearch';
import i18n from '@/i18n';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { KENJI, M4, MAKES, MODS, overview, page, R34 } from '../home/fixtures';
import { callsTo, renderWithProviders, setNetwork, stubFetch, type NetInfoListener } from '../home/harness';

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
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const mockNetListeners = jest.requireMock<{ listeners: Set<NetInfoListener> }>('@react-native-community/netinfo').listeners;
const mockToast = jest.fn();
jest.mock('@/ui/toast', () => ({ ...jest.requireActual<object>('@/ui/toast'), toast: (...args: unknown[]) => mockToast(...args) }));

const setParams = (next: Record<string, string>) => {
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  Object.assign(mockParams, next);
};

const facet = (value: string, label: string, count: number) => ({ value, label, count });
function facets(overrides: Partial<Facets> = {}): Facets {
  return {
    total: 4,
    total_capped: false,
    makes: [facet('bmw', 'BMW', 12), facet('nissan', 'Nissan', 2)],
    models: null,
    generations: null,
    drivetrain: [facet('rear', 'Heck', 9), facet('all', 'Allrad', 4)],
    gearbox: [],
    fuel: [],
    wheel_diameter: [facet('19', '19″', 3), facet('20', '20″', 2)],
    wheel_brand: [facet('bbs', 'BBS', 2)],
    suspension_type: [facet('coilover', 'Gewindefahrwerk', 5)],
    suspension_brand: [],
    exhaust_brand: [],
    mod_category: [],
    year: { min: 1999, max: 2024 },
    power: { min: 150, max: 650 },
    ...overrides,
  };
}
const COLLECTION: DiscoverCollection = {
  key: 'bmw-m',
  title: 'BMW M Builds',
  subtitle: 'M2, M3 und M4 ab 340 PS',
  cover: null,
  filters: { make: 'bmw', power_min: 340 },
  sort: 'power',
  count: 4,
  count_capped: false,
};
const searchOf = (request: Request) => new URL(request.url).search;

beforeAll(async () => {
  await hydrateThemePreference();
  await i18n.changeLanguage('de');
});
beforeEach(async () => {
  jest.clearAllMocks();
  setParams({});
  forgetLabelsForTests();
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
  resetRecentSearchesForTests();
  await AsyncStorage.clear();
});

describe('DISC-01 additions (FS-11)', () => {
  it('shows Kollektionen with their real count, and one opens DISC-02 with its filters and sort as chips', async () => {
    stubFetch({ '/discover': { body: { data: { makes: MAKES, collections: [COLLECTION], popular_mods: MODS, similar_members: null } } } });
    await renderWithProviders(<DiscoverScreen />);
    expect(await screen.findByTestId('DISC-01.collections.bmw-m')).toHaveTextContent(/BMW M Builds.*M2, M3 und M4 ab 340 PS.*4 Builds/);
    await fireEvent.press(screen.getByTestId('DISC-01.collections.bmw-m'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/discover/search', params: { make: 'bmw', power_min: '340', sort: 'power' } });
  });

  it('shows Beliebte Mods as search chips, and the members with similar cars only when there are some', async () => {
    stubFetch({ '/discover': { body: { data: { makes: MAKES, collections: [], popular_mods: MODS, similar_members: [KENJI] } } } });
    await renderWithProviders(<DiscoverScreen />);
    expect(await screen.findByTestId('DISC-01.popularMods.chip.0')).toBeTruthy();
    expect(screen.queryByTestId('DISC-01.collections')).toBeNull();
    expect(screen.getByTestId(`DISC-01.similarMembers.${KENJI.username}.garage`)).toHaveTextContent('4 Fahrzeuge · Nissan, Toyota');
    await fireEvent.press(screen.getByTestId(`DISC-01.similarMembers.${KENJI.username}.body`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/u/[username]', params: { username: KENJI.username } });
  });
});

describe('DISC-02 filters', () => {
  it('sends every filter of the URL with bracketed lists, and shows them as removable chips with the facets’ names', async () => {
    setParams({ make: 'bmw', drivetrain: 'rear,all', wheel_diameter: '19', suspension_type: 'coilover', sort: 'power' });
    const { calls } = stubFetch({
      '/search': { body: { data: overview({ query: '', members: { count: 0, count_capped: false, items: [], next_cursor: null } }) } },
      '/search/facets': { body: { data: facets() } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    expect(await screen.findByTestId(`DISC-02.vehicle.${R34.id}`)).toBeTruthy();
    const request = callsTo(calls, '/search')[0];
    expect(request && decodeURIComponent(searchOf(request))).toBe('?make=bmw&drivetrain[]=rear&drivetrain[]=all&wheel_diameter[]=19&suspension_type[]=coilover&sort=power');
    // No text: no Mitglieder tab, and the count and sort above the results.
    expect(screen.queryByTestId('DISC-02.tabs')).toBeNull();
    expect(screen.getByTestId('DISC-02.results.count')).toHaveTextContent(/^1 Build\s·/);
    expect(screen.getByTestId('DISC-02.results.sort')).toHaveTextContent('Meiste PS');
    await waitFor(() => expect(screen.getByTestId('DISC-02.chips.drivetrain.rear')).toHaveTextContent('Heck'));
    expect(screen.getByTestId('DISC-02.chips.make.bmw')).toHaveTextContent('BMW');
    expect(screen.getByTestId('DISC-02.chips.suspension_type.coilover')).toHaveTextContent('Gewindefahrwerk');
    expect(screen.getByTestId('DISC-02.chips.filter')).toHaveTextContent('Filter5');

    await fireEvent.press(screen.getByTestId('DISC-02.chips.drivetrain.rear.remove'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ drivetrain: 'all', make: 'bmw', sort: 'power' }));
    await fireEvent.press(screen.getByTestId('DISC-02.chips.make.bmw.remove'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ make: undefined, model: undefined }));
  });

  it('opens "Alle" from Home: sort=updated alone lists every build in that order', async () => {
    setParams({ sort: 'updated' });
    const { calls } = stubFetch({ '/search': { body: { data: overview({ query: '' }) } }, '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);
    expect(await screen.findByTestId(`DISC-02.vehicle.${R34.id}`)).toBeTruthy();
    expect(searchOf(callsTo(calls, '/search')[0] as Request)).toBe('?sort=updated');
    expect(screen.getByTestId('DISC-02.results.sort')).toHaveTextContent('Zuletzt aktualisiert');
    expect(callsTo(calls, '/search/facets')).toHaveLength(0);
  });

  it('the filter sheet shows facet counts and the live total of its draft, and applies only with its button', async () => {
    setParams({ q: 'turbo' });
    const { calls } = stubFetch({
      '/search': { body: { data: overview({ query: 'turbo' }) } },
      '/search/facets': (request) => ({ body: { data: facets({ total: new URL(request.url).search.includes('drivetrain') ? 9 : 24 }) } }),
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    await fireEvent.press(await screen.findByTestId('DISC-02.chips.filter'));
    expect(await screen.findByTestId('DISC-02.filterSheet.apply')).toHaveTextContent('24 Builds anzeigen');
    expect(screen.getByTestId('DISC-02.filterSheet.panel.drivetrain.rear')).toHaveTextContent('Heck9');
    expect(screen.getByTestId('DISC-02.filterSheet.panel.wheel_diameter.19')).toHaveTextContent('19″3');

    await fireEvent.press(screen.getByTestId('DISC-02.filterSheet.panel.drivetrain.rear'));
    await waitFor(() => expect(screen.getByTestId('DISC-02.filterSheet.apply')).toHaveTextContent('9 Builds anzeigen'));
    expect(callsTo(calls, '/search/facets').some((request) => decodeURIComponent(searchOf(request)) === '?q=turbo&drivetrain[]=rear')).toBe(true);
    expect(mockRouter.setParams).not.toHaveBeenCalledWith(expect.objectContaining({ drivetrain: 'rear' }));

    await fireEvent.press(screen.getByTestId('DISC-02.filterSheet.apply'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'turbo', drivetrain: 'rear' }));
  });

  it('asks for facets once the taps settle: three quick taps in the sheet are one request', async () => {
    setParams({ q: 'turbo' });
    const { calls } = stubFetch({
      '/search': { body: { data: overview({ query: 'turbo' }) } },
      '/search/facets': { body: { data: facets() } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    jest.useFakeTimers();
    try {
      await renderWithProviders(<SearchScreen />);
      await act(async () => jest.advanceTimersByTime(FACETS_DEBOUNCE_MS));
      await fireEvent.press(await screen.findByTestId('DISC-02.chips.filter'));
      await act(async () => jest.advanceTimersByTime(FACETS_DEBOUNCE_MS));
      await screen.findByTestId('DISC-02.filterSheet.panel.drivetrain.rear');
      const before = callsTo(calls, '/search/facets').length;
      await fireEvent.press(screen.getByTestId('DISC-02.filterSheet.panel.drivetrain.rear'));
      await fireEvent.press(screen.getByTestId('DISC-02.filterSheet.panel.drivetrain.all'));
      await fireEvent.press(screen.getByTestId('DISC-02.filterSheet.panel.wheel_diameter.19'));
      // The count is not the draft's yet: the button says so instead of showing the old number.
      expect(screen.getByTestId('DISC-02.filterSheet.apply')).toHaveTextContent(/^Builds anzeigen$/);
      expect(callsTo(calls, '/search/facets')).toHaveLength(before);
      await act(async () => jest.advanceTimersByTime(FACETS_DEBOUNCE_MS));
      await waitFor(() => expect(callsTo(calls, '/search/facets')).toHaveLength(before + 1));
      const last = callsTo(calls, '/search/facets').at(-1) as Request;
      expect(decodeURIComponent(searchOf(last))).toBe('?q=turbo&drivetrain[]=rear&drivetrain[]=all&wheel_diameter[]=19');
    } finally {
      jest.useRealTimers();
    }
  });

  it('applies a change made just before "anzeigen", and the URL never got the draft before', async () => {
    setParams({ q: 'turbo' });
    stubFetch({
      '/search': { body: { data: overview({ query: 'turbo' }) } },
      '/search/facets': { body: { data: facets() } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    await fireEvent.press(await screen.findByTestId('DISC-02.chips.filter'));
    await fireEvent.changeText(await screen.findByTestId('DISC-02.filterSheet.panel.yearMin'), '2018');
    await fireEvent.press(screen.getByTestId('DISC-02.filterSheet.apply'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ year_min: '2018' }));
  });

  it('drops a filter the API refuses and says which one', async () => {
    setParams({ wheel_brand: 'oldbrand', make: 'bmw' });
    stubFetch({
      '/search': {
        status: 422,
        body: { message: 'Ungültig', code: 'validation_failed', errors: { wheel_brand: ['Diese Marke gibt es im Teilekatalog nicht.'] } },
      },
      '/search/facets': { status: 422, body: { message: 'Ungültig', code: 'validation_failed', errors: {} } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    await waitFor(() => expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ make: 'bmw', wheel_brand: undefined })));
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('Oldbrand'));
  });

  it('picks a make in the sheet’s own picker page, and "Zurücksetzen" clears the draft', async () => {
    setParams({ q: 'turbo' });
    stubFetch({
      '/search': { body: { data: overview({ query: 'turbo' }) } },
      '/search/facets': { body: { data: facets() } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    await fireEvent.press(await screen.findByTestId('DISC-02.chips.filter'));
    await fireEvent.press(await screen.findByTestId('DISC-02.filterSheet.panel.make'));
    expect(await screen.findByTestId('DISC-02.filterSheet.picker.make.bmw.count')).toHaveTextContent('12');
    await fireEvent.press(screen.getByTestId('DISC-02.filterSheet.picker.make.bmw'));
    expect(await screen.findByTestId('DISC-02.filterSheet.panel.make')).toHaveTextContent(/Marke.*BMW/);
    await fireEvent.press(screen.getByTestId('DISC-02.filterSheet.reset'));
    expect(await screen.findByTestId('DISC-02.filterSheet.panel.make')).toHaveTextContent(/Marke.*Alle/);
  });

  it('says when nothing matches the filters, with "Filter zurücksetzen"', async () => {
    setParams({ make: 'bmw', model: 'm4', wheel_diameter: '19' });
    stubFetch({
      '/search': { body: { data: overview({ query: '', vehicles: { count: 0, count_capped: false, items: [], next_cursor: null }, members: { count: 0, count_capped: false, items: [], next_cursor: null } }) } },
      '/search/facets': { body: { data: facets({ total: 0 }) } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    expect(await screen.findByTestId('DISC-02.noResultsFiltered')).toHaveTextContent(/Keine Builds für diese Filter/);
    await fireEvent.press(screen.getByTestId('DISC-02.noResultsFiltered.action'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ make: undefined, model: undefined, wheel_diameter: undefined }));
  });

  it('sorts from the sort sheet and switches to the grid of tiles', async () => {
    setParams({ q: 'r34' });
    stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);
    expect(await screen.findByTestId('DISC-02.results.sort')).toHaveTextContent('Relevanz');
    await fireEvent.press(screen.getByTestId('DISC-02.results.sort'));
    await fireEvent.press(await screen.findByTestId('DISC-02.sortSheet.power'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'r34', sort: 'power' }));
    await fireEvent.press(screen.getByTestId('DISC-02.results.view.grid'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'grid' }));
  });

  it('draws tiles in the grid view', async () => {
    setParams({ q: 'r34', view: 'grid' });
    stubFetch({ '/search': { body: { data: overview({ vehicles: { count: 2, count_capped: false, items: [R34, M4], next_cursor: null } }) } }, '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);
    expect(await screen.findByTestId(`DISC-02.tile.${M4.id}`)).toHaveTextContent(/BMW M4 G82/);
    expect(screen.queryByTestId(`DISC-02.vehicle.${R34.id}`)).toBeNull();
  });
});

describe('DISC-02 query understanding (contract §3)', () => {
  const understood = {
    filters: { make: 'nissan', model: 'skyline-gt-r', generation: 'r34' },
    chips: [
      { field: 'make', value: 'nissan', label: 'Nissan', matched: null },
      { field: 'model', value: 'skyline-gt-r', label: 'Skyline GT-R', matched: null },
      { field: 'generation', value: 'r34', label: 'R34', matched: 'r34' },
    ],
    remaining_q: '',
  };

  it('turns a submitted text into visible chips and searches with what is left', async () => {
    const { calls } = stubFetch({
      '/search': { body: { data: overview() } },
      '/search/interpret': { body: { data: understood } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'r34');
    await fireEvent(screen.getByTestId('DISC-02.search'), 'submitEditing');
    await waitFor(() =>
      expect(mockRouter.setParams).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: undefined, make: 'nissan', model: 'skyline-gt-r', generation: 'r34', understand: undefined }),
      ),
    );
    expect(new URL((callsTo(calls, '/search/interpret')[0] as Request).url).searchParams.get('q')).toBe('r34');
  });

  it('reads the text DISC-01 submitted once, using the request up before the answer', async () => {
    setParams({ q: 'carbon', understand: '1' });
    const { calls } = stubFetch({
      '/search': { body: { data: overview({ query: 'carbon' }) } },
      '/search/interpret': { body: { data: { filters: {}, chips: [], remaining_q: 'carbon' } } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    // Typing on must never read the text again; with nothing understood nothing else changes.
    expect(mockRouter.setParams).toHaveBeenCalledWith({ understand: undefined });
    await waitFor(() => expect(callsTo(calls, '/search/interpret')).toHaveLength(1));
    expect(mockRouter.setParams).toHaveBeenCalledTimes(1);
  });

  it('announces what it understood for screen readers', async () => {
    stubFetch({
      '/search': { body: { data: overview() } },
      '/search/interpret': {
        body: { data: { filters: { make: 'nissan' }, chips: [{ field: 'make', value: 'nissan', label: 'Nissan', matched: 'nissan' }], remaining_q: '' } },
      },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'nissan');
    await fireEvent(screen.getByTestId('DISC-02.search'), 'submitEditing');
    await waitFor(() => expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ make: 'nissan' })));
    expect(screen.getByTestId('DISC-02.understood')).toHaveProp('aria-live', 'polite');
  });

  it('reads a text submitted offline once the connection is back, so its chips still come', async () => {
    stubFetch({
      '/search': { body: { data: overview() } },
      '/search/interpret': { body: { data: understood } },
      '/discover': { body: { data: { makes: MAKES } } },
    });
    await renderWithProviders(<SearchScreen />);
    await setNetwork(false, mockNetListeners);
    try {
      await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'r34');
      await fireEvent(screen.getByTestId('DISC-02.search'), 'submitEditing');
      expect(mockRouter.setParams).not.toHaveBeenCalledWith(expect.objectContaining({ make: 'nissan' }));
      await setNetwork(true, mockNetListeners);
      await waitFor(() => expect(mockRouter.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ make: 'nissan', generation: 'r34' })));
    } finally {
      await setNetwork(true, mockNetListeners);
    }
  });

  it('keeps the text search when the interpreter cannot answer', async () => {
    stubFetch({ '/search': { body: { data: overview() } }, '/discover': { body: { data: { makes: MAKES } } } });
    await renderWithProviders(<SearchScreen />);
    await fireEvent.changeText(screen.getByTestId('DISC-02.search'), 'r34');
    await fireEvent(screen.getByTestId('DISC-02.search'), 'submitEditing');
    expect(mockRouter.setParams).toHaveBeenCalledWith({ q: 'r34' });
    await waitFor(() => expect(mockRouter.setParams).toHaveBeenCalledTimes(1));
  });
});

const MAKE_PAGE: MakePage = {
  make: { id: 1, name: 'BMW', slug: 'bmw', vehicle_count: 4 },
  models: [
    {
      id: 10,
      name: 'M3',
      slug: 'm3',
      key: 'bmw--m3',
      vehicle_count: 2,
      generations: [
        { name: 'E46', slug: 'e46', year_from: 2000, year_to: 2006, vehicle_count: 1 },
        { name: 'G80', slug: 'g80', year_from: 2020, year_to: null, vehicle_count: 1 },
      ],
    },
    { id: 11, name: 'M4', slug: 'm4', key: 'bmw--m4', vehicle_count: 1, generations: [] },
  ],
};

describe('DISC-03 make page', () => {
  it('shows the make’s real count, its models with counts and generation chips, each leading to DISC-04', async () => {
    setParams({ make: 'bmw' });
    stubFetch({ '/discover/makes/bmw': { body: { data: MAKE_PAGE } } });
    await renderWithProviders(<MakeScreen />);
    expect(await screen.findByTestId('DISC-03.count')).toHaveTextContent('4 öffentliche Builds');
    expect(screen.getByTestId('DISC-03.model.m3')).toHaveTextContent(/M3.*2 Builds/);
    expect(screen.getByTestId('DISC-03.model.m3.generation.g80')).toHaveTextContent(/^G80 · seit 2020/);
    await fireEvent.press(screen.getByTestId('DISC-03.model.m3.generation.e46'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/discover/model/[model]', params: { model: 'bmw--m3', generation: 'e46' } });
    await fireEvent.press(screen.getByTestId('DISC-03.model.m4'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/discover/model/[model]', params: { model: 'bmw--m4' } });
    await fireEvent.press(screen.getByTestId('DISC-03.allBuilds'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/discover/search', params: { make: 'bmw' } });
  });

  it('says so for a make without a visible build', async () => {
    setParams({ make: 'trabant' });
    stubFetch({});
    await renderWithProviders(<MakeScreen />);
    expect(await screen.findByTestId('DISC-03.notFound')).toHaveTextContent(/Marke nicht gefunden/);
  });
});

const MODEL_PAGE: ModelPage = {
  model: { id: 20, name: 'Skyline GT-R', slug: 'skyline-gt-r', key: 'nissan--skyline-gt-r', vehicle_count: 2 },
  make: { id: 2, name: 'Nissan', slug: 'nissan', vehicle_count: 3 },
  generations: [{ name: 'R34', slug: 'r34', year_from: 1999, year_to: 2002, vehicle_count: 2 }],
};
const SETUP: WheelSetup = {
  vehicle: { id: R34.id, slug: R34.slug, full_title: R34.full_title, cover: null, owner: null },
  wheel: {
    brand: 'Volk Racing',
    model: 'TE37 SL',
    diameter_front: 18,
    diameter_rear: null,
    width_front: 9.5,
    width_rear: 10.5,
    et_front: 22,
    et_rear: 15,
    tyre_front: '265/35 R18',
    tyre_rear: '275/35 R18',
    spacers_front: null,
    spacers_rear: null,
  },
  suspension: { type: 'coilover', type_label: 'Gewindefahrwerk', brand: 'HKS', model: 'Hipermax', lowering_front: 35, lowering_rear: 30 },
};

describe('DISC-04 model collection', () => {
  it('shows the builds of a generation chosen by its chip', async () => {
    setParams({ model: 'nissan--skyline-gt-r' });
    const { calls } = stubFetch({
      '/discover/models/nissan--skyline-gt-r': { body: { data: MODEL_PAGE } },
      '/discover/models/nissan--skyline-gt-r/builds': { body: page([R34]) },
    });
    await renderWithProviders(<ModelScreen />);
    expect(await screen.findByTestId(`DISC-04.vehicle.${R34.id}`)).toBeTruthy();
    expect(screen.getByTestId('DISC-04.title')).toHaveTextContent(/^Skyline GT-\u2060?R$/);
    expect(screen.getByTestId('DISC-04.generation.r34')).toHaveTextContent(/^R34 · 1999–2002/);
    expect(callsTo(calls, '/wheel-setups')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('DISC-04.generation.r34'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ generation: 'r34' });
  });

  it('compares the wheel set-ups on a phone as one card per build, in §3.9’s notation, square sets merged', async () => {
    setParams({ model: 'nissan--skyline-gt-r', segment: 'wheels' });
    stubFetch({
      '/discover/models/nissan--skyline-gt-r': { body: { data: MODEL_PAGE } },
      '/discover/models/nissan--skyline-gt-r/wheel-setups': { body: page([SETUP]) },
    });
    await renderWithProviders(<ModelScreen />);
    expect(await screen.findByTestId(`DISC-04.wheels.${R34.id}.size`)).toHaveTextContent(/^18″ × 9,5J vorne · 18″ × 10,5J hinten$/);
    expect(screen.getByTestId(`DISC-04.wheels.${R34.id}.et`)).toHaveTextContent(/^ET22 vorne · ET15 hinten$/);
    expect(screen.getByTestId(`DISC-04.wheels.${R34.id}.tyres`)).toHaveTextContent(/^265\/⁠?35\sR18 vorne · 275\/⁠?35\sR18 hinten$/);
    expect(screen.getByTestId(`DISC-04.wheels.${R34.id}.lowering`)).toHaveTextContent(/^−35\s\/\s−30\smm$/);
    expect(screen.getByTestId(`DISC-04.wheels.${R34.id}.suspension`)).toHaveTextContent('HKS Hipermax');
    await fireEvent.press(screen.getByTestId(`DISC-04.wheels.${R34.id}.open`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${R34.slug}`);
    await fireEvent.press(screen.getByTestId('DISC-04.segment.builds'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ segment: undefined });
  });

  it('drops a generation the model does not have, and asks for all builds instead of a 422', async () => {
    setParams({ model: 'nissan--skyline-gt-r', generation: 'R35' });
    const { calls } = stubFetch({
      '/discover/models/nissan--skyline-gt-r': { body: { data: MODEL_PAGE } },
      '/discover/models/nissan--skyline-gt-r/builds': { body: page([R34]) },
    });
    await renderWithProviders(<ModelScreen />);
    expect(await screen.findByTestId(`DISC-04.vehicle.${R34.id}`)).toBeTruthy();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ generation: undefined });
    expect(callsTo(calls, '/builds').every((request) => !searchOf(request).includes('generation'))).toBe(true);
  });

  it('says so for a model nobody can see', async () => {
    setParams({ model: 'bmw--z1' });
    stubFetch({});
    await renderWithProviders(<ModelScreen />);
    expect(await screen.findByTestId('DISC-04.notFound')).toHaveTextContent(/Modell nicht gefunden/);
  });
});

describe('VEH-02 "Ähnliche suchen"', () => {
  it('searches by wheel brand and diameter of a wheel set', () => {
    const state = similarSearchState({
      brand: 'BBS',
      search: { mod_category: 'wheels_tires', wheel_brand: 'bbs', wheel_diameter: 19.5, suspension_type: null, suspension_brand: null, exhaust_brand: null },
    });
    expect(similarSearchHref(state)).toEqual({ pathname: '/discover/search', params: { wheel_diameter: '19.5', wheel_brand: 'bbs' } });
  });

  it('searches a part without a brand facet by its category and the typed brand', () => {
    const state = similarSearchState({
      brand: 'Recaro',
      search: { mod_category: 'interior', wheel_brand: null, wheel_diameter: null, suspension_type: null, suspension_brand: null, exhaust_brand: null },
    });
    expect(similarSearchHref(state)).toEqual({ pathname: '/discover/search', params: { q: 'Recaro', mod_category: 'interior' } });
  });
});
