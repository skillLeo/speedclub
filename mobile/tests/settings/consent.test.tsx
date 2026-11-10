import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { api, apiData, ApiError, isConsentRequired } from '@/api/client';
import { setPreviewTokenForTests } from '@/api/preview';
import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { forgetPreviousMember } from '@/api/queries/auth';
import { ConsentHost, isLegalReading } from '@/features/consent/ConsentHost';
import { onConsentAccepted, rememberConsentClearance, resetConsentClearanceForTests, useConsentClearance } from '@/state/consent';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, stubFetch, type Answer } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() };
let mockPath = '/';
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  usePathname: () => mockPath,
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
const mockSignOut = jest.fn(() => Promise.resolve());
jest.mock('@/api/queries/auth', () => {
  const actual = jest.requireActual<typeof import('@/api/queries/auth')>('@/api/queries/auth');
  const { useMutation } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useSignOut: () => useMutation({ mutationFn: () => mockSignOut() }) };
});

const REQUIRED = {
  required: [{ key: 'terms', version: '3', summary: 'Neu: Regeln für QR-Sticker im Straßenverkehr.', published_at: '2026-11-08T09:00:00Z' }],
  accepted: { terms: '2', privacy: '4' },
  consented_at: '2026-01-02T10:00:00Z',
};
const DONE = { required: [], accepted: { terms: '3', privacy: '4' }, consented_at: '2026-11-09T10:00:00Z' };

function client(reconsent: { terms: string | null; privacy: string | null } = { terms: '3', privacy: null }) {
  const queries = newQueryClient();
  queries.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, legal_reconsent: reconsent }, confirmed: true });
  return queries;
}

async function show(answers: Record<string, Answer | (() => Answer)>, reconsent?: { terms: string | null; privacy: string | null }) {
  const stub = stubFetch(answers);
  await renderScreen(<ConsentHost />, client(reconsent));
  await act(async () => undefined);
  return stub;
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockPath = '/';
  useSessionStore.setState({ status: 'member' });
});

