import NetInfo from '@react-native-community/netinfo';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions, Platform, ScrollView, Share, StyleSheet, type TextStyle } from 'react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { Me } from '@/api/queries/auth';
import type { VehicleCardData } from '@/api/queries/profile';
import { queryClient } from '@/api/queryClient';
import { EditProfileScreen } from '@/features/profile/screens/EditProfileScreen';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen as renderWith, stubFetch, type Answer } from '../settings/harness';
import { measureOf } from '../ui/helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
const mockPreventRemove = jest.fn();
/** PROF-03 leaves by popping when PROF-01 is under it in its stack (`index` > 0), else by replacing itself (CARRY-M4.8/9). */
const mockNavigation = {
  dispatch: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  getParent: () => undefined,
  canGoBack: () => true,
  goBack: jest.fn(),
  getState: jest.fn(() => ({ index: 1 })),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/profile',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  usePreventRemove: (prevent: boolean) => mockPreventRemove(prevent),
  // DiscardGuardDialog continues a blocked action through the screen's navigation.
  useNavigation: () => mockNavigation,
  Link: ({ children }: { children: unknown }) => children,
}));
// Items render in place: list virtualisation is FlashList's own business and needs a layout Jest does not have.
jest.mock('@shopify/flash-list', () => ({
  FlashList: ({ data, renderItem }: { data: readonly unknown[]; renderItem: (info: { item: unknown; index: number }) => ReactNode }) =>
    data.map((item, index) => renderItem({ item, index })),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ME: Me = {
  id: '01m6f7ztzfs0gd39t08rs9zmmp',
  email: 'lukas.sc@speedclub.test',
  email_verified: true,
  is_sample: false,
  is_editorial: false,
  has_username: true,
  profile_complete: true,
  next_step: null,
  force_password_change: false,
  password_set: true,
  two_factor_enabled: false,
  username: 'lukas.sc',
  username_change_available_at: null,
  display_name: 'Lukas Scholz',
  city: 'Stuttgart',
  bio: 'KFZ-Mechatroniker aus Stuttgart.',
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'ps_kw',
  member_since: '2023-03-12T10:00:00+00:00',
  stats: { vehicles: 2, followers: 5, following: 3 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
};

const CARD = {
  id: 'v1',
  public_id: '5TF974VJ',
  slug: 'nissan-skyline-gt-r-r34-5tf974vj',
  status: 'published',
  visibility: 'public',
  is_main: true,
  is_sample: false,
  eyebrow: 'NISSAN',
  make: 'Nissan',
  model: 'Skyline GT-R',
  generation: 'R34',
  title: 'Skyline GT-R R34',
  full_title: 'Nissan Skyline GT-R R34',
  nickname: null,
  color: null,
  model_year: 2002,
  subline_parts: ['2002', '2,6 l R6 Biturbo (RB26DETT)'],
  spec_strip: [{ key: 'power', value: '500', unit: 'PS', label: 'PS' }],
  cover: null,
  photo_count: 3,
  mod_count: 14,
  updates_count: null,
  published_at: null,
  updated_at: null,
  wizard: null,
  completeness: null,
  qr: null,
} satisfies VehicleCardData;

const NBSP = '\u00A0';

function signIn() {
  useSessionStore.setState({ status: 'member', member: { id: ME.id, username: 'lukas.sc', displayName: 'Lukas Scholz', avatarUrl: null } });
}

/** Tells every NetInfo listener of the rendered screen about the connection. */
async function connection(isConnected: boolean) {
  const calls = (NetInfo.addEventListener as unknown as jest.Mock).mock.calls as [(state: { isConnected: boolean }) => void][];
  await act(async () => calls.forEach(([listener]) => listener({ isConnected })));
}

function api(overrides: Record<string, Answer | (() => Answer)> = {}) {
  return stubFetch({ '/auth/me': { body: { data: ME } }, '/me/vehicles': { body: { data: [CARD, { ...CARD, id: 'draft', status: 'draft' }] } }, ...overrides });
}

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) => renderWith(element, client);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});
// The username check keeps its answer a minute, and a saved profile goes through adoptMe into the app's own client with its
// 24-hour collection timer: either timer would keep Jest from exiting once the file has run.
afterEach(() => {
  client.clear();
  queryClient.clear();
});

describe('PROF-01 My profile', () => {
  it('shows the member from auth/me with inline stats that wrap as wholes', async () => {
    signIn();
    api();
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.name')).toHaveTextContent('Lukas Scholz'));
    expect(screen.getByTestId('screen.profile')).toBeTruthy();
    expect(screen.getByTestId('PROF-01.username')).toHaveTextContent('@lukas.sc');
    expect(screen.getByTestId('PROF-01.meta')).toHaveTextContent('Stuttgart · Mitglied seit März 2023');
    expect(screen.getByTestId('PROF-01.stats')).toHaveTextContent(
      `2${NBSP}Fahrzeuge${NBSP}· 5${NBSP}Follower${NBSP}· 3${NBSP}Folge${NBSP}ich`,
      { normalizer: (text: string) => text },
    );
    expect(screen.getByTestId('PROF-01.bio')).toHaveTextContent('KFZ-Mechatroniker aus Stuttgart.');
  });

  it('lists the published vehicles and opens one', async () => {
    signIn();
    api();
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.vehicle.v1')).toBeTruthy());
    expect(screen.queryByTestId('PROF-01.vehicle.draft')).toBeNull();
    await fireEvent.press(screen.getByTestId('PROF-01.vehicle.v1.body'));
    expect(mockRouter.push).toHaveBeenCalledWith('/v/nissan-skyline-gt-r-r34-5tf974vj');
    // 09 §7.7: the Garage tab lists the cards one under the other, with "Fahrzeug hinzufügen" after them.
    expect(screen.getByTestId('PROF-01.tabs.garage')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('PROF-01.addVehicle'));
    expect(mockRouter.push).toHaveBeenCalledWith('/add-vehicle/new/vehicle');
  });

  it('invites to add the first car when the garage is empty', async () => {
    signIn();
    api({ '/me/vehicles': { body: { data: [] } } });
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.garage.empty')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('PROF-01.garage.empty.action'));
    expect(mockRouter.push).toHaveBeenCalledWith('/add-vehicle/new/vehicle');
  });

  it('opens edit, QR codes and settings', async () => {
    signIn();
    api();
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.edit')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('PROF-01.edit'));
    await fireEvent.press(screen.getByTestId('PROF-01.qrCodes'));
    // Header pattern (b): the gear floats in the bar over the cover.
    await fireEvent.press(screen.getByTestId('PROF-01.settings'));
    expect(mockRouter.push.mock.calls).toEqual([['/profile/edit'], ['/profile/qr'], ['/settings']]);
  });

  it('shares the public /u link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    signIn();
    api();
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.share')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('PROF-01.share')));
    expect(share).toHaveBeenCalledWith({ message: 'Lukas Scholz auf SPEED CLUB', url: 'https://speedclub.test/u/lukas.sc' });
    share.mockRestore();
  });

  it('says when a restriction keeps the profile as it is', async () => {
    signIn();
    api({
      '/auth/me': {
        body: { data: { ...ME, restrictions: { ...ME.restrictions, publishing: { restricted: true, until: '2027-01-01T00:30:00+01:00' } } } },
      },
    });
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.restricted')).toHaveTextContent('Dein Konto ist bis zum 01.01.2027, 00:30 Uhr eingeschränkt.', { exact: false }));
    // The edit screen only shows the profile then, and the button says so (DQ-124).
    expect(screen.getByTestId('PROF-01.edit')).toHaveTextContent('Profil ansehen');
  });

  it('says offline what the profile shows, and promises nothing to send (DQ-125)', async () => {
    signIn();
    api();
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.name')).toBeTruthy());
    await connection(false);
    expect(screen.getByTestId('shell.offline')).toHaveTextContent('Offline – du siehst dein Profil, wie es zuletzt geladen wurde.');
    await connection(true);
  });

  it('tells a guest offline that signing in needs a connection (DQ-125)', async () => {
    api();
    await renderScreen(<ProfileScreen />);
    await connection(false);
    expect(screen.getByTestId('shell.offline')).toHaveTextContent('Offline – zum Anmelden brauchst du eine Verbindung.');
    await connection(true);
  });

  it('shows the builds’ updates on the Updates tab and opens one', async () => {
    signIn();
    const update = {
      id: 'u1', type: 'suspension', type_label: 'Fahrwerk geändert', note: null, summary: 'Serie → KW V3', changes: [], changes_count: 1, hidden: false,
      created_at: '2026-11-10T10:00:00Z', month_label: null, vehicle_id: 'v1', mileage_km: null, happened_on: null, audience: 'vehicle', edited_at: null,
      photos: [], photo_pairs: [], modifications: [],
    };
    api({ '/public/vehicles/nissan-skyline-gt-r-r34-5tf974vj/updates': { body: { data: [update], links: {}, meta: { next_cursor: null } } } });
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.tabs.updates')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('PROF-01.tabs.updates'));
    await waitFor(() => expect(screen.getByTestId('PROF-01.update.u1')).toBeTruthy());
    expect(screen.getByTestId('PROF-01.update.u1')).toHaveTextContent('Fahrwerk geändert', { exact: false });
    await fireEvent.press(screen.getByTestId('PROF-01.update.u1'));
    expect(mockRouter.push).toHaveBeenCalledWith('/v/nissan-skyline-gt-r-r34-5tf974vj/updates/u1');
  });

  it('shows the events said yes to on the Treffen tab, with the flag', async () => {
    signIn();
    client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { events: true } }, confirmed: true });
    const event = {
      id: 'e1', slug: 'cars-coffee', title: 'Cars & Coffee Riem', type: 'meet', status: 'published', visibility: 'public',
      starts_at: '2026-06-14T17:30:00Z', ends_at: null, timezone: 'Europe/Berlin',
      location: { visibility: 'public', exact: true, venue_name: 'Messe', street: null, postcode: null, city: 'München', country: 'DE', lat: null, lng: null, area: { lat: null, lng: null } },
      cover: null, organiser: { username: 'max.e46', display_name: null, city: null, avatar: null, is_sample: false, is_editorial: false },
      counts: { going: 12, interested: 0 }, capacity: null, spots_left: null, distance_km: null, my_rsvp: 'going', is_sample: false,
    };
    api({ '/me/events': { body: { data: [event], links: {}, meta: { next_cursor: null } } } });
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.tabs.events')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('PROF-01.tabs.events'));
    await waitFor(() => expect(screen.getByTestId('PROF-01.event.e1')).toHaveTextContent('Cars & Coffee Riem', { exact: false }));
    // M4.12: the EVT-05 card, with the time in the event's zone and the real answers; it opens EVT-02.
    expect(screen.getByTestId('PROF-01.event.e1.caption')).toHaveTextContent('München · ab 19:30 Uhr');
    expect(screen.getByTestId('PROF-01.event.e1.counts')).toHaveTextContent('12 Zusagen');
  });

  it('has no Treffen tab without the events flag', async () => {
    signIn();
    api();
    await renderScreen(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-01.tabs.garage')).toBeTruthy());
    expect(screen.queryByTestId('PROF-01.tabs.events')).toBeNull();
  });

  it('offers a guest the sign-in, back to the profile, and no fake data', async () => {
    const { fetchMock } = api();
    await renderScreen(<ProfileScreen />);
    expect(screen.getByTestId('PROF-01.guest')).toBeTruthy();
    expect(screen.queryByTestId('PROF-01.name')).toBeNull();
    // Nothing of a member is asked for (app-config, which every screen reads for the logo, is not member data).
    const paths = (fetchMock.mock.calls as [RequestInfo][]).map(([input]) => new URL(typeof input === 'string' ? input : input.url).pathname);
    expect(paths.filter((path) => path.includes('/me') || path.includes('/auth/'))).toEqual([]);
    // 09 §7.7 guest: the brand title, three real fragments badged "Beispiel", one filled action.
    expect(screen.getByTestId('PROF-01.guest.title')).toHaveTextContent('Werde Teil des SPEED CLUB.');
    expect(screen.getByTestId('PROF-01.guest.card', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('PROF-01.guest.spec', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('PROF-01.guest.qr', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('PROF-01.signIn'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/auth/email', params: { returnTo: '/profile' } });
    await fireEvent.press(screen.getByTestId('PROF-01.signUp'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-up', params: { returnTo: '/profile' } });
  });
});

async function bodyOf(calls: Request[], method: string, path: string): Promise<unknown> {
  const request = calls.find((call) => call.method === method && new URL(call.url).pathname.endsWith(path));
  return request ? request.clone().json() : undefined;
}

describe('PROF-03 Edit profile', () => {
  it('saves only what changed and goes back with a toast', async () => {
    signIn();
    const { calls } = api({ '/me/profile': { body: { data: { ...ME, city: 'Berlin' } } } });
    await renderScreen(<EditProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-03.city')).toBeTruthy());
    expect(screen.getByTestId('PROF-03.cta.primary')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('PROF-03.city'), 'Berlin');
    expect(mockPreventRemove).toHaveBeenLastCalledWith(true);
    await act(async () => fireEvent.press(screen.getByTestId('PROF-03.cta.primary')));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await bodyOf(calls, 'PATCH', '/me/profile')).toEqual({ city: 'Berlin' });
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
  });

  it('replaces itself with PROF-01 when it is the first route of its stack, so the guard sees the leave (CARRY-M4.8/9)', async () => {
    mockNavigation.getState.mockReturnValueOnce({ index: 0 });
    signIn();
    api();
    await renderScreen(<EditProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-03.city')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('PROF-03.city'), 'Berlin');
    expect(mockPreventRemove).toHaveBeenLastCalledWith(true);
    await fireEvent.press(screen.getByTestId('PROF-03.header.back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/profile');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('counts the characters of the bio', async () => {
    signIn();
    api();
    await renderScreen(<EditProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-03.bio.helper')).toHaveTextContent('32 von 500 Zeichen'));
  });

  it('N12 (Build 12): at 360×640 dp × 2.0 on Android the bio caps at whole drawn lines, 7 × 36 instead of 5 × 24', async () => {
    const os = Platform.OS;
    Platform.OS = 'android';
    const window = jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 360, height: 640, scale: 2, fontScale: 2 });
    try {
      signIn();
      api();
      await renderScreen(<EditProfileScreen />);
      await waitFor(() => expect(screen.getByTestId('PROF-03.bio')).toBeTruthy());
      // Android 14+ draws the 24 of `input` at 36 at font scale 2.0 (non-linear sp); the field measures it.
      await fireEvent(measureOf('PROF-03.bio', 'line'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 36 } },
      });
      const cap = (StyleSheet.flatten(screen.getByTestId('PROF-03.bio').props.style as TextStyle) ?? {}).maxHeight as number;
      expect(cap).toBe(7 * 36);
      expect(cap % 36).toBe(0);
      expect(cap).toBeGreaterThanOrEqual(5 * 24);
      expect(cap).toBeLessThanOrEqual(640 * 0.4);
    } finally {
      window.mockRestore();
      Platform.OS = os;
    }
  });

  it('changes the username on its own route when it is free', async () => {
    signIn();
    const { calls } = api({
      '/usernames/check': { body: { data: { username: 'lukas.r34', available: true, reason: null } } },
      '/me/username': { body: { data: { ...ME, username: 'lukas.r34' } } },
    });
    await renderScreen(<EditProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-03.username')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('PROF-03.username'), 'Lukas.R34');
    await waitFor(() => expect(screen.getByTestId('PROF-03.username.available')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('PROF-03.cta.primary')));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await bodyOf(calls, 'PUT', '/me/username')).toEqual({ username: 'lukas.r34' });
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('puts a 422 on the field it names and stays', async () => {
    signIn();
    api({
      '/me/profile': { status: 422, body: { message: 'Ungültig', code: 'validation_failed', errors: { bio: ['Der Text enthält ein unzulässiges Zeichen.'] } } },
    });
    await renderScreen(<EditProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-03.bio')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('PROF-03.bio'), 'Neu');
    await act(async () => fireEvent.press(screen.getByTestId('PROF-03.cta.primary')));
    await waitFor(() => expect(screen.getByTestId('PROF-03.bio.error')).toHaveTextContent('Der Text enthält ein unzulässiges Zeichen.'));
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('shows the server cooldown on the username', async () => {
    signIn();
    api({
      '/usernames/check': { body: { data: { username: 'lukas.r34', available: true, reason: null } } },
      '/me/username': {
        status: 409,
        body: { message: 'Du kannst deinen Benutzernamen ab dem 01.12.2026, 00:30 Uhr wieder ändern.', code: 'username_change_cooldown', errors: {}, until: '2026-12-01T00:30:00+01:00' },
      },
    });
    await renderScreen(<EditProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-03.username')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('PROF-03.username'), 'lukas.r34');
    await act(async () => fireEvent.press(screen.getByTestId('PROF-03.cta.primary')));
    await waitFor(() => expect(screen.getByTestId('PROF-03.username.error')).toHaveTextContent('ab dem 01.12.2026, 00:30 Uhr', { exact: false }));
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('locks the username during a known cooldown', async () => {
    signIn();
    api({ '/auth/me': { body: { data: { ...ME, username_change_available_at: '2099-01-01T12:00:00+01:00' } } } });
    await renderScreen(<EditProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-03.username.helper')).toHaveTextContent('ab dem 01.01.2099, 12:00 Uhr wieder ändern', { exact: false }));
    expect(screen.getByTestId('PROF-03.username').props.editable).toBe(false);
  });

  it('scrolls up to the held notice when the session ends under the form (DQ-249)', async () => {
    signIn();
    api();
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    try {
      await renderScreen(<EditProfileScreen />);
      await waitFor(() => expect(screen.getByTestId('PROF-03.city')).toBeTruthy());
      await fireEvent.changeText(screen.getByTestId('PROF-03.city'), 'Berlin');
      scrollTo.mockClear();
      await act(async () => useSessionStore.setState({ status: 'guest', member: null, expiredFrom: ME.id }));
      await waitFor(() => expect(screen.getByTestId('PROF-03.restricted')).toBeTruthy());
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
      expect(screen.getByTestId('PROF-03.city')).toHaveDisplayValue('Berlin');
    } finally {
      scrollTo.mockRestore();
      await act(async () => useSessionStore.setState({ expiredFrom: null }));
    }
  });

  it('a save the ended session refused shows only the held notice, not a retry notice (DQ-259)', async () => {
    signIn();
    // The session ends as the save reaches the server: SessionHost, not mounted here, would do the same on the 401.
    api({
      '/me/profile': () => {
        useSessionStore.setState({ status: 'guest', member: null, expiredFrom: ME.id });
        return { status: 401, body: { message: 'Nicht angemeldet.', code: 'unauthenticated', errors: {} } };
      },
    });
    try {
      await renderScreen(<EditProfileScreen />);
      await waitFor(() => expect(screen.getByTestId('PROF-03.city')).toBeTruthy());
      await fireEvent.changeText(screen.getByTestId('PROF-03.city'), 'Berlin');
      await act(async () => fireEvent.press(screen.getByTestId('PROF-03.cta.primary')));
      await waitFor(() => expect(screen.getByTestId('PROF-03.restricted')).toBeTruthy());
      expect(screen.queryByTestId('PROF-03.notice')).toBeNull();
      expect(screen.getByTestId('PROF-03.city')).toHaveDisplayValue('Berlin');
      expect(mockRouter.back).not.toHaveBeenCalled();
    } finally {
      await act(async () => useSessionStore.setState({ expiredFrom: null }));
    }
  });

  it('keeps a restricted member from editing', async () => {
    signIn();
    api({ '/auth/me': { body: { data: { ...ME, restrictions: { ...ME.restrictions, publishing: { restricted: true, until: null } } } } } });
    await renderScreen(<EditProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('PROF-03.restricted')).toBeTruthy());
    expect(screen.getByTestId('PROF-03.city').props.editable).toBe(false);
    expect(screen.getByTestId('PROF-03.cover.pick')).toBeDisabled();
  });
});
