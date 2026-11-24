import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { settleDesign, stickerDesignKey, type StickerDesign } from '@/api/queries/stickers';
import { StickerRedirect } from '@/features/qr/redirects';
import { StickerDesignerScreen } from '@/features/qr/screens/StickerDesignerScreen';
import { StickerHubScreen } from '@/features/qr/screens/StickerHubScreen';
import { StickerOrderScreen } from '@/features/qr/screens/StickerOrderScreen';
import { StickerHistoryScreen } from '@/features/qr/screens/StickerHistoryScreen';
import { StickerStatsScreen } from '@/features/qr/screens/StickerStatsScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, signIn, signOut, stubFetch, type Answer } from './harness';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  dismissTo: jest.fn(),
  canGoBack: jest.fn(() => true),
};
let mockParams: Record<string, string> = {};
const mockRedirect = jest.fn((_props: unknown) => null);
const mockOpenBrowser = jest.fn((_url: string, _options?: unknown) => Promise.resolve({ type: 'opened' }));

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/stickers',
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), getParent: () => undefined, getState: () => undefined }),
  usePreventRemove: jest.fn(() => jest.fn()),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Redirect: (props: unknown) => mockRedirect(props),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('token-1')) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string, options: unknown) => mockOpenBrowser(url, options) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
jest.mock('@/features/shell/useRetainedListScroll', () => ({ useRetainedListScroll: () => ({ forget: jest.fn() }) }));

const R34 = '01m6f7zv1vs5e2xw9a96cbqzyp';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 156 65"><rect id="surface" width="156" height="65" fill="#0B0B0C"/></svg>';
const ME: Answer = {
  body: {
    data: {
      id: '01lukas',
      username: 'lukas.sc',
      restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
    },
  },
};
const OPTIONS = {
  size: 'm',
  colourway: 'white',
  material: 'transparent',
  qr: true,
  username: true,
  car_name: false,
  custom_line: null,
  mirrored: false,
};

function designResource(patch: Record<string, unknown> = {}) {
  return {
    id: '01design',
    revision: 2,
    persisted: true,
    reference: 'SD7H2KQXMB',
    version: 3,
    template: 'classic',
    options: OPTIONS,
    effective: { username: true, car_name: false, custom_line: false },
    size_mm: { width: 156, height: 65 },
    qr_mm: 35.7,
    state: 'draft',
    scan_test: null,
    validated_at: null,
    order_requested_at: null,
    code: { display_code: '8TR0 Q3MC', active: true },
    warnings: [],
    urls: { preview_svg: 'https://speedclub.test/api/v1/sticker-designs/01design/preview.svg', share_png: null, print_svg: null, print_pdf: null, print_png: null },
    created_at: '2026-11-15T10:00:00+00:00',
    updated_at: '2026-11-15T10:00:00+00:00',
    ...patch,
  };
}

const VALIDATED = designResource({
  state: 'validated',
  scan_test: 'passed',
  validated_at: '2026-11-15T10:05:00+00:00',
  urls: {
    preview_svg: 'x',
    share_png: 'x',
    print_svg: 'https://speedclub.test/api/v1/sticker-designs/01design/print.svg',
    print_pdf: 'https://speedclub.test/api/v1/sticker-designs/01design/print.pdf',
    print_png: 'x',
  },
});

function card(patch: Record<string, unknown> = {}, actions: Record<string, unknown> = {}) {
  return {
    vehicle: {
      id: R34,
      slug: 'nissan-skyline-gt-r-r34-5tf974vj',
      title: 'Skyline GT-R R34',
      full_title: 'Nissan Skyline GT-R R34',
      cover: null,
      public_url: 'https://speedclub.de/v/nissan-skyline-gt-r-r34-5tf974vj',
    },
    sticker: { status: 'active', scan_state: 'active', display_code: '8TR0 Q3MC', url: 'https://speedclub.de/C/8TR0Q3MC' },
    scans_this_week: 9,
    design: null,
    actions: { design: true, order: { available: false, reason: 'no_design' }, download: false, ...actions },
    ...patch,
  };
}

