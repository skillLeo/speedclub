import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { queryClient } from '@/api/queryClient';
import { resetMapConsent } from '@/features/events/map/mapConsent';
import { EventEditorScreen } from '@/features/events/screens/EventEditorScreen';
import { EventScreen } from '@/features/events/screens/EventScreen';
import { EventsScreen } from '@/features/events/screens/EventsScreen';
import { ManageEventScreen } from '@/features/events/screens/ManageEventScreen';
import { CheckinScreen } from '@/features/events/screens/CheckinScreen';
import { MyEventsScreen } from '@/features/events/screens/MyEventsScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { dismissToast, ToastHost } from '@/ui';

import { newQueryClient, renderScreen as renderWith, stubFetch, type Answer } from '../settings/harness';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  canGoBack: jest.fn(() => true),
};
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/events',
  // M5.2: EVT-01 asks whether it is Entdecken's segment page; here it is pushed in Start's stack (no discover/index), so it is not.
  useRoute: () => ({ key: 'events-1', name: 'events/index' }),
  useNavigation: () => ({
    getState: () => ({ routeNames: ['index', 'events/index'], routes: [{ key: 'home-1', name: 'index' }, { key: 'events-1', name: 'events/index' }] }),
    getParent: () => undefined,
    canGoBack: () => true,
    goBack: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
  }),
  usePreventRemove: jest.fn(),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } =
    jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), getScrollableNode: () => null }));
    const { data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent } =
      props;
    const items = data.map((item, index) =>
      createElement(
        Fragment,
        { key: keyExtractor ? keyExtractor(item) : index },
        renderItem({ item, index }),
      ),
    );
    return createElement(
      Fragment,
      null,
      ListHeaderComponent,
      data.length === 0 ? ListEmptyComponent : items,
      ListFooterComponent,
    );
  });
  return { FlashList };
});
jest.mock('react-native-webview', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { WebView: (props: { testID?: string }) => createElement(View, { testID: props.testID }) };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ORGANISER = {
  username: 'lukas.sc',
  display_name: 'Lukas Scholz',
  city: 'Hamburg',
  avatar: null,
  is_sample: false,
  is_editorial: false,
};
// M5.6: inside "Diese Woche" (the default view, the next seven Berlin days), so the list shows it without a filter.
const FUTURE_START = new Date(Date.now() + 2 * 24 * 3600 * 1000);
const LATER_START = new Date(Date.now() + 12 * 24 * 3600 * 1000);
const FUTURE_END = new Date(FUTURE_START.getTime() + 3 * 3600 * 1000);

const HIDDEN_PLACE = {
  visibility: 'after_rsvp',
  exact: false,
  venue_name: null,
  street: null,
  postcode: null,
  city: 'Hamburg',
  country: 'DE',
  lat: null,
  lng: null,
  area: { lat: 53.55, lng: 10 },
};
const EXACT_PLACE = {
  ...HIDDEN_PLACE,
  exact: true,
  venue_name: 'Parkplatz am Kai',
  street: 'Hafenstraße 1',
  postcode: '20457',
  lat: 53.5413,
  lng: 9.9845,
};

function card(extra: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    slug: 'nachttreffen-hafen-x1',
    title: 'Nachttreffen am Hafen',
    type: 'meet',
    status: 'published',
    visibility: 'public',
    starts_at: FUTURE_START.toISOString(),
    ends_at: FUTURE_END.toISOString(),
    timezone: 'Europe/Berlin',
    location: HIDDEN_PLACE,
    cover: null,
    organiser: ORGANISER,
    counts: { going: 38, interested: 12 },
    capacity: null,
    spots_left: null,
    distance_km: null,
    my_rsvp: null,
    is_sample: false,
    ...extra,
  };
}

function detail(extra: Record<string, unknown> = {}) {
  return {
    ...card(),
    description: 'Motor aus auf dem Platz, Gespräche über Builds.',
    organiser_rules: null,
    rules: ['legal_only', 'no_racing'],
    cancellation_reason: null,
    cancelled_at: null,
    cancelled_by_staff: false,
    waitlist_position: null,
    can: {
      rsvp: true,
      edit: false,
      cancel: false,
      post_update: false,
      view_updates: false,
      view_attendees: true,
      report: true,
    },
    review: null,
    calendar_url: 'https://speedclub.test/e/nachttreffen-hafen-x1.ics',
    share_url: 'https://speedclub.test/e/nachttreffen-hafen-x1',
    created_at: null,
    ...extra,
  };
}

