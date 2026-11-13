import NetInfo from '@react-native-community/netinfo';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import * as ReactNative from 'react-native';

import { BlurTool } from '@/features/garage/components/BlurTool';
import { evenChipLayout } from '@/features/garage/components/fields';
import { SortHandleSlot, Sortable } from '@/features/garage/components/Sortable';
import { EditBasicsScreen } from '@/features/garage/screens/EditBasicsScreen';
import { GarageScreen } from '@/features/garage/screens/GarageScreen';
import { HistoryScreen } from '@/features/garage/screens/HistoryScreen';
import { ModEditorScreen } from '@/features/garage/screens/ModEditorScreen';
import { ModsScreen } from '@/features/garage/screens/ModsScreen';
import { AltFieldSkeleton, PhotoEditScreen } from '@/features/garage/screens/PhotoEditScreen';
import { PhotosScreen } from '@/features/garage/screens/PhotosScreen';
import { WizardReviewScreen } from '@/features/garage/screens/wizard/WizardReviewScreen';
import { WizardPhotosScreen } from '@/features/garage/screens/wizard/WizardPhotosScreen';
import { WizardVehicleScreen } from '@/features/garage/screens/wizard/WizardVehicleScreen';
import type { OwnerUpdate } from '@/api/queries/garage';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, themes, typography } from '@/theme';

import { flat, visualOf } from '../ui/helpers';
import { card, draftCard, media, vehicle, VEHICLE_ID, WHEEL_FIELDS, wheelMod } from './fixtures';
import { flushQueryNotifications, list, ME, renderScreen, signIn, signOut, stubFetch } from './harness';

const mockWindow: { current: { width: number; height: number; scale: number; fontScale: number } | null } = { current: null };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => {
  const actual = jest.requireActual<{ default: () => unknown }>('react-native/Libraries/Utilities/useWindowDimensions');
  return { __esModule: true, default: () => mockWindow.current ?? actual.default() };
});

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
const mockRootGoBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/garage',
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: mockRootGoBack }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  usePreventRemove: jest.fn(),
  Link: ({ children }: { children: unknown }) => children,
}));
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
};
// Items render in place: virtualisation needs a layout Jest does not have.
jest.mock('@shopify/flash-list', () => {
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList({ data, renderItem, ListHeaderComponent, ListEmptyComponent, ListFooterComponent }, _ref) {
    return (
      <>
        {ListHeaderComponent}
        {data.length === 0 ? ListEmptyComponent : data.map((item, index) => renderItem({ item, index }))}
        {ListFooterComponent}
      </>
    );
  });
  return { FlashList };
});
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

const MAKES = list([
  { id: 1, name: 'BMW', slug: 'bmw', country: 'DE', is_popular: true },
  { id: 34, name: 'Nissan', slug: 'nissan', country: 'JP', is_popular: true },
]);
const MODELS = list([{ id: 254, make_id: 34, name: 'Skyline GT-R', slug: 'skyline-gt-r' }]);
const carbon = themes.carbon.color;

/** The text of an element as it is set, no-break spaces included, which `toHaveTextContent` normalises away. */
function flatText(node: ReturnType<typeof screen.getByTestId> | string): string {
  return typeof node === 'string' ? node : node.children.map(flatText).join('');
}

// Whole screens in the real form stack: on a busy machine (parallel suites, other agents' exports) one keystroke-driven test
// such as GAR-10 takes 5 to 9 s (measured with and without the M1.6 fixes), past the 5 s default. The shell and router suites
// allow the same; no assertion changes.
jest.setTimeout(60_000);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  signIn();
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

function width(value: number) {
  mockWindow.current = { width: value, height: 900, scale: 1, fontScale: 1 };
}