const TEMPLATES: Answer = {
  body: {
    data: {
      templates: ['classic', 'minimal', 'banner', 'plate', 'vertical_jdm', 'round'].map((key) => ({
        key,
        name: key === 'vertical_jdm' ? 'Vertical JDM' : key[0]!.toUpperCase() + key.slice(1),
        description: '',
        shape: key === 'round' ? 'circle' : 'rounded',
        corner_radius_mm: 4,
        sizes: [
          { key: 's', width_mm: 120, height_mm: 50, qr_mm: 27.4 },
          { key: 'm', width_mm: 156, height_mm: 65, qr_mm: 35.7 },
          { key: 'l', width_mm: 192, height_mm: 80, qr_mm: 43.9 },
        ],
        options: key === 'classic' || key === 'banner' ? ['username', 'car_name', 'custom_line'] : ['username'],
        defaults: OPTIONS,
      })),
      colourways: [
        { key: 'white', name: 'Weißer Druck', hint: 'Für dunkle Scheiben', inks: ['white'], materials: ['transparent'], mirrored_allowed: true },
        { key: 'black', name: 'Schwarzer Druck', hint: 'Für helle Lackierung', inks: ['black'], materials: ['transparent', 'white_vinyl'], mirrored_allowed: true },
        { key: 'white_red', name: 'Weiß mit Signalrot', hint: 'Für dunkle Scheiben', inks: ['white', 'red'], materials: ['transparent'], mirrored_allowed: true },
      ],
      materials: [
        { key: 'transparent', name: 'Transparente Folie' },
        { key: 'white_vinyl', name: 'Weiße Folie' },
      ],
      limits: { custom_line_max: 24, qr_min_mm: 25, quiet_zone_modules: 4, error_correction: 'H', bleed_mm: 3 },
    },
  },
};
const PREVIEW: Answer = {
  body: { data: { svg: SVG, size_mm: { width: 156, height: 65 }, qr_mm: 35.7, effective: { username: true, car_name: false, custom_line: false }, warnings: [] } },
};
const list = (cards: unknown[]): Answer => ({ body: { data: cards, links: {}, meta: { next_cursor: null } } });

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  signIn();
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

