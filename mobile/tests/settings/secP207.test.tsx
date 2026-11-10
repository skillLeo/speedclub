import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';
import { meKey, type Me } from '@/api/queries/auth';
import { ChangeEmailScreen } from '@/features/settings/screens/ChangeEmailScreen';
import { ChangePasswordScreen } from '@/features/settings/screens/ChangePasswordScreen';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen as renderWith, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
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
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
/** The SEC-P2-07 calls, as the API will answer them; each test sets what it needs. */
const mockApi = { changePassword: jest.fn(), requestEmailChange: jest.fn() };
jest.mock('@/api/queries/settings', () => {
  const actual = jest.requireActual<typeof import('@/api/queries/settings')>('@/api/queries/settings');
  const { useMutation } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useChangePassword: () => useMutation({ mutationFn: (input: unknown) => mockApi.changePassword(input) }),
    useRequestEmailChange: () => useMutation({ mutationFn: (input: unknown) => mockApi.requestEmailChange(input) }),
  };
});

const EMAIL = 'lukas.sc@speedclub.test';
const PASSWORD = 'Boxer-Motor-2002';
const ME: Me = {
  id: '01m6f7ztzfs0gd39t08rs9zmmp',
  email: EMAIL,
  email_verified: true,
  has_username: true,
  profile_complete: true,
  next_step: null,
  force_password_change: false,
  two_factor_enabled: true,
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
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
};

const validation = (fields: Record<string, string[]>, code = 'validation_failed') =>
  new ApiError({ kind: 'validation', status: 422, code, message: 'Vom Server.', fieldErrors: fields });

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) => renderWith(element, client);

function setMe(me: Me) {
  client.setQueryData(meKey, me);
  stubFetch({ '/auth/me': { body: { data: me } } });
}