describe('GAR-01 Garage', () => {
  afterEach(() => {
    mockWindow.current = null;
  });

  it('shows the main vehicle with its badge, completeness and QR button, then the drafts (FS-4)', async () => {
    width(390);
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': list([card(), draftCard()]) });
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}`)).toBeTruthy());
    expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.badge`)).toHaveTextContent('Hauptfahrzeug');
    expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.completeness`)).toHaveTextContent('Build zu 70 % vollständig');
    expect(screen.getByText('Entwürfe')).toBeTruthy();
    // DQ-152: it wraps after the dot only, "Schritt 2 von 4" stays together.
    expect(screen.getByText('Entwurf · Schritt 2 von 4')).toBeTruthy();
    expect(screen.getByTestId('GAR-01.add')).toBeTruthy();
    // 09 §7.6: the private stats line, only from what the list carries (14 mods and 3 photos on the fixture's card).
    expect(screen.getByTestId('GAR-01.stats.line')).toHaveTextContent('1\u00a0Fahrzeug · 14\u00a0Mods · 3\u00a0Fotos');
    // The quick actions of the car: QR keeps the card's `.qr` id the flows press.
    await fireEvent.press(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.qr`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/qr/${VEHICLE_ID}`);
    await fireEvent.press(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.mods`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/garage/${VEHICLE_ID}/mods`);
    await fireEvent.press(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.update`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/post-update', params: { vehicleId: VEHICLE_ID } });
    await fireEvent.press(screen.getByTestId('GAR-01.draft.01draft.body'));
    expect(mockRouter.push).toHaveBeenCalledWith('/add-vehicle/01draft/specs', { withAnchor: true });
  });

  it('loads in the shape of FS-4’s card, with the completeness line and the QR button (DQ-166)', async () => {
    width(390);
    stubFetch({ '/api/v1/auth/me': ME });
    globalThis.fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-01.skeleton.footer', { includeHiddenElements: true })).toBeTruthy());
  });

  it('leaves the add action to the sidebar from 1280 (DQ-084)', async () => {
    width(1280);
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': list([card()]) });
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}`)).toBeTruthy());
    expect(screen.queryByTestId('GAR-01.add')).toBeNull();
  });

  it.each([
    [1280, 'flex-start'],
    [1000, 'center'],
  ])('at %i the column stands on %s, so the large title stays put between the tabs from 1280 (DQ-202)', async (window, alignSelf) => {
    width(window);
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': list([card()]) });
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}`)).toBeTruthy());
    expect(flat(screen.getByTestId('GAR-01.title').props.style).alignSelf).toBe(alignSelf);
  });

  it('greets an empty garage with a photo, its one action and a sample card badged Beispiel (09 §7.6)', async () => {
    width(390);
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': list([]) });
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-01.empty')).toBeTruthy());
    expect(screen.getByTestId('GAR-01.empty.title')).toHaveTextContent('Deine Garage wartet.');
    expect(screen.getByTestId('GAR-01.empty.photo')).toBeTruthy();
    expect(screen.getByTestId('GAR-01.empty.sample.sample')).toHaveTextContent('Beispiel');
    await fireEvent.press(screen.getByTestId('GAR-01.empty.action'));
    expect(mockRouter.push).toHaveBeenCalledWith('/add-vehicle/new/vehicle');
  });

  it('lays the cards out two to a row from 1280, not as one stretched phone column (DQ-921)', async () => {
    width(1440);
    const second = card({ id: '01second', is_main: false, full_title: 'BMW M3 E46' });
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': list([card(), second]) });
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}`)).toBeTruthy());
    expect(screen.getByTestId('GAR-01.grid')).toBeTruthy();
    expect(screen.getByTestId('GAR-01.card.01second')).toBeTruthy();
    expect(screen.queryByTestId('GAR-01.carousel')).toBeNull();
  });

  it('shows the cars in the SM16 carousel on a phone', async () => {
    width(390);
    const second = card({ id: '01second', is_main: false, full_title: 'BMW M3 E46' });
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': list([card(), second]) });
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-01.carousel')).toBeTruthy());
    expect(screen.getByTestId(`GAR-01.carousel.card.${VEHICLE_ID}`)).toBeTruthy();
    expect(screen.getByTestId('GAR-01.carousel.card.01second')).toBeTruthy();
    // One page indicator and one action row, QR included, for the centred (first) car only: a QR control floating on the photo
    // overlapped the card's link (DOM audit overlap, m4.10-shots).
    expect(screen.getByTestId('GAR-01.pages').props['aria-label']).toBe('Fahrzeug 1 von 2');
    expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.qr`)).toBeTruthy();
    expect(screen.queryByTestId('GAR-01.card.01second.qr')).toBeNull();
    expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.update`)).toBeTruthy();
    expect(screen.queryByTestId('GAR-01.card.01second.update')).toBeNull();
    expect(screen.getByTestId('GAR-01.stats.line')).toHaveTextContent('2\u00a0Fahrzeuge · 28\u00a0Mods · 6\u00a0Fotos');
  });

  it('draws the 2.0 card: display title, caption, mini spec and status on the photo (DQ-1050)', async () => {
    width(390);
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': list([card()]) });
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.title`)).toBeTruthy());
    expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.status`)).toHaveTextContent('Öffentlich');
    expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.spec`)).toHaveTextContent(/LeistungDrehmoment|Leistung/);
    // One action row: the filled "Update posten" and two secondary buttons, no tile grid (DQ-1051).
    expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.update`)).toHaveTextContent('Update posten');
    expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.mods`)).toHaveTextContent('Mods');
  });

  it('closes the editing actions under a restriction, the QR code stays (DQ-1067 a)', async () => {
    width(390);
    stubFetch({ '/api/v1/auth/me': RESTRICTED_ME, '/api/v1/me/vehicles': list([card()]) });
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-01.restricted')).toBeTruthy());
    for (const action of ['update', 'mods', 'photos']) {
      expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.${action}`).props.accessibilityState?.disabled ?? screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.${action}`).props['aria-disabled']).toBe(true);
    }
    expect(screen.getByTestId(`GAR-01.card.${VEHICLE_ID}.qr`)).toBeTruthy();
  });

  it('names the page and the cause when the list fails (DQ-1078)', async () => {
    width(390);
    stubFetch({ '/api/v1/auth/me': ME, '/api/v1/me/vehicles': { status: 500, body: { message: 'x' } } });
    await renderScreen(<GarageScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-01.error')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByTestId('GAR-01.error')).toHaveTextContent(/Deine Garage konnte nicht geladen werden\./);
  });

  it('invites a guest to sign in instead of loading anything', async () => {
    width(390);
    signOut();
    const { calls } = stubFetch({});
    await renderScreen(<GarageScreen />);
    expect(screen.getByTestId('GAR-01.guest')).toBeTruthy();
    expect(calls.filter((call) => call.path.endsWith('/me/vehicles'))).toHaveLength(0);
  });
});