describe('re-consent (ADM-31)', () => {
  it('blocks with the summary and accepts the version shown', async () => {
    let accepted = false;
    const { calls } = await show({
      '/me/consents': () => {
        const answer = accepted ? DONE : REQUIRED;
        return { body: { data: answer } };
      },
    });
    expect(await screen.findByTestId('CONSENT.document.terms.summary')).toHaveTextContent('Neu: Regeln für QR-Sticker im Straßenverkehr.');
    expect(screen.getByText('Fassung 3 vom 08.11.2026')).toBeTruthy();
    accepted = true;
    await fireEvent.press(screen.getByTestId('CONSENT.accept'));
    await waitFor(() => expect(screen.queryByTestId('CONSENT.accept')).toBeNull());
    const post = calls.find((request) => request.method === 'POST');
    expect(await post?.json()).toEqual({ terms_version: '3', privacy_version: null });
  });

  it('asks nothing while app-config names no re-consent version, or for a guest', async () => {
    const { calls } = await show({ '/me/consents': { body: { data: REQUIRED } } }, { terms: null, privacy: null });
    expect(calls).toHaveLength(0);
    expect(screen.queryByTestId('CONSENT.accept')).toBeNull();
  });

  it('declining explains and signs out to Welcome', async () => {
    await show({ '/me/consents': { body: { data: REQUIRED } } });
    await fireEvent.press(await screen.findByTestId('CONSENT.decline'));
    expect(screen.getByText('Ohne Zustimmung abmelden?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('CONSENT.declineDialog.signOut'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/welcome'));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('an outdated version (422) says so and reloads the sheet', async () => {
    let posted = false;
    await show({
      '/me/consents': () => {
        if (!posted) return { body: { data: REQUIRED } };
        return { status: 422, body: { message: 'Veraltet', code: 'validation_failed', errors: { terms_version: ['Veraltet'] } } };
      },
    });
    posted = true;
    await fireEvent.press(await screen.findByTestId('CONSENT.accept'));
    expect(await screen.findByTestId('CONSENT.notice')).toHaveTextContent(/neuere Fassung/);
  });

  it('never fails open: a failed read keeps the sheet with a retry, which then shows the documents (SF-5, ADR-245)', async () => {
    let failing = true;
    const { calls } = await show({
      '/me/consents': () => (failing ? { status: 500, body: { message: 'Fehler', code: 'server_error' } } : { body: { data: REQUIRED } }),
    });
    // The sheet blocks from the first failure, while the query still retries on its own.
    expect(await screen.findByTestId('CONSENT.unavailable.notice')).toHaveTextContent(/nicht laden/);
    expect(screen.queryByTestId('CONSENT.accept')).toBeNull();
    // Once its own retry failed too, the button is free for the member's.
    await waitFor(() => expect(calls.filter((request) => request.url.endsWith('/me/consents'))).toHaveLength(2), { timeout: 4000 });
    await act(async () => undefined);
    expect(screen.getByTestId('CONSENT.unavailable.notice')).toBeTruthy();
    failing = false;
    await fireEvent.press(screen.getByTestId('CONSENT.retry'));
    expect(await screen.findByTestId('CONSENT.document.terms.summary')).toBeTruthy();
  });

  it('the failed sheet still lets the member sign out', async () => {
    await show({ '/me/consents': { status: 503, body: { message: 'Fehler', code: 'server_error' } } });
    await fireEvent.press(await screen.findByTestId('CONSENT.unavailable.signOut'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/welcome'));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('a write refused with 403 consent_required brings the sheet up, also before app-config names the version', async () => {
    const answers: Record<string, Answer | (() => Answer)> = {
      '/me/consents': { body: { data: REQUIRED } },
      '/follow': { status: 403, body: { message: 'Consent required', code: 'consent_required', errors: {} } },
    };
    const { calls } = await show(answers, { terms: null, privacy: null });
    expect(calls).toHaveLength(0);
    let refused: unknown;
    await act(async () => {
      refused = await apiData(api.POST('/users/{username}/follow', { params: { path: { username: 'max.e46' } } })).catch((error: unknown) => error);
    });
    // The write says what to do in the app's words, and the sheet answers it.
    expect(refused).toBeInstanceOf(ApiError);
    expect(isConsentRequired(refused)).toBe(true);
    expect((refused as ApiError).message).toBe('Stimm zuerst den geänderten Bedingungen zu, dann geht es weiter.');
    expect(await screen.findByTestId('CONSENT.document.terms.summary')).toBeTruthy();
  });

  it('steps aside while the member reads the document from it', () => {
    expect(isLegalReading('/settings/legal/terms')).toBe(true);
    expect(isLegalReading('/settings/legal/imprint')).toBe(false);
    expect(isLegalReading('/')).toBe(false);
  });
});

// Code review phase-3-final MF-2: an offline start blocks only a member the device cannot vouch for.
describe('re-consent offline (MF-2)', () => {
  const KEY = 'sc.consentCleared';
  const asMember = (id: string) => useSessionStore.setState({ status: 'member', member: { id, username: id, displayName: null, avatarUrl: null } });
  const stored = async () => JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as unknown;
  /** A new start: the record is on the device, nothing of it in memory, no consent state cached. */
  const restart = () => resetConsentClearanceForTests();
  const settle = async () => {
    await waitFor(() => expect(useConsentClearance.getState().loaded).toBe(true));
    await act(async () => undefined);
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
    restart();
    asMember('01mem');
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    setPreviewTokenForTests(null);
  });

  it('a member who accepted is not blocked on an offline start', async () => {
    await show({ '/me/consents': { body: { data: DONE } } });
    await waitFor(async () => expect(await stored()).toEqual({ member: '01mem', terms: '3', privacy: null }));
    await cleanup();

    restart();
    onlineManager.setOnline(false);
    const { calls } = await show({ '/me/consents': { body: { data: REQUIRED } } });
    await settle();
    expect(calls).toHaveLength(0);
    expect(screen.queryByTestId('CONSENT.unavailable')).toBeNull();
    expect(screen.queryByTestId('CONSENT.sheet')).toBeNull();

    // Back online, the server has the last word.
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(await screen.findByTestId('CONSENT.document.terms.summary')).toBeTruthy();
    await waitFor(async () => expect(await stored()).toBeNull());
  });

  it('accepting in the sheet is remembered too, and announced', async () => {
    const heard = jest.fn();
    const stop = onConsentAccepted(heard);
    let accepted = false;
    await show({ '/me/consents': () => ({ body: { data: accepted ? DONE : REQUIRED } }) });
    expect(await stored()).toBeNull();
    accepted = true;
    await fireEvent.press(await screen.findByTestId('CONSENT.accept'));
    await waitFor(async () => expect(await stored()).toEqual({ member: '01mem', terms: '3', privacy: null }));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a member never cleared on this device is still blocked offline', async () => {
    onlineManager.setOnline(false);
    const { calls } = await show({ '/me/consents': { body: { data: DONE } } });
    await settle();
    expect(calls).toHaveLength(0);
    expect(await screen.findByTestId('CONSENT.unavailable.notice')).toHaveTextContent(/Du bist offline/);
  });

  it('a new re-consent version blocks offline again', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ member: '01mem', terms: '3', privacy: null }));
    onlineManager.setOnline(false);
    await show({ '/me/consents': { body: { data: DONE } } }, { terms: '4', privacy: null });
    await settle();
    expect(await screen.findByTestId('CONSENT.unavailable')).toBeTruthy();
  });

  it('another member on the device is blocked offline, and a member change forgets the record', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ member: '01mem', terms: '3', privacy: null }));
    asMember('01other');
    onlineManager.setOnline(false);
    await show({ '/me/consents': { body: { data: DONE } } });
    await settle();
    expect(await screen.findByTestId('CONSENT.unavailable')).toBeTruthy();

    forgetPreviousMember();
    await waitFor(async () => expect(await stored()).toBeNull());
    expect(useConsentClearance.getState().record).toBeNull();
    useSessionStore.setState({ memberChanged: false });
  });

  it('a write refused with 403 consent_required forgets the record, so an offline start blocks again', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ member: '01mem', terms: '3', privacy: null }));
    // The state cannot be read (a server error), so only the refusal itself can tell the device.
    await show({
      '/me/consents': { status: 500, body: { message: 'Fehler', code: 'server_error' } },
      '/follow': { status: 403, body: { message: 'Consent required', code: 'consent_required', errors: {} } },
    });
    await settle();
    expect(await stored()).toEqual({ member: '01mem', terms: '3', privacy: null });
    await act(async () => {
      await apiData(api.POST('/users/{username}/follow', { params: { path: { username: 'max.e46' } } })).catch(() => undefined);
    });
    await waitFor(async () => expect(await stored()).toBeNull());
  });

  it('a guest is never blocked offline', async () => {
    useSessionStore.setState({ status: 'guest', member: null });
    onlineManager.setOnline(false);
    const { calls } = await show({ '/me/consents': { body: { data: REQUIRED } } });
    await act(async () => undefined);
    expect(calls).toHaveLength(0);
    expect(screen.queryByTestId('CONSENT.unavailable')).toBeNull();
  });

  it('a preview tab neither reads nor writes the record', async () => {
    setPreviewTokenForTests('abcdefgh.abcdefghijklmnop');
    await AsyncStorage.setItem(KEY, JSON.stringify({ member: '01mem', terms: '3', privacy: null }));
    rememberConsentClearance('01mem', { terms: '4', privacy: null });
    expect(await stored()).toEqual({ member: '01mem', terms: '3', privacy: null });
    onlineManager.setOnline(false);
    await show({ '/me/consents': { body: { data: DONE } } });
    await settle();
    expect(useConsentClearance.getState().record).toBeNull();
    expect(await screen.findByTestId('CONSENT.unavailable')).toBeTruthy();
  });
});
