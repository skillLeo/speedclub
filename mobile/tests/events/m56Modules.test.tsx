import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { MemberSettings } from '@/api/queries/auth';
import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { EventCard } from '@/api/queries/events';
import { NextEventsModule } from '@/features/home/components/NextEventsModule';
import { NotificationSettingsScreen } from '@/features/settings/screens/NotificationSettingsScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, stubFetch } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/settings/notifications',
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const START = new Date(Date.now() + 2 * 24 * 3600 * 1000);

function card(id: string, extra: Partial<EventCard> = {}): EventCard {
  return {
    id,
    slug: `${id}-x1`,
    title: id === 'a' ? 'Cars & Coffee am Hafen' : 'Herbstausfahrt Harz',
    type: 'meet',
    status: 'published',
    visibility: 'public',
    starts_at: START.toISOString(),
    ends_at: new Date(START.getTime() + 3 * 3600 * 1000).toISOString(),
    timezone: 'Europe/Berlin',
    location: { visibility: 'public', exact: false, venue_name: null, street: null, postcode: null, city: 'Hamburg', country: 'DE', lat: null, lng: null, area: { lat: 53.55, lng: 10 } },
    cover: null,
    organiser: { username: 'lukas.sc', display_name: 'Lukas', city: null, avatar: null, is_sample: false, is_editorial: false, main_vehicle_cover: null, verified: false },
    counts: { going: 8, interested: 3 },
    capacity: null,
    spots_left: null,
    distance_km: null,
    attendee_preview: [],
    my_rsvp: null,
    is_sample: false,
    ...extra,
  } as EventCard;
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  useSessionStore.setState({ status: 'member', member: { id: 'me', username: 'max.e46', displayName: 'Max', avatarUrl: null } });
});

describe('M5.6 HOME-01 "Nächste Treffen"', () => {
  it('shows the cards with their real counts and leads to /events', async () => {
    await renderScreen(<NextEventsModule events={[card('a'), card('b', { counts: null, is_sample: true })]} width={350} routeId="HOME-01" />);
    expect(screen.getByTestId('HOME-01.events.header')).toHaveTextContent('Nächste Treffen', { exact: false });
    expect(screen.getByTestId('HOME-01.events.event.a.counts')).toHaveTextContent('8 Zusagen · 3 interessiert');
    // A sample shows no number (09 §8.19).
    expect(screen.queryByTestId('HOME-01.events.event.b.counts')).toBeNull();
    await fireEvent.press(screen.getByText('Alle Treffen'));
    expect(mockRouter.push).toHaveBeenCalledWith('/events');
  });

  it('renders nothing without a coming meet', async () => {
    await renderScreen(<NextEventsModule events={[]} width={350} routeId="HOME-01" />);
    expect(screen.queryByTestId('HOME-01.events')).toBeNull();
  });
});

const TYPES = {
  new_follower: { push: true, web_push: false },
  followed_published: { push: false, web_push: false },
  build_saved: { push: false, web_push: false },
  new_message: { push: true, email_digest: false, web_push: false },
  message_request: { push: true, web_push: false },
  hu_au_reminder: { push: true, email: false, web_push: false },
  qr_milestone: { push: false, web_push: false },
  reaction: { push: true, web_push: false },
  mention: { push: true, web_push: false },
  comment: { push: true, web_push: false },
  vehicle_follower: { push: true, web_push: false },
  event_reminder: { push: true, email: false, web_push: false },
  event_update: { push: true, web_push: false },
  event_nearby: { push: false, email: false, web_push: false },
};

function settings(types: Record<string, unknown> = {}, region: MemberSettings['home_region'] = null): MemberSettings {
  return {
    theme: 'carbon',
    locale: 'de',
    effective_locale: 'de',
    home_region: region,
    power_display: 'ps_kw',
    distance_unit: 'km',
    torque_unit: 'nm',
    weight_unit: 'kg',
    maintenance: { hu_au_lead_days: [30, 14, 1], tyre_reminders: true, insurance_reminder: true, service_reminders: true },
    show_owner_on_qr: true,
    who_can_message: 'everyone',
    mention_privacy: 'everyone',
    discoverable: true,
    indexable: true,
    read_receipts: true,
    ai_suggestions: false,
    notification_prefs: { types: { ...TYPES, ...types }, quiet_hours: { enabled: true, from: '22:00', to: '07:00' }, message_previews: false, digest_frequency: 'weekly' },
  } as unknown as MemberSettings;
}

function withEvents() {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { events: true } }, confirmed: true });
  return client;
}

describe('M5.6 SET-09 "Neue Treffen in deiner Nähe"', () => {
  it('follows the Treffen rows, off by default (the generated settings always list it)', async () => {
    stubFetch({ '/me/settings': { body: { data: settings() } } });
    await renderScreen(<NotificationSettingsScreen />, withEvents());
    expect(await screen.findByTestId('SET-09.push.event_reminder')).toBeTruthy();
    expect(screen.getByTestId('SET-09.push.event_nearby.switch')).not.toBeChecked();
  });

  it('is opt-in (off), switches its push and e-mail, and asks for a region when there is none', async () => {
    const { calls } = stubFetch({ '/me/settings': { body: { data: settings({ event_nearby: { push: false, email: false, web_push: false } }) } } });
    await renderScreen(<NotificationSettingsScreen />, withEvents());
    const push = await screen.findByTestId('SET-09.push.event_nearby.switch');
    expect(push).not.toBeChecked();
    expect(screen.getByTestId('SET-09.email.event_nearby.switch')).not.toBeChecked();
    expect(screen.getByText('Leg in Sprache & Einheiten deine Region fest, damit wir wissen, was in deiner Nähe ist.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('SET-09.nearbyRegion'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/language');
    await fireEvent.press(push);
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(await calls.find((call) => call.method === 'PATCH')?.clone().json()).toEqual({ notification_prefs: { types: { event_nearby: { push: true } } } });
  });

  it('says when it comes once a region is set', async () => {
    stubFetch({ '/me/settings': { body: { data: settings({ event_nearby: { push: true, email: false, web_push: false } }, { label: 'Hamburg', lat: 53.55, lng: 10 }) } } });
    await renderScreen(<NotificationSettingsScreen />, withEvents());
    expect(await screen.findByText('Einmal pro Woche am Donnerstag, nur wenn in deiner Region neue Treffen dazugekommen sind.')).toBeTruthy();
    expect(screen.queryByTestId('SET-09.nearbyRegion')).toBeNull();
  });
});
