import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { MemberSettings } from '@/api/queries/auth';
import { showMySpotsOf } from '@/api/queries/dex';
import { memberSettingsKey } from '@/api/queries/settings';
import { NotificationSettingsScreen } from '@/features/settings/screens/NotificationSettingsScreen';
import { PrivacyScreen } from '@/features/settings/screens/PrivacyScreen';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, signIn, stubFetch } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/settings/privacy',
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

function settings(extra: Record<string, unknown> = {}, types: Record<string, unknown> = {}): MemberSettings {
  return {
    theme: 'carbon',
    locale: 'de',
    effective_locale: 'de',
    home_region: null,
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
    ...extra,
  } as unknown as MemberSettings;
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
});

describe('SET-07 Meine Spots zeigen', () => {
  it('is on by default, explains "jemand" and saves with PATCH /me/settings', async () => {
    // The first answer is the GET (on), the next the PATCH's settings as stored (off).
    let answers = 0;
    const { calls } = stubFetch({ '/me/settings': () => ({ body: { data: { ...settings(), show_my_spots: answers++ === 0 } } }) });
    const client = newQueryClient();
    await renderScreen(<PrivacyScreen />, client);
    const row = await screen.findByTestId('SET-07.showMySpots.switch');
    expect(row).toBeChecked();
    expect(screen.getByText('Wenn du ein Auto spottest, sieht der Besitzer deinen Namen. Ist das aus, sehen Besitzer nur „jemand“.')).toBeTruthy();
    await fireEvent(row, 'valueChange', false);
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH' && new URL(call.url).pathname === '/api/v1/me/settings')).toBe(true));
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(await patch?.clone().json()).toEqual({ show_my_spots: false });
    expect(showMySpotsOf(client.getQueryData(memberSettingsKey))).toBe(false);
  });

  it('reads `show_my_spots` of the settings, on while they are not loaded', () => {
    expect(showMySpotsOf({ show_my_spots: false })).toBe(false);
    expect(showMySpotsOf({ show_my_spots: true })).toBe(true);
    expect(showMySpotsOf(undefined)).toBe(true);
  });
});

describe('SET-09 Spots', () => {
  it('offers the category once the server lists spot_alert, and switches its push', async () => {
    const { calls } = stubFetch({ '/me/settings': { body: { data: settings({}, { spot_alert: { push: true, web_push: false } }) } } });
    await renderScreen(<NotificationSettingsScreen />);
    expect(await screen.findByTestId('SET-09.spots')).toBeTruthy();
    expect(screen.getByText('Dein Auto wurde gespottet')).toBeTruthy();
    expect(screen.getByText('Höchstens einmal am Tag und gesammelt: wie oft und, wenn erlaubt, in welcher Stadt.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('SET-09.push.spot_alert.switch'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(await patch?.clone().json()).toEqual({ notification_prefs: { types: { spot_alert: { push: false } } } });
  });

  it('is not offered while the server does not know the type', async () => {
    stubFetch({ '/me/settings': { body: { data: settings() } } });
    await renderScreen(<NotificationSettingsScreen />);
    expect(await screen.findByTestId('SET-09.quiet')).toBeTruthy();
    expect(screen.queryByTestId('SET-09.spots')).toBeNull();
  });
});