describe('GAR-03 wizard', () => {
  it('creates the draft from the catalogue on Weiter, with an idempotency key, and moves to Technik', async () => {
    mockParams = { draftId: 'new' };
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      '/api/v1/catalog/makes': MAKES,
      '/api/v1/catalog/makes/34/models': MODELS,
      '/api/v1/catalog/models/254/generations': list([]),
      'POST /api/v1/vehicles': { status: 201, body: { data: vehicle({ id: '01new', wizard: { step: 2, total_steps: 4 }, status: 'draft' }) } },
    });
    await renderScreen(<WizardVehicleScreen />);
    expect(screen.getByTestId('GAR-03.caption')).toHaveTextContent('Schritt 1 von 4 · Fahrzeug');
    await fireEvent.press(screen.getByTestId('GAR-03.make'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.makeSheet.option.34')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-03.makeSheet.search'), 'nis');
    expect(screen.queryByTestId('GAR-03.makeSheet.option.1')).toBeNull();
    await fireEvent.press(screen.getByTestId('GAR-03.makeSheet.option.34.body'));
    await fireEvent.press(screen.getByTestId('GAR-03.model'));
    await waitFor(() => expect(screen.getByTestId('GAR-03.modelSheet.option.254')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-03.modelSheet.option.254.body'));
    await fireEvent.changeText(screen.getByTestId('GAR-03.year'), '2002');
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/add-vehicle/01new/specs'));
    const create = calls.find((call) => call.method === 'POST' && call.path.endsWith('/vehicles'));
    expect(create?.body).toEqual({ make_id: 34, model_id: 254, generation_id: null, model_year: 2002, nickname: null, color: null, description: null, wizard_step: 2 });
    expect(create?.headers.get('Idempotency-Key')).toBe('uuid-1');
  });

  it('asks for make, model and year before it saves anything', async () => {
    mockParams = { draftId: 'new' };
    const { calls } = stubFetch({ '/api/v1/auth/me': ME, '/api/v1/catalog/makes': MAKES });
    await renderScreen(<WizardVehicleScreen />);
    await fireEvent.press(screen.getByTestId('GAR-03.vehicle.cta.primary'));
    await waitFor(() => expect(screen.getByText('Wähle die Marke.')).toBeTruthy());
    expect(screen.getByText('Gib das Baujahr ein.')).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('publishes with the chosen visibility and replaces the wizard with GAR-04', async () => {
    mockParams = { draftId: '01new' };
    const draft = vehicle({ id: '01new', status: 'draft', wizard: { step: 4, total_steps: 4 }, qr: null });
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      'GET /api/v1/vehicles/01new': { body: { data: draft } },
      // BH-08: the choice saves when it is made, so the publish waits for this answer.
      'PATCH /api/v1/vehicles/01new/visibility': { body: { data: { ...draft, visibility: 'unlisted' } } },
      'POST /api/v1/vehicles/01new/publish': { body: { data: { ...draft, status: 'published', qr: { code: '8TR0Q3MC', url: 'https://speedclub.test/C/8TR0Q3MC' } } } },
    });
    await renderScreen(<WizardReviewScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.card')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-03.review.visibility.unlisted'));
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/visibility'))).toBe(true));
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.cta.primary')).not.toBeBusy());
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/published/[vehicleId]', params: { vehicleId: '01new' } }));
    const publish = calls.find((call) => call.path.endsWith('/publish'));
    expect(publish?.body).toEqual({ visibility: 'unlisted' });
  });

  it('sends an unverified member to confirm the address first', async () => {
    mockParams = { draftId: '01new' };
    const draft = vehicle({ id: '01new', status: 'draft', wizard: { step: 4, total_steps: 4 } });
    stubFetch({
      '/api/v1/auth/me': ME,
      'GET /api/v1/vehicles/01new': { body: { data: draft } },
      'POST /api/v1/vehicles/01new/publish': { status: 403, body: { message: 'Bestätige zuerst deine E-Mail-Adresse.', code: 'email_not_verified', errors: {} } },
    });
    await renderScreen(<WizardReviewScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-03.review.card')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-03.review.cta.primary'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/verify-email'));
  });
});

