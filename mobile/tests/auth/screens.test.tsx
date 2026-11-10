// The submit branches of AUTH-03, 05, 07, 08 and 09: what each screen does with the server's answer.
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';

import type { QueryClient } from '@tanstack/react-query';

import { meKey, type Me } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { handedEmailFor } from '@/features/auth/emailHandoff';
import { clearRegistrationPassword, holdRegistrationPassword, registrationPasswordFor } from '@/features/auth/pendingRegistration';
import { consumeAfterOnboarding, WIZARD_PATH } from '@/features/auth/routing';
import { ProfileSetupScreen } from '@/features/auth/screens/ProfileSetupScreen';
import { ResetPasswordScreen } from '@/features/auth/screens/ResetPasswordScreen';
import { SignInScreen } from '@/features/auth/screens/SignInScreen';
import { SignUpScreen } from '@/features/auth/screens/SignUpScreen';
import { UsernameScreen } from '@/features/auth/screens/UsernameScreen';
import { VerifyEmailScreen } from '@/features/auth/screens/VerifyEmailScreen';
import { setGuest, setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { dismissToast, useCurrentToast } from '@/ui/toast';

import { newQueryClient, renderScreen as renderWith, stubFetch, type Answer } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
const mockKeychain = new Map<string, string>();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePreventRemove: jest.fn(),
  // DiscardGuardDialog continues a blocked action through the screen's navigation.
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockKeychain.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockKeychain.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockKeychain.delete(key);
    return Promise.resolve();
  }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// AUTH-09's photo steps, replaceable per test; the rest of the file uses the real ones.
const mockAvatar: { pick: jest.Mock | null; form: jest.Mock | null } = { pick: null, form: null };
jest.mock('@/features/auth/avatar', () => {
  const actual = jest.requireActual('@/features/auth/avatar');
  return {
    ...actual,
    pickPhoto: (...args: unknown[]) => (mockAvatar.pick ? mockAvatar.pick(...args) : actual.pickPhoto(...args)),
    avatarFormData: (...args: unknown[]) => (mockAvatar.form ? mockAvatar.form(...args) : actual.avatarFormData(...args)),
  };
});
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const EMAIL = 'lukas.sc@speedclub.test';
const PASSWORD = 'Boxer-Motor-2002';

const ME: Me = {
  id: '01m6f7ztzfs0gd39t08rs9zmmp',
  email: EMAIL,
  email_verified: true,
  has_username: true,
  profile_complete: false,
  next_step: 'profile_setup',
  force_password_change: false,
  two_factor_enabled: false,
  username: 'lukas.sc',
  username_change_available_at: null,
  display_name: null,
  city: null,
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

const error = (status: number, code: string, extra: Record<string, unknown> = {}): Answer => ({
  status,
  body: { message: 'Vom Server.', code, errors: {}, ...extra },
});

function signIn() {
  mockKeychain.set('sc.authToken', 'token-1');
  setMember({ id: ME.id, username: 'lukas.sc', displayName: null, avatarUrl: null, nextStep: ME.next_step });
}

/** The parsed JSON bodies sent to a path. */
async function bodiesTo(calls: Request[], path: string): Promise<unknown[]> {
  const matching = calls.filter((request) => new URL(request.url).pathname.endsWith(path));
  return Promise.all(matching.map(async (request) => JSON.parse(await request.clone().text()) as unknown));
}

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) => renderWith(element, client);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  mockParams = {};
  mockKeychain.clear();
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null, notice: null, passwordChangeEmail: null });
  consumeAfterOnboarding();
});
// The username check keeps its answer a minute, and adoptMe writes the app's own client: both timers would outlive the file.
afterEach(() => {
  client.clear();
  queryClient.clear();
  clearRegistrationPassword();
});
afterAll(() => setGuest());

/** What the discard guard held at the moment the screen navigated. A guard that is still on stops the navigation. */
function guardWhenReplaced(): () => boolean | undefined {
  const { usePreventRemove } = jest.requireMock<{ usePreventRemove: jest.Mock<void, [boolean]> }>('expo-router');
  let held: boolean | undefined;
  mockRouter.replace.mockImplementationOnce(() => {
    held = usePreventRemove.mock.lastCall?.[0];
  });
  return () => held;
}