beforeAll(hydrateThemePreference);
beforeEach(async () => {
  jest.clearAllMocks();
  client = newQueryClient();
  setMe(ME);
  await act(async () => setMember({ id: ME.id, username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
});
afterEach(async () => {
  await act(async () => useSessionStore.setState({ status: 'guest', member: null }));
});

/** SEC-P2-07 (ADR-221): with two-factor on, SET-03 and SET-04 send the current code; a 422 lands on the field. */
describe('SET-04 with two-factor on', () => {
  async function fill(code?: string) {
    await fireEvent.changeText(screen.getByTestId('SET-04.currentPassword'), 'Alt-Passwort-1');
    await fireEvent.changeText(screen.getByTestId('SET-04.password'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('SET-04.passwordRepeat'), PASSWORD);
    if (code !== undefined) await fireEvent.changeText(screen.getByTestId('SET-04.secondFactor'), code);
  }

  it('asks for the code, refuses an empty one and sends it without spaces', async () => {
    mockApi.changePassword.mockResolvedValueOnce(undefined);
    await renderScreen(<ChangePasswordScreen />);
    await fill();
    await fireEvent.press(screen.getByTestId('SET-04.cta.primary'));
    await waitFor(() => expect(screen.getByText('Gib den Code aus deiner App oder einen Wiederherstellungscode ein.')).toBeTruthy());
    expect(mockApi.changePassword).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('SET-04.secondFactor'), '123 456');
    await fireEvent.press(screen.getByTestId('SET-04.cta.primary'));
    await waitFor(() =>
      expect(mockApi.changePassword).toHaveBeenCalledWith({ currentPassword: 'Alt-Passwort-1', password: PASSWORD, revokeOtherSessions: true, code: '123456' }),
    );
  });

  it('puts the code right under the current password (DQ-570, as SET-03)', async () => {
    await renderScreen(<ChangePasswordScreen />);
    const order = screen
      .getAllByTestId(/^SET-04\.(currentPassword|secondFactor|password|passwordRepeat)$/)
      .map((node) => node.props.testID as string)
      .filter((id, index, all) => all.indexOf(id) === index);
    expect(order).toEqual(['SET-04.currentPassword', 'SET-04.secondFactor', 'SET-04.password', 'SET-04.passwordRepeat']);
  });

  it('a wrong code shows on the field', async () => {
    mockApi.changePassword.mockRejectedValueOnce(validation({ code: ['Dieser Code stimmt nicht.'] }));
    await renderScreen(<ChangePasswordScreen />);
    await fill('111111');
    await fireEvent.press(screen.getByTestId('SET-04.cta.primary'));
    await waitFor(() => expect(screen.getByText('Dieser Code stimmt nicht.')).toBeTruthy());
  });

  it('two-factor switched on elsewhere: 422 two_factor_code_required brings the field with its message', async () => {
    setMe({ ...ME, two_factor_enabled: false });
    mockApi.changePassword.mockRejectedValueOnce(
      validation({ code: ['Gib zusätzlich den Code aus deiner Authenticator-App oder einen Wiederherstellungscode ein.'] }, 'two_factor_code_required'),
    );
    await renderScreen(<ChangePasswordScreen />);
    expect(screen.queryByTestId('SET-04.secondFactor')).toBeNull();
    await fill();
    await fireEvent.press(screen.getByTestId('SET-04.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('SET-04.secondFactor')).toBeTruthy());
    expect(screen.getByText('Gib zusätzlich den Code aus deiner Authenticator-App oder einen Wiederherstellungscode ein.')).toBeTruthy();
  });

  it('a locked second factor says so calmly and rests the button', async () => {
    mockApi.changePassword.mockRejectedValueOnce(new ApiError({ kind: 'forbidden', status: 403, code: 'second_factor_locked', message: 'Gesperrt.' }));
    await renderScreen(<ChangePasswordScreen />);
    await fill('111111');
    await fireEvent.press(screen.getByTestId('SET-04.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('SET-04.notice')).toHaveTextContent(/Zu viele falsche Codes/));
  });
});

describe('SET-03 with two-factor on', () => {
  it('sends address, password and code', async () => {
    mockApi.requestEmailChange.mockResolvedValueOnce(undefined);
    await renderScreen(<ChangeEmailScreen />);
    await fireEvent.changeText(screen.getByTestId('SET-03.email'), 'neu@speedclub.test');
    await fireEvent.changeText(screen.getByTestId('SET-03.password'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('SET-03.secondFactor'), 'ABCD-EFGH-12');
    await fireEvent.press(screen.getByTestId('SET-03.cta.primary'));
    await waitFor(() => expect(mockApi.requestEmailChange).toHaveBeenCalledWith({ email: 'neu@speedclub.test', password: PASSWORD, code: 'ABCD-EFGH-12' }));
    await waitFor(() => expect(screen.getByTestId('SET-03.sentTo')).toBeTruthy());
  });

  it('without two-factor there is no code field until the server asks for one', async () => {
    setMe({ ...ME, two_factor_enabled: false });
    mockApi.requestEmailChange.mockRejectedValueOnce(validation({ code: ['Code nötig.'] }, 'two_factor_code_required'));
    await renderScreen(<ChangeEmailScreen />);
    expect(screen.queryByTestId('SET-03.secondFactor')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('SET-03.email'), 'neu@speedclub.test');
    await fireEvent.changeText(screen.getByTestId('SET-03.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-03.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('SET-03.secondFactor')).toBeTruthy());
    expect(mockApi.requestEmailChange).toHaveBeenCalledWith({ email: 'neu@speedclub.test', password: PASSWORD });
    expect(screen.getByText('Code nötig.')).toBeTruthy();
  });
});

/** The restricted state of SET-03/04/05/13/15 (visual rule state-not-rendered): the notice, and the decision behind it. */
describe('restricted settings forms', () => {
  it('SET-04 says what still works and links the decision', async () => {
    setMe({
      ...ME,
      restrictions: { suspended: false, messaging: { restricted: true, until: null, decision_id: '01JDEC' }, publishing: { restricted: false, until: null, decision_id: null } },
    });
    await renderScreen(<ChangePasswordScreen />);
    expect(screen.getByTestId('SET-04.restricted')).toHaveTextContent(/Einstellungen, Datenexport und Kontolöschung funktionieren trotzdem/);
    await fireEvent.press(screen.getByTestId('SET-04.restricted.reasons'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/decision/[id]', params: { id: '01JDEC' } });
  });

  it('an unrestricted account shows no notice', async () => {
    await renderScreen(<ChangeEmailScreen />);
    expect(screen.queryByTestId('SET-03.restricted')).toBeNull();
  });
});
