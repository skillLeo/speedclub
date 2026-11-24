import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { QrDetailScreen } from '@/features/qr/screens/QrDetailScreen';
import { QrPlacementScreen } from '@/features/qr/screens/QrPlacementScreen';
import { QrPreviewScreen } from '@/features/qr/screens/QrPreviewScreen';
import i18n from '@/i18n';
import deQr from '@/i18n/locales/de/qr.json';
import enQr from '@/i18n/locales/en/qr.json';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, themes } from '@/theme';

import { visualOf } from '../ui/helpers';
import { QR_SVG, qrRow, renderScreen, signIn, stubFetch } from './harness';

const carbon = themes.carbon.color;

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { vehicleId?: string } = {};
const mockOpenBrowser = jest.fn((_url: string, _options?: unknown) => Promise.resolve({ type: 'opened' }));
const mockShare = jest.fn((_content: unknown) => Promise.resolve({ action: 'sharedAction' }));

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/profile/qr',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('token-1')) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string, options: unknown) => mockOpenBrowser(url, options) }));
const mockDownloadFile = jest.fn((_url: string, target: { uri: string }) => Promise.resolve({ uri: target.uri }));
const mockShareFile = jest.fn((_uri: string, _options: unknown) => Promise.resolve());
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}${name}`;
    }
    static downloadFileAsync(url: string, target: { uri: string }): Promise<{ uri: string }> {
      return mockDownloadFile(url, target);
    }
  },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(true),
  shareAsync: (uri: string, options: unknown) => mockShareFile(uri, options),
}));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const mockRetained = jest.fn((_list: unknown) => ({ forget: jest.fn() }));
jest.mock('@/features/shell/useRetainedListScroll', () => ({ useRetainedListScroll: (list: unknown) => mockRetained(list) }));

const VEHICLE = '01m6f7zv1vs5e2xw9a96cbqzyp';
const ME = {
  body: {
    data: {
      id: '01lukas',
      username: 'lukas.sc',
      restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
    },
  },
};

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  signIn();
  const { Share } = jest.requireActual<typeof import('react-native')>('react-native');
  jest.spyOn(Share, 'share').mockImplementation((content) => mockShare(content) as never);
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

describe('QR-02 QR detail (FS-9)', () => {
  function stubDetail(row: ReturnType<typeof qrRow> = qrRow(), extra: Parameters<typeof stubFetch>[0] = {}) {
    return stubFetch({
      '/api/v1/auth/me': ME,
      [`/api/v1/vehicles/${VEHICLE}/qr`]: { body: { data: row } },
      [`/api/v1/vehicles/${VEHICLE}/qr.svg`]: { body: QR_SVG, contentType: 'image/svg+xml' },
      ...extra,
    });
  }

  /** DQ-M54-10: the QR card lives in the "QR-Code" sheet; the row opens once the code is drawn. */
  async function openQrSheet() {
    await waitFor(() => expect(screen.getByTestId('STK-02.download.body')).toBeEnabled());
    await fireEvent.press(screen.getByTestId('STK-02.download.body'));
    await waitFor(() => expect(screen.getByTestId('STK-02.card')).toBeTruthy());
  }

  it('leads with the sticker, and keeps the code with its URL in the QR-Code sheet (DQ-M54-10)', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubDetail();
    await renderScreen(<QrDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02.stage')).toBeTruthy());
    expect(screen.getByTestId('STK-02.download')).toHaveTextContent(/8TR0 Q3MC/);
    // One filled action: no design yet, so "Sticker gestalten".
    expect(screen.getByTestId('STK-02.primary')).toHaveTextContent('Sticker gestalten');
    await openQrSheet();
    // DQ-047: "GT-R" holds together at a large font.
    expect(screen.getByTestId('STK-02.subtitle')).toHaveTextContent('Nissan Skyline GT-\u2060R R34');
    expect(screen.getByTestId('STK-02.card.shortCode')).toHaveTextContent('8TR0 Q3MC');
    expect(screen.getByTestId('STK-02.card.url')).toHaveTextContent('speedclub.de/C/8TR0Q3MC');
    expect(screen.getByLabelText('QR-\u2060Code deines Stickers für Nissan Skyline GT-R R34')).toBeTruthy();
    expect(screen.getByTestId('STK-02.download')).toBeTruthy();
    expect(screen.getByTestId('STK-02.share')).toBeTruthy();
    expect(screen.getByText('Öffentliche Seite ansehen')).toBeTruthy();
    expect(screen.getByText('Sticker-Platzierung')).toBeTruthy();
    expect(screen.getByText('QR-\u2060Code ersetzen')).toBeTruthy();
    // Phase 2 stays out: no scan statistics, no placard.
    expect(screen.queryByText(/Scans/)).toBeNull();
    expect(screen.queryByText(/Placard/i)).toBeNull();
  });

  it('opens the format sheet with PNG, the large PNG, SVG and the PDF sticker', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubDetail();
    await renderScreen(<QrDetailScreen />);
    await openQrSheet();
    await waitFor(() => expect(screen.getByTestId('STK-02.download.pdf')).toBeTruthy());
    for (const format of ['png', 'png2048', 'svg', 'pdf']) expect(screen.getByTestId(`STK-02.download.${format}`)).toBeTruthy();
    expect(screen.getByText('A6-\u2060Bogen mit Logo, Code und Platzierungshinweis')).toBeTruthy();
  });

  it('downloads a format into the cache and hands it to the share sheet, then closes the sheet', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubDetail();
    await renderScreen(<QrDetailScreen />);
    await openQrSheet();
    await waitFor(() => expect(screen.getByTestId('STK-02.download.png')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-02.download.png'));
    await waitFor(() => expect(mockShareFile).toHaveBeenCalled());
    expect(mockDownloadFile.mock.calls[0]![0]).toBe(`https://speedclub.test/api/v1/vehicles/${VEHICLE}/qr.png?size=1024`);
    expect(mockShareFile.mock.calls[0]![0]).toBe('file:///cache/speedclub-qr-8TR0Q3MC.png');
    await waitFor(() => expect(screen.queryByTestId('STK-02.download.png')).toBeNull());
  });

  it('keeps a failed download on its row with the reason, and the sheet open', async () => {
    mockParams = { vehicleId: VEHICLE };
    mockDownloadFile.mockRejectedValueOnce(new Error('UnableToDownloadException: response has status: 429'));
    stubDetail();
    await renderScreen(<QrDetailScreen />);
    await openQrSheet();
    await waitFor(() => expect(screen.getByTestId('STK-02.download.svg')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-02.download.svg'));
    await waitFor(() => expect(screen.getByTestId('STK-02.download.svg.error')).toBeTruthy());
    expect(screen.getByText('Das war etwas schnell. Warte kurz und versuch es noch einmal.')).toBeTruthy();
    expect(mockShareFile).not.toHaveBeenCalled();
  });

  it('opens the designer from the one filled action and saves the A6 sticker PDF at once (DQ-M54-10)', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubDetail();
    await renderScreen(<QrDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02.primary')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-02.primary'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId: VEHICLE } });
    await waitFor(() => expect(screen.getByTestId('STK-02.stickerPdf')).toBeEnabled());
    expect(screen.getByTestId('STK-02.stickerPdf')).toHaveTextContent('Sticker-PDF');
    await fireEvent.press(screen.getByTestId('STK-02.stickerPdf'));
    await waitFor(() => expect(mockShareFile).toHaveBeenCalled());
    expect(mockDownloadFile.mock.calls[0]![0]).toBe(`https://speedclub.test/api/v1/vehicles/${VEHICLE}/qr.pdf`);
  });

  it('offers "Sticker bestellen" once the design passed its Scan-Test, and keeps the designer as a row', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubDetail(qrRow(), {
      '/api/v1/me/stickers': {
        body: {
          data: [
            {
              vehicle: { id: VEHICLE, slug: 'nissan-skyline-gt-r-r34-5tf974vj', title: 'Skyline GT-R R34', full_title: 'Nissan Skyline GT-R R34', cover: null, public_url: 'https://speedclub.de/v/x' },
              sticker: { status: 'active', scan_state: 'active', display_code: '8TR0 Q3MC', url: 'https://speedclub.de/C/8TR0Q3MC' },
              scans_this_week: 0,
              design: null,
              actions: { design: true, order: { available: true, reason: null }, download: true },
            },
          ],
          links: {},
          meta: { next_cursor: null },
        },
      },
    });
    await renderScreen(<QrDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02.primary')).toHaveTextContent('Sticker bestellen'));
    await fireEvent.press(screen.getByTestId('STK-02.primary'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/stickers/[vehicleId]/order', params: { vehicleId: VEHICLE } });
    expect(screen.getByTestId('STK-02.design')).toBeTruthy();
  });

  it('gives a suspended owner no way into the designer or the order (DQ-M54-23)', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubDetail(qrRow(), {
      '/api/v1/auth/me': {
        body: {
          data: {
            id: '01lukas',
            username: 'lukas.sc',
            restrictions: { suspended: true, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
          },
        },
      },
    });
    await renderScreen(<QrDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02.restricted')).toBeTruthy());
    expect(screen.queryByTestId('STK-02.primary')).toBeNull();
    expect(screen.queryByTestId('STK-02.design')).toBeNull();
  });

  it('shares the public page, not the sticker address, so a share is never counted as a scan', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubDetail();
    await renderScreen(<QrDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02.share')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-02.share'));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    // M5.7 (m5.7-contract §2.4): the shared address carries `?via=share` (a view through it counts as "geteilter Link").
    expect(mockShare.mock.calls[0]![0]).toMatchObject({ url: 'https://speedclub.de/v/nissan-skyline-gt-r-r34-5tf974vj?via=share' });
  });

  it('replaces the code after the dialog, with one idempotency key, and shows the new one', async () => {
    mockParams = { vehicleId: VEHICLE };
    const next = qrRow({ code: 'K7M2P9QA', display_code: 'K7M2 P9QA', url: 'https://speedclub.de/C/K7M2P9QA' });
    let current = qrRow();
    const { calls } = stubDetail(qrRow(), {
      [`/api/v1/vehicles/${VEHICLE}/qr`]: () => ({ body: { data: current } }),
      [`/api/v1/vehicles/${VEHICLE}/qr/reissue`]: () => {
        current = next;
        return { body: { data: next } };
      },
    });
    await renderScreen(<QrDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02.reissue')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('STK-02.reissue.body'));
    await waitFor(() => expect(screen.getByTestId('STK-02.reissueDialog')).toBeTruthy());
    expect(screen.getByText(/Wer den alten Sticker scannt, sieht danach nur noch „Dieser Sticker ist nicht mehr gültig“/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('STK-02.reissueConfirm'));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    const post = calls.find((call) => call.method === 'POST')!;
    expect(new URL(post.url).pathname).toBe(`/api/v1/vehicles/${VEHICLE}/qr/reissue`);
    expect(post.headers.get('Idempotency-Key')).toBe('uuid-1');
    await waitFor(() => expect(screen.getByTestId('STK-02.download')).toHaveTextContent(/K7M2 P9QA/));
  });

  it('shows the blocked state after a staff takedown: no downloads, no reissue', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubDetail(qrRow({ status: 'revoked', scan_state: 'revoked', revoked_reason: 'moderation', downloads: null }));
    await renderScreen(<QrDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02.blocked')).toBeTruthy());
    expect(screen.getByText('Dieser Sticker ist gesperrt')).toBeTruthy();
    expect(screen.queryByTestId('STK-02.download')).toBeNull();
    expect(screen.queryByTestId('STK-02.reissue')).toBeNull();
    expect(screen.queryByTestId('STK-02.card')).toBeNull();
  });

  it('explains what a scan of a private vehicle shows', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubDetail(qrRow({ scan_state: 'private' }, { visibility: 'private' }));
    await renderScreen(<QrDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02.private')).toBeTruthy());
  });

  it('turns a draft or someone else’s vehicle into "nicht verfügbar"', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubFetch({ '/api/v1/auth/me': ME });
    await renderScreen(<QrDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02.unavailable')).toBeTruthy());
    // DQ-226: an action that leaves the page is Secondary.
    expect(visualOf('STK-02.unavailable.action').backgroundColor).toBe(carbon.bg.raised);
    await fireEvent.press(screen.getByText('Zur Garage'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/garage');
  });
});

describe('QR-04 without a page to open', () => {
  it('leads back to the garage with a Secondary action (DQ-226)', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubFetch({ '/api/v1/auth/me': ME });
    await renderScreen(<QrPreviewScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02-preview.unavailable')).toBeTruthy());
    expect(visualOf('STK-02-preview.unavailable.action').backgroundColor).toBe(carbon.bg.raised);
  });
});

describe('QR-03 copy', () => {
  it.each([
    ['de', deQr.placement.print, '4\u00A0Module'],
    ['en', enQr.placement.print, '4\u00A0modules'],
  ])('keeps the figure with its noun in the %s print line (DQ-210)', (_language, line, kept) => {
    expect(line).toContain(kept);
  });
});

describe('QR-03 placement guide', () => {
  it('uses the wording of 08_LEGAL_COMPLIANCE §7 word for word', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubFetch({ [`/api/v1/vehicles/${VEHICLE}/qr`]: { body: { data: qrRow() } } });
    await renderScreen(<QrPlacementScreen />);
    for (const sentence of [
      'Am sichersten: außen auf der Karosserie (z. B. Kofferraumdeckel, Stoßfänger) oder klein innen in einer Ecke der Heckscheibe.',
      'Heckscheibe nur, wenn dein Auto zwei Außenspiegel hat. Sonst nur ganz am Rand, damit die Sicht nach hinten frei bleibt.',
      'Vordere Seitenscheiben: nicht bekleben.',
      'Windschutzscheibe: möglichst gar nicht. Wenn überhaupt, nur ganz am Rand außerhalb des Sichtfelds und nie im Wischerbereich.',
      'Klein halten: deutlich unter 0,1 m² und nie mehr als ein Viertel einer Scheibe. Nicht spiegelnd, nicht leuchtend, keine Kennzeichen, Leuchten oder Plaketten verdecken.',
      'Keine Rechtsberatung. Maßgeblich sind die StVZO (u. a. §§ 35b, 40) und die Auslegung der Behörden. Verstöße können ein Bußgeld nach sich ziehen.',
    ]) {
      expect(screen.getByText(sentence)).toBeTruthy();
    }
    // DQ-M54-17: the print line follows the designer (10 §2.3: QR from 25 mm, white print on dark glass, black on light paint).
    expect(screen.getByText(deQr.placement.print)).toBeTruthy();
    expect(deQr.placement.print).toContain('25\u00A0mm');
    expect(screen.getByLabelText(/Auto von oben/)).toBeTruthy();
  });

  it('in English, uses the sentences the sticker PDF prints, word for word', async () => {
    await i18n.changeLanguage('en');
    try {
      mockParams = { vehicleId: VEHICLE };
      stubFetch({ [`/api/v1/vehicles/${VEHICLE}/qr`]: { body: { data: qrRow() } } });
      await renderScreen(<QrPlacementScreen />);
      for (const sentence of [
        'Safest: outside on the bodywork (e.g. boot lid, bumper) or small, inside a corner of the rear window.',
        'Rear window only if your car has two exterior mirrors. Otherwise only right at the edge, so the view to the rear stays clear.',
        'Front side windows: no stickers.',
        'Windscreen: preferably not at all. If you must, only right at the edge outside the field of view and never in the wiper area.',
        'Keep it small: well under 0.1 m² and never more than a quarter of a window. Not reflective, not illuminated, never covering number plates, lights or inspection stickers.',
        enQr.placement.print,
        'Not legal advice. The German StVZO (including §§ 35b, 40) and how the authorities apply it are decisive. Violations can result in a fine.',
      ]) {
        expect(screen.getByText(sentence)).toBeTruthy();
      }
    } finally {
      await i18n.changeLanguage('de');
    }
  });
});

describe('QR-04 public page preview', () => {
  it('opens the real public page in the in-app browser, as a guest would see it (BH-22)', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubFetch({ '/api/v1/auth/me': ME, [`/api/v1/vehicles/${VEHICLE}/qr`]: { body: { data: qrRow() } } });
    await renderScreen(<QrPreviewScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02-preview.open')).toBeTruthy());
    expect(screen.getByTestId('STK-02-preview.url')).toHaveTextContent('speedclub.de/v/nissan-skyline-gt-r-r34-5tf974vj');
    await fireEvent.press(screen.getByTestId('STK-02-preview.open'));
    await waitFor(() => expect(mockOpenBrowser).toHaveBeenCalled());
    expect(mockOpenBrowser.mock.calls[0]![0]).toBe('https://speedclub.de/v/nissan-skyline-gt-r-r34-5tf974vj?view=public');
  });

  it('says what a scan shows for an unlisted vehicle', async () => {
    mockParams = { vehicleId: VEHICLE };
    stubFetch({ '/api/v1/auth/me': ME, [`/api/v1/vehicles/${VEHICLE}/qr`]: { body: { data: qrRow({}, { visibility: 'unlisted' }) } } });
    await renderScreen(<QrPreviewScreen />);
    await waitFor(() => expect(screen.getByTestId('STK-02-preview.explain')).toHaveTextContent(/Nicht gelistet/));
  });
});