describe('GAR-10 Räder & Reifen', () => {
  it('shows the live line of FS-6 and sends the fields as JSON numbers', async () => {
    mockParams = { id: VEHICLE_ID, modId: 'new', category: 'wheels_tires' };
    width(390);
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      '/api/v1/catalog/mod-categories': list([{ id: 1, key: 'wheels_tires', name: 'Räder & Reifen', icon: 'wheel', fields: WHEEL_FIELDS }]),
      '/api/v1/catalog/brands': list([{ id: 7, name: 'BBS', slug: 'bbs', category_hint: 'wheels_tires', aliases: [] }]),
      [`POST /api/v1/vehicles/${VEHICLE_ID}/mods`]: { status: 201, body: { data: { id: '01mod' } } },
    });
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.wheel_brand')).toBeTruthy());
    expect(screen.getByTestId('GAR-10.group.rims')).toBeTruthy();
    expect(screen.getByTestId('GAR-10.group.tyres')).toBeTruthy();
    // DQ-177: the catalogue's example is the English "5x120"; the placeholder is written the German way.
    expect(screen.getByTestId('GAR-10.field.bolt_pattern').props.placeholder).toBe('z. B. 5×114,3');
    await fireEvent(screen.getByTestId('GAR-10.field.wheel_brand'), 'focus');
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.wheel_brand'), 'bb');
    await fireEvent.press(screen.getByTestId('GAR-10.field.wheel_brand.suggestion.7.body'));
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.wheel_model'), 'LM');
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.diameter'), '19');
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.width_front'), '9,5');
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.et_front'), '35');
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.tyre_size_front'), '2553519');
    expect(flatText(screen.getByTestId('GAR-10.preview.text')).replace(/\u2060/g, '').replace(/\u00A0/g, ' ')).toBe('BBS LM · 19″ × 9,5J ET35 · 255/35 R19');
    // DQ-167: "9,5J ET35" never splits; the words of a long name still wrap.
    expect(flatText(screen.getByTestId('GAR-10.preview.text'))).toContain('19″\u00A0×\u00A09,5J\u00A0ET35');
    expect(flatText(screen.getByTestId('GAR-10.preview.text'))).toContain('BBS LM');
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/mods'))).toBe(true));
    const create = calls.find((call) => call.method === 'POST' && call.path.endsWith('/mods'));
    expect(create?.body).toMatchObject({
      category: 'wheels_tires',
      status: 'installed',
      cost_public: false,
      fields: { wheel_brand: 'BBS', wheel_model: 'LM', diameter: 19, width_front: 9.5, et_front: 35, tyre_size_front: '255/35 R19' },
    });
    expect(create?.headers.get('Idempotency-Key')).toBe('uuid-1');
  });
});

const RESTRICTED_ME = {
  body: {
    data: {
      ...ME.body.data,
      restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: true, until: null } },
    },
  },
};

/** What NetInfo reports to every handler the rendered screen registered (src/state/online.ts). */
function connectivity(isConnected: boolean) {
  for (const [listener] of jest.mocked(NetInfo.addEventListener).mock.calls) (listener as (state: { isConnected: boolean }) => void)({ isConnected });
}

async function layOut(testID: string) {
  await act(async () => {
    fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { width: 360, height: 400, x: 0, y: 0 } } });
  });
}

describe('GAR-07 Fotos under a restriction', () => {
  it('still deletes a photo, while adding, the cover and editing stay closed (ADR-146 b)', async () => {
    mockParams = { id: VEHICLE_ID };
    let deleted = false;
    const { calls } = stubFetch({
      '/api/v1/auth/me': RESTRICTED_ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: () => ({ body: { data: vehicle(deleted ? { photos: [media('01cover')] } : {}) } }),
      'DELETE /api/v1/media/01side': () => {
        deleted = true;
        return { status: 204, body: null };
      },
    });
    await renderScreen(<PhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-07.restricted')).toBeTruthy());
    await layOut('GAR-07.photos');
    expect(screen.getByTestId('GAR-07.photos.add')).toBeDisabled();
    const tile = screen.getByTestId('GAR-07.photos.photo.01side');
    expect(tile).not.toBeDisabled();
    await fireEvent.press(tile);
    await waitFor(() => expect(screen.getByTestId('GAR-07.photoSheet.delete')).toBeTruthy());
    expect(screen.queryByTestId('GAR-07.photoSheet.cover')).toBeNull();
    expect(screen.queryByTestId('GAR-07.photoSheet.edit')).toBeNull();
    await fireEvent.press(screen.getByTestId('GAR-07.photoSheet.delete.body'));
    await fireEvent.press(screen.getByTestId('GAR-07.deletePhoto.confirm'));
    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/media/01side'))).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('GAR-07.photos.photo.01side')).toBeNull());
  });

  it('takes no taps on the photos while offline', async () => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } } });
    await renderScreen(<PhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-07.photos')).toBeTruthy());
    await layOut('GAR-07.photos');
    expect(screen.getByTestId('GAR-07.photos.photo.01side')).not.toBeDisabled();
    try {
      await act(async () => connectivity(false));
      expect(screen.getByTestId('GAR-07.photos.photo.01side')).toBeDisabled();
    } finally {
      await act(async () => connectivity(true));
    }
  });
});

