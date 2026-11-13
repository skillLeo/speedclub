// M4.6 Auth 2.0 screens: AUTH-02 (providers), AUTH-12, AUTH-13, WEB-12, AUTH-09b, AUTH-16, AUTH-14, SET-19, the reauth sheet and OTPInput.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { meKey, type Me } from '@/api/queries/auth';
import { useRecentAuthStore } from '@/api/queries/recentAuth';
import { queryClient } from '@/api/queryClient';
import { RecentAuthHost } from '@/features/auth/RecentAuthHost';
import { attemptFrom, forgetEmailAttempt, heldEmailAttempt, holdEmailAttempt } from '@/features/auth/emailAttempt';
import { forgetLinkStep, holdLinkStep } from '@/features/auth/linkStep';
import { usePasskeyOfferStore } from '@/features/auth/passkeyOffer';
import { CodeEntryScreen } from '@/features/auth/screens/CodeEntryScreen';
import { EmailEntryScreen } from '@/features/auth/screens/EmailEntryScreen';
import { FinishScreen } from '@/features/auth/screens/FinishScreen';
import { LinkAccountScreen } from '@/features/auth/screens/LinkAccountScreen';
import { MagicLinkScreen } from '@/features/auth/screens/MagicLinkScreen';
import { PasskeyOfferScreen } from '@/features/auth/screens/PasskeyOfferScreen';
import { WelcomeScreen } from '@/features/auth/screens/WelcomeScreen';
import { SignInMethodsScreen } from '@/features/settings/screens/SignInMethodsScreen';
import { setGuest, setMember, useSessionStore } from '@/state/session';
import { Text } from '@/ui';
import { OTPInput } from '@/ui/OTPInput';
import { hydrateThemePreference, ThemeProvider } from '@/theme';
import { useCurrentToast, dismissToast } from '@/ui/toast';

import { newQueryClient, renderScreen as renderWith, stubFetch, type Answer } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
const mockKeychain = new Map<string, string>();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/settings/security/sign-in',
  usePreventRemove: jest.fn(),
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
jest.mock('expo-crypto', () => ({
  randomUUID: () => '0d4c6a0e-7a3b-4c1e-9d55-3f1a2b3c4d5e',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  digestStringAsync: jest.fn(async () => 'hash'),
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  AndroidHaptics: {},
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// DQ-1003: the skeleton cells (qaState=loading) of the auth screens.
const mockQa: { state: string } = { state: 'default' };
jest.mock('@/lib/qa', () => ({ ...jest.requireActual<object>('@/lib/qa'), useQaState: () => mockQa.state }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const EMAIL = 'sven.e30@speedclub.test';
const ATTEMPT = '0d4c6a0e-7a3b-4c1e-9d55-3f1a2b3c4d5e';

const ME: Me = {
  id: '01m6f7ztzfs0gd39t08rs9zmmp',
  email: EMAIL,
  email_verified: true,
  is_sample: false,
  is_editorial: false,
  has_username: true,
  profile_complete: true,
  next_step: null,
  force_password_change: false,
  password_set: true,
  two_factor_enabled: false,
  username: 'sven.e30',
  username_change_available_at: null,
  display_name: 'Sven',
  city: null,
  bio: null,
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'ps_kw',
  member_since: '2024-03-12T10:00:00+00:00',
  stats: { vehicles: 1, followers: 0, following: 0 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
};

const NEW_ME: Me = { ...ME, has_username: false, username: null, profile_complete: false, next_step: 'accept_terms', password_set: false };

const error = (status: number, code: string, extra: Record<string, unknown> = {}): Answer => ({
  status,
  body: { message: 'Vom Server.', code, errors: {}, ...extra },
});

const session = (member: Me, next: string, isNew = false): Answer => ({
  body: { data: { token: 'token-new', token_expires_at: null, member, is_new: isNew, next } },
});

async function bodiesTo(calls: Request[], path: string, method = 'POST'): Promise<Record<string, unknown>[]> {
  const matching = calls.filter((request) => request.method === method && new URL(request.url).pathname.endsWith(path));
  return Promise.all(matching.map(async (request) => JSON.parse((await request.clone().text()) || '{}') as Record<string, unknown>));
}

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) => renderWith(element, client);

function withFlags(flags: Record<string, boolean>, legal: Record<string, string> = {}) {
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags, legal_versions: legal }, confirmed: true });
}

function signIn(me: Me = ME) {
  mockKeychain.set('sc.authToken', 'token-1');
  setMember({ id: me.id, username: me.username ?? '', displayName: me.display_name, avatarUrl: null, nextStep: me.next_step });
  client.setQueryData(meKey, me);
}

function ToastProbe() {
  const current = useCurrentToast();
  return current ? <Text variant="body">{current.message}</Text> : null;
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  mockQa.state = 'default';
  mockParams = {};
  mockKeychain.clear();
  forgetEmailAttempt();
  forgetLinkStep();
  usePasskeyOfferStore.setState({ state: 'idle', offeredBefore: null });
  useRecentAuthStore.setState({ pending: null });
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null, notice: null, passwordChangeEmail: null });
});
afterEach(() => {
  client.clear();
  queryClient.clear();
  dismissToast();
});
afterAll(() => setGuest());