describe('STK-01 Meine Sticker', () => {
  it('shows one card per car with status, scans this week, and the three actions', async () => {
    stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/me/stickers': list([
        card(),
        card(
          { vehicle: { ...card().vehicle, id: '01silvia', full_title: 'Nissan Silvia S15' }, design: VALIDATED, scans_this_week: 0 },
          { order: { available: true, reason: null }, download: true },
        ),
      ]),
      '/sticker-design/preview': PREVIEW,
      '/preview.svg': { body: SVG, contentType: 'image/svg+xml' },
    });
    await renderScreen(<StickerHubScreen />);
    await waitFor(() => expect(screen.getByTestId(`STK-01.card.${R34}`)).toBeTruthy());
    expect(screen.getByText('Meine Sticker')).toBeTruthy();
    expect(screen.getByTestId(`STK-01.card.${R34}.scansCount`)).toHaveTextContent('9');
    // DQ-M54-08: a week without scans is a sentence, never a big zero.
    expect(screen.queryByTestId('STK-01.card.01silvia.scansCount')).toBeNull();
    expect(screen.getByTestId('STK-01.card.01silvia.scansNone')).toHaveTextContent('Noch keine Scans diese Woche');
    expect(screen.getByTestId(`STK-01.card.${R34}.status`)).toHaveTextContent('Aktiv');
    expect(screen.getByTestId(`STK-01.card.${R34}.designLine`)).toHaveTextContent('Noch nicht gestaltet');
    expect(screen.getByTestId(`STK-01.card.${R34}.note`)).toHaveTextContent('Herunterladen und Bestellen gehen nach dem Scan-Test.');
    expect(screen.getByTestId('STK-01.card.01silvia.designLine')).toHaveTextContent(/Classic · M · 156\s×\s65\smm · Scan-Test bestanden/);

    await fireEvent.press(screen.getByTestId(`STK-01.card.${R34}.design`));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId: R34 } });
    // Not validated yet: the button says "Scan-Test" and opens the designer, which runs it (DQ-M54R2-15).
    expect(screen.getByTestId(`STK-01.card.${R34}.order`)).toHaveTextContent('Scan-Test');
    await fireEvent.press(screen.getByTestId(`STK-01.card.${R34}.order`));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId: R34, scan: '1' } });
    await fireEvent.press(screen.getByTestId('STK-01.card.01silvia.order'));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/stickers/[vehicleId]/order', params: { vehicleId: '01silvia' } });
    await fireEvent.press(screen.getByTestId(`STK-01.card.${R34}.scans`));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/stickers/[vehicleId]/stats', params: { vehicleId: R34 } });
    await fireEvent.press(screen.getByTestId(`STK-01.card.${R34}.open`));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/stickers/[vehicleId]', params: { vehicleId: R34 } });
  });

  it('says "Bestellung bald verfügbar" while the store is not configured, and never offers a dead order link', async () => {
    stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/me/stickers': list([card({ design: VALIDATED }, { order: { available: false, reason: 'not_configured' }, download: true })]),
      '/preview.svg': { body: SVG, contentType: 'image/svg+xml' },
    });
    await renderScreen(<StickerHubScreen />);
    await waitFor(() => expect(screen.getByTestId(`STK-01.card.${R34}.note`)).toHaveTextContent('Bestellung bald verfügbar.'));
    await fireEvent.press(screen.getByTestId(`STK-01.card.${R34}.order`));
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('shows a badged sample sticker and one action when no car is published', async () => {
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/stickers': list([]) });
    await renderScreen(<StickerHubScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-01.empty')).toBeTruthy());
    expect(screen.getByTestId('STK-01.sample')).toBeTruthy();
    expect(screen.getByText('Beispiel')).toBeTruthy();
    await fireEvent.press(screen.getByText('Fahrzeug hinzufügen'));
    expect(mockRouter.push).toHaveBeenCalledWith('/add-vehicle/new/vehicle');
  });

  it('asks a guest to sign in instead of loading anything', async () => {
    signOut();
    const { fetchMock } = stubFetch({});
    await renderScreen(<StickerHubScreen />);
    expect(screen.getByTestId('STK-01.guest')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('STK-04 Scan-Statistik', () => {
  const stats = (patch: Record<string, unknown> = {}): Answer => ({
    body: {
      data: {
        days: Array.from({ length: 30 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, '0')}`, count: index === 29 ? 4 : 1 })),
        total: 412,
        total_30_days: 33,
        this_week: 9,
        last_week: 14,
        first_scan_on: '2026-03-02',
        sources: { sticker_scan: 33, link: null },
        milestones_reached: [10, 50, 100],
        ...patch,
      },
    },
  });

  it('shows the totals, the weeks and the line, and says honestly that shared links are not counted yet', async () => {
    mockParams = { vehicleId: R34 };
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/stickers': list([card()]), '/sticker/stats': stats() });
    await renderScreen(<StickerStatsScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-04.total')).toHaveTextContent('412'));
    expect(screen.getByTestId('STK-04.thisWeek')).toHaveTextContent('9');
    expect(screen.getByTestId('STK-04.lastWeek')).toHaveTextContent('14');
    expect(screen.getByTestId('STK-04.source.link')).toHaveTextContent(/Noch nicht erfasst/);
    expect(screen.getByTestId('STK-04.firstScan')).toHaveTextContent(/2\. März 2026/);
    expect(screen.getByLabelText('Scans der letzten 30 Tage: 33, an einem Tag höchstens 4.')).toBeTruthy();
    // Counts only: nothing names who scanned.
    expect(screen.getByText('Wir zählen nur Scans, nicht wer scannt.')).toBeTruthy();
  });

  it('shows the link count once the server sends one', async () => {
    mockParams = { vehicleId: R34 };
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/stickers': list([card()]), '/sticker/stats': stats({ sources: { sticker_scan: 33, link: 7 } }) });
    await renderScreen(<StickerStatsScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-04.source.link')).toHaveTextContent(/7/));
  });

  it('turns a car without scans into a sentence and one action, not a grid of zeros (DQ-M54-12)', async () => {
    mockParams = { vehicleId: R34 };
    stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/me/stickers': list([card()]),
      '/sticker/stats': stats({
        days: Array.from({ length: 30 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, '0')}`, count: 0 })),
        total: 0,
        total_30_days: 0,
        this_week: 0,
        last_week: 0,
        first_scan_on: null,
        sources: { sticker_scan: 0, link: null },
        milestones_reached: [],
      }),
    });
    await renderScreen(<StickerStatsScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-04.zeroTitle')).toHaveTextContent('Noch hat niemand deinen Sticker gescannt.'));
    expect(screen.queryByTestId('STK-04.total')).toBeNull();
    expect(screen.queryByTestId('STK-04.thisWeek')).toBeNull();
    expect(screen.getByTestId('STK-04.firstScan')).toHaveTextContent(/Noch keiner/);
    expect(screen.getByTestId('STK-04.design')).toBeTruthy();
  });

  it('says plainly when the statistics are switched off', async () => {
    mockParams = { vehicleId: R34 };
    stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/me/stickers': list([card()]),
      '/sticker/stats': { status: 404, body: { message: 'Aus', code: 'feature_disabled', errors: {} } },
    });
    await renderScreen(<StickerStatsScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-04.disabled')).toBeTruthy());
  });
});

