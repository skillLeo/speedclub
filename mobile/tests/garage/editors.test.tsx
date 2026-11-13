/**
 * The garage editors after the bug hunt: fresh data reaches untouched fields (BH-10), a hidden field cannot hold a save back
 * silently (BH-11), the toast says what the server recorded (BH-16), a lost answer on a new mod or note is recovered (BH-03),
 * an abandoned sort asks first (BH-13), a failed upload is a tile that only deletes (BH-46), and the names of the Verlauf toggle.
 */
import { IsRestoringProvider, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { usePreventRemove } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { garageKeys, type OwnerUpdate } from '@/api/queries/garage';
import { modKeys } from '@/api/queries/mods';
import { myVehiclesKey } from '@/api/queries/profile';
import { EditBasicsScreen } from '@/features/garage/screens/EditBasicsScreen';
import { EditSpecsScreen } from '@/features/garage/screens/EditSpecsScreen';
import { GarageVehicleScreen } from '@/features/garage/screens/GarageVehicleScreen';
import { HistoryScreen } from '@/features/garage/screens/HistoryScreen';
import { ModEditorScreen } from '@/features/garage/screens/ModEditorScreen';
import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { ModsScreen } from '@/features/garage/screens/ModsScreen';
import { PhotosScreen } from '@/features/garage/screens/PhotosScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, ThemeProvider } from '@/theme';
import { dismissToast, useCurrentToast } from '@/ui/toast';

import { card, media, vehicle, VEHICLE_ID, WHEEL_FIELDS, wheelMod } from './fixtures';
import { flushQueryNotifications, list, ME, newQueryClient, renderScreen, signIn, stubFetch, type Answer, type Call } from './harness';

const mockWindow: { current: { width: number; height: number; scale: number; fontScale: number } } = { current: { width: 390, height: 844, scale: 1, fontScale: 1 } };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow.current }));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/garage',
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: jest.fn(), dispatch: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  usePreventRemove: jest.fn(() => jest.fn()),
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
jest.mock('expo-crypto', () => {
  let next = 0;
  return {
    randomUUID: jest.fn(() => {
      next += 1;
      return `uuid-${next}`;
    }),
  };
});
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

jest.setTimeout(60_000);
configure({ asyncUtilTimeout: 15_000 });

const VEHICLE_PATH = `/api/v1/vehicles/${VEHICLE_ID}`;
const CATEGORIES = list([{ id: 1, key: 'wheels_tires', name: 'Räder & Reifen', icon: 'wheel', fields: WHEEL_FIELDS }]);
const MOD_BASE = {
  '/api/v1/auth/me': ME,
  [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } },
  '/api/v1/catalog/mod-categories': CATEGORIES,
  '/api/v1/catalog/brands': list([]),
};

function ToastProbe() {
  const current = useCurrentToast();
  return current ? <Text testID={current.testID ?? 'toast'}>{current.message}</Text> : null;
}

/** Lets a chosen request wait until the test releases it. */
function holdRequests(answers: Record<string, Answer | ((call: Call) => Answer)>, held: (method: string, path: string) => boolean) {
  const stub = stubFetch(answers);
  const inner = globalThis.fetch;
  const gates: (() => void)[] = [];
  globalThis.fetch = (async (input: Request | string, init?: RequestInit) => {
    const request = typeof input === 'string' ? new Request(input, init) : input;
    if (held(request.method, new URL(request.url).pathname)) await new Promise<void>((resolve) => gates.push(resolve));
    return inner(request);
  }) as typeof fetch;
  return { ...stub, waiting: () => gates.length, release: () => gates.shift()?.() };
}

function connectionDrops(): never {
  throw new TypeError('Network request failed');
}

async function layOut(testID: string) {
  await act(async () => {
    fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { width: 360, height: 400, x: 0, y: 0 } } });
  });
}

const guardArgument = () => jest.mocked(usePreventRemove).mock.lastCall?.[0];

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockWindow.current = { width: 390, height: 844, scale: 1, fontScale: 1 };
  signIn();
  dismissToast();
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

