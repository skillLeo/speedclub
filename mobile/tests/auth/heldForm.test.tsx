// BH-30: a session that ends under a form. The form stays mounted until the member chooses, its values come back only for the
// same member, and no request or restored value crosses to another account. Also BH-10's other half: an editor reads fresh on open.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { adoptMe, meKey, releaseExpiredSession, type Me } from '@/api/queries/auth';
import { garageKeys } from '@/api/queries/garage';
import { queryClient } from '@/api/queryClient';
import { expireSession } from '@/features/auth/sessionLifecycle';
import { EditBasicsScreen } from '@/features/garage/screens/EditBasicsScreen';
import { EditProfileScreen } from '@/features/profile/screens/EditProfileScreen';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { vehicle, VEHICLE_ID } from '../garage/fixtures';
import { list, renderScreen, stubFetch } from '../garage/harness';

let mockParams: Record<string, string> = {};
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/garage',
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  usePreventRemove: jest.fn(() => jest.fn()),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('@shopify/flash-list', () => ({
  FlashList: ({ data, renderItem }: { data: readonly unknown[]; renderItem: (info: { item: unknown; index: number }) => ReactNode }) =>
    data.map((item, index) => renderItem({ item, index })),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), selectionAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

jest.setTimeout(60_000);

const ME: Me = {
  id: '01nina',
  email: 'nina@speedclub.test',
  email_verified: true,
  has_username: true,
  profile_complete: true,
  next_step: null,
  force_password_change: false,
  two_factor_enabled: false,
  username: 'nina.neu',
  username_change_available_at: null,
  display_name: 'Nina',
  city: 'Bremen',
  bio: null,
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'ps_kw',
  member_since: '2023-03-12T10:00:00+00:00',
  stats: { vehicles: 0, followers: 0, following: 0 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
};
const OTHER: Me = { ...ME, id: '01paul', email: 'paul@speedclub.test', username: 'paul.roadster', display_name: 'Paul', city: 'Hamburg' };

function stubServer(me: Me = ME) {
  return stubFetch({
    '/api/v1/auth/me': { body: { data: me } },
    [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
    '/api/v1/catalog/makes': list([{ id: 34, name: 'Nissan', slug: 'nissan', country: 'JP', is_popular: true }]),
    '/api/v1/catalog/makes/34/models': list([{ id: 254, make_id: 34, name: 'Skyline GT-R', slug: 'skyline-gt-r' }]),
    '/generations': list([{ id: 120, name: 'R34', year_from: 1999, year_to: 2002 }]),
    '/api/v1/me/vehicles': list([]),
  });
}

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  queryClient.clear();
  useSessionStore.setState({ status: 'guest', member: null, notice: null, intent: null, expiredFrom: null, memberChanged: false });
  setMember({ id: ME.id, username: 'nina.neu', displayName: 'Nina', avatarUrl: null, nextStep: null });
});
afterEach(() => queryClient.clear());
afterAll(() => useSessionStore.setState({ status: 'loading', member: null, notice: null, expiredFrom: null, memberChanged: false }));

describe('PROF-03 when the session ends under it', () => {
  async function dirtyForm() {
    stubServer();
    queryClient.setQueryData(meKey, ME);
    await renderScreen(<EditProfileScreen />, queryClient);
    await waitFor(() => expect(screen.getByTestId('PROF-03.city')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('PROF-03.city'), 'Düsseldorf');
    expect(screen.getByTestId('PROF-03.cta.primary')).not.toBeDisabled();
  }

  it('keeps the form with the typed text behind the dialog, and the button off', async () => {
    await dirtyForm();
    await act(() => expireSession());
    await flush();
    expect(useSessionStore.getState()).toMatchObject({ status: 'guest', member: null, notice: { kind: 'expired' }, expiredFrom: ME.id });
    expect(screen.getByTestId('PROF-03.city').props.value).toBe('Düsseldorf');
    expect(screen.queryByTestId('PROF-03.guest')).toBeNull();
    expect(screen.getByTestId('PROF-03.cta.primary')).toBeDisabled();
    expect(screen.getByTestId('PROF-03.restricted')).toHaveTextContent('Melde dich neu an', { exact: false });
  });

  it('comes back to life for the same member, with the text', async () => {
    await dirtyForm();
    await act(() => expireSession());
    await act(async () => adoptMe(ME));
    await flush();
    expect(screen.getByTestId('PROF-03.city').props.value).toBe('Düsseldorf');
    expect(screen.getByTestId('PROF-03.cta.primary')).not.toBeDisabled();
    expect(screen.queryByTestId('PROF-03.restricted')).toBeNull();
    expect(useSessionStore.getState().memberChanged).toBe(false);
  });

  it('drops the text for another member, whose own values show', async () => {
    await dirtyForm();
    await act(() => expireSession());
    await act(async () => adoptMe(OTHER));
    await flush();
    expect(screen.getByTestId('PROF-03.city').props.value).toBe('Hamburg');
    expect(screen.queryByDisplayValue('Düsseldorf')).toBeNull();
    expect(useSessionStore.getState()).toMatchObject({ expiredFrom: null, memberChanged: true });
  });

  it('drops the text when the member goes on as a guest', async () => {
    await dirtyForm();
    await act(() => expireSession());
    await act(() => releaseExpiredSession());
    await flush();
    expect(screen.getByTestId('PROF-03.guest')).toBeTruthy();
    expect(screen.queryByDisplayValue('Düsseldorf')).toBeNull();
    expect(queryClient.getQueryData(meKey)).toBeUndefined();
    expect(useSessionStore.getState().expiredFrom).toBeNull();
  });

  it('opened as a guest it stays the invitation, whatever the store says', async () => {
    useSessionStore.setState({ status: 'guest', member: null, expiredFrom: ME.id });
    queryClient.setQueryData(meKey, ME);
    stubServer();
    await renderScreen(<EditProfileScreen />, queryClient);
    expect(screen.getByTestId('PROF-03.guest')).toBeTruthy();
    expect(screen.queryByTestId('PROF-03.city')).toBeNull();
  });
});

describe('GAR-05 when the session ends under it', () => {
  const DESCRIPTION = 'Winterprojekt: Getriebe neu gelagert.';

  async function dirtyForm() {
    mockParams = { id: VEHICLE_ID };
    const stub = stubServer();
    queryClient.setQueryData(meKey, ME);
    await renderScreen(<EditBasicsScreen />, queryClient);
    await waitFor(() => expect(screen.getByTestId('GAR-05.description')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-05.description'), DESCRIPTION);
    expect(screen.getByTestId('GAR-05.cta.primary')).not.toBeDisabled();
    return stub;
  }

  it('keeps the form and the text, turns the button off, and asks the server for nothing as a guest', async () => {
    const { calls } = await dirtyForm();
    const before = calls.length;
    await act(() => expireSession());
    await flush();
    expect(screen.getByTestId('GAR-05.description').props.value).toBe(DESCRIPTION);
    expect(screen.queryByTestId('GAR-05.guest')).toBeNull();
    expect(screen.getByTestId('GAR-05.cta.primary')).toBeDisabled();
    expect(screen.getByTestId('GAR-05.restricted')).toHaveTextContent('Melde dich neu an', { exact: false });
    expect(calls.slice(before)).toEqual([]);
  });

  it('forgets the session on the device all the same', async () => {
    await dirtyForm();
    await act(() => expireSession());
    expect(useSessionStore.getState().member).toBeNull();
    expect(await AsyncStorage.getItem('sc.sessionMember')).toBeNull();
    expect(await AsyncStorage.getItem('sc.queryCache')).toBeNull();
  });

  it('comes back for the same member with the text and the button on', async () => {
    await dirtyForm();
    await act(() => expireSession());
    await act(async () => adoptMe(ME));
    await flush();
    expect(screen.getByTestId('GAR-05.description').props.value).toBe(DESCRIPTION);
    expect(screen.getByTestId('GAR-05.cta.primary')).not.toBeDisabled();
  });

  it('is gone for another member', async () => {
    await dirtyForm();
    stubFetch({ [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } }, '/api/v1/auth/me': { body: { data: OTHER } } });
    await act(() => expireSession());
    await act(async () => adoptMe(OTHER));
    await flush();
    expect(screen.queryByTestId('GAR-05.description')).toBeNull();
    expect(screen.queryByDisplayValue(DESCRIPTION)).toBeNull();
  });

  it('drops the form when the member goes on as a guest', async () => {
    await dirtyForm();
    await act(() => expireSession());
    await act(() => releaseExpiredSession());
    await flush();
    expect(screen.getByTestId('GAR-05.guest')).toBeTruthy();
    expect(screen.queryByDisplayValue(DESCRIPTION)).toBeNull();
  });
});

describe('an editor reads fresh on open (BH-10)', () => {
  it('asks the server even for a copy younger than the 60 s of staleTime, without asking twice', async () => {
    mockParams = { id: VEHICLE_ID };
    const { calls } = stubServer();
    queryClient.setQueryData(garageKeys.vehicle(VEHICLE_ID), vehicle());
    await renderScreen(<EditBasicsScreen />, queryClient);
    await waitFor(() => expect(screen.getByTestId('GAR-05.description')).toBeTruthy());
    await flush();
    expect(calls.filter((call) => call.method === 'GET' && call.path.endsWith(`/vehicles/${VEHICLE_ID}`))).toHaveLength(1);
  });

  it('asks once for an open without a copy', async () => {
    mockParams = { id: VEHICLE_ID };
    const { calls } = stubServer();
    await renderScreen(<EditBasicsScreen />, queryClient);
    await waitFor(() => expect(screen.getByTestId('GAR-05.description')).toBeTruthy());
    await flush();
    expect(calls.filter((call) => call.method === 'GET' && call.path.endsWith(`/vehicles/${VEHICLE_ID}`))).toHaveLength(1);
  });
});