describe('GAR-10 mod photos', () => {
  const categories = list([{ id: 1, key: 'wheels_tires', name: 'Räder & Reifen', icon: 'wheel', fields: WHEEL_FIELDS }]);

  it('deletes a photo under a restriction and drops it from the grid, which reads the mod', async () => {
    mockParams = { id: VEHICLE_ID, modId: '01wheels' };
    let deleted = false;
    const { calls } = stubFetch({
      '/api/v1/auth/me': RESTRICTED_ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      '/api/v1/catalog/mod-categories': categories,
      '/api/v1/catalog/brands': list([]),
      'GET /api/v1/mods/01wheels': () => ({ body: { data: wheelMod({ photos: deleted ? [media('01p2')] : [media('01p1'), media('01p2')] }) } }),
      'DELETE /api/v1/media/01p1': () => {
        deleted = true;
        return { status: 204, body: null };
      },
    });
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.photos')).toBeTruthy());
    await layOut('GAR-10.photos');
    expect(screen.getByTestId('GAR-10.photos.add')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('GAR-10.photos.photo.01p1'));
    await fireEvent.press(screen.getByTestId('GAR-10.deletePhoto.confirm'));
    await waitFor(() => expect(screen.queryByTestId('GAR-10.photos.photo.01p1')).toBeNull());
    expect(screen.getByTestId('GAR-10.photos.photo.01p2')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    // The mod itself reads again, so the grid shows the server's word, not only the local removal.
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET' && call.path.endsWith('/mods/01wheels')).length).toBeGreaterThan(1));
  });
});

describe('GAR-09 Mods', () => {
  it('keeps the empty state’s action as closed as the header’s under a restriction', async () => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({
      '/api/v1/auth/me': RESTRICTED_ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      [`GET /api/v1/vehicles/${VEHICLE_ID}/mods`]: list([]),
      '/api/v1/catalog/mod-categories': list([]),
    });
    await renderScreen(<ModsScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-09.empty.action')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('GAR-09.restricted')).toBeTruthy());
    expect(screen.getByTestId('GAR-09.empty.action')).toBeDisabled();
    expect(screen.getByTestId('GAR-09.add')).toBeDisabled();
  });
});

describe('GAR-09 without mods', () => {
  it('offers the first mod as the page’s primary action (DQ-226)', async () => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      [`GET /api/v1/vehicles/${VEHICLE_ID}/mods`]: list([]),
      '/api/v1/catalog/mod-categories': list([]),
    });
    await renderScreen(<ModsScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-09.empty.action')).toBeTruthy());
    expect(visualOf('GAR-09.empty.action').backgroundColor).toBe(carbon.bg.inverse);
  });
});

