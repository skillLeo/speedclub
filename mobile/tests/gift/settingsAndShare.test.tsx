/** M5.9d SET-09 gift categories (contract §7) and the VEH-07 share card line (contract §6). */
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import type { MemberSettings } from '@/api/queries/auth';
import type { NotificationPrefs } from '@/api/queries/settings';
import { giftGroups, NotificationSettingsScreen } from '@/features/settings/screens/NotificationSettingsScreen';
import { shareCardContents } from '@/features/vehicle/screens/ShareCardScreen';
import i18n from '@/i18n';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, signIn, stubApi } from './helpers';

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

const BASE_TYPES = {
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
const GIFT_TYPES = {
  spot_alert: { push: true, web_push: false },
  badge_unlocked: { push: false, web_push: false },
  car_of_the_day: { push: false, web_push: false },
  car_of_the_day_owner: { push: true, web_push: false },
  invite_accepted: { push: true, web_push: false },
};

function settings(types: Record<string, unknown>): MemberSettings {
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
    notification_prefs: { types, quiet_hours: { enabled: true, from: '22:00', to: '07:00' }, message_previews: false, digest_frequency: 'weekly' },
  } as unknown as MemberSettings;
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
});

describe('SET-09 gift categories', () => {
  it('offers Spots, Abzeichen, Car of the Day and Einladungen for the types the server lists', () => {
    const prefs = settings({ ...BASE_TYPES, ...GIFT_TYPES }).notification_prefs as NotificationPrefs;
    expect(giftGroups(prefs, 'push', () => false)).toEqual([
      { key: 'spots', rows: [{ type: 'spot_alert', value: true }] },
      { key: 'badges', rows: [{ type: 'badge_unlocked', value: false }] },
      { key: 'carOfTheDay', rows: [{ type: 'car_of_the_day', value: false }, { type: 'car_of_the_day_owner', value: true }] },
      { key: 'invites', rows: [{ type: 'invite_accepted', value: true }] },
    ]);
    expect(giftGroups(settings(BASE_TYPES).notification_prefs as NotificationPrefs, 'push', () => false)).toEqual([]);
  });

  it('labels every row in German and English, and switches one push on its own', async () => {
    const { calls } = stubApi({ 'GET /me/settings': { body: { data: settings({ ...BASE_TYPES, ...GIFT_TYPES }) } }, 'PATCH /me/settings': { status: 204 } });
    await renderScreen(<NotificationSettingsScreen />);
    expect(await screen.findByTestId('SET-09.badges')).toBeTruthy();
    expect(screen.getByText('Abzeichen')).toBeTruthy();
    expect(screen.getByText('Neue Abzeichen')).toBeTruthy();
    expect(screen.getByText('Dein Auto ist Car of the Day')).toBeTruthy();
    expect(screen.getByText('Eingelöste Einladungen')).toBeTruthy();
    expect(screen.getByTestId('SET-09.socialLimit')).toHaveTextContent(
      'Von diesen Push-Mitteilungen bekommst du höchstens eine am Tag und keine zwischen 22\u00A0Uhr und 8\u00A0Uhr; deine eigenen Ruhezeiten gelten zusätzlich. Ist dein Auto Car of the Day, sagen wir es dir trotzdem – aber auch dann nie zwischen 22\u00A0Uhr und 8\u00A0Uhr. Alles andere findest du in der App.',
    );
    // DQ-P5G-32: the line is the footer of the parent of all four gift groups, not of the last one.
    expect(within(screen.getByTestId('SET-09.gifts')).getByTestId('SET-09.socialLimit')).toBeTruthy();
    expect(within(screen.getByTestId('SET-09.gifts')).getByTestId('SET-09.badges')).toBeTruthy();
    expect(screen.getByTestId('SET-09.gifts.title')).toHaveTextContent(
      // DQ-P5G-65: the name is bound with no-break spaces, so the heading never breaks inside it.
      'Spots, Abzeichen, Car\u00A0of\u00A0the\u00A0Day und Einladungen',
    );
    await fireEvent.press(screen.getByTestId('SET-09.push.car_of_the_day.switch'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ notification_prefs: { types: { car_of_the_day: { push: true } } } });
    for (const type of Object.keys(GIFT_TYPES)) {
      expect(i18n.exists(`settings:notifications.types.${type}`, { lng: 'en' })).toBe(true);
      expect(i18n.exists(`settings:notifications.types.${type}Helper`, { lng: 'en' })).toBe(true);
    }
  });
});

describe('VEH-07 share card line', () => {
  const t = i18n.getFixedT('de', 'vehicle');
  it('names the score with its stage, the Dex number and the QR code the server draws', () => {
    expect(shareCardContents(t, { total: 642, stage: 4 }, '0087', (value) => String(value))).toBe(
      'Auf der Karte: Build Score 642, Stufe 4 · Dex Nr. 0087 · QR-⁠Code',
    );
    expect(shareCardContents(t, null, null, String)).toBe('Auf der Karte: QR-⁠Code');
  });
});