describe('AUTH-02 Welcome 2.0', () => {
  it('offers E-Mail always, no password field and no red; providers stay hidden while their flags are off', async () => {
    await renderScreen(<WelcomeScreen />);
    expect(screen.getByTestId('AUTH-02.provider.email')).toBeTruthy();
    expect(screen.queryByTestId('AUTH-02.provider.apple')).toBeNull();
    expect(screen.queryByTestId('AUTH-02.provider.google')).toBeNull();
    expect(screen.queryByTestId('AUTH-02.provider.passkey')).toBeNull();
    expect(screen.getByTestId('AUTH-02.privacy')).toBeTruthy();
    expect(screen.getByTestId('AUTH-02.terms')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('AUTH-02.provider.email'));
    expect(mockRouter.push).toHaveBeenCalledWith('/auth/email');
  });

  it('native without the provider modules: the flags alone show nothing that cannot work', async () => {
    withFlags({ 'auth.apple': true, 'auth.google': true, 'auth.passkeys': true });
    await renderScreen(<WelcomeScreen />);
    expect(screen.queryByTestId('AUTH-02.provider.apple')).toBeNull();
    expect(screen.queryByTestId('AUTH-02.provider.google')).toBeNull();
    expect(screen.queryByTestId('AUTH-02.provider.passkey')).toBeNull();
  });
});