describe('STK-06 Sticker bestellen', () => {
  it('opens the Shopify cart link from the server in the in-app browser', async () => {
    mockParams = { vehicleId: R34 };
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/me/stickers': list([card({ design: VALIDATED }, { order: { available: true, reason: null }, download: true })]),
      '/sticker-design': { body: { data: VALIDATED } },
      '/preview.svg': { body: SVG, contentType: 'image/svg+xml' },
      '/order-link': {
        body: {
          data: {
            available: true,
            url: 'https://shop.example.de/cart/123:1?attributes[sticker_design]=SD7H2KQXMB&storefront=true',
            reason: null,
            message: null,
          },
        },
      },
    });
    await renderScreen(<StickerOrderScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-06.reference')).toHaveTextContent(/SD7H2KQXMB/));
    await fireEvent.press(screen.getByTestId('STK-06.cta'));
    await waitFor(() => expect(mockOpenBrowser).toHaveBeenCalled());
    expect(mockOpenBrowser.mock.calls[0]![0]).toBe('https://shop.example.de/cart/123:1?attributes[sticker_design]=SD7H2KQXMB&storefront=true');
    const post = calls.find((request) => request.url.endsWith('/order-link'));
    expect(post?.method).toBe('POST');
    expect(post?.headers.get('Idempotency-Key')).toBe('uuid-1');
  });

  it('shows "Bestellung bald verfügbar" when the server has no store, and opens nothing', async () => {
    mockParams = { vehicleId: R34 };
    stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/me/stickers': list([card({ design: VALIDATED }, { order: { available: true, reason: null }, download: true })]),
      '/sticker-design': { body: { data: VALIDATED } },
      '/preview.svg': { body: SVG, contentType: 'image/svg+xml' },
      '/order-link': { body: { data: { available: false, url: null, reason: 'not_configured', message: 'Bestellung bald verfügbar' } } },
    });
    await renderScreen(<StickerOrderScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-06.cta')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-06.cta'));
    await waitFor(() => expect(screen.getByTestId('STK-06.notice')).toHaveTextContent('Bestellung bald verfügbar'));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it('sends a design without a passed Scan-Test back to the designer', async () => {
    mockParams = { vehicleId: R34 };
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/stickers': list([card()]), '/sticker-design': { body: { data: designResource() } } });
    await renderScreen(<StickerOrderScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-06.notReady')).toBeTruthy());
    expect(screen.queryByTestId('STK-06.restricted')).toBeNull();
    // DQ-M54-15: one way on, to the designer that runs the test at once.
    expect(screen.getByTestId('STK-06.notReady.title')).toHaveTextContent('Erst der Scan-Test');
    await fireEvent.press(screen.getByTestId('STK-06.notReady.action'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId: R34, scan: '1' } });
  });

  it('a suspended member without a passed Scan-Test sees the suspension, and no way into the designer they cannot use', async () => {
    mockParams = { vehicleId: R34 };
    const suspendedMe: Answer = {
      body: {
        data: {
          id: '01lukas',
          username: 'lukas.sc',
          restrictions: { suspended: true, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
        },
      },
    };
    stubFetch({ '/api/v1/auth/me': suspendedMe, '/api/v1/me/stickers': list([card()]), '/sticker-design': { body: { data: designResource() } } });
    await renderScreen(<StickerOrderScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-06.notReady')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('STK-06.restricted')).toBeTruthy());
    expect(screen.queryByTestId('STK-06.notReady.action')).toBeNull();
  });
});