describe('fresh data reaches an open form (BH-10)', () => {
  it('GAR-06 takes a newer refetch into the untouched fields, keeps the one the member changed, and sends that', async () => {
    mockParams = { id: VEHICLE_ID };
    const cached = vehicle();
    const newer = vehicle({ specs: { ...cached.specs, torque_nm: 555, engine_code: 'NEWCODE', displacement_cc: 2600 } });
    const { calls, waiting, release } = holdRequests(
      {
        '/api/v1/auth/me': ME,
        [`GET ${VEHICLE_PATH}`]: { body: { data: newer } },
        [`PUT ${VEHICLE_PATH}/specs`]: { body: { data: { ...newer, history_recorded: true } } },
      },
      (method, path) => method === 'GET' && path === VEHICLE_PATH,
    );
    const client = newQueryClient();
    client.setQueryData(garageKeys.vehicle(VEHICLE_ID), cached);
    await renderScreen(<EditSpecsScreen />, client);
    await waitFor(() => expect(screen.getByTestId('GAR-06.torque')).toHaveDisplayValue('540'));
    await fireEvent.changeText(screen.getByTestId('GAR-06.displacement'), '2500');
    await waitFor(() => expect(waiting()).toBe(1));
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('GAR-06.torque')).toHaveDisplayValue('555'));
    expect(screen.getByTestId('GAR-06.engineCode')).toHaveDisplayValue('NEWCODE');
    expect(screen.getByTestId('GAR-06.displacement')).toHaveDisplayValue('2500');
    // The member's change still counts: Speichern stays open and leaving still asks.
    expect(screen.getByTestId('GAR-06.cta.primary')).not.toBeDisabled();
    expect(guardArgument()).toBe(true);
    await fireEvent.press(screen.getByTestId('GAR-06.cta.primary'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ torque_nm: 555, engine_code: 'NEWCODE', displacement_cc: 2500 });
  });

  it('GAR-10 reads fresh on open, takes it into the untouched fields, nested ones too, and keeps the changed one', async () => {
    mockParams = { id: VEHICLE_ID, modId: '01wheels' };
    const cached = wheelMod();
    const newer = wheelMod({ notes: 'Vom anderen Gerät', fields: { ...cached.fields, wheel_model: 'RS', et_front: 30, diameter: 18 }, cost: { cents: 100000, label: '1.000 €' } });
    const { calls, waiting, release } = holdRequests(
      {
        ...MOD_BASE,
        'GET /api/v1/mods/01wheels': { body: { data: newer } },
        'PATCH /api/v1/mods/01wheels': { body: { data: { ...newer, history_recorded: false } } },
      },
      (method, path) => method === 'GET' && path.endsWith('/mods/01wheels'),
    );
    // Fresh by the clock: without "always" the copy would stay.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 }, mutations: { retry: false, gcTime: Infinity } } });
    client.setQueryData(garageKeys.vehicle(VEHICLE_ID), vehicle());
    client.setQueryData(modKeys.mod('01wheels'), cached);
    await renderScreen(<ModEditorScreen />, client);
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.et_front')).toHaveDisplayValue('35'));
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.et_front'), '40');
    await waitFor(() => expect(waiting()).toBe(1));
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.wheel_model')).toHaveDisplayValue('RS'));
    expect(screen.getByTestId('GAR-10.field.et_front')).toHaveDisplayValue('40');
    expect(screen.getByTestId('GAR-10.field.diameter')).toHaveDisplayValue('18');
    expect(screen.getByTestId('GAR-10.notes')).toHaveDisplayValue('Vom anderen Gerät');
    expect(screen.getByTestId('GAR-10.cta.primary')).not.toBeDisabled();
    expect(guardArgument()).toBe(true);
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
      notes: 'Vom anderen Gerät',
      cost_cents: 100000,
      fields: { wheel_model: 'RS', et_front: 40, diameter: 18 },
    });
  });
});

describe('the form stays dirty while fresh data lands (BH-10, resetOptions.keepDirty)', () => {
  // Without keepDirty the reset that brings the fresh values renders the form clean once: Speichern is off for that render, a
  // tap in it does nothing, and leaving in it does not ask. Every render after the member's change must say dirty.
  it('GAR-06 never calls itself clean, and then saves the change with the fresh values', async () => {
    mockParams = { id: VEHICLE_ID };
    const cached = vehicle();
    const newer = vehicle({ specs: { ...cached.specs, torque_nm: 555, engine_code: 'NEWCODE' } });
    const { calls, waiting, release } = holdRequests(
      {
        '/api/v1/auth/me': ME,
        [`GET ${VEHICLE_PATH}`]: { body: { data: newer } },
        [`PUT ${VEHICLE_PATH}/specs`]: { body: { data: { ...newer, history_recorded: true } } },
      },
      (method, path) => method === 'GET' && path === VEHICLE_PATH,
    );
    const client = newQueryClient();
    client.setQueryData(garageKeys.vehicle(VEHICLE_ID), cached);
    await renderScreen(<EditSpecsScreen />, client);
    await waitFor(() => expect(screen.getByTestId('GAR-06.torque')).toHaveDisplayValue('540'));
    await fireEvent.changeText(screen.getByTestId('GAR-06.displacement'), '2500');
    await waitFor(() => expect(waiting()).toBe(1));
    expect(guardArgument()).toBe(true);
    jest.mocked(usePreventRemove).mockClear();
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('GAR-06.torque')).toHaveDisplayValue('555'));
    const guarded = jest.mocked(usePreventRemove).mock.calls.map(([prevent]) => prevent);
    expect(guarded.length).toBeGreaterThan(0);
    expect(guarded).not.toContain(false);
    await fireEvent.press(screen.getByTestId('GAR-06.cta.primary'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ displacement_cc: 2500, torque_nm: 555, engine_code: 'NEWCODE' });
  });

  it('GAR-10 the same', async () => {
    mockParams = { id: VEHICLE_ID, modId: '01wheels' };
    const cached = wheelMod();
    const newer = wheelMod({ fields: { ...cached.fields, wheel_model: 'RS' } });
    const { waiting, release } = holdRequests(
      { ...MOD_BASE, 'GET /api/v1/mods/01wheels': { body: { data: newer } } },
      (method, path) => method === 'GET' && path.endsWith('/mods/01wheels'),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 }, mutations: { retry: false, gcTime: Infinity } } });
    client.setQueryData(garageKeys.vehicle(VEHICLE_ID), vehicle());
    client.setQueryData(modKeys.mod('01wheels'), cached);
    await renderScreen(<ModEditorScreen />, client);
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.et_front')).toHaveDisplayValue('35'));
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.et_front'), '40');
    await waitFor(() => expect(waiting()).toBe(1));
    jest.mocked(usePreventRemove).mockClear();
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.wheel_model')).toHaveDisplayValue('RS'));
    const guarded = jest.mocked(usePreventRemove).mock.calls.map(([prevent]) => prevent);
    expect(guarded.length).toBeGreaterThan(0);
    expect(guarded).not.toContain(false);
  });
});

