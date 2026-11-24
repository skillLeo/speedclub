/**
 * Client round 6, L1 (GDPR): a member who signed up with the e-mail code has no password (Me `password_set: false`). SET-13 and
 * SET-12 (and the other `or-password` forms) must not ask for one: they send `password: ''`, and a 403 reauthentication_required
 * opens the REAUTH sheet, after which the call goes once more. Members with a password keep the password path unchanged.
 *
 * The real query hooks run here (no mocked mutations), against a fetch stub, with the RecentAuthHost mounted as in the root.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { QueryClient } from '@tanstack/react-query';

import { meKey, type Me } from '@/api/queries/auth';
import { RecentAuthHost } from '@/features/auth/RecentAuthHost';
import { resetAccountDeleted } from '@/features/settings/deletion';
import { ChangeEmailScreen } from '@/features/settings/screens/ChangeEmailScreen';
import { ChangePasswordScreen } from '@/features/settings/screens/ChangePasswordScreen';
import { DeleteAccountScreen } from '@/features/settings/screens/DeleteAccountScreen';
import { ExportScreen } from '@/features/settings/screens/ExportScreen';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen as renderWith, stubFetch, type Answer } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/settings/data/delete',
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '0d4c6a0e-7a3b-4c1e-9d55-3f1a2b3c4d5e' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
const mockEndSession = jest.fn(() => Promise.resolve());
jest.mock('@/api/queries/auth', () => ({
  ...jest.requireActual<object>('@/api/queries/auth'),
  endLocalSessionQuietly: () => mockEndSession(),
}));

const PASSWORD = 'Boxer-Motor-2002';
const MEMBER: Me = {
  intro_seen_at: '2026-11-01T10:00:00Z',
  id: '01m6f7ztzfs0gd39t08rs9zmmp',
  email: 'lukas.sc@speedclub.test',
  email_verified: true,
  level: { level: 1, title: 'Street Rookie' },
  founding_number: null,
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
  display_name: 'Lukas',
  city: null,
  bio: null,
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'ps_kw',
  member_since: '2023-03-12T10:00:00+00:00',
  stats: { vehicles: 1, followers: 0, following: 0 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null }, forum: { restricted: false, until: null, decision_id: null } },
};
/** Signed up with the e-mail code: no password. */
const PASSWORDLESS: Me = { ...MEMBER, password_set: false };

const reauthRequired: Answer = {
  status: 403,
  body: { message: 'Bestätige kurz, dass du es bist.', code: 'reauthentication_required', errors: {}, methods: ['email_code'] },
};
const EXPORT_ROW = { id: '01export', status: 'queued', requested_at: '2026-11-24T10:00:00Z', ready_at: null, expires_at: null, bytes: null, download_url: null };

/** The first call answers 403 reauthentication_required, every later one `then`. */
function firstNeedsReauth(then: Answer) {
  let count = 0;
  return {
    answer: () => {
      count += 1;
      return count === 1 ? reauthRequired : then;
    },
    count: () => count,
  };
}

const REAUTH_ANSWERS: Record<string, Answer> = {
  '/me/reauth/email': { status: 202, body: { data: { attempt_id: '0d4c6a0e-7a3b-4c1e-9d55-3f1a2b3c4d5e', resend_after: 30 } } },
  '/me/reauth': { body: { data: { reauthenticated_until: '2026-11-24T10:10:00Z' } } },
};

async function bodiesTo(calls: Request[], path: string): Promise<Record<string, unknown>[]> {
  const matching = calls.filter((request) => request.method !== 'GET' && new URL(request.url).pathname.endsWith(path));
  return Promise.all(matching.map(async (request) => JSON.parse((await request.clone().text()) || '{}') as Record<string, unknown>));
}

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) => renderWith(element, client);

