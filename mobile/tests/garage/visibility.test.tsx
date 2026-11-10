import NetInfo from '@react-native-community/netinfo';
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { VisibilityScreen } from '@/features/garage/screens/VisibilityScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { dismissToast, useCurrentToast } from '@/ui/toast';

import { vehicle, VEHICLE_ID } from './fixtures';
import { flushQueryNotifications, ME, renderScreen, signIn, stubFetch, type Answer, type Call } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/garage',
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  usePreventRemove: jest.fn(),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

// Whole screens in the real form stack, as in screens.test.tsx: on a busy machine one test can pass the 5 s default, and
// in the full verify run the first screen of the file took longer than waitFor's 1 s to load. The shell suites allow the same.
jest.setTimeout(60_000);
configure({ asyncUtilTimeout: 15_000 });

const SWITCH = 'GAR-12.ownerOnQr.switch';
const settings = (show: boolean): Answer => ({ body: { data: { theme: 'system', locale: 'de', power_display: 'ps', show_owner_on_qr: show } } });
const RESTRICTED_ME = {
  body: {
    data: {
      ...ME.body.data,
      restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: true, until: null } },
    },
  },
};

/** The toast that is showing, as text, so a test can read what the member was told. */
function ToastProbe() {
  const current = useCurrentToast();
  return current ? <Text testID={current.testID ?? 'toast'}>{current.message}</Text> : null;
}

function connectivity(isConnected: boolean) {
  for (const [listener] of jest.mocked(NetInfo.addEventListener).mock.calls) (listener as (state: { isConnected: boolean }) => void)({ isConnected });
}

/** A PATCH that waits for the test to answer it, so the switch can be read while the call is on its way. */
function deferredSettings(answers: Record<string, Answer | ((call: Call) => Answer)>) {
  const stub = stubFetch(answers);
  const inner = globalThis.fetch;
  const gates: (() => void)[] = [];
  globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
    const request = typeof input === 'string' ? new Request(input, init) : input;
    if (request.method === 'PATCH' && new URL(request.url).pathname.endsWith('/me/settings')) {
      await new Promise<void>((resolve) => gates.push(resolve));
    }
    return inner(request);
  }) as typeof fetch;
  return { ...stub, waiting: () => gates.length, release: () => gates.shift()?.() };
}

async function show() {
  await renderScreen(
    <>
      <VisibilityScreen />
      <ToastProbe />
    </>,
  );
  await waitFor(() => expect(screen.getByTestId(SWITCH)).toBeTruthy());
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: VEHICLE_ID };
  signIn();
  dismissToast();
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

describe('GAR-12 on a draft (BH-17)', () => {
  it.each([
    ['public', 'private'],
    ['unlisted', 'public'],
  ] as const)('moving to %s says it applies from publishing, not that the car is out there', async (next, stored) => {
    const draft = vehicle({ status: 'draft', visibility: stored, qr: null });
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: draft } },
      'GET /api/v1/me/settings': settings(true),
      [`PATCH /api/v1/vehicles/${VEHICLE_ID}/visibility`]: { body: { data: { ...draft, visibility: next } } },
    });
    await show();
    await fireEvent.press(screen.getByTestId(`GAR-12.choice.${next}`));
    await fireEvent.press(screen.getByTestId('GAR-12.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-12.saved')).toHaveTextContent('Gespeichert. Gilt ab dem Veröffentlichen.'));
  });

  it('keeps the plain word on a published car', async () => {
    const published = vehicle({ visibility: 'public' });
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: published } },
      'GET /api/v1/me/settings': settings(true),
      [`GET /api/v1/public/vehicles/${published.slug}`]: { status: 404, body: { message: 'x', code: 'not_found', errors: {} } },
      [`PATCH /api/v1/vehicles/${VEHICLE_ID}/visibility`]: { body: { data: { ...published, visibility: 'private' } } },
    });
    await show();
    await fireEvent.press(screen.getByTestId('GAR-12.choice.private'));
    await fireEvent.press(screen.getByTestId('GAR-12.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-12.saved')).toHaveTextContent(/privat/));
  });
});