describe('fresh data on an untouched form (BH-10)', () => {
  it('stays clean: nothing to save, nothing to ask', async () => {
    mockParams = { id: VEHICLE_ID };
    const cached = vehicle();
    const newer = vehicle({ specs: { ...cached.specs, torque_nm: 555 } });
    const { waiting, release } = holdRequests({ '/api/v1/auth/me': ME, [`GET ${VEHICLE_PATH}`]: { body: { data: newer } } }, (method, path) => method === 'GET' && path === VEHICLE_PATH);
    const client = newQueryClient();
    client.setQueryData(garageKeys.vehicle(VEHICLE_ID), cached);
    await renderScreen(<EditSpecsScreen />, client);
    await waitFor(() => expect(waiting()).toBe(1));
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId('GAR-06.torque')).toHaveDisplayValue('555'));
    expect(screen.getByTestId('GAR-06.cta.primary')).toBeDisabled();
    expect(guardArgument()).toBe(false);
  });
});

describe('a save that cannot go through says why (BH-11)', () => {
  it('shows a failing field the layout leaves out, with its error, and says where to fix it', async () => {
    mockParams = { id: VEHICLE_ID, modId: '01wheels' };
    const long = wheelMod({ part_number: 'X'.repeat(81) });
    const { calls } = stubFetch({ ...MOD_BASE, 'GET /api/v1/mods/01wheels': { body: { data: long } } });
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.notes')).toBeTruthy());
    // FS-6 has no part number on Räder & Reifen.
    expect(screen.queryByTestId('GAR-10.partNumber')).toBeNull();
    expect(screen.queryByTestId('GAR-10.group.more')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('GAR-10.notes'), 'Neu');
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-10.group.more')).toBeTruthy());
    expect(screen.getByTestId('GAR-10.notice')).toHaveTextContent('„Teilenummer“ ist ungültig. Korrigiere das Feld unten bei „Weitere Angaben“.');
    expect(screen.getByTestId('GAR-10.group.more')).toHaveTextContent(/Weitere Angaben/);
    expect(screen.getByTestId('GAR-10.partNumber')).toHaveDisplayValue('X'.repeat(81));
    expect(screen.getByText('Höchstens 80 Zeichen.')).toBeTruthy();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('scrolls to the end once the field is drawn, so its error clears the sticky bar (DQ-251)', async () => {
    mockParams = { id: VEHICLE_ID, modId: '01wheels' };
    stubFetch({ ...MOD_BASE, 'GET /api/v1/mods/01wheels': { body: { data: wheelMod({ part_number: 'X'.repeat(81) }) } } });
    const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
    try {
      await renderScreen(<ModEditorScreen />);
      await waitFor(() => expect(screen.getByTestId('GAR-10.notes')).toBeTruthy());
      await fireEvent.changeText(screen.getByTestId('GAR-10.notes'), 'Neu');
      expect(scrollToEnd).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
      await waitFor(() => expect(screen.getByTestId('GAR-10.group.more')).toBeTruthy());
      await waitFor(() => expect(scrollToEnd).toHaveBeenCalledTimes(1));
      // Motion on in the tests: the scroll is animated; reduced motion jumps (EditorForm's `animated`).
      expect(scrollToEnd).toHaveBeenCalledWith({ animated: expect.any(Boolean) });
      // A second press with the field already in view leaves the scroll to the focus of the form.
      await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
      await waitFor(() => expect(screen.getByText('Höchstens 80 Zeichen.')).toBeTruthy());
      expect(scrollToEnd).toHaveBeenCalledTimes(1);
    } finally {
      scrollToEnd.mockRestore();
    }
  });

  it('lets the member fix it there, and then saves', async () => {
    mockParams = { id: VEHICLE_ID, modId: '01wheels' };
    const long = wheelMod({ part_number: 'X'.repeat(81) });
    const { calls } = stubFetch({
      ...MOD_BASE,
      'GET /api/v1/mods/01wheels': { body: { data: long } },
      'PATCH /api/v1/mods/01wheels': { body: { data: { ...long, part_number: 'BBS-LM-19', history_recorded: false } } },
    });
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.notes')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.notes'), 'Neu');
    await fireEvent.press(screen.getByTestId('GAR-10.headerSave'));
    await waitFor(() => expect(screen.getByTestId('GAR-10.partNumber')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.partNumber'), 'BBS-LM-19');
    await fireEvent.press(screen.getByTestId('GAR-10.headerSave'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({ part_number: 'BBS-LM-19', notes: 'Neu' });
  });

  it('a title that is too long on Räder & Reifen comes into view the same way', async () => {
    mockParams = { id: VEHICLE_ID, modId: '01wheels' };
    const { calls } = stubFetch({ ...MOD_BASE, 'GET /api/v1/mods/01wheels': { body: { data: wheelMod({ title: 'T'.repeat(161) }) } } });
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.notes')).toBeTruthy());
    expect(screen.queryByTestId('GAR-10.title')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('GAR-10.notes'), 'Neu');
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-10.title')).toBeTruthy());
    expect(screen.getByTestId('GAR-10.notice')).toHaveTextContent(/^„Titel“ ist ungültig\. Korrigiere das Feld unten/);
    expect(screen.getByText('Höchstens 160 Zeichen.')).toBeTruthy();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('saves a set of wheels whose hidden rear diameter is invalid, and leaves it out', async () => {
    mockParams = { id: VEHICLE_ID, modId: 'new', category: 'wheels_tires' };
    const { calls } = stubFetch({ ...MOD_BASE, [`POST ${VEHICLE_PATH}/mods`]: { status: 201, body: { data: wheelMod() } } });
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.wheel_model')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.wheel_model'), 'LM');
    await fireEvent.press(screen.getByTestId('GAR-10.field.staggered'));
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.diameter_rear')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.diameter_rear'), '19,3');
    await fireEvent.press(screen.getByTestId('GAR-10.field.staggered'));
    await waitFor(() => expect(screen.queryByTestId('GAR-10.field.diameter_rear')).toBeNull());
    await fireEvent.press(screen.getByTestId('GAR-10.headerSave'));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect((calls.find((call) => call.method === 'POST')?.body as { fields: object }).fields).not.toHaveProperty('diameter_rear');
  });

  it('adds nothing when the failing field is on screen', async () => {
    mockParams = { id: VEHICLE_ID, modId: 'new', category: 'wheels_tires' };
    stubFetch(MOD_BASE);
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.diameter')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.diameter'), '30');
    await fireEvent.press(screen.getByTestId('GAR-10.headerSave'));
    await waitFor(() => expect(screen.getByText('Erlaubt sind 13 bis 24.')).toBeTruthy());
    expect(screen.queryByTestId('GAR-10.notice')).toBeNull();
    expect(screen.queryByTestId('GAR-10.group.more')).toBeNull();
  });
});

