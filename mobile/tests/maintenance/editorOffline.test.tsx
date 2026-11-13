import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { __resetMaintenanceOutboxForTests, maintenanceOutbox } from '@/features/maintenance/outbox';
import { MaintenanceEditorScreen } from '@/features/maintenance/screens/MaintenanceEditorScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { vehicle } from '../garage/fixtures';
import { list, ME, newQueryClient, renderScreen, signIn, stubFetch } from '../garage/harness';
import { item, log, VEHICLE } from './fixtures';

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
type MockListProps = { data: readonly unknown[]; renderItem: (info: { item: unknown; index: number }) => ReactNode; ListHeaderComponent?: ReactNode; ListEmptyComponent?: ReactNode; ListFooterComponent?: ReactNode };
jest.mock('@shopify/flash-list', () => {
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList({ data, renderItem, ListHeaderComponent, ListEmptyComponent, ListFooterComponent }, _ref) {
    return (
      <>
        {ListHeaderComponent}
        {data.length === 0 ? ListEmptyComponent : data.map((entry, index) => renderItem({ item: entry, index }))}
        {ListFooterComponent}
      </>
    );
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1'), getRandomBytes: (count: number) => new Uint8Array(count).fill(1) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied', granted: false, canAskAgain: false })),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
const mockQa: { state: 'default' | 'loading' | 'empty' | 'error' | 'offline' | 'restricted' } = { state: 'default' };
jest.mock('@/lib/qa', () => ({ ...jest.requireActual<object>('@/lib/qa'), useQaState: () => mockQa.state }));
const mockOnline = { current: true };
jest.mock('@/state/online', () => ({ useOnline: () => mockOnline.current }));

jest.setTimeout(60_000);

/** The screens read several queries in a row (session, settings, items): give them longer than the 1 s default. */
async function until(assertion: () => void, timeout = 30_000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > end) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
}

const SETTINGS = {
  body: {
    data: {
      distance_unit: 'km',
      maintenance: { hu_au_lead_days: [30, 14, 1], tyre_reminders: true, insurance_reminder: true, service_reminders: true },
    },
  },
};
const COSTS = { body: { data: { currency: 'EUR', total_cents: 124000, maintenance_cents: 18950, mods_cents: 105050, years: [{ year: 2026, total_cents: 124000, maintenance_cents: 18950, mods_cents: 105050 }] } } };
const ITEMS = (items = [item(), item({ id: '01mnt00000000000000000oil', type: 'oil_change', next_due: { date: '2027-06-14', month: null, km: 56200, pinned: false, deadline: null }, days_left: 214, last_done: { date: '2026-06-14', km: 41200 } })]) => ({
  body: { data: items, meta: { odometer: { km: 48200, recorded_at: '2026-11-01T10:00:00Z' } } },
});

function client(flag = true) {
  const queries = newQueryClient();
  queries.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, maintenance: flag } }, confirmed: true });
  return queries;
}

function api(overrides: Record<string, unknown> = {}) {
  return stubFetch({
    '/api/v1/auth/me': ME,
    '/api/v1/me/settings': SETTINGS,
    [`GET /api/v1/vehicles/${VEHICLE}`]: { body: { data: vehicle({ id: VEHICLE }) } },
    [`GET /api/v1/vehicles/${VEHICLE}/maintenance-items`]: ITEMS(),
    [`GET /api/v1/vehicles/${VEHICLE}/maintenance-logs`]: list([log()]),
    [`GET /api/v1/vehicles/${VEHICLE}/costs`]: COSTS,
    ...(overrides as Record<string, never>),
  });
}

beforeAll(hydrateThemePreference);
beforeEach(async () => {
  jest.clearAllMocks();
  mockQa.state = 'default';
  mockOnline.current = true;
  onlineManager.setOnline(true);
  mockParams = { id: VEHICLE };
  signIn();
  __resetMaintenanceOutboxForTests();
  await maintenanceOutbox().reset();
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

describe('MNT-02 editor', () => {
  it('offline: a service entry is queued with its cost in cents and the editor closes', async () => {
    const { calls } = api();
    mockOnline.current = false;
    mockParams = { id: VEHICLE, kind: 'log' };
    await renderScreen(<MaintenanceEditorScreen />, client());
    await until(() => expect(screen.getByTestId('MNT-02.cost')).toBeTruthy());
    fireEvent.press(screen.getByText('Ölwechsel'));
    fireEvent.changeText(screen.getByTestId('MNT-02.km'), '48.200');
    fireEvent.changeText(screen.getByTestId('MNT-02.cost'), '189,50');
    await act(async () => fireEvent.press(screen.getByTestId('MNT-02.cta')));
    await until(() => expect(maintenanceOutbox().store.getState().ops).toHaveLength(1), 5000);
    const ops = maintenanceOutbox().store.getState().ops;
    expect(ops[0]).toEqual(expect.objectContaining({ kind: 'log.create', scope: VEHICLE }));
    expect((ops[0]?.payload as { body: object }).body).toEqual(expect.objectContaining({ item_id: '01mnt00000000000000000oil', mileage_km: 48200, cost_cents: 18950 }));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    // The editor closes (the toast host is not part of this harness).
    await until(() => expect(mockRouter.back.mock.calls.length + mockRouter.replace.mock.calls.length).toBeGreaterThan(0));
  });
});