describe('AUTH-12 e-mail entry', () => {
  it('sends the code with a new attempt and goes to AUTH-13', async () => {
    const { calls } = stubFetch({ '/auth/email/start': { status: 202, body: { data: { attempt_id: ATTEMPT, resend_after: 30 } } } });
    await renderScreen(<EmailEntryScreen />);
    expect(screen.getByText('Mit E-⁠Mail fortfahren')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('AUTH-12.email'), EMAIL);
    await fireEvent.press(screen.getByTestId('AUTH-12.cta.primary'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/auth/code'));
    expect(await bodiesTo(calls, '/auth/email/start')).toEqual([{ email: EMAIL, attempt_id: ATTEMPT, locale: 'de' }]);
    expect(heldEmailAttempt()).toMatchObject({ attemptId: ATTEMPT, email: EMAIL });
  });

  it('validates inline before sending anything', async () => {
    const { calls } = stubFetch({});
    await renderScreen(<EmailEntryScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-12.email'), 'sven@');
    await fireEvent.press(screen.getByTestId('AUTH-12.cta.primary'));
    expect(await screen.findByText('Das sieht nicht nach einer E-\u2060Mail-Adresse aus.')).toBeTruthy();
    expect(await bodiesTo(calls, '/auth/email/start')).toHaveLength(0);
  });

  it('rate limited: says how long, and rests the button', async () => {
    stubFetch({ '/auth/email/start': error(429, 'rate_limited', { retry_after: 120 }) });
    await renderScreen(<EmailEntryScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-12.email'), EMAIL);
    await fireEvent.press(screen.getByTestId('AUTH-12.cta.primary'));
    expect(await screen.findByTestId('AUTH-12.notice')).toHaveTextContent(/2 Minuten/);
  });

  it('leads to AUTH-03 while password sign-in is on, and hides it when the flag is off', async () => {
    stubFetch({});
    await renderScreen(<EmailEntryScreen />);
    await fireEvent.press(screen.getByTestId('AUTH-12.withPassword'));
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
    withFlags({ 'auth.password_login': false });
    await renderScreen(<EmailEntryScreen />);
    expect(screen.queryAllByTestId('AUTH-12.withPassword')).toHaveLength(0);
  });
});

describe('AUTH-13 code entry', () => {
  const hold = () => holdEmailAttempt(attemptFrom(ATTEMPT, EMAIL, 30));

  it('without an attempt, goes back to AUTH-12', async () => {
    stubFetch({});
    await renderScreen(<CodeEntryScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/auth/email'));
  });

  it('shows the masked address and the resend timer in tnum m:ss', async () => {
    hold();
    stubFetch({});
    await renderScreen(<CodeEntryScreen />);
    // identifierText puts break opportunities into the address; the text reads the same.
    expect(screen.getByTestId('AUTH-13.subtitle')).toHaveTextContent(/Gesendet an s•••@\u200b?speedclub/);
    expect(screen.getByTestId('AUTH-13.resend')).toHaveTextContent(/Neuen Code in 0:(30|29)/);
  });

  it('a wrong code shakes, clears, and names the attempts left', async () => {
    hold();
    stubFetch({ '/auth/email/verify': error(422, 'invalid_code', { attempts_left: 3 }) });
    await renderScreen(<CodeEntryScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-13.code'), '123456');
    expect(await screen.findByText('Der Code stimmt nicht. Noch 3 Versuche.')).toBeTruthy();
    expect(screen.getByTestId('AUTH-13.code').props.value).toBe('');
  });

  it('expired: says so', async () => {
    hold();
    stubFetch({ '/auth/email/verify': error(422, 'code_expired') });
    await renderScreen(<CodeEntryScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-13.code'), '123456');
    expect(await screen.findByText('Der Code ist abgelaufen. Fordere einen neuen an.')).toBeTruthy();
  });

  it('locked: the running time left, the cells rest, and no new code is offered (DQ-1004)', async () => {
    hold();
    stubFetch({ '/auth/email/verify': error(429, 'email_code_locked', { retry_after: 900 }) });
    await renderScreen(<CodeEntryScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-13.code'), '123456');
    expect(await screen.findByTestId('AUTH-13.notice')).toHaveTextContent(/Wieder möglich in 1[45]:\d\d\./);
    expect(screen.getByTestId('AUTH-13.code').props.editable).toBe(false);
    expect(screen.getByTestId('AUTH-13.code').props['aria-disabled']).toBe(true);
    expect(screen.queryByTestId('AUTH-13.resend')).toBeNull();
    expect(screen.getByTestId('AUTH-13.changeEmail')).toBeTruthy();
  });

  it('a right code signs in a new account with the attempt, and the session names the AGB step', async () => {
    hold();
    const { calls } = stubFetch({ '/auth/email/verify': session(NEW_ME, 'terms', true) });
    await renderScreen(<CodeEntryScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-13.code'), '654321');
    await waitFor(() => expect(useSessionStore.getState().status).toBe('member'));
    expect(useSessionStore.getState().member?.nextStep).toBe('accept_terms');
    expect(await bodiesTo(calls, '/auth/email/verify')).toEqual([
      expect.objectContaining({ email: EMAIL, attempt_id: ATTEMPT, code: '654321', locale: 'de' }),
    ]);
  });

  it('two-factor on: holds the challenge and opens AUTH-11', async () => {
    hold();
    stubFetch({ '/auth/email/verify': { body: { data: { two_factor_required: true, challenge: 'ch-1', expires_in: 300 } } } });
    await renderScreen(<CodeEntryScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-13.code'), '654321');
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/two-factor'));
  });

  it('a resend keeps the attempt and starts the next cooldown', async () => {
    holdEmailAttempt(attemptFrom(ATTEMPT, EMAIL, 0));
    const { calls } = stubFetch({ '/auth/email/start': { status: 202, body: { data: { attempt_id: ATTEMPT, resend_after: 60 } } } });
    await renderScreen(<CodeEntryScreen />);
    await fireEvent.press(screen.getByTestId('AUTH-13.resend'));
    await waitFor(() => expect(screen.getByTestId('AUTH-13.resend')).toHaveTextContent(/Neuen Code in (1:00|0:59)/));
    expect(await bodiesTo(calls, '/auth/email/start')).toEqual([expect.objectContaining({ attempt_id: ATTEMPT, email: EMAIL })]);
  });
});

describe('WEB-12 magic link', () => {
  it('on another device: tells the member to type the code there', async () => {
    mockParams = { t: 'AbcDefGhiJklMnoPqrStuVwxYz0123456789_-abcd' };
    stubFetch({});
    await renderScreen(<MagicLinkScreen />);
    expect(await screen.findByText('Gib den Code in der App ein')).toBeTruthy();
  });

  it('on the same device: signs in with the token and the kept attempt', async () => {
    holdEmailAttempt(attemptFrom(ATTEMPT, EMAIL, 30));
    mockParams = { t: 'AbcDefGhiJklMnoPqrStuVwxYz0123456789_-abcd' };
    const { calls } = stubFetch({ '/auth/email/verify': session(ME, 'done') });
    await renderScreen(<MagicLinkScreen />);
    await waitFor(() => expect(useSessionStore.getState().status).toBe('member'));
    expect(await bodiesTo(calls, '/auth/email/verify')).toEqual([
      expect.objectContaining({ attempt_id: ATTEMPT, email: EMAIL, magic_token: 'AbcDefGhiJklMnoPqrStuVwxYz0123456789_-abcd' }),
    ]);
  });

  it('a spent link: offers the code and a new one', async () => {
    holdEmailAttempt(attemptFrom(ATTEMPT, EMAIL, 30));
    mockParams = { t: 'AbcDefGhiJklMnoPqrStuVwxYz0123456789_-abcd' };
    stubFetch({ '/auth/email/verify': error(422, 'code_expired') });
    await renderScreen(<MagicLinkScreen />);
    expect(await screen.findByTestId('WEB-12.enterCode')).toBeTruthy();
    expect(screen.getByTestId('WEB-12.notice')).toHaveTextContent(/abgelaufen/);
  });
});

describe('AUTH-09b Fast geschafft', () => {
  beforeEach(() => signIn(NEW_ME));

  it('needs both boxes, then accepts the published versions with the age line', async () => {
    withFlags({}, { terms: '3', privacy: '2' });
    const { calls } = stubFetch({ '/me/onboarding/accept': { body: { data: { ...NEW_ME, next_step: 'choose_username' } } } });
    await renderScreen(<FinishScreen />);
    await fireEvent.press(screen.getByTestId('AUTH-09b.cta.primary'));
    expect(await screen.findByTestId('AUTH-09b.ageConfirmed.error')).toBeTruthy();
    expect(screen.getByTestId('AUTH-09b.termsAccepted.error')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
    await fireEvent.press(screen.getByTestId('AUTH-09b.ageConfirmed'));
    await fireEvent.press(screen.getByTestId('AUTH-09b.termsAccepted'));
    await fireEvent.press(screen.getByTestId('AUTH-09b.cta.primary'));
    await waitFor(() => expect(useSessionStore.getState().member?.nextStep).toBe('choose_username'));
    expect(await bodiesTo(calls, '/me/onboarding/accept')).toEqual([{ terms_version: '3', privacy_version: '2', age_confirmed: true }]);
  });

  it('links AGB and Datenschutz inside the one sentence', async () => {
    withFlags({}, { terms: '3', privacy: '2' });
    stubFetch({});
    await renderScreen(<FinishScreen />);
    expect(screen.getByTestId('AUTH-09b.termsAccepted.read')).toHaveTextContent('AGB');
    expect(screen.getByTestId('AUTH-09b.termsAccepted.read1')).toHaveTextContent('Datenschutzerklärung');
  });

  it('a new version went out meanwhile: loads it and asks again', async () => {
    withFlags({}, { terms: '3', privacy: '2' });
    stubFetch({ '/me/onboarding/accept': { status: 422, body: { message: 'Veraltet.', code: 'validation_failed', errors: { terms_version: ['Veraltet.'] } } } });
    await renderScreen(<FinishScreen />);
    await fireEvent.press(screen.getByTestId('AUTH-09b.ageConfirmed'));
    await fireEvent.press(screen.getByTestId('AUTH-09b.termsAccepted'));
    await fireEvent.press(screen.getByTestId('AUTH-09b.cta.primary'));
    expect(await screen.findByTestId('AUTH-09b.notice')).toHaveTextContent(/aktualisiert/);
  });
});

describe('AUTH-16 Konto verknüpfen', () => {
  it('links only with the code, and says so', async () => {
    holdLinkStep({ link_required: true, provider: 'google', attempt_id: ATTEMPT, email_hint: 's•••@gmail.com', resend_after: 30 });
    const { calls } = stubFetch({ '/auth/link/confirm': session(ME, 'done') });
    await renderScreen(
      <>
        <LinkAccountScreen />
        <ToastProbe />
      </>,
    );
    expect(screen.getByTestId('AUTH-16.subtitle')).toHaveTextContent(/Google/);
    await fireEvent.changeText(screen.getByTestId('AUTH-16.code'), '111222');
    expect(await screen.findByText('Google ist jetzt mit deinem Konto verbunden.')).toBeTruthy();
    expect(await bodiesTo(calls, '/auth/link/confirm')).toEqual([expect.objectContaining({ attempt_id: ATTEMPT, code: '111222' })]);
  });

  it('without the held step, goes back to Welcome', async () => {
    stubFetch({});
    await renderScreen(<LinkAccountScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/welcome'));
  });
});

describe('AUTH-14 Passkey anbieten', () => {
  it('"Später" ends the offer on this device', async () => {
    signIn();
    stubFetch({});
    await renderScreen(<PasskeyOfferScreen />);
    // DQ-994: the stack is a picture of AUTH-02, hidden from assistive tech, the passkey marked; it comes before the title.
    expect(screen.getByTestId('AUTH-14.stack.passkey.marked', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: 'Mit E-Mail fortfahren' })).toHaveLength(0);
    const order = screen.toJSON();
    const json = JSON.stringify(order);
    expect(json.indexOf('AUTH-14.fragment')).toBeLessThan(json.indexOf('AUTH-14.title'));
    await fireEvent.press(screen.getByTestId('AUTH-14.later'));
    expect(usePasskeyOfferStore.getState().state).toBe('answered');
  });
});

describe('design QA M4.6 round 2', () => {
  it('DQ-1003: a skeleton draws the fields its screen has: one on AUTH-12', async () => {
    mockQa.state = 'loading';
    stubFetch({});
    await renderScreen(<EmailEntryScreen />);
    expect(screen.getByTestId('AUTH-12.skeleton', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getAllByTestId('AUTH-12.skeleton.field', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('DQ-1007: AUTH-14 puts its body in the subtitle slot under the title', async () => {
    signIn();
    stubFetch({});
    await renderScreen(<PasskeyOfferScreen />);
    expect(screen.getByTestId('AUTH-14.subtitle')).toHaveTextContent(/Face ID, Touch ID oder Fingerabdruck/);
    expect(screen.queryByTestId('AUTH-14.body')).toBeNull();
  });

  it('DQ-999: a passkey with only the fallback name is never quoted, and its rename field starts empty', async () => {
    signIn();
    withFlags({ 'auth.passkeys': true });
    const native = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>('@react-native/jest-preset/jest/MockNativeMethods');
    native.default.measureInWindow.mockImplementation((done: (x: number, y: number, width: number, height: number) => void) => done(300, 400, 44, 44));
    const GENERIC = { id: '01jpasskey0000000000000009', name: 'Passkey', provider: null, provider_icon: null, synced: false, last_used_at: null, created_at: '2026-06-14T10:00:00Z' };
    stubFetch({ '/me/passkeys': { body: { data: [GENERIC] } } });
    await renderScreen(<SignInMethodsScreen />);
    await fireEvent.press(await screen.findByTestId(`SET-19.passkey.${GENERIC.id}.more`));
    await fireEvent.press(await screen.findByTestId(`SET-19.passkey.${GENERIC.id}.more.menu.remove`));
    expect(screen.getByTestId('SET-19.dialog')).toHaveTextContent(/Passkey entfernen\?/);
    expect(screen.getByTestId('SET-19.dialog')).not.toHaveTextContent(/„Passkey“/);
    await fireEvent.press(screen.getByTestId('SET-19.dialog.cancel'));
    await fireEvent.press(screen.getByTestId(`SET-19.passkey.${GENERIC.id}.more`));
    await fireEvent.press(await screen.findByTestId(`SET-19.passkey.${GENERIC.id}.more.menu.rename`));
    expect((await screen.findByTestId('SET-19.renameSheet.name')).props.value ?? '').toBe('');
  });
});

describe('SET-19 Anmeldung & Passkeys', () => {
  // The "···" menu opens at its trigger's place, which the jest mocks of the native methods never report.
  beforeEach(() => {
    const native = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>('@react-native/jest-preset/jest/MockNativeMethods');
    native.default.measureInWindow.mockImplementation((done: (x: number, y: number, width: number, height: number) => void) => done(300, 400, 44, 44));
  });

  const PASSKEY = {
    id: '01jpasskey0000000000000001',
    name: 'MacBook Pro',
    provider: 'iCloud-Schlüsselbund',
    provider_icon: 'apple',
    synced: true,
    last_used_at: null,
    created_at: '2026-06-14T10:00:00Z',
  };

  beforeEach(() => signIn());

  it('lists the e-mail code, the password and the passkeys', async () => {
    withFlags({ 'auth.passkeys': true });
    stubFetch({ '/me/passkeys': { body: { data: [PASSKEY] } } });
    await renderScreen(<SignInMethodsScreen />);
    expect(await screen.findByTestId(`SET-19.passkey.${PASSKEY.id}`)).toBeTruthy();
    expect(screen.getByTestId('SET-19.emailCode')).toBeTruthy();
    expect(screen.getByTestId('SET-19.password')).toBeTruthy();
    expect(screen.getByText(/iCloud-Schlüsselbund · Angelegt am/)).toBeTruthy();
  });

  it('empty: a sample row badged Beispiel, never a grey state', async () => {
    withFlags({ 'auth.passkeys': true });
    stubFetch({ '/me/passkeys': { body: { data: [] } } });
    await renderScreen(<SignInMethodsScreen />);
    expect(await screen.findByTestId('SET-19.passkeys.empty')).toBeTruthy();
    expect(screen.getByText('Beispiel')).toBeTruthy();
  });

  it('removing asks for recent authentication, and goes through after the password', async () => {
    withFlags({ 'auth.passkeys': true });
    let deletes = 0;
    const { calls } = stubFetch({
      [`/me/passkeys/${PASSKEY.id}`]: () => {
        deletes += 1;
        return deletes === 1
          ? error(403, 'reauthentication_required', { methods: ['email_code', 'password'] })
          : { status: 200, body: {} };
      },
      '/me/passkeys': { body: { data: [PASSKEY] } },
      '/me/reauth/email': { status: 202, body: { data: { attempt_id: ATTEMPT, resend_after: 30 } } },
      '/me/reauth': { body: { data: { reauthenticated_until: '2026-11-12T10:10:00Z' } } },
    });
    await renderScreen(
      <>
        <SignInMethodsScreen />
        <RecentAuthHost />
      </>,
    );
    // DQ-996: rename and remove sit in the row's "···" menu.
    await fireEvent.press(await screen.findByTestId(`SET-19.passkey.${PASSKEY.id}.more`));
    await fireEvent.press(await screen.findByTestId(`SET-19.passkey.${PASSKEY.id}.more.menu.remove`));
    await fireEvent.press(screen.getByTestId('SET-19.dialog.confirm'));
    // The server's first method is the e-mail code; the member switches to the password.
    expect(await screen.findByTestId('REAUTH.sheet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('REAUTH.switch.password'));
    await fireEvent.changeText(screen.getByTestId('REAUTH.password'), 'Boxer-Motor-2002');
    await fireEvent.press(screen.getByTestId('REAUTH.confirm'));
    await waitFor(() => expect(deletes).toBe(2));
    expect(await bodiesTo(calls, '/me/reauth')).toEqual([{ method: 'password', password: 'Boxer-Motor-2002' }]);
    await waitFor(() => expect(screen.queryByTestId(`SET-19.passkey.${PASSKEY.id}`)).toBeNull());
  });

  it('the last way in stays: says why', async () => {
    withFlags({ 'auth.passkeys': true });
    stubFetch({ [`/me/passkeys/${PASSKEY.id}`]: error(409, 'last_sign_in_method'), '/me/passkeys': { body: { data: [PASSKEY] } } });
    await renderScreen(
      <>
        <SignInMethodsScreen />
        <ToastProbe />
      </>,
    );
    // DQ-996: rename and remove sit in the row's "···" menu.
    await fireEvent.press(await screen.findByTestId(`SET-19.passkey.${PASSKEY.id}.more`));
    await fireEvent.press(await screen.findByTestId(`SET-19.passkey.${PASSKEY.id}.more.menu.remove`));
    await fireEvent.press(screen.getByTestId('SET-19.dialog.confirm'));
    expect(await screen.findByText('Das ist dein letzter Weg ins Konto. Leg zuerst einen anderen fest.')).toBeTruthy();
  });

  it('error + retry', async () => {
    withFlags({ 'auth.passkeys': true });
    stubFetch({ '/me/passkeys': error(500, 'server') });
    await renderScreen(<SignInMethodsScreen />);
    expect(await screen.findByTestId('SET-19.error')).toBeTruthy();
  });

  it('native without a passkey module: says where passkeys work', async () => {
    withFlags({ 'auth.passkeys': true });
    stubFetch({ '/me/passkeys': { body: { data: [] } } });
    await renderScreen(<SignInMethodsScreen />);
    expect(await screen.findByTestId('SET-19.notHere')).toBeTruthy();
  });
});

describe('OTPInput (09 §5)', () => {
  it('a refusal plays the warning haptic once; success resolves into the check with the success haptic', async () => {
    const onChange = jest.fn();
    // The same tree on every render: a remount would start the refusal count afresh.
    const themed = (element: React.ReactElement) => (
      <QueryClientProvider client={client}>
        <ThemeProvider>{element}</ThemeProvider>
      </QueryClientProvider>
    );
    const view = await render(themed(<OTPInput value="" onChange={onChange} label="Code" errorKey={0} testID="T.code" />));
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    await view.rerender(themed(<OTPInput value="" onChange={onChange} label="Code" errorKey={1} error="Falsch" testID="T.code" />));
    await act(async () => undefined);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
    await view.rerender(themed(<OTPInput value="123456" onChange={onChange} label="Code" errorKey={1} success testID="T.code" />));
    await act(async () => undefined);
    expect(screen.getByTestId('T.code.check', { includeHiddenElements: true })).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('submits once for a full paste', async () => {
    const onComplete = jest.fn();
    await renderScreen(<OTPInput value="" onChange={jest.fn()} onComplete={onComplete} label="Code" testID="T.code" />);
    await fireEvent.changeText(screen.getByTestId('T.code'), '12 34 56');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});