describe('a session that ends under the form (BH-30 held notice)', () => {
  it('scrolls up to the notice and keeps the typed text legible, while nothing can be saved', async () => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({ '/api/v1/auth/me': ME, [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } } });
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    try {
      await renderScreen(<EditSpecsScreen />);
      await waitFor(() => expect(screen.getByTestId('GAR-06.displacement')).toBeTruthy());
      await fireEvent.changeText(screen.getByTestId('GAR-06.displacement'), '2500');
      scrollTo.mockClear();
      await act(async () => useSessionStore.setState({ status: 'guest', member: null, expiredFrom: '01nina' }));
      await waitFor(() => expect(screen.getByTestId('GAR-06.restricted')).toBeTruthy());
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
      expect(screen.getByTestId('GAR-06.cta.primary')).toBeDisabled();
      // Locked, not greyed out: the member's text stays in its own colour.
      expect(screen.getByTestId('GAR-06.displacement')).not.toBeDisabled();
      expect(screen.getByTestId('GAR-06.displacement')).toHaveDisplayValue('2500');
    } finally {
      scrollTo.mockRestore();
      await act(async () => useSessionStore.setState({ expiredFrom: null }));
    }
  });
});

describe('the editors read fresh once the persisted cache is restored (BH-10 rest)', () => {
  it('GAR-06 asks after the restore, and the restored copy does not stand', async () => {
    mockParams = { id: VEHICLE_ID };
    const older = vehicle({ specs: { ...vehicle().specs, torque_nm: 400, engine_code: 'OLD' } });
    const { calls } = stubFetch({ '/api/v1/auth/me': ME, [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle({ specs: { ...older.specs, torque_nm: 555, engine_code: 'NEWCODE' } }) } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 }, mutations: { retry: false, gcTime: Infinity } } });
    const tree = (restoring: boolean) => (
      <GestureHandlerRootView>
        <QueryClientProvider client={client}>
          <IsRestoringProvider value={restoring}>
            <ThemeProvider>
              <EditSpecsScreen />
            </ThemeProvider>
          </IsRestoringProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    );
    const view = await render(tree(true));
    await flushQueryNotifications();
    const reads = () => calls.filter((call) => call.method === 'GET' && call.path === VEHICLE_PATH);
    expect(reads()).toHaveLength(0);
    await act(async () => client.setQueryData(garageKeys.vehicle(VEHICLE_ID), older));
    await view.rerender(tree(false));
    await waitFor(() => expect(reads()).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('GAR-06.torque')).toHaveDisplayValue('555'));
    expect(screen.getByTestId('GAR-06.engineCode')).toHaveDisplayValue('NEWCODE');
  });
});