describe('GAR-11 entries', () => {
  const update = (overrides: Partial<OwnerUpdate>): OwnerUpdate => ({
    id: '01upd',
    type: 'mod_changed',
    type_label: 'Modifikation geändert',
    note: null,
    summary: 'Fahrwerk: Serie → KW V3 · −35 mm',
    changes: [
      {
        kind: 'mod_changed',
        category: 'suspension',
        modification_id: '01mod',
        label: 'Fahrwerk',
        before: 'Serie',
        after: 'KW V3 · −35 mm',
        text: 'Fahrwerk: Serie → KW V3 · −35 mm',
        details: [],
      },
    ],
    changes_count: 1,
    hidden: false,
    created_at: null,
    month_label: 'März 2023',
    vehicle_id: VEHICLE_ID,
    mileage_km: null,
    happened_on: null,
    audience: 'vehicle',
    edited_at: null,
    photos: [],
    photo_pairs: [],
    modifications: [],
    mentions: [],
    my_reaction: null,
    ...overrides,
  });
  const show = async (entries: OwnerUpdate[]) => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      [`GET /api/v1/vehicles/${VEHICLE_ID}/updates`]: list(entries),
    });
    await renderScreen(<HistoryScreen />);
  };

  it('titles one named change as VEH-01 does, the system and key value under it, the kind never twice (DQ-175, DQ-1059)', async () => {
    await show([update({})]);
    await waitFor(() => expect(screen.getByTestId('GAR-11.entry.01upd')).toBeTruthy());
    // DQ-1072: VEH-01's Timeline line, the system and the value as their own texts around the "·".
    expect(screen.getByTestId('GAR-11.entry.01upd')).toHaveTextContent(/^KW V3 statt Serie\s*Fahrwerk\s*·\s*−35\s*mm/);
    expect(screen.getByTestId('GAR-11.entry.01upd')).not.toHaveTextContent('Modifikation geändert');
    expect(screen.getByLabelText('KW V3 statt Serie ausblenden')).toBeTruthy();
  });

  it('keeps the kind as the title of an entry without changes, and says it once', async () => {
    await show([update({ id: '01pho', type: 'photos_added', type_label: 'Fotos hinzugefügt', summary: '3 Fotos', changes: [], changes_count: 0 })]);
    await waitFor(() => expect(screen.getByTestId('GAR-11.entry.01pho')).toHaveTextContent('Fotos hinzugefügt3 Fotos'));
    expect(screen.getByTestId('GAR-11.entry.01pho')).not.toHaveTextContent(/Fotos hinzugefügt.*Fotos hinzugefügt/);
  });

  it('counts what an entry leaves out', async () => {
    await show([update({ id: '01many', changes_count: 5 })]);
    await waitFor(() => expect(screen.getByTestId('GAR-11.entry.01many')).toHaveTextContent(/und 4 weitere Änderungen/));
  });

  it('offers the first note as the page’s primary action (DQ-226)', async () => {
    await show([]);
    await waitFor(() => expect(screen.getByTestId('GAR-11.empty.action')).toBeTruthy());
    expect(visualOf('GAR-11.empty.action').backgroundColor).toBe(carbon.bg.inverse);
  });
});