describe('GAR-12 Besitzer auf der QR-Seite zeigen', () => {
  it('says it applies to every vehicle of the account, what "off" does, and shows the stored value', async () => {
    stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } }, 'GET /api/v1/me/settings': settings(true) });
    await show();
    expect(screen.getByTestId('GAR-12.ownerOnQr')).toHaveTextContent(/Für alle deine Fahrzeuge/);
    // DQ-209: the group title names every vehicle, so the helper only says what "off" does, true to the PDF (QrSticker).
    expect(screen.getByTestId('GAR-12.ownerOnQr')).toHaveTextContent(
      /Ist der Schalter aus, siehst nur du deinen Namen auf deinen Fahrzeugseiten, und neue Sticker-PDFs kommen ohne ihn\./,
    );
    expect(screen.getByRole('switch', { name: 'Besitzer auf der QR-⁠Seite' })).toBeChecked();
    // DQ-208: a row on its own surface card, like every other group of the page.
    expect(screen.getByTestId('GAR-12.ownerOnQr.row')).toHaveTextContent(/Besitzer auf der QR/);
    expect(screen.getByTestId(SWITCH)).not.toBeDisabled();
  });

  it('moves at once, sends only show_owner_on_qr, and keeps the server’s answer', async () => {
    const { calls, release, waiting } = deferredSettings({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      'GET /api/v1/me/settings': settings(true),
      'PATCH /api/v1/me/settings': settings(false),
    });
    await show();
    await act(async () => fireEvent.press(screen.getByTestId(SWITCH)));
    await flushQueryNotifications();
    // Optimistic: off before the server answered, which it cannot until the test releases the PATCH.
    expect(screen.getByTestId(SWITCH)).not.toBeChecked();
    await waitFor(() => expect(waiting()).toBe(1));
    await flushQueryNotifications();
    expect(screen.getByTestId(SWITCH)).not.toBeChecked();
    expect(waiting()).toBe(1);
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ show_owner_on_qr: false }));
    await waitFor(() => expect(screen.getByTestId(SWITCH)).not.toBeChecked());
    expect(screen.queryByTestId('GAR-12.ownerOnQr.failed')).toBeNull();
    // Apart from the form: the visibility's Speichern stays closed, nothing there changed.
    expect(screen.getByTestId('GAR-12.cta.primary')).toBeDisabled();
  });

  it('says so once the switch has saved, because Speichern under it stays greyed out (DQ-212)', async () => {
    const { release, waiting } = deferredSettings({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      'GET /api/v1/me/settings': settings(true),
      'PATCH /api/v1/me/settings': settings(false),
    });
    await show();
    await act(async () => fireEvent.press(screen.getByTestId(SWITCH)));
    await waitFor(() => expect(waiting()).toBe(1));
    // Not before the server has it.
    expect(screen.queryByTestId('GAR-12.ownerOnQr.saved')).toBeNull();
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('GAR-12.ownerOnQr.saved')).toHaveTextContent('Einstellung gespeichert'));
    expect(screen.getByTestId('GAR-12.cta.primary')).toBeDisabled();
  });

  it('does not repeat the page title over the choice (DQ-176)', async () => {
    stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } }, 'GET /api/v1/me/settings': settings(true) });
    await show();
    expect(screen.getByRole('heading', { name: 'Dieses Fahrzeug' })).toBeTruthy();
  });

  it('goes back and says why when the server refuses', async () => {
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      'GET /api/v1/me/settings': settings(true),
      'PATCH /api/v1/me/settings': { status: 429, body: { message: 'Zu viele Anfragen.', code: 'rate_limited', errors: {} } },
    });
    await show();
    await act(async () => fireEvent.press(screen.getByTestId(SWITCH)));
    await waitFor(() => expect(screen.getByTestId('GAR-12.ownerOnQr.failed')).toBeTruthy());
    await flushQueryNotifications();
    expect(screen.getByTestId(SWITCH)).toBeChecked();
    expect(screen.getByTestId('GAR-12.ownerOnQr.failed')).toHaveTextContent(/Zu viele/);
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('goes back when the connection drops on the way', async () => {
    stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } }, 'GET /api/v1/me/settings': settings(false) });
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
      const request = typeof input === 'string' ? new Request(input, init) : input;
      if (request.method === 'PATCH') throw new TypeError('Network request failed');
      return inner(request);
    }) as typeof fetch;
    await show();
    expect(screen.getByTestId(SWITCH)).not.toBeChecked();
    await act(async () => fireEvent.press(screen.getByTestId(SWITCH)));
    await waitFor(() => expect(screen.getByTestId('GAR-12.ownerOnQr.failed')).toBeTruthy());
    await flushQueryNotifications();
    expect(screen.getByTestId(SWITCH)).not.toBeChecked();
  });

  it('takes no taps while offline', async () => {
    const { calls } = stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } }, 'GET /api/v1/me/settings': settings(true) });
    await show();
    try {
      await act(async () => connectivity(false));
      expect(screen.getByTestId(SWITCH)).toBeDisabled();
      await act(async () => fireEvent.press(screen.getByTestId(SWITCH)));
      expect(screen.getByTestId(SWITCH)).toBeChecked();
      expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
    } finally {
      await act(async () => connectivity(true));
    }
    expect(screen.getByTestId(SWITCH)).not.toBeDisabled();
  });

  it('stays open under a publishing restriction, which the server allows for this setting', async () => {
    const { calls } = stubFetch({
      '/api/v1/auth/me': RESTRICTED_ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      'GET /api/v1/me/settings': settings(true),
      'PATCH /api/v1/me/settings': settings(false),
    });
    await show();
    await waitFor(() => expect(screen.getByTestId('GAR-12.restricted')).toBeTruthy());
    expect(screen.getByTestId(SWITCH)).not.toBeDisabled();
    await act(async () => fireEvent.press(screen.getByTestId(SWITCH)));
    await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ show_owner_on_qr: false }));
    await flushQueryNotifications();
    expect(screen.getByTestId(SWITCH)).not.toBeChecked();
  });

  it('offers a retry when the setting cannot be loaded', async () => {
    let fail = true;
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      'GET /api/v1/me/settings': () => (fail ? { status: 503, body: { message: 'Wartung', code: 'server_error', errors: {} } } : settings(false)),
    });
    await renderScreen(<VisibilityScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-12.ownerOnQr.error')).toBeTruthy(), { timeout: 15_000 });
    expect(screen.getByTestId('GAR-12.ownerOnQr.error')).toHaveTextContent(/Diese Einstellung konnte nicht geladen werden\./);
    fail = false;
    await act(async () => fireEvent.press(screen.getByTestId('GAR-12.ownerOnQr.retry')));
    await waitFor(() => expect(screen.getByTestId(SWITCH)).not.toBeChecked());
  });
});

describe('GAR-12 loading', () => {
  it('draws the page’s own skeleton while the vehicle is on its way, not the form skeleton (DQ-207)', async () => {
    stubFetch({ '/api/v1/auth/me': ME, 'GET /api/v1/me/settings': settings(true) });
    const answered = globalThis.fetch;
    globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
      const request = typeof input === 'string' ? new Request(input, init) : input;
      if (new URL(request.url).pathname.endsWith(`/vehicles/${VEHICLE_ID}`)) return new Promise<Response>(() => undefined);
      return answered(request);
    }) as typeof fetch;
    await renderScreen(<VisibilityScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-12.skeleton')).toBeTruthy());
    expect(screen.getByTestId('GAR-12.skeleton.choice')).toBeTruthy();
    expect(screen.getByTestId('GAR-12.skeleton.ownerOnQr')).toBeTruthy();
    expect(screen.queryByTestId('GAR-12.choice')).toBeNull();
    expect(screen.queryByTestId(SWITCH)).toBeNull();
  });
});