describe('a lost answer on Fahrzeug löschen', () => {
  it('GAR-05: the second tap\'s 404 counts as deleted, with the toast, and the garage forgets the car', async () => {
    mockParams = { id: VEHICLE_ID };
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } },
      '/api/v1/catalog/makes': list([{ id: 34, name: 'Nissan', slug: 'nissan', country: 'JP', is_popular: true }]),
      '/api/v1/catalog/makes/34/models': list([{ id: 254, make_id: 34, name: 'Skyline GT-R', slug: 'skyline-gt-r' }]),
      '/api/v1/catalog/models/254/generations': list([]),
      [`DELETE ${VEHICLE_PATH}`]: { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } },
    });
    const client = newQueryClient();
    client.setQueryData(myVehiclesKey, [card()]);
    await renderScreen(
      <>
        <EditBasicsScreen />
        <ToastProbe />
      </>,
      client,
    );
    await waitFor(() => expect(screen.getByTestId('GAR-05.delete')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-05.delete'));
    await waitFor(() => expect(screen.getByTestId('GAR-05.deleteDialog.confirm')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-05.deleteDialog.confirm'));
    await waitFor(() => expect(screen.getByTestId('GAR-05.deleted')).toHaveTextContent(/wurde gelöscht/));
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/garage'));
    expect(screen.queryByTestId('GAR-05.notice')).toBeNull();
    expect(client.getQueryData(myVehiclesKey)).toEqual([]);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('GAR-02: a 404 of the public page reads the owner copy again, so the gone state shows, not a connection error', async () => {
    mockParams = { id: VEHICLE_ID };
    const NOT_FOUND = { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } };
    let deleted = false;
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: () => (deleted ? NOT_FOUND : { body: { data: vehicle() } }),
      '/api/v1/public/vehicles/': NOT_FOUND,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 }, mutations: { retry: false, gcTime: Infinity } } });
    client.setQueryData(garageKeys.vehicle(VEHICLE_ID), vehicle());
    client.setQueryData(myVehiclesKey, [card()]);
    deleted = true;
    await renderScreen(<GarageVehicleScreen />, client);
    await waitFor(() => expect(screen.getByTestId('GAR-02.notFound')).toBeTruthy());
    expect(calls.some((call) => call.method === 'GET' && call.path === VEHICLE_PATH)).toBe(true);
    expect(client.getQueryState(myVehiclesKey)?.isInvalidated).toBe(true);
  });
});

describe('the toast says what the server recorded (BH-16)', () => {
  async function saveMod(historyRecorded: boolean) {
    mockParams = { id: VEHICLE_ID, modId: '01wheels' };
    stubFetch({
      ...MOD_BASE,
      'GET /api/v1/mods/01wheels': { body: { data: wheelMod() } },
      'PATCH /api/v1/mods/01wheels': { body: { data: { ...wheelMod({ notes: 'Nur die Notiz' }), history_recorded: historyRecorded } } },
    });
    await renderScreen(
      <>
        <ModEditorScreen />
        <ToastProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('GAR-10.notes')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.notes'), 'Nur die Notiz');
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
  }

  it('GAR-10: a notes-only edit on a published vehicle gets the plain toast', async () => {
    await saveMod(false);
    await waitFor(() => expect(screen.getByTestId('GAR-10.saved')).toHaveTextContent(/^Modifikation gespeichert$/));
  });

  it('GAR-10: an edit that made an entry says so', async () => {
    await saveMod(true);
    await waitFor(() => expect(screen.getByTestId('GAR-10.saved')).toHaveTextContent('Modifikation gespeichert. Im Verlauf erscheint ein Eintrag.'));
  });

  it('GAR-10: a new mod on a published vehicle keeps the history toast', async () => {
    mockParams = { id: VEHICLE_ID, modId: 'new', category: 'wheels_tires' };
    stubFetch({ ...MOD_BASE, [`POST ${VEHICLE_PATH}/mods`]: { status: 201, body: { data: wheelMod() } } });
    await renderScreen(
      <>
        <ModEditorScreen />
        <ToastProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.wheel_model')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.wheel_model'), 'LM');
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-10.saved')).toHaveTextContent('Modifikation gespeichert. Im Verlauf erscheint ein Eintrag.'));
  });

  it.each([
    [false, /^Gespeichert$/],
    [true, /^Gespeichert\. Im Verlauf erscheint ein Eintrag\.$/],
  ])('GAR-06 with history_recorded %s', async (historyRecorded, text) => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } },
      [`PUT ${VEHICLE_PATH}/specs`]: { body: { data: { ...vehicle(), history_recorded: historyRecorded } } },
    });
    await renderScreen(
      <>
        <EditSpecsScreen />
        <ToastProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('GAR-06.engineCode')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-06.engineCode'), 'RB26');
    await fireEvent.press(screen.getByTestId('GAR-06.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-06.saved')).toHaveTextContent(text));
  });
});

describe('a lost answer on a new mod (BH-03)', () => {
  it('re-sends what was sent with the same key, then PATCHes the change', async () => {
    mockParams = { id: VEHICLE_ID, modId: 'new', category: 'wheels_tires' };
    let sent = 0;
    const stored = wheelMod({ id: '01stored' });
    const { calls } = stubFetch({
      ...MOD_BASE,
      [`POST ${VEHICLE_PATH}/mods`]: () => {
        sent += 1;
        return sent === 1 ? connectionDrops() : { status: 201, body: { data: stored } };
      },
      'PATCH /api/v1/mods/01stored': { body: { data: { ...stored, history_recorded: true } } },
    });
    await renderScreen(
      <>
        <ModEditorScreen />
        <ToastProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.wheel_model')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.wheel_model'), 'LN');
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-10.notice')).toHaveTextContent(/Vielleicht kam es trotzdem an/));
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.wheel_model'), 'LM');
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-10.saved')).toBeTruthy());
    const creates = calls.filter((call) => call.method === 'POST');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.headers.get('Idempotency-Key')).toBe(creates[0]?.headers.get('Idempotency-Key'));
    expect(creates[1]?.body).toEqual(creates[0]?.body);
    expect(creates[1]?.body).toMatchObject({ fields: { wheel_model: 'LN' } });
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.path).toMatch(/\/mods\/01stored$/);
    expect(patch?.body).toMatchObject({ fields: { wheel_model: 'LM' }, title: null });
  });

  it('a change that fails on top of the replay never creates a second mod', async () => {
    mockParams = { id: VEHICLE_ID, modId: 'new', category: 'wheels_tires' };
    let sent = 0;
    let patched = 0;
    const stored = wheelMod({ id: '01stored' });
    const { calls } = stubFetch({
      ...MOD_BASE,
      [`POST ${VEHICLE_PATH}/mods`]: () => {
        sent += 1;
        return sent === 1 ? connectionDrops() : { status: 201, body: { data: stored } };
      },
      'PATCH /api/v1/mods/01stored': () => {
        patched += 1;
        return patched === 1 ? connectionDrops() : { body: { data: { ...stored, history_recorded: true } } };
      },
    });
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.field.wheel_model')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.wheel_model'), 'LN');
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(screen.getByTestId('GAR-10.notice')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.wheel_model'), 'LM');
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(patched).toBe(1));
    // Now the mod exists, so this answer may be read literally.
    await waitFor(() => expect(screen.getByTestId('GAR-10.notice')).toHaveTextContent('Keine Verbindung. Deine Änderungen sind noch nicht gespeichert.'));
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(patched).toBe(2));
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
  });
});

