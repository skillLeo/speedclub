import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';
import { meKey, type Me } from '@/api/queries/auth';
import { RecoveryCodesSheet } from '@/features/settings/components/RecoveryCodesSheet';
import { markAccountDeleted, resetAccountDeleted } from '@/features/settings/deletion';
import { AccountDeletedScreen } from '@/features/settings/screens/AccountDeletedScreen';
import { ChangePasswordScreen } from '@/features/settings/screens/ChangePasswordScreen';
import { DeleteAccountScreen } from '@/features/settings/screens/DeleteAccountScreen';
import { ExportScreen } from '@/features/settings/screens/ExportScreen';
import { SettingsScreen } from '@/features/settings/screens/SettingsScreen';
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
const mockEndSession = jest.fn(() => Promise.resolve());
jest.mock('@/api/queries/auth', () => ({
  ...jest.requireActual<object>('@/api/queries/auth'),
  endLocalSessionQuietly: () => mockEndSession(),
}));
/** The M2.5 calls, as the API will answer them; each test sets what it needs. */
const mockApi = { deleteAccount: jest.fn(), requestExport: jest.fn(), changePassword: jest.fn() };
jest.mock('@/api/queries/settings', () => {
  const actual = jest.requireActual<typeof import('@/api/queries/settings')>('@/api/queries/settings');
  const { useMutation, useQuery } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useDeleteAccount: () => useMutation({ mutationFn: (input: unknown) => mockApi.deleteAccount(input) }),
    useRequestExport: () => useMutation({ mutationFn: (input: unknown) => mockApi.requestExport(input) }),
    useChangePassword: () => useMutation({ mutationFn: (input: unknown) => mockApi.changePassword(input) }),
    useDataExports: () => useQuery({ queryKey: ['me', 'exports'], queryFn: () => Promise.resolve([]) }),
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
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
};

const validation = (fields: Record<string, string[]>, code = 'validation_failed') =>
  new ApiError({ kind: 'validation', status: 422, code, message: 'Vom Server.', fieldErrors: fields });

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) => renderWith(element, client);
const guardOn = () => {
  const { usePreventRemove } = jest.requireMock<{ usePreventRemove: jest.Mock<void, [boolean]> }>('expo-router');
  return usePreventRemove.mock.lastCall?.[0];
};