const page = (data: unknown[]) => ({
  data,
  links: {},
  meta: { next_cursor: null, prev_cursor: null, per_page: 30, path: null },
});

function signIn(username = 'max.e46') {
  useSessionStore.setState({
    status: 'member',
    member: { id: 'me', username, displayName: 'Max', avatarUrl: null },
  });
}

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) =>
  renderWith(
    <>
      {element}
      <ToastHost />
    </>,
    client,
  );

function flags(on: Record<string, boolean> = { events: true, 'events.create': true }) {
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: on }, confirmed: true });
}

const callsTo = (calls: Request[], method: string, path: string) =>
  calls.filter((call) => call.method === method && new URL(call.url).pathname.endsWith(path));

beforeAll(async () => {
  await hydrateThemePreference();
});
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  mockParams = {};
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});
afterEach(() => {
  dismissToast();
  client.clear();
  queryClient.clear();
});

describe('EVT-01 Treffen', () => {
  it('lists the events under their day with the real counts', async () => {
    flags();
    stubFetch({
      '/events': {
        body: page([
          card(),
          card({
            id: 'e2',
            slug: 'ausfahrt-x2',
            title: 'Ausfahrt Schwarzwald',
            type: 'cruise',
            counts: { going: 1, interested: 0 },
          }),
        ]),
      },
    });
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e1')).toBeTruthy());
    expect(screen.getByTestId('EVT-01.event.e1.counts')).toHaveTextContent('38 Zusagen · 12 interessiert');
    expect(screen.getByTestId('EVT-01.event.e2.counts')).toHaveTextContent('1 Zusage');
    expect(screen.getByTestId('EVT-01.event.e1.caption')).toHaveTextContent('Hamburg', { exact: false });
    await fireEvent.press(screen.getByTestId('EVT-01.event.e1.open'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[slug]',
      params: { slug: 'nachttreffen-hafen-x1' },
    });
  });

  it('asks the filters it shows', async () => {
    flags();
    const { calls } = stubFetch({ '/events': { body: page([card()]) } });
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e1')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('EVT-01.filter.weekend')));
    // DQ-M52-04: the kinds sit behind one "Art" chip.
    expect(screen.queryByTestId('EVT-01.filter.type.meet')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('EVT-01.filter.type')));
    await act(async () => fireEvent.press(await screen.findByTestId('EVT-01.filter.type.track_day')));
    expect(screen.getByTestId('EVT-01.filter.type')).toHaveTextContent('Trackday');
    await waitFor(() =>
      expect(
        calls.some((call) => call.url.includes('when=weekend') && call.url.includes('type=track_day')),
      ).toBe(true),
    );
  });

  it('M5.2: searches title and city with its own field (q), once typing pauses', async () => {
    flags();
    const { calls } = stubFetch({ '/events': { body: page([card()]) } });
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e1')).toBeTruthy());
    await act(async () => fireEvent.changeText(screen.getByTestId('EVT-01.search'), '  Hocken   heim '));
    await waitFor(() => expect(calls.some((call) => call.url.includes('q=Hocken+heim') || call.url.includes('q=Hocken%20heim'))).toBe(true));
  });

  it('M5.2: pushed outside Entdecken it is the page "Treffen" with back and no segments', async () => {
    flags();
    stubFetch({ '/events': { body: page([card()]) } });
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e1')).toBeTruthy());
    expect(screen.getByTestId('EVT-01.header.back')).toBeTruthy();
    expect(screen.queryByTestId('EVT-01.segments')).toBeNull();
    expect(screen.queryByTestId('EVT-01.messages')).toBeNull();
  });

  it('DQ-M52-05/06: Liste · Karte is one toggle at the end of the search row, and the title stays in the map view', async () => {
    flags();
    stubFetch({ '/events': { body: page([card()]) } });
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e1')).toBeTruthy());
    expect(screen.queryByTestId('EVT-01.view')).toBeNull();
    const toMap = screen.getByTestId('EVT-01.view.map');
    expect(toMap).toHaveAccessibleName('Karte');
    await act(async () => fireEvent.press(toMap));
    const toList = await screen.findByTestId('EVT-01.view.list');
    expect(toList).toHaveAccessibleName('Liste');
    expect(screen.getByTestId('EVT-01.title')).toHaveTextContent('Treffen');
    expect(screen.getByTestId('EVT-01.search')).toBeTruthy();
  });

  it('invites with the badged sample event when there is nothing near', async () => {
    flags();
    stubFetch({ '/events': { body: page([]) } });
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.empty')).toBeTruthy());
    expect(screen.getByText('Gerade keine Treffen in deiner Nähe.')).toBeTruthy();
    expect(screen.getByTestId('EVT-01.empty.event.sample', { includeHiddenElements: true })).toBeTruthy();
    expect(
      screen.queryByTestId('EVT-01.empty.event.sample.counts', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('says the section is off when the flag is', async () => {
    flags({});
    const { fetchMock } = stubFetch({});
    await renderScreen(<EventsScreen />);
    expect(screen.getByTestId('EVT-01.unavailable')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String((request as Request).url ?? request).includes('/events'),
      ),
    ).toBe(false);
  });
});

describe('EVT-02 Treffen-Detail', () => {
  beforeEach(() => {
    mockParams = { slug: 'nachttreffen-hafen-x1' };
  });

  it('hides a private place until the member is going and offers no route', async () => {
    flags();
    signIn();
    stubFetch({
      '/events/nachttreffen-hafen-x1': { body: { data: detail() } },
      '/attendees': { body: page([]) },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('EVT-02.title')).toHaveTextContent('Nachttreffen am Hafen'),
    );
    expect(screen.getByTestId('EVT-02.place')).toHaveTextContent('Ort wird nach deiner Zusage angezeigt', {
      exact: false,
    });
    expect(screen.queryByTestId('EVT-02.route')).toBeNull();
    expect(screen.getByTestId('EVT-02.counts')).toHaveTextContent('38 Zusagen · 12 interessiert');
    expect(screen.getByTestId('EVT-02.rules.legal_only')).toBeTruthy();
  });

  it('loads the map only after "Karte anzeigen" (third-party tiles)', async () => {
    flags();
    resetMapConsent();
    stubFetch({ '/events/nachttreffen-hafen-x1': { body: { data: detail() } } });
    await renderScreen(<EventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-02.map.consent')).toBeTruthy());
    expect(screen.queryByTestId('EVT-02.map.webview')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('EVT-02.map.load')));
    await waitFor(() => expect(screen.getByTestId('EVT-02.map.webview')).toBeTruthy());
    resetMapConsent();
  });

  it('answers "Zusagen" at once and keeps the server state', async () => {
    flags();
    signIn();
    let going = false;
    const { calls } = stubFetch({
      '/events/nachttreffen-hafen-x1/rsvp': () => {
        going = true;
        return {
          body: {
            data: {
              event_id: 'e1',
              status: 'going',
              waitlist_position: null,
              counts: { going: 39, interested: 12 },
              spots_left: null,
            },
          },
        };
      },
      '/events/nachttreffen-hafen-x1': () => ({
        body: {
          data: going
            ? detail({ my_rsvp: 'going', location: EXACT_PLACE, counts: { going: 39, interested: 12 } })
            : detail(),
        },
      }),
      '/attendees': { body: page([]) },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-02.rsvp.going')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('EVT-02.rsvp.going')));
    await waitFor(() => expect(callsTo(calls, 'PUT', '/rsvp')).toHaveLength(1));
    expect(await callsTo(calls, 'PUT', '/rsvp')[0]?.clone().json()).toEqual({ status: 'going' });
    await waitFor(() => expect(screen.getByTestId('EVT-02.rsvp.state')).toHaveTextContent('Zugesagt'));
    await waitFor(() => expect(screen.getByTestId('EVT-02.route')).toBeTruthy());
    expect(screen.getByTestId('EVT-02.place')).toHaveTextContent('Hafenstraße 1', { exact: false });
    expect(screen.getByTestId('EVT-02.rsvp.calendar')).toBeTruthy();
  });

  it('tells the organiser a pending event is in review and offers to manage it', async () => {
    flags();
    signIn('lukas.sc');
    stubFetch({
      '/events/nachttreffen-hafen-x1': {
        body: {
          data: detail({
            status: 'pending_review',
            review: { submitted_at: null, reviewed_at: null, reason: null },
            can: {
              rsvp: false,
              edit: true,
              cancel: true,
              post_update: false,
              view_updates: true,
              view_attendees: false,
              report: false,
            },
          }),
        },
      },
      '/updates': { body: { data: [] } },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-02.review')).toBeTruthy());
    expect(screen.getByTestId('EVT-02.review.title')).toHaveTextContent('Wird geprüft');
    expect(screen.getByTestId('EVT-02.rsvp.manage')).toBeTruthy();
  });

  it('shows a cancelled event with its reason and no answer bar', async () => {
    flags();
    signIn();
    stubFetch({
      '/events/nachttreffen-hafen-x1': {
        body: {
          data: detail({
            status: 'cancelled',
            cancellation_reason: 'Der Platz ist gesperrt.',
            can: {
              rsvp: false,
              edit: false,
              cancel: false,
              post_update: false,
              view_updates: false,
              view_attendees: true,
              report: true,
            },
          }),
        },
      },
      '/attendees': { body: page([]) },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('EVT-02.review.reason')).toHaveTextContent('Der Platz ist gesperrt.', {
        exact: false,
      }),
    );
    expect(screen.queryByTestId('EVT-02.rsvp')).toBeNull();
  });

  it('says when an event is gone', async () => {
    flags();
    stubFetch({
      '/events/nachttreffen-hafen-x1': {
        status: 404,
        body: { message: 'Nicht gefunden', code: 'event_unavailable', errors: {} },
      },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-02.notFound')).toBeTruthy());
  });
});

describe('EVT-03 Treffen erstellen', () => {
  it('keeps a pending event frozen instead of showing the form (ADR-439)', async () => {
    flags();
    signIn('lukas.sc');
    mockParams = { id: 'nachttreffen-hafen-x1' };
    stubFetch({
      '/events/nachttreffen-hafen-x1': {
        body: {
          data: detail({
            status: 'pending_review',
            can: {
              rsvp: false,
              edit: true,
              cancel: true,
              post_update: false,
              view_updates: true,
              view_attendees: false,
              report: false,
            },
          }),
        },
      },
    });
    await renderScreen(<EventEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-03.frozen')).toBeTruthy());
    expect(screen.queryByTestId('EVT-03.title')).toBeNull();
  });

  it('checks each step before it moves on', async () => {
    flags();
    signIn();
    mockParams = { id: 'new' };
    stubFetch({ '/me/events': { body: page([]) } });
    await renderScreen(<EventEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-03.title')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('EVT-03.cta.primary')));
    await waitFor(() => expect(screen.getByText('Mindestens 3 Zeichen.')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('EVT-03.title'), 'Nachttreffen am Hafen');
    await act(async () => fireEvent.press(screen.getByTestId('EVT-03.cta.primary')));
    await waitFor(() => expect(screen.getByTestId('EVT-03.step')).toHaveTextContent('Schritt 2 von 5: Ort'));
  });

  it('asks a guest to sign in', async () => {
    flags();
    mockParams = { id: 'new' };
    stubFetch({});
    await renderScreen(<EventEditorScreen />);
    expect(screen.getByTestId('EVT-03.guest')).toBeTruthy();
  });
});

describe('EVT-05 Meine Treffen', () => {
  it('shows the organiser their events with the status pill', async () => {
    flags();
    signIn('lukas.sc');
    mockParams = { tab: 'organised' };
    const { calls } = stubFetch({
      '/me/events': { body: page([card({ status: 'pending_review', organiser: ORGANISER })]) },
    });
    await renderScreen(<MyEventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-05.event.e1.status')).toHaveTextContent('In Prüfung'));
    expect(calls.some((call) => call.url.includes('tab=organised'))).toBe(true);
  });
});

describe('EVT-06 Organisator-Tools', () => {
  beforeEach(() => {
    mockParams = { slug: 'nachttreffen-hafen-x1' };
  });

  it('cancels with a reason', async () => {
    flags();
    signIn('lukas.sc');
    const answers: Record<string, Answer | (() => Answer)> = {
      '/events/nachttreffen-hafen-x1/cancel': {
        body: { data: detail({ status: 'cancelled', cancellation_reason: 'Platz gesperrt' }) },
      },
      '/events/nachttreffen-hafen-x1/updates': { body: { data: [] } },
      '/events/nachttreffen-hafen-x1': {
        body: {
          data: detail({
            location: EXACT_PLACE,
            can: {
              rsvp: false,
              edit: true,
              cancel: true,
              post_update: true,
              view_updates: true,
              view_attendees: true,
              report: false,
            },
          }),
        },
      },
    };
    const { calls } = stubFetch(answers);
    await renderScreen(<ManageEventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-06.cancel')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('EVT-06.cancel')));
    await act(async () => fireEvent.press(screen.getByTestId('EVT-06.cancelDialog.confirm')));
    expect(screen.getByText('Bitte nenn einen Grund.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('EVT-06.cancelReason'), 'Platz gesperrt');
    await act(async () => fireEvent.press(screen.getByTestId('EVT-06.cancelDialog.confirm')));
    await waitFor(() => expect(callsTo(calls, 'POST', '/cancel')).toHaveLength(1));
    expect(await callsTo(calls, 'POST', '/cancel')[0]?.clone().json()).toEqual({ reason: 'Platz gesperrt' });
  });

  it('keeps others out', async () => {
    flags();
    signIn('max.e46');
    stubFetch({ '/events/nachttreffen-hafen-x1': { body: { data: detail() } } });
    await renderScreen(<ManageEventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-06.notOrganiser')).toBeTruthy());
  });
});

const later = (extra: Record<string, unknown> = {}) =>
  card({
    id: 'e9',
    slug: 'herbstausfahrt-x9',
    title: 'Herbstausfahrt Harz',
    starts_at: LATER_START.toISOString(),
    ends_at: new Date(LATER_START.getTime() + 3 * 3600 * 1000).toISOString(),
    ...extra,
  });

/** `GET events` answered by its `when`, as the server does: `week` only this week's meets, everything else every coming meet. */
function stubWeek(week: unknown[], upcoming: unknown[]) {
  const calls: Request[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    calls.push(request);
    const url = new URL(request.url);
    const body = url.pathname.endsWith('/events') ? page(url.searchParams.get('when') === 'week' ? week : upcoming) : { message: 'Nicht gefunden', code: 'not_found' };
    return new Response(JSON.stringify(body), { status: url.pathname.endsWith('/events') ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls };
}

describe('M5.6 EVT-01 "Diese Woche"', () => {
  it('opens on this week, one header per day, and offers every coming meet after it', async () => {
    flags();
    const { calls } = stubWeek([card()], [card(), later()]);
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e1')).toBeTruthy());
    // The server knows `week` (m5.6-contract §1); the first page of `upcoming` says whether meets follow.
    expect(calls.some((call) => call.url.includes('when=week'))).toBe(true);
    await waitFor(() => expect(screen.getByTestId('EVT-01.allUpcoming')).toBeTruthy());
    expect(screen.getByTestId('EVT-01.filter.week')).toBeChecked();
    expect(screen.queryByTestId('EVT-01.event.e9')).toBeNull();
    expect(screen.getAllByTestId(/^EVT-01\.day\.\d{4}-\d{2}-\d{2}$/)).toHaveLength(1);
    await act(async () => fireEvent.press(screen.getByTestId('EVT-01.allUpcoming')));
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e9')).toBeTruthy());
    expect(screen.getByTestId('EVT-01.filter.week')).not.toBeChecked();
    expect(screen.queryByTestId('EVT-01.allUpcoming')).toBeNull();
  });

  it('says the week is empty and leads to the later meets instead of the sample', async () => {
    flags();
    stubWeek([], [later()]);
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.weekEmpty')).toBeTruthy());
    expect(screen.getByText('Diese Woche steht noch kein Treffen an.')).toBeTruthy();
    expect(screen.queryByTestId('EVT-01.empty.event.sample', { includeHiddenElements: true })).toBeNull();
    await act(async () => fireEvent.press(screen.getByText('Alle kommenden Treffen')));
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e9')).toBeTruthy());
  });

  it('keeps one chip row: Diese Woche · Heute · Wochenende · Monat · Entfernung · Art', async () => {
    flags();
    stubFetch({ '/events': { body: page([card()]) } });
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e1')).toBeTruthy());
    const labels = ['week', 'today', 'weekend', 'month', 'near', 'type'].map((key) => screen.getByTestId(`EVT-01.filter.${key}`));
    expect(labels.map((chip) => chip.props['aria-label'] ?? chip.props.accessibilityLabel)).toEqual([
      'Diese Woche, die nächsten sieben Tage',
      'Heute',
      'Wochenende',
      'Diesen Monat',
      'Entfernung',
      'Art',
    ]);
  });

  it('opens a deep link with `when=upcoming` on every coming meet', async () => {
    flags();
    mockParams = { when: 'upcoming' };
    stubFetch({ '/events': { body: page([card(), later()]) } });
    await renderScreen(<EventsScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-01.event.e9')).toBeTruthy());
  });
});

const photo = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  media: {
    id: `m-${id}`,
    status: 'ready',
    category: 'other',
    width: 1080,
    height: 1080,
    blurhash: null,
    thumbhash: null,
    focal_x: null,
    focal_y: null,
    alt: null,
    sort: 0,
    variants: [{ width: 640, height: 640, url: `https://speedclub.test/media/${id}-640.webp` }],
    created_at: null,
  },
  source: 'attendee',
  status: 'approved',
  uploader: { username: 'nina.r34', display_name: null, city: null, avatar: null, is_sample: false, is_editorial: false },
  reject_reason: null,
  created_at: null,
  reviewed_at: null,
  is_sample: false,
  can: { delete: false, report: true, moderate: false },
  ...extra,
});

const PAST_START = new Date(Date.now() - 2 * 24 * 3600 * 1000);
const pastDetail = (extra: Record<string, unknown> = {}, can: Record<string, unknown> = {}) =>
  detail({
    starts_at: PAST_START.toISOString(),
    ends_at: new Date(PAST_START.getTime() + 3 * 3600 * 1000).toISOString(),
    gallery: {
      open: true,
      opens_at: PAST_START.toISOString(),
      closes_at: new Date(PAST_START.getTime() + 16 * 24 * 3600 * 1000).toISOString(),
      count: 2,
      pending: null,
      mine_pending: 1,
      preview: [photo('p1'), photo('p2')],
    },
    can: { ...detail().can, add_photos: true, ...can },
    ...extra,
  });

const nowCheckin = (mine: Record<string, unknown> | null = null) => ({
  checkin: {
    opens_at: new Date(Date.now() - 3600 * 1000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
    open: true,
    mine,
    count: null,
  },
});

describe('M5.6 EVT-02 gallery and check-in behind their flags', () => {
  beforeEach(() => {
    mockParams = { slug: 'nachttreffen-hafen-x1' };
  });

  it('shows neither while `events.gallery` and `events.checkin` are off, even when the server sends the fields', async () => {
    flags();
    signIn();
    stubFetch({
      '/events/nachttreffen-hafen-x1': { body: { data: pastDetail(nowCheckin(), { checkin: true }) } },
      '/attendees': { body: page([]) },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-02.title')).toBeTruthy());
    expect(screen.queryByTestId('EVT-02.gallery')).toBeNull();
    expect(screen.queryByTestId('EVT-02.checkin')).toBeNull();
    expect(screen.queryByTestId('EVT-02.checkin.done')).toBeNull();
  });

  it('shows the approved photos, the own pending ones and "Fotos hinzufügen" after the meet', async () => {
    flags({ events: true, 'events.gallery': true });
    signIn();
    stubFetch({
      '/events/nachttreffen-hafen-x1': { body: { data: pastDetail({ capacity: 40, spots_left: 32 }) } },
      '/attendees': { body: page([]) },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-02.gallery')).toBeTruthy());
    expect(screen.getByTestId('EVT-02.gallery.count')).toHaveTextContent('2 Fotos');
    expect(screen.getByTestId('EVT-02.gallery.minePending')).toHaveTextContent('1 Foto von dir wartet auf Freigabe.');
    expect(screen.getByTestId('EVT-02.gallery.add')).toBeTruthy();
    expect(screen.getByTestId('EVT-02.gallery.hint')).toHaveTextContent('sobald der Organisator sie freigibt', { exact: false });
    // DQ-P5-011: after the meet the answers are history, no free places, and the photos lead before the place card.
    expect(screen.getByTestId('EVT-02.counts')).toHaveTextContent('38 waren angemeldet');
    expect(screen.queryByTestId('EVT-02.capacity')).toBeNull();
    const order = screen.getAllByTestId(/^EVT-02\.(gallery|place)$/).map((node) => node.props.testID as string);
    expect(order).toEqual(['EVT-02.gallery', 'EVT-02.place']);
  });

  it('hides the section of a closed gallery without photos', async () => {
    flags({ events: true, 'events.gallery': true });
    signIn();
    stubFetch({
      '/events/nachttreffen-hafen-x1': {
        body: { data: pastDetail({ gallery: { open: false, opens_at: null, closes_at: null, count: 0, pending: null, mine_pending: 0, preview: [] } }, { add_photos: false }) },
      },
      '/attendees': { body: page([]) },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-02.title')).toBeTruthy());
    expect(screen.queryByTestId('EVT-02.gallery')).toBeNull();
  });

  it('checks in with the typed code, and a wrong code lands on the field', async () => {
    flags({ events: true, 'events.checkin': true });
    signIn();
    let tries = 0;
    const { calls } = stubFetch({
      '/events/nachttreffen-hafen-x1/checkin': () =>
        tries++ === 0
          ? { status: 422, body: { message: 'Der Code stimmt nicht.', code: 'checkin_code_invalid', errors: { code: ['Der Code stimmt nicht.'] } } }
          : { status: 201, body: { data: { checked_in_at: new Date().toISOString(), profile_visible: true, event: { id: 'e1', slug: 'nachttreffen-hafen-x1', title: 'Nachttreffen am Hafen' } } } },
      '/events/nachttreffen-hafen-x1': { body: { data: detail({ ...nowCheckin(), my_rsvp: 'going', can: { ...detail().can, checkin: true } }) } },
      '/attendees': { body: page([]) },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-02.checkin.open')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('EVT-02.checkin.open')));
    await act(async () => fireEvent.press(await screen.findByTestId('EVT-02.checkin.submit')));
    expect(await screen.findByText('Gib den Code ein, den der Organisator zeigt.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('EVT-02.checkin.code'), 'k7m 2qq');
    await act(async () => fireEvent.press(screen.getByTestId('EVT-02.checkin.submit')));
    expect(await screen.findByText('Der Code stimmt nicht oder ist abgelaufen. Frag nach dem aktuellen Code.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('EVT-02.checkin.code'), 'K7M2QP');
    await act(async () => fireEvent.press(screen.getByTestId('EVT-02.checkin.submit')));
    await waitFor(() => expect(callsTo(calls, 'POST', '/checkin')).toHaveLength(2));
    expect(await callsTo(calls, 'POST', '/checkin')[1]?.clone().json()).toEqual({ code: 'K7M2QP', profile_visible: true });
    expect(callsTo(calls, 'POST', '/checkin')[1]?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('says "War dabei" once checked in and lets the member hide it from the profile', async () => {
    flags({ events: true, 'events.checkin': true });
    signIn();
    const { calls } = stubFetch({
      '/events/nachttreffen-hafen-x1/checkin': { body: { data: { checked_in_at: new Date().toISOString(), profile_visible: false, event: { id: 'e1' } } } },
      '/events/nachttreffen-hafen-x1': {
        body: { data: detail({ ...nowCheckin({ checked_in_at: new Date().toISOString(), profile_visible: true }), my_rsvp: 'going' }) },
      },
      '/attendees': { body: page([]) },
    });
    await renderScreen(<EventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-02.checkin.wasThere')).toHaveTextContent('War dabei'));
    expect(screen.queryByTestId('EVT-02.checkin.open')).toBeNull();
    await act(async () => fireEvent(screen.getByTestId('EVT-02.checkin.visible.switch'), 'valueChange', false));
    await waitFor(() => expect(callsTo(calls, 'PATCH', '/checkin')).toHaveLength(1));
    expect(await callsTo(calls, 'PATCH', '/checkin')[0]?.clone().json()).toEqual({ profile_visible: false });
  });
});

describe('M5.6 EVT-06 check-in code and photo approval', () => {
  beforeEach(() => {
    mockParams = { slug: 'nachttreffen-hafen-x1' };
  });

  const organiserCan = { rsvp: false, edit: true, cancel: true, post_update: true, view_updates: true, view_attendees: true, report: false };

  it('shows the rotating code as a QR with the real number of check-ins', async () => {
    flags({ events: true, 'events.checkin': true });
    signIn('lukas.sc');
    stubFetch({
      '/events/nachttreffen-hafen-x1/checkin-code': {
        body: {
          data: {
            code: 'K7M2QP',
            url: 'https://speedclub.test/app/events/nachttreffen-hafen-x1/checkin?code=K7M2QP',
            svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
            expires_at: new Date(Date.now() + 300_000).toISOString(),
            refresh_at: new Date(Date.now() + 270_000).toISOString(),
            checked_in: 12,
          },
        },
      },
      '/events/nachttreffen-hafen-x1/updates': { body: { data: [] } },
      '/events/nachttreffen-hafen-x1': {
        body: { data: detail({ ...nowCheckin(), location: EXACT_PLACE, can: { ...organiserCan, show_checkin_code: true } }) },
      },
    });
    await renderScreen(<ManageEventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-06.checkinCode.row')).toBeTruthy());
    // DQ-P5-013: the helper runs full width under the row, not squeezed beside its value.
    expect(screen.getByTestId('EVT-06.checkinCode.helper')).toBeTruthy();
    expect(screen.getByTestId('EVT-06.checkinCode.row')).not.toHaveTextContent(/Treffpunkt/);
    await act(async () => fireEvent.press(screen.getByTestId('EVT-06.checkinCode.row')));
    await waitFor(() => expect(screen.getByTestId('EVT-06.checkinCode.count')).toHaveTextContent('12 eingecheckt'));
    expect(screen.getByText('K7M 2QP')).toBeTruthy();
  });

  it('approves an attendee’s photo and takes it out of the queue', async () => {
    flags({ events: true, 'events.gallery': true });
    signIn('lukas.sc');
    const { calls } = stubFetch({
      '/gallery/p1/approve': { body: { data: photo('p1') } },
      '/events/nachttreffen-hafen-x1/gallery': { body: page([photo('p1', { status: 'pending' })]) },
      '/events/nachttreffen-hafen-x1/updates': { body: { data: [] } },
      '/events/nachttreffen-hafen-x1': {
        body: {
          data: pastDetail(
            { gallery: { open: true, opens_at: null, closes_at: null, count: 0, pending: 1, mine_pending: 0, preview: [] }, location: EXACT_PLACE },
            { ...organiserCan, moderate_photos: true },
          ),
        },
      },
    });
    await renderScreen(<ManageEventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-06.galleryReview.photo.p1')).toBeTruthy());
    expect(calls.some((call) => call.url.includes('/gallery?') && call.url.includes('status=pending'))).toBe(true);
    await act(async () => fireEvent.press(screen.getByTestId('EVT-06.galleryReview.approve.p1')));
    await waitFor(() => expect(callsTo(calls, 'POST', '/gallery/p1/approve')).toHaveLength(1));
  });

  it('offers neither while the flags are off', async () => {
    flags();
    signIn('lukas.sc');
    stubFetch({
      '/events/nachttreffen-hafen-x1/updates': { body: { data: [] } },
      '/events/nachttreffen-hafen-x1': {
        body: { data: pastDetail({ ...nowCheckin(), location: EXACT_PLACE }, { ...organiserCan, moderate_photos: true, show_checkin_code: true }) },
      },
    });
    await renderScreen(<ManageEventScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-06.attendees')).toBeTruthy());
    expect(screen.queryByTestId('EVT-06.checkinCode.row')).toBeNull();
    expect(screen.queryByTestId('EVT-06.galleryReview')).toBeNull();
  });
});

describe('M5.6 EVT-07 Check-in from the QR link', () => {
  it('takes the code from the link, asks before it checks in, then says "Du bist eingecheckt"', async () => {
    flags({ events: true, 'events.checkin': true });
    signIn();
    mockParams = { slug: 'nachttreffen-hafen-x1', code: 'k7m2qp' };
    const { calls } = stubFetch({
      '/events/nachttreffen-hafen-x1/checkin': {
        status: 201,
        body: { data: { checked_in_at: new Date().toISOString(), profile_visible: true, event: { id: 'e1' } } },
      },
      '/events/nachttreffen-hafen-x1': { body: { data: detail(nowCheckin()) } },
    });
    await renderScreen(<CheckinScreen />);
    await waitFor(() => expect(screen.getByTestId('EVT-07.title')).toHaveTextContent('Bei Nachttreffen am Hafen einchecken?'));
    expect(screen.getByTestId('EVT-07.checkin.code')).toHaveDisplayValue('K7M 2QP');
    expect(callsTo(calls, 'POST', '/checkin')).toHaveLength(0);
    await act(async () => fireEvent.press(screen.getByTestId('EVT-07.cta.primary')));
    await waitFor(() => expect(screen.getByTestId('EVT-07.success.title')).toHaveTextContent('Du bist eingecheckt'));
    expect(await callsTo(calls, 'POST', '/checkin')[0]?.clone().json()).toEqual({ code: 'K7M2QP', profile_visible: true });
  });

  it('is not there while `events.checkin` is off', async () => {
    flags();
    signIn();
    mockParams = { slug: 'nachttreffen-hafen-x1', code: 'K7M2QP' };
    stubFetch({ '/events/nachttreffen-hafen-x1': { body: { data: detail() } } });
    await renderScreen(<CheckinScreen />);
    expect(screen.getByTestId('EVT-07.unavailable')).toBeTruthy();
  });
});