describe('a lost answer on a note (BH-03)', () => {
  const entry = { id: '01upd', type: 'note', type_label: 'Notiz', note: 'Oelwechsl gemacht', summary: 'Oelwechsl gemacht', changes: [], changes_count: 0, hidden: false, created_at: null, month_label: 'März 2023' };
  const updates = (calls: Call[]) => calls.filter((call) => call.method === 'GET' && call.path.endsWith('/updates'));
  const notes = (calls: Call[]) => calls.filter((call) => call.method === 'POST' && call.path.endsWith('/updates'));

  async function writeNote(text: string) {
    await fireEvent.changeText(screen.getByTestId('GAR-11.noteSheet.input'), text);
    await fireEvent.press(screen.getByTestId('GAR-11.noteSheet.submit'));
  }

  it('reads the list again, and after a changed text says plainly that the first one is there', async () => {
    mockParams = { id: VEHICLE_ID };
    let sent = 0;
    let stored = false;
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } },
      [`GET ${VEHICLE_PATH}/updates`]: () => list(stored ? [entry] : []),
      [`POST ${VEHICLE_PATH}/updates`]: () => {
        sent += 1;
        if (sent === 1) {
          stored = true;
          return connectionDrops();
        }
        if (sent === 2) return { status: 409, body: { message: 'Das wurde schon einmal mit anderen Angaben abgeschickt.', code: 'idempotency_key_reused', errors: {} } };
        return { status: 201, body: { data: entry } };
      },
    });
    await renderScreen(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-11.empty')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-11.empty.action'));
    await waitFor(() => expect(screen.getByTestId('GAR-11.noteSheet.input')).toBeTruthy());
    const before = updates(calls).length;

    await writeNote('Oelwechsl gemacht');
    await waitFor(() => expect(screen.getByTestId('GAR-11.noteSheet.notice')).toHaveTextContent(/Vielleicht kam es trotzdem an/));
    expect(screen.getByTestId('GAR-11.noteSheet.notice')).not.toHaveTextContent(/nicht gespeichert/);
    // The saved entry shows behind the sheet.
    await waitFor(() => expect(updates(calls).length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByTestId('GAR-11.entry.01upd')).toBeTruthy());

    await writeNote('Ölwechsel gemacht');
    await waitFor(() => expect(screen.getByTestId('GAR-11.noteSheet.notice')).toHaveTextContent('Deine erste Fassung ist schon angekommen und steht im Verlauf. Noch einmal senden legt eine zweite Notiz an.'));
    expect(screen.getByTestId('GAR-11.noteSheet.input')).toHaveDisplayValue('Ölwechsel gemacht');

    await fireEvent.press(screen.getByTestId('GAR-11.noteSheet.submit'));
    await waitFor(() => expect(notes(calls)).toHaveLength(3));
    const [first, second, third] = notes(calls);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(third?.headers.get('Idempotency-Key')).not.toBe(second?.headers.get('Idempotency-Key'));
  });
});

describe('an abandoned sort asks first (BH-13)', () => {
  it('GAR-07: dirty after a move, not before, and not after Fertig', async () => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } },
      [`PUT ${VEHICLE_PATH}/media/order`]: { body: { data: [] } },
    });
    await renderScreen(<PhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-07.sort')).toBeTruthy());
    expect(guardArgument()).toBe(false);
    await fireEvent.press(screen.getByTestId('GAR-07.sort'));
    expect(guardArgument()).toBe(false);
    await layOut('GAR-07.sortable');
    await fireEvent(screen.getByTestId('GAR-07.sortable.01cover.handle'), 'keyDown', { key: 'ArrowRight', preventDefault: jest.fn() });
    expect(guardArgument()).toBe(true);
    await fireEvent.press(screen.getByTestId('GAR-07.sortDone'));
    expect(guardArgument()).toBe(false);
  });

  it('GAR-09: dirty after a move, and its custom header still renders the dialog', async () => {
    mockParams = { id: VEHICLE_ID };
    const mods = [wheelMod(), wheelMod({ id: '01second', title: 'OZ Ultraleggera' })];
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } },
      [`GET ${VEHICLE_PATH}/mods`]: list(mods),
      [`PUT ${VEHICLE_PATH}/mods/order`]: list(mods),
      '/api/v1/catalog/mod-categories': CATEGORIES,
    });
    await renderScreen(<ModsScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-09.sort')).toBeTruthy());
    expect(guardArgument()).toBe(false);
    await fireEvent.press(screen.getByTestId('GAR-09.sort'));
    await layOut('GAR-09.sortable.wheels_tires');
    await fireEvent(screen.getByTestId('GAR-09.sortable.wheels_tires.01wheels.handle'), 'keyDown', { key: 'ArrowDown', preventDefault: jest.fn() });
    expect(guardArgument()).toBe(true);
    const onBlocked = jest.mocked(usePreventRemove).mock.lastCall?.[1] as unknown as (event: { data: { action: { type: string } } }) => void;
    await act(async () => onBlocked({ data: { action: { type: 'GO_BACK' } } }));
    await waitFor(() => expect(screen.getByTestId('GAR-09.discard.keep')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-09.discard.keep'));
    await fireEvent.press(screen.getByTestId('GAR-09.sortDone'));
    expect(guardArgument()).toBe(false);
  });
});

