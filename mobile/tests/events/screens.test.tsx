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
  useNavigation: () => ({
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
const FUTURE_START = new Date(Date.now() + 10 * 24 * 3600 * 1000);
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
    await act(async () => fireEvent.press(screen.getByTestId('EVT-01.filter.type.track_day')));
    await waitFor(() =>
      expect(
        calls.some((call) => call.url.includes('when=weekend') && call.url.includes('type=track_day')),
      ).toBe(true),
    );
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