describe('GAR-05 and the catalogue', () => {
  it('draws the form once the generations are known, so the field and the year’s helper do not arrive late (DQ-184)', async () => {
    mockParams = { id: VEHICLE_ID };
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      '/api/v1/catalog/makes': MAKES,
      '/api/v1/catalog/makes/34/models': MODELS,
    });
    const answered = globalThis.fetch;
    let answer: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
      const request = typeof input === 'string' ? new Request(input, init) : input;
      if (!new URL(request.url).pathname.endsWith('/generations')) return answered(request);
      await held;
      return new Response(JSON.stringify({ data: [{ id: 120, name: 'R34', year_from: 1999, year_to: 2002 }], links: {}, meta: { next_cursor: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    await renderScreen(<EditBasicsScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-05.skeleton', { includeHiddenElements: true })).toBeTruthy());
    expect(screen.queryByTestId('GAR-05.make')).toBeNull();
    await act(async () => answer());
    await waitFor(() => expect(screen.getByTestId('GAR-05.make')).toBeTruthy());
    expect(screen.getByTestId('GAR-05.generation')).toBeTruthy();
    expect(screen.getByTestId('GAR-05.year.helper')).toHaveTextContent(/1999/);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('does not hold the form back when the generations fail', async () => {
    mockParams = { id: VEHICLE_ID };
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      '/api/v1/catalog/makes': MAKES,
      '/api/v1/catalog/makes/34/models': MODELS,
      '/api/v1/catalog/models/254/generations': { status: 500, body: { message: 'Fehler', code: 'server', errors: {} } },
    });
    await renderScreen(<EditBasicsScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-05.make')).toBeTruthy());
    // The form's own observer asks once more. It must not take the form away again, or the two would go on for ever.
    await flushQueryNotifications();
    await flushQueryNotifications();
    expect(screen.getByTestId('GAR-05.make')).toBeTruthy();
    expect(calls.filter((call) => call.path.endsWith('/generations')).length).toBeLessThanOrEqual(2);
  });
});

describe('provenance chips (DQ-169)', () => {
  // Label widths of Herstellerangabe, Geschätzt and Prüfstand at 14/600.
  const LABELS = [88, 109, 65];

  it('stay on one row where they fit, share two even columns where they do not, and wrap where even a column is too narrow', () => {
    expect(evenChipLayout(390, LABELS)).toBe('row');
    expect(evenChipLayout(350, LABELS)).toBe('columns');
    expect(evenChipLayout(328, LABELS)).toBe('columns');
    expect(evenChipLayout(328, LABELS.map((label) => label * 2))).toBe('wrap');
  });

  it('wait for the measure', () => {
    expect(evenChipLayout(0, LABELS)).toBeNull();
    expect(evenChipLayout(328, [88, 0, 65])).toBeNull();
  });
});

describe('GAR-03 step 3', () => {
  it('has no eyebrow repeating the field’s label (DQ-176)', async () => {
    mockParams = { draftId: VEHICLE_ID };
    stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle({ status: 'draft', wizard: { step: 3, total_steps: 4 } }) } } });
    await renderScreen(<WizardPhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-03.description')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Beschreibung' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Fotos' })).toBeTruthy();
  });
});

describe('GAR-11 note', () => {
  it('asks before a typed note is thrown away, and keeps it on "Weiterschreiben"', async () => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
      [`GET /api/v1/vehicles/${VEHICLE_ID}/updates`]: list([]),
    });
    await renderScreen(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-11.empty')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-11.empty.action'));
    await waitFor(() => expect(screen.getByTestId('GAR-11.noteSheet.input')).toBeTruthy());
    // Empty: closes at once.
    await fireEvent.press(screen.getByTestId('GAR-11.noteSheet.scrim'));
    await waitFor(() => expect(screen.queryByTestId('GAR-11.noteSheet.input')).toBeNull());
    await fireEvent.press(screen.getByTestId('GAR-11.empty.action'));
    await waitFor(() => expect(screen.getByTestId('GAR-11.noteSheet.input')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-11.noteSheet.input'), 'Erster Trackday');
    await fireEvent.press(screen.getByTestId('GAR-11.noteSheet.scrim'));
    await waitFor(() => expect(screen.getByTestId('GAR-11.noteSheet.discard.keep')).toBeTruthy());
    expect(screen.getByText('Notiz verwerfen?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('GAR-11.noteSheet.discard.keep'));
    await waitFor(() => expect(screen.queryByTestId('GAR-11.noteSheet.discard.keep')).toBeNull());
    expect(screen.getByTestId('GAR-11.noteSheet.input')).toHaveDisplayValue('Erster Trackday');
    await fireEvent.press(screen.getByTestId('GAR-11.noteSheet.scrim'));
    await fireEvent.press(await screen.findByTestId('GAR-11.noteSheet.discard.discard'));
    await waitFor(() => expect(screen.queryByTestId('GAR-11.noteSheet.input')).toBeNull());
  });
});

describe('GAR-08 focal point', () => {
  it('moves the point with screen-reader actions and says where it is now', async () => {
    mockParams = { id: VEHICLE_ID, mediaId: '01side' };
    const announce = jest.spyOn(ReactNative.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    stubFetch({ '/api/v1/auth/me': ME, [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } } });
    await renderScreen(<PhotoEditScreen />);
    const stage = await screen.findByTestId('GAR-08.stage');
    expect(stage.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(['moveLeft', 'moveRight', 'moveUp', 'moveDown']);
    await fireEvent(stage, 'accessibilityAction', { nativeEvent: { actionName: 'moveRight' } });
    await fireEvent(screen.getByTestId('GAR-08.stage'), 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    expect(screen.getByTestId('GAR-08.stage')).toHaveAccessibleName('Fokuspunkt: 55 % von links, 45 % von oben');
    expect(announce).toHaveBeenLastCalledWith('55 % von links, 45 % von oben');
    announce.mockRestore();
  });
});

describe('GAR-08 loading', () => {
  afterEach(() => {
    mockWindow.current = null;
  });

  it('draws its section headers’ skeleton lines at the header role’s height (ADR-426 e)', async () => {
    mockParams = { id: VEHICLE_ID, mediaId: '01side' };
    mockWindow.current = { width: 390, height: 844, scale: 1, fontScale: 1 };
    stubFetch({ '/api/v1/auth/me': ME });
    const answered = globalThis.fetch;
    globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
      const request = typeof input === 'string' ? new Request(input, init) : input;
      if (new URL(request.url).pathname.endsWith(`/vehicles/${VEHICLE_ID}`)) return new Promise<Response>(() => undefined);
      return answered(request);
    }) as typeof fetch;
    await renderScreen(<PhotoEditScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-08.skeleton.header.focus', { includeHiddenElements: true })).toBeTruthy());
    for (const header of ['focus', 'details']) {
      const line = screen.getByTestId(`GAR-08.skeleton.header.${header}`, { includeHiddenElements: true });
      const box = line.children.find((child) => typeof child !== 'string');
      expect(box && typeof box !== 'string' ? flat(box.props.style).height : null).toBe(typography.callout.lineHeight);
    }
  });
});

describe('GAR-08 alt field skeleton (SF-R4-2)', () => {
  afterEach(() => {
    mockWindow.current = null;
  });

  type Node = ReturnType<typeof screen.getByTestId>;
  const layout = (node: Node, height: number) => fireEvent(node, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height } } });
  const blockHeight = () => flat(screen.getByTestId('GAR-08.skeleton.alt', { includeHiddenElements: true }).props.style).height;
  const inputLine = typography.input.lineHeight;
  const padding = 12;

  it('measures in the field\'s input role and is as tall as the field with a 2-line alt text', async () => {
    mockWindow.current = { width: 390, height: 844, scale: 1, fontScale: 1 };
    await renderScreen(<AltFieldSkeleton text="Heckansicht des Skyline auf nasser Fahrbahn bei Nacht in Yokohama" testID="GAR-08.skeleton.alt" />);
    const measure = screen.getByTestId('GAR-08.skeleton.alt.measure', { includeHiddenElements: true });
    // The input role (16/24), never body (15/22): the field's own line box.
    expect(flat(measure.props.style).fontSize).toBe(typography.input.fontSize);
    expect(flat(measure.props.style).lineHeight).toBe(inputLine);
    await layout(measure, 2 * inputLine);
    // TextInput: two drawn lines of the input role and 12 above and below them.
    expect(blockHeight()).toBe(2 * inputLine + 2 * padding);
    await layout(measure, 5 * inputLine);
    // At most ALT_ROWS (3) rows, as the field caps them.
    expect(blockHeight()).toBe(3 * inputLine + 2 * padding);
  });

  it('counts rows in the drawn line, as Android 14+ draws it at a large font', async () => {
    mockWindow.current = { width: 390, height: 844, scale: 1, fontScale: 2 };
    await renderScreen(<AltFieldSkeleton text="Heckansicht des Skyline auf nasser Fahrbahn bei Nacht in Yokohama" testID="GAR-08.skeleton.alt" />);
    const drawnLine = 36;
    const measure = screen.getByTestId('GAR-08.skeleton.alt.measure', { includeHiddenElements: true });
    // InputLineMeasure, beside the measured text: one line of the input role as the OS draws it.
    const line = measure.parent?.children.find(
      (child): child is Node => typeof child !== 'string' && (child.props.dataSet as { qaMeasure?: string } | undefined)?.qaMeasure === 'line',
    );
    expect(line).toBeTruthy();
    if (line) await layout(line, drawnLine);
    await layout(measure, 2 * drawnLine);
    expect(blockHeight()).toBe(2 * drawnLine + 2 * padding);
  });
});