/** The stage and the dock size themselves from layout, which a test renderer never reports by itself. */
async function layOut() {
  await waitFor(() => expect(screen.getByTestId('STK-05.area')).toBeTruthy());
  await fireEvent(screen.getByTestId('STK-05.area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } });
}

/** The compact dock keeps the options from screen readers until it is expanded, as a member would. */
async function expandDock() {
  await fireEvent.press(screen.getByTestId('STK-05.grabber'));
}

describe('STK-05 Sticker designer', () => {
  function stubDesigner(overrides: Record<string, Answer | (() => Answer)> = {}) {
    return stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/me/stickers': list([card({ design: designResource() })]),
      '/stickers/templates': TEMPLATES,
      '/sticker-design/preview': PREVIEW,
      '/sticker-design': { body: { data: designResource() } },
      ...overrides,
    });
  }

  it('describes the live preview for a screen reader and lists the six templates', async () => {
    mockParams = { vehicleId: R34 };
    stubDesigner();
    await renderScreen(<StickerDesignerScreen />);
    await layOut();
    await waitFor(() => expect(screen.getByTestId('STK-05.preview.art')).toBeTruthy());
    expect(screen.getByLabelText(/^Sticker Classic, 156 × 65 mm, Weißer Druck, mit QR-⁠Code, Text: @lukas\.sc\./)).toBeTruthy();
    for (const key of ['classic', 'minimal', 'banner', 'plate', 'vertical_jdm', 'round']) {
      expect(screen.getByTestId(`STK-05.template.${key}`)).toBeTruthy();
    }
    expect(screen.getByTestId('STK-05.cta')).toBeTruthy();
  });

  it('warns when the QR code is switched off, autosaves with the version it saw, and undoes', async () => {
    mockParams = { vehicleId: R34 };
    const puts: unknown[] = [];
    stubDesigner({
      '/sticker-design': () => ({ body: { data: designResource() } }),
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Request | string) => {
      const request = typeof input === 'string' ? new Request(input) : input;
      if (request.method === 'PUT') {
        const body = (await request.clone().json()) as { base_version: number; template: string; options: typeof OPTIONS };
        puts.push(body);
        return new Response(JSON.stringify({ data: designResource({ template: body.template, options: body.options }) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return original(request);
    }) as typeof fetch;
    await renderScreen(<StickerDesignerScreen />);
    await layOut();
    await expandDock();
    await waitFor(() => expect(screen.getByTestId('STK-05.qr')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-05.qr'));
    await waitFor(() => expect(screen.getByTestId('STK-05.qrOff')).toHaveTextContent('Ohne QR-⁠Code kann niemand deinen Build scannen.'));
    await waitFor(() => expect(puts).toHaveLength(1), { timeout: 5000 });
    expect(puts[0]).toMatchObject({ base_version: 3, base_revision: 2, template: 'classic', options: { qr: false } });
    await fireEvent.press(screen.getByTestId('STK-05.undo'));
    await waitFor(() => expect(screen.queryByTestId('STK-05.qrOff')).toBeNull());
    globalThis.fetch = original;
  });

  it('runs the Scan-Test, shows "Scan-Test bestanden" and only then offers "Sticker bestellen"', async () => {
    mockParams = { vehicleId: R34 };
    const { calls } = stubDesigner({ '/validate': { body: { data: VALIDATED } } });
    await renderScreen(<StickerDesignerScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-05.scanState')).toHaveTextContent(/Vor dem Bestellen prüfen wir/));
    expect(screen.getByTestId('STK-05.cta.primary')).toHaveTextContent('Scan-Test starten');
    await fireEvent.press(screen.getByTestId('STK-05.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('STK-05.scanState')).toHaveTextContent('Scan-Test bestanden'));
    expect(screen.getByTestId('STK-05.cta.primary')).toHaveTextContent('Sticker bestellen');
    expect(screen.getByTestId('STK-05.download')).toHaveTextContent('Herunterladen');
    const validate = calls.find((request) => request.url.endsWith('/validate'));
    expect(await validate!.clone().json()).toEqual({ version: 3, client_scan_test: 'unavailable' });
    await fireEvent.press(screen.getByTestId('STK-05.cta.primary'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/stickers/[vehicleId]/order', params: { vehicleId: R34 } });
  });

  it('asks what to keep when the server answers 409 edit_conflict to the Scan-Test', async () => {
    mockParams = { vehicleId: R34 };
    stubDesigner({ '/validate': { status: 409, body: { message: 'Geändert', code: 'edit_conflict', errors: {} } } });
    await renderScreen(<StickerDesignerScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-05.cta')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-05.cta.primary'));
    await waitFor(() => expect(screen.getByText('Auf einem anderen Gerät geändert')).toBeTruthy());
    expect(screen.getByText('Neuere Version laden')).toBeTruthy();
    expect(screen.getByText('Meine Version behalten')).toBeTruthy();
    // Review SF-3: "Später" leaves the dialog and keeps the conflict, which the status line offers to resolve.
    await fireEvent.press(screen.getByText('Später'));
    await waitFor(() => expect(screen.queryByText('Neuere Version laden')).toBeNull());
    // Also for the Scan-Test's conflict, the status area offers to resolve it later (re-check nit).
    await waitFor(() => expect(screen.getByTestId('STK-05.resolveConflict')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-05.resolveConflict'));
    await waitFor(() => expect(screen.getByText('Neuere Version laden')).toBeTruthy());
  });

  /** A designer whose PUT answers with the next revision; the test's query client is returned for cache writes. */
  async function openEditing() {
    mockParams = { vehicleId: R34 };
    stubDesigner();
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Request | string) => {
      const request = typeof input === 'string' ? new Request(input) : input;
      if (request.method === 'PUT') {
        const body = (await request.clone().json()) as { base_revision: number; template: string; options: typeof OPTIONS };
        return new Response(
          JSON.stringify({ data: designResource({ template: body.template, options: body.options, revision: body.base_revision + 1, updated_at: '2026-11-15T10:01:00+00:00' }) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return original(request);
    }) as typeof fetch;
    const client = newQueryClient();
    await renderScreen(<StickerDesignerScreen />, client);
    await layOut();
    await expandDock();
    await waitFor(() => expect(screen.getByTestId('STK-05.qr')).toBeTruthy());
    return { client, restore: () => (globalThis.fetch = original) };
  }

  it('ignores a read that answers after the save with an older revision (review SF-5)', async () => {
    const { client, restore } = await openEditing();
    await fireEvent.press(screen.getByTestId('STK-05.qr'));
    await waitFor(() => expect(screen.getByTestId('STK-05.saveStatus')).toHaveTextContent(/Gespeichert/), { timeout: 5000 });
    // The refetch sent before the save lands now: same version, the revision before the save.
    await act(async () => {
      client.setQueryData(stickerDesignKey(R34), designResource({ revision: 2 }));
    });
    expect(screen.getByTestId('STK-05.qrOff')).toBeTruthy();
    expect(screen.queryByText('Auf einem anderen Gerät geändert')).toBeNull();
    restore();
  });

  it('never drops a custom line the app refuses when the server moves on: it asks (review SF-6)', async () => {
    const { client, restore } = await openEditing();
    await fireEvent.changeText(screen.getByTestId('STK-05.customLine'), 'Zeile\nmit Umbruch');
    await act(async () => {
      client.setQueryData(stickerDesignKey(R34), designResource({ template: 'round', revision: 7, updated_at: '2026-11-15T11:00:00+00:00' }));
    });
    await waitFor(() => expect(screen.getByText('Auf einem anderen Gerät geändert')).toBeTruthy());
    expect(screen.getByTestId('STK-05.customLine')).toHaveDisplayValue('Zeile\nmit Umbruch');
    restore();
  });

  it('takes the side column from the measured room, never from the window (DQ-M54-01)', async () => {
    mockParams = { vehicleId: R34 };
    stubDesigner();
    await renderScreen(<StickerDesignerScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-05.area')).toBeTruthy());
    await fireEvent(screen.getByTestId('STK-05.area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 1040, height: 760 } } });
    await waitFor(() => expect(screen.getByTestId('STK-05.side')).toBeTruthy());
    await fireEvent(screen.getByTestId('STK-05.area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 748, height: 760 } } });
    await waitFor(() => expect(screen.queryByTestId('STK-05.side')).toBeNull());
    expect(screen.getByTestId('STK-05.dock')).toBeTruthy();
  });

  it('opens on a fresh read, never on a design cached before the last save (review MF-2)', async () => {
    mockParams = { vehicleId: R34 };
    stubDesigner();
    const client = newQueryClient();
    client.setQueryData(stickerDesignKey(R34), designResource({ template: 'round', version: 2 }));
    await renderScreen(<StickerDesignerScreen />, client);
    await layOut();
    await waitFor(() => expect(screen.getByTestId('STK-05.template.classic')).toBeChecked());
    expect(screen.getByTestId('STK-05.template.round')).not.toBeChecked();
  });

  it('freezes the controls while the Scan-Test runs (review MF-1)', async () => {
    mockParams = { vehicleId: R34 };
    let answer: (value: Response) => void = () => undefined;
    stubDesigner();
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Request | string) => {
      const request = typeof input === 'string' ? new Request(input) : input;
      if (request.url.endsWith('/validate')) return new Promise<Response>((done) => (answer = done));
      return original(request);
    }) as typeof fetch;
    await renderScreen(<StickerDesignerScreen />);
    await layOut();
    await waitFor(() => expect(screen.getByTestId('STK-05.template.round')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-05.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('STK-05.template.round')).toBeDisabled());
    expect(screen.getByTestId('STK-05.undo')).toBeDisabled();
    answer(new Response(JSON.stringify({ data: VALIDATED }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await waitFor(() => expect(screen.getByTestId('STK-05.scanState')).toHaveTextContent('Scan-Test bestanden'));
    expect(screen.getByTestId('STK-05.template.round')).toBeEnabled();
    globalThis.fetch = original;
  });

  it('turns a car that is not the member’s into "nicht verfügbar"', async () => {
    mockParams = { vehicleId: R34 };
    stubDesigner({ '/sticker-design': { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } } });
    await renderScreen(<StickerDesignerScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-05.unavailable')).toBeTruthy());
  });
});

describe('STK-07 empty (DQ-M54-16)', () => {
  it('shows a badged sample version row, one line and one action', async () => {
    mockParams = { vehicleId: R34 };
    stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/me/stickers': list([card()]),
      '/sticker-design/versions': list([]),
      '/sticker-design/preview': PREVIEW,
    });
    await renderScreen(<StickerHistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-07.empty')).toBeTruthy());
    expect(screen.getByTestId('STK-07.sample')).toHaveTextContent(/Beispiel/);
    expect(screen.getByTestId('STK-07.sample')).toHaveTextContent(/Geprüft am 2\. März 2026/);
    await fireEvent.press(screen.getByTestId('STK-07.empty.action'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId: R34 } });
  });
});

describe('settleDesign (review SF-5)', () => {
  it('cancels a read that is still on its way, so its older answer never overwrites the write', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    let answer: (design: StickerDesign) => void = () => undefined;
    const read = client.fetchQuery({ queryKey: stickerDesignKey(R34), queryFn: () => new Promise<StickerDesign>((done) => (answer = done)) }).catch(() => undefined);
    const saved = designResource({ revision: 3 }) as unknown as StickerDesign;
    settleDesign(client, R34, saved);
    answer(designResource({ revision: 2 }) as unknown as StickerDesign);
    await read;
    expect(client.getQueryData<StickerDesign>(stickerDesignKey(R34))?.revision).toBe(3);
  });
});

describe('STK-07 Frühere Versionen', () => {
  it('restores on top of the current revision and returns to the designer underneath, never a second one (review MF-3, MF-4)', async () => {
    mockParams = { vehicleId: R34 };
    const older = designResource({ id: '01older', version: 2, state: 'validated', scan_test: 'passed', revision: 1, template: 'round' });
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/me/stickers': list([card()]),
      '/sticker-design/versions': list([designResource(), older]),
      '/versions/2/restore': { body: { data: designResource({ template: 'round', revision: 3 }) } },
      '/preview.svg': { body: SVG, contentType: 'image/svg+xml' },
    });
    await renderScreen(<StickerHistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-07.version.2.restore')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-07.version.2.restore'));
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId: R34 } }));
    expect(mockRouter.push).not.toHaveBeenCalled();
    // DQ-M54R2-11 b: "Aktuell" is a pill on the newest version, not a meta word.
    expect(screen.getByTestId('STK-07.version.3.current')).toHaveTextContent('Aktuell');
    const restore = calls.find((request) => request.url.endsWith('/versions/2/restore'));
    expect(await restore!.clone().json()).toEqual({ base_revision: 2 });
  });
});

describe('old QR routes', () => {
  it('redirect to the sticker routes and keep the query', async () => {
    mockParams = { vehicleId: R34, qaState: 'empty' };
    await renderScreen(<StickerRedirect to="/stickers/[vehicleId]/placement" />);
    await act(async () => undefined);
    expect(mockRedirect).toHaveBeenCalledWith({
      href: { pathname: '/stickers/[vehicleId]/placement', params: { vehicleId: R34, qaState: 'empty' } },
    });
  });
});