beforeAll(hydrateThemePreference);
beforeEach(async () => {
  jest.clearAllMocks();
  resetAccountDeleted();
  client = newQueryClient();
  client.setQueryData(meKey, ME);
  stubFetch({ '/auth/me': { body: { data: ME } } });
  await act(async () => setMember({ id: ME.id, username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
});
afterEach(async () => {
  await act(async () => useSessionStore.setState({ status: 'guest', member: null }));
});

describe('SET-01 FS-12', () => {
  it('shows every group to a member, the blocked accounts under Privatsphäre, and the version and sign-out', async () => {
    await renderScreen(<SettingsScreen />);
    for (const group of ['account', 'security', 'privacy', 'app', 'data', 'helpGroup', 'legalGroup', 'about', 'signOutGroup']) {
      expect(screen.getByTestId(`SET-01.${group}`)).toBeTruthy();
    }
    expect(screen.getByTestId('SET-01.privacy')).toContainElement(screen.getByTestId('SET-01.blocked'));
    await fireEvent.press(screen.getByTestId('SET-01.delete.body'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/data/delete');
  });
});

describe('SET-04 change password', () => {
  async function fill() {
    await fireEvent.changeText(screen.getByTestId('SET-04.currentPassword'), 'Alt-Passwort-1');
    await fireEvent.changeText(screen.getByTestId('SET-04.password'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('SET-04.passwordRepeat'), PASSWORD);
  }

  it('guards a typed form, and maps a 422 to its field', async () => {
    mockApi.changePassword.mockRejectedValueOnce(validation({ current_password: ['Das aktuelle Passwort stimmt nicht.'] }));
    await renderScreen(<ChangePasswordScreen />);
    expect(guardOn()).toBe(false);
    await fill();
    expect(guardOn()).toBe(true);
    await fireEvent.press(screen.getByTestId('SET-04.cta.primary'));
    await waitFor(() => expect(screen.getByText('Das aktuelle Passwort stimmt nicht.')).toBeTruthy());
    expect(mockApi.changePassword).toHaveBeenCalledWith({ currentPassword: 'Alt-Passwort-1', password: PASSWORD, revokeOtherSessions: true });
  });

  it('says what is wrong before sending', async () => {
    await renderScreen(<ChangePasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('SET-04.password'), 'kurz');
    await fireEvent.press(screen.getByTestId('SET-04.cta.primary'));
    await waitFor(() => expect(screen.getByText('Das Passwort braucht mindestens 10 Zeichen.')).toBeTruthy());
    expect(mockApi.changePassword).not.toHaveBeenCalled();
  });

  it('drops the guard after a success and goes back', async () => {
    mockApi.changePassword.mockResolvedValueOnce(undefined);
    await renderScreen(<ChangePasswordScreen />);
    await fill();
    await fireEvent.press(screen.getByTestId('SET-04.cta.primary'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(guardOn()).toBe(false);
  });
});

describe('SET-13 final screen', () => {
  it('"Zur Startseite" goes home only: clearing the deletion does not send it to the settings (M2.8)', async () => {
    markAccountDeleted();
    await act(async () => useSessionStore.setState({ status: 'guest', member: null }));
    await renderScreen(<AccountDeletedScreen />);
    expect(screen.getByTestId('SET-13.done')).toBeTruthy();
    const fetches = jest.mocked(globalThis.fetch).mock.calls.length;
    await fireEvent.press(screen.getByTestId('SET-13.done.home'));
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
    expect(jest.mocked(globalThis.fetch).mock.calls.length).toBe(fetches);
  });

  it('a typed URL without a deletion goes to the settings', async () => {
    await renderScreen(<AccountDeletedScreen />);
    expect(mockRouter.replace).toHaveBeenCalledWith('/settings');
    expect(screen.queryByTestId('SET-13.done')).toBeNull();
  });
});

describe('SET-13 delete account', () => {
  async function fill() {
    await fireEvent.changeText(screen.getByTestId('SET-13.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-13.understood'));
  }

  it('lists the consequences before anything can be sent', async () => {
    await renderScreen(<DeleteAccountScreen />);
    for (const key of ['hidden', 'stickers', 'signedOut', 'social', 'messages', 'final', 'noUndo']) {
      expect(screen.getByTestId(`SET-13.consequence.${key}`)).toBeTruthy();
    }
    expect(screen.getByTestId('SET-13.consequence.messages')).toHaveTextContent(/Gelöschtes Mitglied/);
  });

  it('needs the checkbox, then a last dialog, then deactivates, ends the session and shows the final screen', async () => {
    mockApi.deleteAccount.mockResolvedValueOnce(undefined);
    await renderScreen(<DeleteAccountScreen />);
    await fireEvent.changeText(screen.getByTestId('SET-13.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('SET-13.understood.error')).toBeTruthy());
    expect(screen.queryByTestId('SET-13.dialog')).toBeNull();

    await fireEvent.press(screen.getByTestId('SET-13.understood'));
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('SET-13.dialog')).toBeTruthy());
    expect(mockApi.deleteAccount).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('SET-13.dialog.confirm'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/settings/data/deleted'));
    expect(mockApi.deleteAccount).toHaveBeenCalledWith({ password: PASSWORD });
    expect(mockEndSession).toHaveBeenCalledTimes(1);
  });

  it('after the deletion nothing asks auth/me again: the session ends and the cache clears without a refetch (F8, round 2)', async () => {
    const meCalls = () => jest.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(typeof input === 'string' ? input : (input as Request).url).includes('/auth/me')).length;
    // As the real endLocalSessionQuietly: the store says guest, then the query cache is cleared.
    mockEndSession.mockImplementationOnce(async () => {
      useSessionStore.setState({ status: 'guest', member: null });
      client.clear();
    });
    mockApi.deleteAccount.mockResolvedValueOnce(undefined);
    await renderScreen(<DeleteAccountScreen />);
    await fill();
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    const confirm = await screen.findByTestId('SET-13.dialog.confirm');
    const before = meCalls();
    await fireEvent.press(confirm);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/settings/data/deleted'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(meCalls()).toBe(before);
    // Nor did one start and wait for the network: no Me query is fetching or paused.
    const me = client.getQueryCache().find({ queryKey: meKey });
    expect(me?.state.fetchStatus ?? 'idle').toBe('idle');
  });

  it('asks for the second factor when the server wants it, and sends it with the password', async () => {
    mockApi.deleteAccount.mockRejectedValueOnce(validation({ code: ['Gib einen Code ein.'] }, 'two_factor_required'));
    mockApi.deleteAccount.mockResolvedValueOnce(undefined);
    await renderScreen(<DeleteAccountScreen />);
    await fill();
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-13.dialog.confirm'));
    await waitFor(() => expect(screen.getByTestId('SET-13.code')).toBeTruthy());
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('SET-13.code'), '123 456');
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-13.dialog.confirm'));
    await waitFor(() => expect(mockApi.deleteAccount).toHaveBeenLastCalledWith({ password: PASSWORD, code: '123456' }));
  });

  it('puts a wrong password on its field and stays signed in', async () => {
    mockApi.deleteAccount.mockRejectedValueOnce(validation({ password: ['Das Passwort stimmt nicht.'] }));
    await renderScreen(<DeleteAccountScreen />);
    await fill();
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-13.dialog.confirm'));
    await waitFor(() => expect(screen.getByText('Das Passwort stimmt nicht.')).toBeTruthy());
    expect(mockEndSession).not.toHaveBeenCalled();
  });
});

describe('SET-12 export', () => {
  it('lists what is included and asks for the password before requesting', async () => {
    mockApi.requestExport.mockResolvedValueOnce({ id: 'x', status: 'queued', requestedAt: '', readyAt: null, expiresAt: null });
    await renderScreen(<ExportScreen />);
    expect(screen.getByTestId('SET-12.contents.photos')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('SET-12.empty')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('SET-12.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-12.reauth.confirm'));
    await waitFor(() => expect(screen.getByText('Gib dein Passwort ein.')).toBeTruthy());
    expect(mockApi.requestExport).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('SET-12.reauth.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-12.reauth.confirm'));
    await waitFor(() => expect(mockApi.requestExport).toHaveBeenCalledWith({ password: PASSWORD }));
  });

  it('says when the next export is possible after the daily one', async () => {
    mockApi.requestExport.mockRejectedValueOnce(
      new ApiError({ kind: 'rate_limited', status: 429, code: 'rate_limited', message: 'Zu viele.', retryAfter: 3 * 3600 }),
    );
    await renderScreen(<ExportScreen />);
    await fireEvent.press(screen.getByTestId('SET-12.cta.primary'));
    await fireEvent.changeText(await screen.findByTestId('SET-12.reauth.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-12.reauth.confirm'));
    await waitFor(() => expect(screen.getByTestId('SET-12.notice')).toHaveTextContent(/Der nächste geht in 180 Minuten/));
  });
});

describe('SET-05 recovery codes', () => {
  const CODES = Array.from({ length: 10 }, (_, index) => `CODE-${String(index).padStart(4, '0')}`);

  it('shows the ten codes and closes only after "Ich habe sie gesichert"', async () => {
    const onDone = jest.fn();
    await renderScreen(<RecoveryCodesSheet codes={CODES} onDone={onDone} testID="SET-05.codes" />);
    expect(screen.getByTestId('SET-05.codes.list')).toHaveTextContent(CODES.join(''));
    await fireEvent.press(screen.getByTestId('SET-05.codes.done'));
    expect(onDone).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('SET-05.codes.saved'));
    await fireEvent.press(screen.getByTestId('SET-05.codes.done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('copies all codes in one go', async () => {
    const clipboard = jest.requireMock<{ setStringAsync: jest.Mock }>('expo-clipboard');
    await renderScreen(<RecoveryCodesSheet codes={CODES} onDone={jest.fn()} testID="SET-05.codes" />);
    await fireEvent.press(screen.getByTestId('SET-05.codes.copy'));
    expect(clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining(CODES.join('\n')));
  });
});

describe('M2.5 server facts', () => {
  const locked = () =>
    new ApiError({ kind: 'forbidden', status: 403, code: 'second_factor_locked', message: 'Gesperrt.' });

  it('SET-12 says how long an export stays, and turns a 503 into a state with a retry', async () => {
    mockApi.requestExport.mockRejectedValueOnce(
      new ApiError({ kind: 'server', status: 503, code: 'service_unavailable', message: 'Nicht verfügbar.', retryAfter: 3600 }),
    );
    await renderScreen(<ExportScreen />);
    expect(screen.getByTestId('SET-12.retention')).toHaveTextContent('Dein Export bleibt bis zu 7 Tage abrufbar.');
    await fireEvent.press(screen.getByTestId('SET-12.cta.primary'));
    await fireEvent.changeText(await screen.findByTestId('SET-12.reauth.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-12.reauth.confirm'));
    await waitFor(() => expect(screen.getByTestId('SET-12.unavailable')).toHaveTextContent(/in 60 Minuten/));
    mockApi.requestExport.mockResolvedValueOnce({ id: 'x', status: 'queued', requestedAt: null, readyAt: null, expiresAt: null, bytes: null, downloadUrl: null });
    await fireEvent.press(screen.getByTestId('SET-12.unavailable.action'));
    await fireEvent.changeText(await screen.findByTestId('SET-12.reauth.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-12.reauth.confirm'));
    await waitFor(() => expect(mockApi.requestExport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('SET-12.unavailable')).toBeNull());
  });

  it('SET-13 keeps a pending export in view (ADR-203 c)', async () => {
    await renderScreen(<DeleteAccountScreen />);
    expect(screen.getByTestId('SET-13.exportKept')).toHaveTextContent(/bis zu 7 Tage abrufbar/);
  });

  it('SET-13: a locked second factor says so calmly, holds the button until a change, and signs nobody out', async () => {
    mockApi.deleteAccount.mockRejectedValueOnce(locked());
    await renderScreen(<DeleteAccountScreen />);
    await fireEvent.changeText(screen.getByTestId('SET-13.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('SET-13.understood'));
    await fireEvent.press(screen.getByTestId('SET-13.cta.primary'));
    await fireEvent.press(await screen.findByTestId('SET-13.dialog.confirm'));
    await waitFor(() => expect(screen.getByTestId('SET-13.notice')).toHaveTextContent(/Zwei-Faktor-Prüfung ist gesperrt/));
    expect(screen.getByTestId('SET-13.notice').props.role).toBe('status');
    expect(screen.getByTestId('SET-13.cta.primary')).toBeDisabled();
    expect(mockEndSession).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe('member');
    await fireEvent.changeText(screen.getByTestId('SET-13.password'), `${PASSWORD}!`);
    expect(screen.getByTestId('SET-13.cta.primary')).not.toBeDisabled();
  });

  it('the re-auth sheet holds its button after a lock until a field changes', async () => {
    const { ReauthSheet } = jest.requireActual<typeof import('@/features/settings/components/ReauthSheet')>(
      '@/features/settings/components/ReauthSheet',
    );
    const onConfirm = jest.fn(() => Promise.reject(locked()));
    await renderScreen(
      <ReauthSheet visible onClose={jest.fn()} title="Neue Codes" body="Bestätige." confirmLabel="Weiter" needsCode onConfirm={onConfirm} testID="SET-05.newCodesSheet" />,
    );
    await fireEvent.changeText(screen.getByTestId('SET-05.newCodesSheet.password'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('SET-05.newCodesSheet.code'), '123456');
    await fireEvent.press(screen.getByTestId('SET-05.newCodesSheet.confirm'));
    await waitFor(() => expect(screen.getByTestId('SET-05.newCodesSheet.notice')).toHaveTextContent(/gesperrt/));
    expect(screen.getByTestId('SET-05.newCodesSheet.confirm')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('SET-05.newCodesSheet.code'), '654321');
    expect(screen.getByTestId('SET-05.newCodesSheet.confirm')).not.toBeDisabled();
  });
});