describe('GAR-09 legal status (sig.mod_legal_status, M2.8)', () => {
  it('shows a stated status as the row’s second pill and closes the list with the owner disclaimer', async () => {
    mockParams = { id: VEHICLE_ID };
    const mods = [wheelMod({ legal_status: 'parts_certificate', legal_status_label: 'Teilegutachten' }), wheelMod({ id: '01second', title: 'OZ Ultraleggera', legal_status: 'unknown', legal_status_label: 'Unbekannt' })];
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } },
      [`GET ${VEHICLE_PATH}/mods`]: list(mods),
      '/api/v1/catalog/mod-categories': CATEGORIES,
    });
    const client = newQueryClient();
    client.setQueryData(appConfigKey, {
      config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, 'sig.mod_legal_status': true } },
      confirmed: true,
    });
    await renderScreen(<ModsScreen />, client);
    expect(await screen.findByTestId('GAR-09.mod.01wheels.legalStatus')).toHaveTextContent('Teilegutachten');
    expect(screen.queryByTestId('GAR-09.mod.01second.legalStatus')).toBeNull();
    expect(screen.getByTestId('GAR-09.legalDisclaimer')).toHaveTextContent('Angaben des Besitzers, keine rechtliche Prüfung');
  });
});

describe('a failed upload on GAR-07 (BH-46)', () => {
  const failed = media('01bad', { status: 'failed', variants: [], width: null, height: null, blurhash: null });
  const withFailed = (overrides = {}) => vehicle({ failed_photos: [failed], ...overrides });

  it('is a tile after the photos that says so, outside the count', async () => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({ '/api/v1/auth/me': ME, [`GET ${VEHICLE_PATH}`]: { body: { data: withFailed() } } });
    await renderScreen(<PhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-07.photos')).toBeTruthy());
    await layOut('GAR-07.photos');
    const tile = screen.getByTestId('GAR-07.photos.failed.01bad');
    expect(tile).toHaveAccessibleName(/konnte nicht verarbeitet werden/);
    // Two words on the tile; the sentence is its label and the dialog's body.
    expect(screen.getByTestId('GAR-07.photos.failed.01bad.status')).toHaveTextContent('Nicht verarbeitet');
    expect(screen.getByTestId('GAR-07.photos.failed.01bad.status').props.numberOfLines).toBe(2);
    // As tall as a photo at least, growing with its caption: no fixed 4:3 box that a larger font squeezes the glyph out of.
    const box = StyleSheet.flatten(tile.props.style) as ViewStyle;
    expect(box.aspectRatio).toBeUndefined();
    expect(box.minHeight).toBeCloseTo(((360 - 16) / 3) * 0.75);
    expect(screen.getByTestId('GAR-07.photos.count')).toHaveTextContent('2 von 30 Fotos');
    expect(screen.queryByTestId('GAR-07.photos.photo.01bad')).toBeNull();
    expect(screen.queryByTestId('GAR-07.photos.failed.01bad.cover')).toBeNull();
  });

  it('keeps to one word in a third of the row from a large font: the sentence stays in the label', async () => {
    mockWindow.current = { width: 390, height: 844, scale: 1, fontScale: 2 };
    mockParams = { id: VEHICLE_ID };
    stubFetch({ '/api/v1/auth/me': ME, [`GET ${VEHICLE_PATH}`]: { body: { data: withFailed() } } });
    await renderScreen(<PhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-07.photos')).toBeTruthy());
    await layOut('GAR-07.photos');
    expect(screen.getByTestId('GAR-07.photos.failed.01bad.status')).toHaveTextContent('Fehler');
    expect(screen.getByTestId('GAR-07.photos.failed.01bad')).toHaveAccessibleName(/konnte nicht verarbeitet werden/);
  });

  it('offers only delete: no sheet with cover or alt, and it goes without a trace', async () => {
    mockParams = { id: VEHICLE_ID };
    let deleted = false;
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: () => ({ body: { data: deleted ? vehicle() : withFailed() } }),
      'DELETE /api/v1/media/01bad': () => {
        deleted = true;
        return { status: 204, body: null };
      },
    });
    await renderScreen(<PhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-07.photos')).toBeTruthy());
    await layOut('GAR-07.photos');
    await fireEvent.press(screen.getByTestId('GAR-07.photos.failed.01bad'));
    await waitFor(() => expect(screen.getByTestId('GAR-07.deletePhoto.confirm')).toBeTruthy());
    expect(screen.queryByTestId('GAR-07.photoSheet.cover')).toBeNull();
    expect(screen.queryByTestId('GAR-07.photoSheet.edit')).toBeNull();
    expect(screen.getByText('Dieses Foto konnte nicht verarbeitet werden. Lösch es und lade es neu hoch.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('GAR-07.deletePhoto.confirm'));
    await waitFor(() => expect(screen.queryByTestId('GAR-07.photos.failed.01bad')).toBeNull());
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('treats an entry media:prune has removed as deleted', async () => {
    mockParams = { id: VEHICLE_ID };
    let pruned = false;
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: () => ({ body: { data: pruned ? vehicle() : withFailed() } }),
      'DELETE /api/v1/media/01bad': () => {
        pruned = true;
        return { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } };
      },
    });
    await renderScreen(
      <>
        <PhotosScreen />
        <ToastProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('GAR-07.photos')).toBeTruthy());
    await layOut('GAR-07.photos');
    await fireEvent.press(screen.getByTestId('GAR-07.photos.failed.01bad'));
    await fireEvent.press(await screen.findByTestId('GAR-07.deletePhoto.confirm'));
    await waitFor(() => expect(screen.getByTestId('GAR-07.toast')).toHaveTextContent('Foto gelöscht'));
    await waitFor(() => expect(screen.queryByTestId('GAR-07.photos.failed.01bad')).toBeNull());
  });

  it('counts for nothing: one photo beside it cannot be sorted', async () => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({ '/api/v1/auth/me': ME, [`GET ${VEHICLE_PATH}`]: { body: { data: withFailed({ photos: [media('01cover')] }) } } });
    await renderScreen(<PhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-07.photos')).toBeTruthy());
    expect(screen.queryByTestId('GAR-07.sort')).toBeNull();
  });

  it('is never in the order, and cannot be dragged', async () => {
    mockParams = { id: VEHICLE_ID };
    const { calls } = stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: { body: { data: withFailed() } },
      [`PUT ${VEHICLE_PATH}/media/order`]: { body: { data: [] } },
    });
    await renderScreen(<PhotosScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-07.sort')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('GAR-07.sort'));
    await layOut('GAR-07.sortable');
    expect(screen.queryByTestId('GAR-07.sortable.01bad.handle')).toBeNull();
    await fireEvent(screen.getByTestId('GAR-07.sortable.01cover.handle'), 'keyDown', { key: 'ArrowRight', preventDefault: jest.fn() });
    await fireEvent.press(screen.getByTestId('GAR-07.sortDone'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ ids: ['01side', '01cover'] });
  });
});