describe('GAR-08 plate blur', () => {
  it('leaves the pointer to the stage: a mouse drag on the photo would start the browser’s image drag and cancel the pan (M2.8)', async () => {
    await renderScreen(<BlurTool vehicle={vehicle()} photo={media('01side')} disabled={false} onDirtyChange={jest.fn()} routeId="GAR-08" />);
    await fireEvent.press(screen.getByTestId('GAR-08.blur.start'));
    const stage = screen.getByTestId('GAR-08.blur.stage');
    expect(stage).toBeTruthy();
    expect(flat(screen.getByTestId('GAR-08.blur.photo').props.style).pointerEvents).toBe('none');
  });
});

describe('Sortable by keyboard', () => {
  it('moves the focused item with the arrow keys and announces its place', async () => {
    const onChange = jest.fn();
    const items = [
      { id: 'a', name: 'Skyline' },
      { id: 'b', name: 'Silvia' },
      { id: 'c', name: 'Supra' },
    ];
    await renderScreen(
      <Sortable
        items={items}
        keyOf={(item) => item.id}
        labelOf={(item) => item.name}
        rowHeight={72}
        gap={0}
        onChange={onChange}
        renderItem={(item) => (
          <ReactNative.View>
            <ReactNative.Text>{item.name}</ReactNative.Text>
            <SortHandleSlot />
          </ReactNative.View>
        )}
        testID="sort"
      />,
    );
    await act(async () => {
      fireEvent(screen.getByTestId('sort'), 'layout', { nativeEvent: { layout: { width: 320, height: 216, x: 0, y: 0 } } });
    });
    const handle = screen.getByTestId('sort.a.handle');
    expect(handle).toHaveAccessibleName('Skyline verschieben');
    const announce = jest.spyOn(ReactNative.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await fireEvent(handle, 'keyDown', { key: 'ArrowDown', preventDefault: jest.fn() });
    expect(onChange).toHaveBeenCalledWith([items[1], items[0], items[2]]);
    expect(screen.getByTestId('sort.announcement')).toHaveTextContent('Skyline: Platz 2 von 3');
    // iOS has no live regions: VoiceOver hears the place directly (Jest runs as iOS).
    expect(ReactNative.Platform.OS).toBe('ios');
    expect(announce).toHaveBeenCalledWith('Skyline: Platz 2 von 3');
    announce.mockRestore();
    onChange.mockClear();
    await fireEvent(handle, 'keyDown', { key: 'ArrowUp', preventDefault: jest.fn() });
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId('sort.c.handle'), 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    expect(onChange).toHaveBeenCalledWith([items[0], items[2], items[1]]);
  });
});