describe('the footer links of AUTH-03 and AUTH-04 (BH-34)', () => {
  it('AUTH-03: an address alone is carried over, so nothing asks', async () => {
    const guard = guardWhenReplaced();
    await renderScreen(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-03.email'), EMAIL);
    await fireEvent.press(screen.getByTestId('AUTH-03.toSignUp'));
    // SEC-P1-05: the address goes along in memory, never in the URL.
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-up'));
    expect(handedEmailFor('/sign-up')).toBe(EMAIL);
    expect(guard()).toBe(false);
  });

  it('AUTH-03: a typed password would be lost, so the guard stays on', async () => {
    const guard = guardWhenReplaced();
    await renderScreen(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-03.email'), EMAIL);
    await fireEvent.changeText(screen.getByTestId('AUTH-03.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('AUTH-03.toSignUp'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(guard()).toBe(true);
  });

  it('AUTH-03: an address alone still asks on the way back, which carries nothing over', async () => {
    await renderScreen(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-03.email'), EMAIL);
    const { usePreventRemove } = jest.requireMock<{ usePreventRemove: jest.Mock<void, [boolean]> }>('expo-router');
    expect(usePreventRemove.mock.lastCall?.[0]).toBe(true);
  });

  it('AUTH-04: an address alone is carried over, so nothing asks', async () => {
    const guard = guardWhenReplaced();
    await renderScreen(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-04.email'), EMAIL);
    await fireEvent.press(screen.getByTestId('AUTH-04.toSignIn'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    expect(handedEmailFor('/sign-in')).toBe(EMAIL);
    expect(guard()).toBe(false);
  });

  it.each([
    ['a password', () => fireEvent.changeText(screen.getByTestId('AUTH-04.password'), PASSWORD)],
    ['a ticked consent', () => fireEvent.press(screen.getByTestId('AUTH-04.termsAccepted'))],
  ])('AUTH-04: %s would be lost, so the guard stays on', async (_what, type) => {
    const guard = guardWhenReplaced();
    await renderScreen(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-04.email'), EMAIL);
    await type();
    await fireEvent.press(screen.getByTestId('AUTH-04.toSignIn'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(guard()).toBe(true);
  });
});

describe('AUTH-03 sign-in', () => {
  async function submit(email: string = EMAIL) {
    await fireEvent.changeText(screen.getByTestId('AUTH-03.email'), email);
    await fireEvent.changeText(screen.getByTestId('AUTH-03.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('AUTH-03.cta.primary'));
  }

  it('goes to AUTH-07 as a forced change when the account needs a new password (ADR-137)', async () => {
    stubFetch({ '/auth/login': error(403, 'password_change_required', { next: 'reset_password', email: EMAIL }) });
    await renderScreen(<SignInScreen />);
    await submit();
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/reset-password', params: { forced: '1' } }),
    );
    expect(handedEmailFor('/reset-password')).toBe(EMAIL);
  });

  it('turns the guard off before a forced change goes to AUTH-07, whatever was typed (BH-34)', async () => {
    const guard = guardWhenReplaced();
    stubFetch({ '/auth/login': error(403, 'password_change_required', { next: 'reset_password', email: EMAIL }) });
    await renderScreen(<SignInScreen />);
    await submit();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(guard()).toBe(false);
  });

  it('says how long to wait after a 429 and keeps the button off until then', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      const { calls } = stubFetch({ '/auth/login': error(429, 'rate_limited') });
      // Retry-After travels as a header; the stub sets none, so the screen falls back to its own minute.
      await renderScreen(<SignInScreen />);
      await submit();
      await waitFor(() => expect(screen.getByTestId('AUTH-03.notice')).toHaveTextContent('1 Minute', { exact: false }));
      expect(screen.getByTestId('AUTH-03.cta.primary')).toBeDisabled();
      await fireEvent.press(screen.getByTestId('AUTH-03.cta.primary'));
      expect(calls.filter((request) => request.url.endsWith('/auth/login'))).toHaveLength(1);

      await act(() => jest.advanceTimersByTimeAsync(60_000));
      expect(screen.getByTestId('AUTH-03.cta.primary')).not.toBeDisabled();
      expect(screen.queryByTestId('AUTH-03.notice')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads a wrong password and an unknown address alike', async () => {
    stubFetch({ '/auth/login': error(401, 'invalid_credentials') });
    await renderScreen(<SignInScreen />);
    await submit();
    await waitFor(() => expect(screen.getByTestId('AUTH-03.notice')).toHaveTextContent('E-Mail-Adresse oder Passwort stimmen nicht.'));
  });
});

describe('AUTH-05 verify email', () => {
  const code = () => screen.getByTestId('AUTH-05.code');

  it('clears the cells on a wrong code and says what to do', async () => {
    signIn();
    mockParams = { email: EMAIL };
    stubFetch({ '/auth/me': { body: { data: { ...ME, email_verified: false, next_step: 'verify_email' } } }, '/auth/email/verify': error(422, 'invalid_code') });
    await renderScreen(<VerifyEmailScreen />);
    await fireEvent.changeText(code(), '123456');
    await waitFor(() =>
      expect(screen.getByTestId('AUTH-05.code.error')).toHaveTextContent('Das hat nicht gepasst. Prüfe den Code oder fordere einen neuen an.'),
    );
    expect(code().props.value).toBe('');
  });

  it('names code and password when a password was sent with it, and keeps the code', async () => {
    mockParams = { email: EMAIL };
    const { calls } = stubFetch({ '/auth/email/verify': error(422, 'invalid_code') });
    await renderScreen(<VerifyEmailScreen />);
    await fireEvent.changeText(code(), '123456');
    await fireEvent.changeText(screen.getByTestId('AUTH-05.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('AUTH-05.cta.primary'));
    await waitFor(() =>
      expect(screen.getByTestId('AUTH-05.code.error')).toHaveTextContent(
        'Code oder Passwort stimmen nicht. Prüfe beides oder fordere einen neuen Code an.',
      ),
    );
    expect(code().props.value).toBe('123456');
    // device_id: this install's own id, so two phones of the same model keep a token each (recheck, server keys on it).
    expect(await bodiesTo(calls, '/auth/email/verify')).toEqual([
      { email: EMAIL, code: '123456', password: PASSWORD, device_name: expect.any(String), platform: expect.any(String), app_version: expect.any(String), device_id: 'uuid-1' },
    ]);
  });
});

describe('AUTH-05 with a password held from AUTH-04 (BH-31)', () => {
  const code = () => screen.getByTestId('AUTH-05.code');
  const INVALID = 'Das hat nicht gepasst. Prüfe den Code oder fordere einen neuen an.';
  const INVALID_WITH_PASSWORD = 'Code oder Passwort stimmen nicht. Prüfe beides oder fordere einen neuen Code an.';

  it('treats the first refusal as a mistyped code: the code goes, no password field', async () => {
    holdRegistrationPassword(EMAIL, PASSWORD);
    mockParams = { email: EMAIL, resend: '60' };
    stubFetch({ '/auth/email/verify': error(422, 'invalid_code') });
    await renderScreen(<VerifyEmailScreen />);
    await fireEvent.changeText(code(), '123456');
    await waitFor(() => expect(screen.getByTestId('AUTH-05.code.error')).toHaveTextContent(INVALID));
    expect(code().props.value).toBe('');
    expect(screen.queryByTestId('AUTH-05.password')).toBeNull();
    expect(registrationPasswordFor(EMAIL)).toBe(PASSWORD);
  });

  it('stops trusting the held password on the second refusal, keeps the code, and asks for the password', async () => {
    holdRegistrationPassword(EMAIL, 'Passwort-B-der-zweiten-Anmeldung');
    mockParams = { email: EMAIL, resend: '60' };
    let answer: Answer = error(422, 'invalid_code');
    const { calls } = stubFetch({
      '/auth/email/verify': () => answer,
    });
    await renderScreen(<VerifyEmailScreen />);
    await fireEvent.changeText(code(), '123456');
    await waitFor(() => expect(screen.getByTestId('AUTH-05.code.error')).toHaveTextContent(INVALID));
    await fireEvent.changeText(code(), '654321');
    await waitFor(() => expect(screen.getByTestId('AUTH-05.code.error')).toHaveTextContent(INVALID_WITH_PASSWORD));

    expect(code().props.value).toBe('654321');
    expect(screen.getByTestId('AUTH-05.password')).toBeTruthy();
    expect(registrationPasswordFor(EMAIL)).toBeNull();

    // The password A of the first registration, with the code that stayed.
    answer = { body: { data: { token: 'token-1', token_expires_at: null, member: ME } } };
    await fireEvent.changeText(screen.getByTestId('AUTH-05.password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('AUTH-05.cta.primary'));
    await waitFor(() => expect(useSessionStore.getState().status).toBe('member'));
    const bodies = await bodiesTo(calls, '/auth/email/verify');
    expect(bodies[2]).toMatchObject({ email: EMAIL, code: '654321', password: PASSWORD });
  });

  // The mail still holds the code that was refused, so the same code pasted again is the likely next step.
  it('sends a refused code again when it is pasted again, and the second refusal asks for the password', async () => {
    holdRegistrationPassword(EMAIL, 'Passwort-B-der-zweiten-Anmeldung');
    mockParams = { email: EMAIL, resend: '60' };
    const { calls } = stubFetch({ '/auth/email/verify': error(422, 'invalid_code') });
    await renderScreen(<VerifyEmailScreen />);
    await fireEvent.changeText(code(), '123456');
    await waitFor(() => expect(screen.getByTestId('AUTH-05.code.error')).toHaveTextContent(INVALID));
    expect(code().props.value).toBe('');
    await fireEvent.changeText(code(), '123456');
    await waitFor(() => expect(screen.getByTestId('AUTH-05.code.error')).toHaveTextContent(INVALID_WITH_PASSWORD));
    expect(code().props.value).toBe('123456');
    expect(screen.getByTestId('AUTH-05.password')).toBeTruthy();
    expect(await bodiesTo(calls, '/auth/email/verify')).toHaveLength(2);
  });

  it('never counts a refusal of a signed-in member, who sends no password', async () => {
    signIn();
    mockParams = { email: EMAIL, resend: '60' };
    stubFetch({ '/auth/email/verify': error(422, 'invalid_code') });
    await renderScreen(<VerifyEmailScreen />);
    await fireEvent.changeText(code(), '123456');
    await waitFor(() => expect(screen.getByTestId('AUTH-05.code.error')).toHaveTextContent(INVALID));
    await fireEvent.changeText(code(), '123457');
    await waitFor(() => expect(code().props.value).toBe(''));
    expect(screen.queryByTestId('AUTH-05.password')).toBeNull();
  });
});

describe('AUTH-05 and what it says about the mail (BH-32)', () => {
  it('arriving from AUTH-04: a mail went out, and the server named the wait', async () => {
    holdRegistrationPassword(EMAIL, PASSWORD);
    mockParams = { email: EMAIL, resend: '60' };
    await renderScreen(<VerifyEmailScreen />);
    expect(screen.getByTestId('AUTH-05.subtitle')).toHaveTextContent('geschickt', { exact: false });
    expect(screen.getByTestId('AUTH-05.resend')).toBeDisabled();
    expect(screen.getByTestId('AUTH-05.resendWait')).toBeTruthy();
  });

  it('arriving any other way: nothing claims a mail, and a new code can be requested at once', async () => {
    signIn();
    stubFetch({ '/auth/me': { body: { data: { ...ME, email_verified: false, next_step: 'verify_email' } } } });
    await renderScreen(<VerifyEmailScreen />);
    await waitFor(() => expect(screen.getByTestId('AUTH-05.subtitle')).toHaveTextContent(EMAIL.slice(0, 5), { exact: false }));
    expect(screen.getByTestId('AUTH-05.subtitle')).toHaveTextContent('Der Code gilt 10 Minuten.', { exact: false });
    expect(screen.getByTestId('AUTH-05.subtitle')).not.toHaveTextContent('geschickt', { exact: false });
    // No "Schau in dein Postfach" for a mail that was never sent, and the resend link below is not repeated in the subtitle.
    expect(screen.getByTestId('AUTH-05.title')).toHaveTextContent('Bestätige deine E-\u2060Mail-Adresse');
    expect(screen.getByTestId('AUTH-05.subtitle')).not.toHaveTextContent('anfordern', { exact: false });
    expect(screen.getByTestId('AUTH-05.resend')).not.toBeDisabled();
    expect(screen.queryByTestId('AUTH-05.resendWait')).toBeNull();
  });

  it('sends nothing by itself on arrival', async () => {
    signIn();
    const { calls } = stubFetch({ '/auth/me': { body: { data: { ...ME, email_verified: false, next_step: 'verify_email' } } } });
    await renderScreen(<VerifyEmailScreen />);
    await waitFor(() => expect(calls.some((request) => request.url.endsWith('/auth/me'))).toBe(true));
    expect(calls.filter((request) => request.url.endsWith('/auth/email/resend'))).toEqual([]);
  });
});

describe('AUTH-05 for a signed-in member who browses (BH-29)', () => {
  it('goes back to the page the member came from, and forgets a path kept for after the steps', async () => {
    signIn();
    useSessionStore.setState({ intent: { returnTo: '/garage' } });
    stubFetch({ '/auth/me': { body: { data: { ...ME, email_verified: false, next_step: 'verify_email' } } } });
    await renderScreen(<VerifyEmailScreen />);
    await fireEvent.press(screen.getByTestId('AUTH-05.header.back'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(useSessionStore.getState().intent).toBeNull();
  });

  it('goes to Home when there is nothing to go back to, and keeps what the member asked for with an action', async () => {
    signIn();
    const follow = jest.fn();
    useSessionStore.setState({ intent: { action: follow, returnTo: '/v/skyline' } });
    mockRouter.canGoBack.mockReturnValue(false);
    try {
      stubFetch({ '/auth/me': { body: { data: { ...ME, email_verified: false, next_step: 'verify_email' } } } });
      await renderScreen(<VerifyEmailScreen />);
      await fireEvent.press(screen.getByTestId('AUTH-05.header.back'));
      expect(mockRouter.replace).toHaveBeenCalledWith('/');
      expect(mockRouter.back).not.toHaveBeenCalled();
      expect(useSessionStore.getState().intent).toEqual({ action: follow, returnTo: '/v/skyline' });
    } finally {
      mockRouter.canGoBack.mockReturnValue(true);
    }
  });
});

describe('AUTH-07 reset password', () => {
  async function fillAndSave() {
    await fireEvent.changeText(screen.getByTestId('AUTH-07.code'), '654321');
    await fireEvent.changeText(screen.getByTestId('AUTH-07.password'), PASSWORD);
    await fireEvent.changeText(screen.getByTestId('AUTH-07.passwordRepeat'), PASSWORD);
    await fireEvent.press(screen.getByTestId('AUTH-07.cta.primary'));
  }

  it('takes code and address from the route (the native mail link)', async () => {
    mockParams = { email: EMAIL, code: '12 34 56' };
    await renderScreen(<ResetPasswordScreen />);
    expect(screen.getByTestId('AUTH-07.email').props.value).toBe(EMAIL);
    expect(screen.getByTestId('AUTH-07.code').props.value).toBe('123456');
  });

  it('sends a guest on to sign-in with the address after a reset', async () => {
    mockParams = { email: EMAIL };
    const { calls } = stubFetch({ '/auth/password/reset': { body: { data: { next: 'sign_in', email: EMAIL, resend_after_seconds: null } } } });
    await renderScreen(<ResetPasswordScreen />);
    await fillAndSave();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    expect(handedEmailFor('/sign-in')).toBe(EMAIL);
    expect(await bodiesTo(calls, '/auth/password/reset')).toEqual([{ email: EMAIL, code: '654321', password: PASSWORD }]);
  });

  it('ends the session of a member who reset while signed in, quietly, before sign-in opens', async () => {
    signIn();
    queryClient.setQueryData(meKey, ME);
    mockParams = { email: EMAIL };
    stubFetch({ '/auth/password/reset': { body: { data: { next: 'sign_in', email: EMAIL, resend_after_seconds: null } } } });
    await renderScreen(<ResetPasswordScreen />);
    await fillAndSave();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    // The session ended first, so the hand-off made after it survives for the sign-in screen.
    expect(handedEmailFor('/sign-in')).toBe(EMAIL);
    expect(useSessionStore.getState()).toMatchObject({ status: 'guest', member: null, notice: null });
    expect(mockKeychain.has('sc.authToken')).toBe(false);
  });

  it('matches the address whatever its case (BH-33)', async () => {
    signIn();
    queryClient.setQueryData(meKey, ME);
    mockParams = { email: EMAIL.toUpperCase() };
    stubFetch({ '/auth/password/reset': { body: { data: { next: 'sign_in', email: EMAIL, resend_after_seconds: null } } } });
    await renderScreen(<ResetPasswordScreen />);
    await fillAndSave();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(useSessionStore.getState().status).toBe('guest');
  });

  it('leaves the session of another address alone: the server did not end it (BH-33)', async () => {
    signIn();
    queryClient.setQueryData(meKey, ME);
    mockParams = { email: 'someone.else@speedclub.test' };
    stubFetch({ '/auth/password/reset': { body: { data: { next: 'sign_in', email: 'someone.else@speedclub.test', resend_after_seconds: null } } } });
    await renderScreen(<ResetPasswordScreen />);
    await fillAndSave();
    // Back to where the member came from, with no sign-in in between: signing in with that password needs a sign-out here first.
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', member: { id: ME.id } });
    expect(mockKeychain.get('sc.authToken')).toBe('token-1');
    const { result, unmount } = await renderHook(() => useCurrentToast());
    expect(result.current?.message).toBe('Das Passwort für someone.else@speedclub.test ist geändert.');
    await unmount();
    dismissToast();
  });

  it('goes home after a reset for another address when there is nothing to go back to (BH-33)', async () => {
    signIn();
    queryClient.setQueryData(meKey, ME);
    mockParams = { email: 'someone.else@speedclub.test' };
    mockRouter.canGoBack.mockReturnValue(false);
    try {
      stubFetch({ '/auth/password/reset': { body: { data: { next: 'sign_in', email: 'someone.else@speedclub.test', resend_after_seconds: null } } } });
      await renderScreen(<ResetPasswordScreen />);
      await fillAndSave();
      await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
      expect(useSessionStore.getState().status).toBe('member');
    } finally {
      mockRouter.canGoBack.mockReturnValue(true);
      dismissToast();
    }
  });

  it('leaves the session alone when it cannot tell whose it is (BH-33)', async () => {
    signIn();
    mockParams = { email: EMAIL };
    stubFetch({ '/auth/password/reset': { body: { data: { next: 'sign_in', email: EMAIL, resend_after_seconds: null } } } });
    await renderScreen(<ResetPasswordScreen />);
    await fillAndSave();
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(useSessionStore.getState().status).toBe('member');
  });

  it('puts a wrong code on the code field', async () => {
    mockParams = { email: EMAIL };
    stubFetch({ '/auth/password/reset': error(422, 'invalid_code') });
    await renderScreen(<ResetPasswordScreen />);
    await fillAndSave();
    await waitFor(() =>
      expect(screen.getByTestId('AUTH-07.code.error')).toHaveTextContent(
        'Der Code stimmt nicht oder ist nicht mehr gültig. Prüfe ihn oder fordere einen neuen an.',
      ),
    );
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('AUTH-08 username', () => {
  it('puts the server’s 422 on the field, with no notice besides', async () => {
    signIn();
    stubFetch({
      '/usernames/check': { body: { data: { username: 'nina.neu', available: true, reason: null } } },
      '/me/username': { status: 422, body: { message: 'Prüfe deine Eingaben.', code: 'validation_failed', errors: { username: ['Dieser Name ist schon vergeben. Wähle einen anderen.'] } } },
    });
    await renderScreen(<UsernameScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-08.username'), 'nina.neu');
    await fireEvent.press(screen.getByTestId('AUTH-08.cta.primary'));
    await waitFor(() => expect(screen.getByText('Dieser Name ist schon vergeben. Wähle einen anderen.')).toBeTruthy());
    expect(screen.queryByTestId('AUTH-08.notice')).toBeNull();
  });
});

describe('AUTH-09 profile setup', () => {
  it('sends exactly an empty patch for "Überspringen", and opens no wizard', async () => {
    signIn();
    const { calls } = stubFetch({ '/auth/me': { body: { data: ME } }, '/me/profile': { body: { data: { ...ME, next_step: null, profile_complete: true } } } });
    await renderScreen(<ProfileSetupScreen />);
    await fireEvent.press(screen.getByTestId('AUTH-09.skip'));
    await waitFor(async () => expect(await bodiesTo(calls, '/me/profile')).toEqual([{}]));
    expect(calls.find((request) => request.url.endsWith('/me/profile'))?.method).toBe('PATCH');
    expect(consumeAfterOnboarding()).toBeNull();
  });

  it('takes one way out at a time: no skip while "Weiter" is under way', async () => {
    signIn();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls } = stubFetch({ '/auth/me': { body: { data: ME } } });
    const answer = globalThis.fetch as jest.Mock;
    const stubbed = answer.getMockImplementation() as (input: Request) => Promise<Response>;
    answer.mockImplementation(async (input: Request) => {
      if (!input.url.endsWith('/me/profile')) return stubbed(input);
      calls.push(input);
      await held;
      return new Response(JSON.stringify({ data: { ...ME, display_name: 'Lukas', next_step: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await renderScreen(<ProfileSetupScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-09.displayName'), 'Lukas');
    await fireEvent.press(screen.getByTestId('AUTH-09.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('AUTH-09.skip')).toBeDisabled());
    await fireEvent.press(screen.getByTestId('AUTH-09.skip'));

    await act(async () => {
      release();
      await held;
    });
    await waitFor(() => expect(useSessionStore.getState().member?.displayName).toBe('Lukas'));
    expect(await bodiesTo(calls, '/me/profile')).toEqual([{ display_name: 'Lukas', city: null }]);
    expect(consumeAfterOnboarding()).toBe(WIZARD_PATH);
  });

  it('shows the spinner from the pick on and takes no second pick while the photo is prepared (DQ-260)', async () => {
    signIn();
    stubFetch({ '/auth/me': { body: { data: ME } } });
    let fail: (reason: Error) => void = () => undefined;
    mockAvatar.pick = jest.fn(async () => ({ uri: 'file:///picked.jpg', width: 1200, height: 1200 }));
    mockAvatar.form = jest.fn(
      () =>
        new Promise<FormData>((_, reject) => {
          fail = reject;
        }),
    );
    try {
      await renderScreen(<ProfileSetupScreen />);
      await act(async () => fireEvent.press(screen.getByTestId('AUTH-09.pickAvatar')));
      await waitFor(() => expect(screen.getByTestId('AUTH-09.avatarBusy')).toBeTruthy());
      expect(screen.getByTestId('AUTH-09.pickAvatar')).toBeDisabled();
      expect(screen.getByTestId('AUTH-09.cta.primary')).toBeDisabled();
      await act(async () => fireEvent.press(screen.getByTestId('AUTH-09.pickAvatar')));
      expect(mockAvatar.pick).toHaveBeenCalledTimes(1);

      await act(async () => fail(new Error('decode failed')));
      await waitFor(() => expect(screen.getByTestId('AUTH-09.avatarError')).toBeTruthy());
      expect(screen.queryByTestId('AUTH-09.avatarBusy')).toBeNull();
      expect(screen.getByTestId('AUTH-09.pickAvatar')).not.toBeDisabled();
    } finally {
      mockAvatar.pick = null;
      mockAvatar.form = null;
    }
  });
});
