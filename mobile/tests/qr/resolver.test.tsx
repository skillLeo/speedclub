import { onlineManager, QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { RESOLVER_USER_AGENT, retryResolveWhileOffline } from '@/api/queries/qr';
import { INVALID_CODE_OUTCOME, resolverOutcome, vehicleRoute } from '@/features/qr/resolve';
import { QrResolveScreen } from '@/features/qr/screens/QrResolveScreen';
import i18n from '@/i18n';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => false) };
let mockParams: { code?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
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

const resolution = (state: string, extra: Record<string, unknown> = {}) => ({
  body: { data: { state, slug: null, title: null, message: null, ...extra } },
});

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});
afterAll(() => i18n.changeLanguage('de'));

/**
 * The resolver's own words, when the server sends none, are WEB-06's word for word: web/lang/{de,en}/public.php
 * `qr_state`, `state.discover`, `state.home` and `state.rate_limited` (M1.6/M1.7 paired copy, DQ-162 joiner included).
 */
const WEB06 = {
  de: {
    revoked: ['Dieser QR-⁠Code ist nicht mehr gültig', 'Dieser Sticker führt zu keinem Fahrzeug mehr.'],
    private: ['Dieses Fahrzeug ist privat', 'Der Besitzer zeigt es gerade nicht öffentlich. Vielleicht klappt es später.'],
    not_found: ['Diesen QR-⁠Code kennen wir nicht', 'Prüf den Code auf dem Sticker oder scanne ihn noch einmal.'],
    discover: 'Builds entdecken',
    home: 'Zur Startseite',
    rateLimited: ['Kurz durchatmen', 'Das waren gerade sehr viele Aufrufe. Versuch es gleich noch einmal.'],
  },
  en: {
    revoked: ['This QR code is no longer valid', 'This sticker no longer leads to a vehicle.'],
    private: ['This vehicle is private', 'The owner is not showing it publicly right now. Maybe later.'],
    not_found: ['We do not know this QR code', 'Check the code on the sticker or scan it again.'],
    discover: 'Discover builds',
    home: 'Go to the home page',
    rateLimited: ['One moment', 'That was a lot of requests. Please try again shortly.'],
  },
} as const;

describe('resolverOutcome', () => {
  it('opens the vehicle only for an active code with a slug', () => {
    expect(resolverOutcome({ state: 'active', slug: 'nissan-skyline-gt-r-r34-5tf974vj', title: null, message: null })).toEqual({
      kind: 'vehicle',
      slug: 'nissan-skyline-gt-r-r34-5tf974vj',
    });
    expect(resolverOutcome({ state: 'active', slug: null, title: null, message: null })).toEqual(INVALID_CODE_OUTCOME);
  });

  it('passes the WEB-06 copy of the other states through and nothing of the vehicle', () => {
    const revoked = resolverOutcome({
      state: 'revoked',
      slug: null,
      title: 'Dieses Fahrzeug ist nicht mehr verfügbar',
      message: 'Die Seite zu diesem Sticker gibt es nicht mehr.',
    });
    expect(revoked).toEqual({
      kind: 'state',
      state: 'revoked',
      title: 'Dieses Fahrzeug ist nicht mehr verfügbar',
      message: 'Die Seite zu diesem Sticker gibt es nicht mehr.',
    });
    expect(resolverOutcome({ state: 'private', slug: null, title: null, message: null })).toMatchObject({ state: 'private' });
    expect(resolverOutcome({ state: 'not_found', slug: null, title: null, message: null })).toMatchObject({ state: 'not_found' });
  });

  it('routes to VEH-01', () => {
    expect(vehicleRoute('x-5tf974vj')).toEqual({ pathname: '/v/[slug]', params: { slug: 'x-5tf974vj' } });
  });
});