describe('the Verlauf toggle hides the whole entry', () => {
  const change = (label: string) => ({
    kind: 'mod_changed',
    category: 'suspension',
    modification_id: '01mod',
    label,
    before: 'Serie',
    after: 'KW V3',
    text: `${label}: Serie → KW V3`,
    details: [],
  });
  const update = (overrides: Partial<OwnerUpdate>): OwnerUpdate => ({
    id: '01upd',
    type: 'mod_changed',
    type_label: 'Modifikation geändert',
    note: null,
    summary: 'x',
    changes: [change('Fahrwerk')],
    changes_count: 1,
    hidden: false,
    created_at: new Date('2026-11-01T10:00:00Z').toISOString(),
    month_label: 'März 2023',
    ...overrides,
  }) as OwnerUpdate;

  async function show(entry: OwnerUpdate) {
    mockParams = { id: VEHICLE_ID };
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } },
      [`GET ${VEHICLE_PATH}/updates`]: list([entry]),
    });
    await renderScreen(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-11.entry.01upd.toggle')).toBeTruthy());
  }

  it('takes the name of the only change, as its title says it (DQ-1059)', async () => {
    await show(update({}));
    expect(screen.getByTestId('GAR-11.entry.01upd.toggle')).toHaveAccessibleName('KW V3 statt Serie ausblenden');
  });

  it('with two changes takes the kind and the date, not the first change', async () => {
    await show(update({ changes: [change('Fahrwerk'), change('Auspuff')], changes_count: 2 }));
    const name = screen.getByTestId('GAR-11.entry.01upd.toggle');
    expect(name).not.toHaveAccessibleName('Fahrwerk ausblenden');
    expect(name).toHaveAccessibleName(/^Modifikation geändert, .+ ausblenden$/);
  });

  it('with changes left out does the same', async () => {
    await show(update({ changes: [change('Fahrwerk')], changes_count: 5 }));
    expect(screen.getByTestId('GAR-11.entry.01upd.toggle')).toHaveAccessibleName(/^Modifikation geändert, .+ ausblenden$/);
  });
});

describe('the nickname says what it is for (BH-26)', () => {
  it('GAR-05 explains it instead of just "Optional"', async () => {
    mockParams = { id: VEHICLE_ID };
    stubFetch({
      '/api/v1/auth/me': ME,
      [`GET ${VEHICLE_PATH}`]: { body: { data: vehicle() } },
      '/api/v1/catalog/makes': list([{ id: 34, name: 'Nissan', slug: 'nissan', country: 'JP', is_popular: true }]),
      '/api/v1/catalog/makes/34/models': list([{ id: 254, make_id: 34, name: 'Skyline GT-R', slug: 'skyline-gt-r' }]),
      '/api/v1/catalog/models/254/generations': list([]),
    });
    await renderScreen(<EditBasicsScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-05.nickname')).toBeTruthy());
    expect(screen.getByText('Optional. So findet man dein Auto in der Suche.')).toBeTruthy();
    await flushQueryNotifications();
  });
});