async function signIn(me: Me) {
  client.setQueryData(meKey, me);
  await act(async () => setMember({ id: me.id, username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
}

/** The REAUTH sheet with the e-mail code, as the server's `methods` ask: the code goes out, the member types it, it is them. */
async function confirmWithEmailCode() {
  expect(await screen.findByTestId('REAUTH.sheet')).toBeTruthy();
  await fireEvent.changeText(await screen.findByTestId('REAUTH.code'), '123456');
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  resetAccountDeleted();
  client = newQueryClient();
});
afterEach(async () => {
  await act(async () => useSessionStore.setState({ status: 'guest', member: null }));
});

describe('SET-13 without a password (L1)', () => {
  it('shows no password field, sends password "", and after the REAUTH sheet deletes on the retry', async () => {
    const remove = firstNeedsReauth({ body: {} });
    const { calls } = stubFetch({ '/auth/me': { body: { data: PASSWORDLESS } }, '/me/delete': remove.answer, ...REAUTH_ANSWERS });
    await signIn(PASSWORDLESS);
    await renderScreen(
      <>
        <DeleteAccountScreen />
        <RecentAuthHost />
      </>,
    );
    expect(screen.queryByTestId('SET-13.password')).toBeNull();
    expect(screen.getByTestId('SET-13.noPassword')).toHaveTextContent(/kein Passwort festgelegt/);

    await fireEvent.press(screen.getByTestId('SET-13.understood'));
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-13.dialog.confirm'));
    await confirmWithEmailCode();

    await waitFor(() => expect(remove.count()).toBe(2));
    expect(await bodiesTo(calls, '/me/delete')).toEqual([{ password: '' }, { password: '' }]);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/settings/data/deleted'));
    expect(screen.queryByText('Gib dein Passwort ein.')).toBeNull();
  });

  it('with two-factor on, still asks for the code and sends it with the empty password', async () => {
    const { calls } = stubFetch({ '/auth/me': { body: { data: { ...PASSWORDLESS, two_factor_enabled: true } } }, '/me/delete': { body: {} } });
    await signIn({ ...PASSWORDLESS, two_factor_enabled: true });
    await renderScreen(<DeleteAccountScreen />);
    expect(screen.queryByTestId('SET-13.password')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('SET-13.code'), '123 456');
    await fireEvent.press(screen.getByTestId('SET-13.understood'));
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-13.dialog.confirm'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/settings/data/deleted'));
    expect(await bodiesTo(calls, '/me/delete')).toEqual([{ password: '', code: '123456' }]);
  });

  it('closing the REAUTH sheet deletes nothing and says nothing', async () => {
    const remove = firstNeedsReauth({ body: {} });
    stubFetch({ '/auth/me': { body: { data: PASSWORDLESS } }, '/me/delete': remove.answer, ...REAUTH_ANSWERS });
    await signIn(PASSWORDLESS);
    await renderScreen(
      <>
        <DeleteAccountScreen />
        <RecentAuthHost />
      </>,
    );
    await fireEvent.press(screen.getByTestId('SET-13.understood'));
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-13.dialog.confirm'));
    expect(await screen.findByTestId('REAUTH.sheet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('REAUTH.sheet.scrim'));
    await waitFor(() => expect(screen.queryByTestId('REAUTH.sheet')).toBeNull());
    expect(remove.count()).toBe(1);
    expect(screen.queryByTestId('SET-13.notice')).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('SET-12 without a password (L1)', () => {
  it('the sheet has no password field, sends password "", and the REAUTH sheet lets the export go through', async () => {
    const request = firstNeedsReauth({ status: 202, body: { data: EXPORT_ROW } });
    const { calls } = stubFetch({
      '/auth/me': { body: { data: PASSWORDLESS } },
      '/me/exports': { body: { data: [] } },
      '/me/export': request.answer,
      ...REAUTH_ANSWERS,
    });
    await signIn(PASSWORDLESS);
    await renderScreen(
      <>
        <ExportScreen />
        <RecentAuthHost />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('SET-12.empty')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('SET-12.cta.primary'));
    expect(await screen.findByTestId('SET-12.reauth.noPassword')).toBeTruthy();
    expect(screen.queryByTestId('SET-12.reauth.password')).toBeNull();
    await fireEvent.press(screen.getByTestId('SET-12.reauth.confirm'));
    expect(screen.queryByText('Gib dein Passwort ein.')).toBeNull();
    await confirmWithEmailCode();

    await waitFor(() => expect(request.count()).toBe(2));
    expect(await bodiesTo(calls, '/me/export')).toEqual([{ password: '' }, { password: '' }]);
    await waitFor(() => expect(screen.queryByTestId('SET-12.reauth.confirm')).toBeNull());
  });
});

describe('SET-03 and SET-04 without a password (L1)', () => {
  it('SET-03 asks for no password and sends password ""', async () => {
    const { calls } = stubFetch({
      '/auth/me': { body: { data: PASSWORDLESS } },
      '/me/email': { status: 202, body: { data: { email: 'neu@speedclub.test', resend_after_seconds: 60 } } },
    });
    await signIn(PASSWORDLESS);
    await renderScreen(<ChangeEmailScreen />);
    expect(screen.queryByTestId('SET-03.password')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('SET-03.email'), 'neu@speedclub.test');
    await fireEvent.press(screen.getByTestId('SET-03.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('SET-03.sentTo')).toBeTruthy());
    expect(await bodiesTo(calls, '/me/email')).toEqual([{ email: 'neu@speedclub.test', password: '' }]);
  });

  it('SET-04 sets a first password without a current one', async () => {
    const { calls } = stubFetch({ '/auth/me': { body: { data: PASSWORDLESS } }, '/me/password': { body: {} } });
    await signIn(PASSWORDLESS);
    await renderScreen(<ChangePasswordScreen />);
    expect(screen.queryByTestId('SET-04.currentPassword')).toBeNull();
    expect(screen.getAllByText('Passwort festlegen').length).toBeGreaterThan(0);
    await fireEvent.changeText(screen.getByTestId('SET-04.password'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('SET-04.passwordRepeat'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-04.cta.primary'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await bodiesTo(calls, '/me/password')).toEqual([
      { current_password: '', password: PASSWORD, password_confirmation: PASSWORD, revoke_other_sessions: true },
    ]);
  });
});

describe('members with a password: unchanged (L1)', () => {
  it('SET-13 asks for the password and sends it, once, without the REAUTH sheet', async () => {
    const { calls } = stubFetch({ '/auth/me': { body: { data: MEMBER } }, '/me/delete': { body: {} } });
    await signIn(MEMBER);
    await renderScreen(
      <>
        <DeleteAccountScreen />
        <RecentAuthHost />
      </>,
    );
    expect(screen.queryByTestId('SET-13.noPassword')).toBeNull();
    await fireEvent.press(screen.getByTestId('SET-13.understood'));
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await waitFor(() => expect(screen.getByText('Gib dein Passwort ein.')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('SET-13.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-13.dialog.confirm'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/settings/data/deleted'));
    expect(await bodiesTo(calls, '/me/delete')).toEqual([{ password: PASSWORD }]);
    expect(screen.queryByTestId('REAUTH.sheet')).toBeNull();
  });

  it('SET-12 asks for the password in the sheet and sends it', async () => {
    const { calls } = stubFetch({
      '/auth/me': { body: { data: MEMBER } },
      '/me/exports': { body: { data: [] } },
      '/me/export': { status: 202, body: { data: EXPORT_ROW } },
    });
    await signIn(MEMBER);
    await renderScreen(<ExportScreen />);
    await waitFor(() => expect(screen.getByTestId('SET-12.empty')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('SET-12.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-12.reauth.confirm'));
    await waitFor(() => expect(screen.getByText('Gib dein Passwort ein.')).toBeTruthy());
    expect(screen.queryByTestId('SET-12.reauth.noPassword')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('SET-12.reauth.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-12.reauth.confirm'));
    await waitFor(() => expect(screen.queryByTestId('SET-12.reauth.confirm')).toBeNull());
    expect(await bodiesTo(calls, '/me/export')).toEqual([{ password: PASSWORD }]);
  });
});

afterAll(() => waitFor(() => undefined));