describe('c/[code]', () => {
  it('normalises the code, asks the server once and replaces itself with the vehicle', async () => {
    mockParams = { code: '8tr0-q3mc' };
    const { calls } = stubFetch({ '/api/v1/qr/8TR0Q3MC': resolution('active', { slug: 'nissan-skyline-gt-r-r34-5tf974vj' }) });
    await renderScreen(<QrResolveScreen />);
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/v/[slug]', params: { slug: 'nissan-skyline-gt-r-r34-5tf974vj' } }),
    );
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/qr/8TR0Q3MC');
    // Not "okhttp": the server's bot list would leave the scan uncounted.
    expect(calls[0]!.headers.get('User-Agent')).toBe(RESOLVER_USER_AGENT);
    expect(RESOLVER_USER_AGENT).toMatch(/^SPEEDCLUB\/\d+\.\d+\.\d+ \(ios\)$/);
    expect(screen.getByTestId('QR-RESOLVE.skeleton')).toBeTruthy();
  });

  it.each([
    ['revoked', 'APPY9FZ9', 'Dieser QR-\u2060Code ist nicht mehr gültig', 'Dieser Sticker führt zu keinem Fahrzeug mehr.'],
    ['private', '5A7XE8ET', 'Dieses Fahrzeug ist privat', 'Der Besitzer zeigt es gerade nicht öffentlich. Vielleicht klappt es später.'],
    ['not_found', 'ZZZZZZZZ', 'Diesen QR-\u2060Code kennen wir nicht', 'Prüf den Code auf dem Sticker oder scanne ihn noch einmal.'],
  ])('shows the calm %s state with the server’s words and two ways on', async (state, code, title, message) => {
    mockParams = { code };
    stubFetch({ [`/api/v1/qr/${code}`]: resolution(state, { title, message }) });
    await renderScreen(<QrResolveScreen />);
    await waitFor(() => expect(screen.getByTestId(`QR-RESOLVE.state.${state}`)).toBeTruthy());
    expect(screen.getByTestId('QR-RESOLVE.title')).toHaveTextContent(title);
    expect(screen.getByTestId('QR-RESOLVE.body')).toHaveTextContent(message);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('QR-RESOLVE.discover'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/discover');
    await fireEvent.press(screen.getByTestId('QR-RESOLVE.home'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  // DQ-172, §12: the same glyph per state as WEB-06; web/tests/Feature/Web/PublicPagesRenderTest.php pins the Blade side.
  it.each([
    ['revoked', 'prohibit'],
    ['private', 'lock-simple'],
    ['not_found', 'magnifying-glass'],
  ] as const)('draws the %s state with the %s glyph of WEB-06', async (state, glyph) => {
    mockParams = { code: 'APPY9FZ9' };
    stubFetch({ '/api/v1/qr/APPY9FZ9': resolution(state) });
    await renderScreen(<QrResolveScreen />);
    await waitFor(() => expect(screen.getByTestId(`QR-RESOLVE.state.${state}`)).toBeTruthy());
    expect(screen.getByTestId(`QR-RESOLVE.glyph.${glyph}`)).toBeTruthy();
  });

  it('keeps "QR-Code" in the server’s words on one line, also without a joiner from the server (DQ-162)', async () => {
    mockParams = { code: 'APPY9FZ9' };
    stubFetch({
      '/api/v1/qr/APPY9FZ9': resolution('revoked', {
        title: 'Dieser QR-Code ist nicht mehr gültig',
        message: 'Dieser QR-Code führt zu keinem Fahrzeug mehr.',
      }),
    });
    await renderScreen(<QrResolveScreen />);
    await waitFor(() => expect(screen.getByTestId('QR-RESOLVE.title')).toHaveTextContent('Dieser QR-\u2060Code ist nicht mehr gültig'));
    expect(screen.getByTestId('QR-RESOLVE.body')).toHaveTextContent('Dieser QR-\u2060Code führt zu keinem Fahrzeug mehr.');
  });

  it('keeps the server’s variant for a deleted vehicle', async () => {
    mockParams = { code: 'APPY9FZ9' };
    stubFetch({
      '/api/v1/qr/APPY9FZ9': resolution('revoked', {
        title: 'Dieses Fahrzeug ist nicht mehr verfügbar',
        message: 'Die Seite zu diesem Sticker gibt es nicht mehr.',
      }),
    });
    await renderScreen(<QrResolveScreen />);
    await waitFor(() => expect(screen.getByTestId('QR-RESOLVE.title')).toHaveTextContent('Dieses Fahrzeug ist nicht mehr verfügbar'));
  });

  it('answers a code that cannot exist without a request, in the words of WEB-06', async () => {
    mockParams = { code: 'NOPE' };
    const { fetchMock } = stubFetch({});
    await renderScreen(<QrResolveScreen />);
    expect(screen.getByTestId('QR-RESOLVE.state.not_found')).toBeTruthy();
    expect(screen.getByTestId('QR-RESOLVE.title')).toHaveTextContent('Diesen QR-\u2060Code kennen wir nicht');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['de', 'revoked'],
    ['de', 'private'],
    ['de', 'not_found'],
    ['en', 'revoked'],
    ['en', 'private'],
    ['en', 'not_found'],
  ] as const)('in %s, words the %s state exactly as WEB-06 when the server sends no text', async (language, state) => {
    await i18n.changeLanguage(language);
    mockParams = { code: 'APPY9FZ9' };
    stubFetch({ '/api/v1/qr/APPY9FZ9': resolution(state) });
    await renderScreen(<QrResolveScreen />);
    await waitFor(() => expect(screen.getByTestId(`QR-RESOLVE.state.${state}`)).toBeTruthy());
    const [title, body] = WEB06[language][state];
    expect(screen.getByTestId('QR-RESOLVE.title')).toHaveTextContent(title);
    expect(screen.getByTestId('QR-RESOLVE.body')).toHaveTextContent(body);
    expect(screen.getByTestId('QR-RESOLVE.discover')).toHaveTextContent(WEB06[language].discover);
    expect(screen.getByTestId('QR-RESOLVE.home')).toHaveTextContent(WEB06[language].home);
    await i18n.changeLanguage('de');
  });

  it.each(['de', 'en'] as const)('in %s, words a rate limit exactly as WEB-06', async (language) => {
    await i18n.changeLanguage(language);
    mockParams = { code: '8TR0Q3MC' };
    stubFetch({ '/api/v1/qr/8TR0Q3MC': { status: 429, body: { message: 'Zu viele Anfragen', code: 'rate_limited', errors: {} }, headers: { 'Retry-After': '20' } } });
    await renderScreen(<QrResolveScreen />);
    await waitFor(() => expect(screen.getByTestId('QR-RESOLVE.error')).toBeTruthy());
    const [title, body] = WEB06[language].rateLimited;
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
    await i18n.changeLanguage('de');
  });

  it('says "Kurz durchatmen" when the resolver is rate limited, and tries again on request', async () => {
    mockParams = { code: '8TR0Q3MC' };
    const { calls } = stubFetch({
      '/api/v1/qr/8TR0Q3MC': { status: 429, body: { message: 'Zu viele Anfragen', code: 'rate_limited', errors: {} }, headers: { 'Retry-After': '20' } },
    });
    await renderScreen(<QrResolveScreen />);
    await waitFor(() => expect(screen.getByTestId('QR-RESOLVE.error')).toBeTruthy());
    expect(screen.getByText('Kurz durchatmen')).toBeTruthy();
    await fireEvent.press(screen.getByText('Erneut versuchen'));
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('never asks again by itself, because each request may count a scan: only the retry button does', async () => {
    mockParams = { code: '8TR0Q3MC' };
    const { calls } = stubFetch({ '/api/v1/qr/8TR0Q3MC': { status: 503, body: { message: 'Wartung', code: 'server', errors: {} } } });
    // The app's own client retries every other query (src/api/queryClient.ts).
    const client = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 1, gcTime: Infinity } } });
    await renderScreen(<QrResolveScreen />, client);
    await waitFor(() => expect(screen.getByTestId('QR-RESOLVE.error')).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toHaveLength(1);
    await fireEvent.press(screen.getByText('Erneut versuchen'));
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('waits for the connection only when the request failed offline, where it never reached the server', () => {
    const network = new ApiError({ kind: 'network', status: 0, code: 'network', message: 'Keine Verbindung' });
    const server = new ApiError({ kind: 'server', status: 503, code: 'server', message: 'Wartung' });
    try {
      onlineManager.setOnline(false);
      expect(retryResolveWhileOffline(0, network)).toBe(true);
      expect(retryResolveWhileOffline(0, server)).toBe(false);
      onlineManager.setOnline(true);
      // Online, a dropped connection may have lost an answer that already counted the scan.
      expect(retryResolveWhileOffline(0, network)).toBe(false);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('closes to the home tab when there is nothing to go back to', async () => {
    mockParams = { code: 'NOPE' };
    stubFetch({});
    await renderScreen(<QrResolveScreen />);
    await fireEvent.press(screen.getByTestId('QR-RESOLVE.header.back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });
});
