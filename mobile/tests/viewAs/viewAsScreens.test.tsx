/** M3.2 view-as UI (m3.2-contract §3): the bar, "Beenden", "Ansicht beendet", disabled writes, the messages and export states. */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { meKey, type Me } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { ChangePasswordScreen } from '@/features/settings/screens/ChangePasswordScreen';
import { ExportScreen } from '@/features/settings/screens/ExportScreen';
import { ViewAsFrame } from '@/features/viewAs/ViewAsFrame';
import { adoptViewAsMember, intakeViewAs, resetViewAsForTests, type ViewAsWindow } from '@/features/viewAs/viewAsSession';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, stubFetch } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/',
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), selectionAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));
const dimensions = useWindowDimensions as jest.Mock;
const mockToast = jest.fn();
jest.mock('@/ui/toast', () => ({ ...jest.requireActual<object>('@/ui/toast'), toast: (...args: unknown[]) => mockToast(...args) }));

const TOKEN = '41|Zb8kQ2rVt6YpLm3NcXw9HsAe1JdFgUo5RiTqKy7B';
const ME = {
  id: '01m6f7ztzfs0gd39t08rs9zmmp',
  email: 'lukas.sc@speedclub.test',
  username: 'lukas.sc',
  display_name: 'Lukas',
  avatar: null,
  cover: null,
  next_step: null,
  two_factor_enabled: false,
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
} as unknown as Me;

function startView() {
  const session = new Map<string, string>();
  const win: ViewAsWindow = {
    location: { hash: `#view_as=${encodeURIComponent(TOKEN)}&staff=Mara%20Klein`, pathname: '/app/', search: '' },
    history: { state: null, replaceState: jest.fn() },
    sessionStorage: { getItem: (key) => session.get(key) ?? null, setItem: (key, value) => void session.set(key, value), removeItem: (key) => void session.delete(key) },
  };
  intakeViewAs(win);
  adoptViewAsMember(ME);
  return session;
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
  queryClient.clear();
});
afterAll(() => queryClient.clear());
afterEach(async () => {
  await act(async () => {
    resetViewAsForTests();
    useSessionStore.setState({ status: 'guest', member: null });
  });
});

describe('ViewAsFrame', () => {
  it('a normal tab: only the app, no bar', async () => {
    await renderScreen(
      <ViewAsFrame>
        <Text testID="app">App</Text>
      </ViewAsFrame>,
    );
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('VIEWAS.banner')).toBeNull();
  });

  it('shows the bar above the app; "Beenden" revokes and leaves "Ansicht beendet"', async () => {
    const { fetchMock } = stubFetch({ '/view-as': { status: 204, body: null } });
    await act(async () => startView());
    await renderScreen(
      <ViewAsFrame>
        <View testID="app" />
      </ViewAsFrame>,
    );
    // ADR-228 / M3.5: one line at 360, the name first and "· nur lesen" whole beside it.
    expect(screen.getByTestId('VIEWAS.banner.text')).toHaveTextContent('Als @lukas.sc\u00a0· nur lesen');
    expect(screen.getByTestId('VIEWAS.banner').props['aria-label']).toBe('Ansicht als @lukas.sc, nur lesen, gestartet von Mara Klein');
    expect(screen.getByTestId('app')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('VIEWAS.end'));
    await waitFor(() => expect(screen.getByTestId('VIEWAS.ended')).toBeTruthy());
    expect(screen.getByText('Ansicht beendet')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
    expect(screen.queryByTestId('VIEWAS.banner')).toBeNull();
    const sent = fetchMock.mock.calls.map(([request]) => request as Request);
    expect(sent.some((request) => request.method === 'DELETE' && request.url.endsWith('/api/v1/view-as'))).toBe(true);
  });
});

describe('the bar at a large font (DQ-672)', () => {
  it('wraps before the "·", never after it, keeps "· nur lesen" whole and puts "Beenden" under the text', async () => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
    stubFetch({});
    await act(async () => startView());
    await renderScreen(
      <ViewAsFrame>
        <View testID="app" />
      </ViewAsFrame>,
    );
    expect(screen.getByTestId('VIEWAS.banner.text')).toHaveTextContent('Als @lukas.sc ·\u00a0nur\u00a0lesen', { normalizer: (text: string) => text });
    expect(StyleSheet.flatten(screen.getByTestId('VIEWAS.banner').props.style)).toMatchObject({ flexDirection: 'column' });
    expect(StyleSheet.flatten(screen.getByTestId('VIEWAS.end').props.style)).toMatchObject({ alignSelf: 'flex-end' });
    // The text keeps its own height in the column (a basis of 0 % ran it out of the top of the bar on web).
    expect(StyleSheet.flatten(screen.getByTestId('VIEWAS.banner.message').props.style)).toMatchObject({ flexBasis: 'auto', flexGrow: 0 });
  });
});

describe('write controls in a view-as tab', () => {
  it('SET-04 says it is read-only and its button rests', async () => {
    stubFetch({});
    await act(async () => startView());
    queryClient.setQueryData(meKey, ME);
    await renderScreen(<ChangePasswordScreen />, queryClient);
    expect(screen.getByTestId('SET-04.viewAsReadOnly')).toBeTruthy();
    const button = screen.getByTestId('SET-04.cta.primary');
    expect(button.props['aria-disabled'] ?? button.props.accessibilityState?.disabled).toBe(true);
  });

  it('SET-12 shows the designed "nicht verfügbar" state and asks the server nothing', async () => {
    const { fetchMock } = stubFetch({});
    await act(async () => startView());
    await renderScreen(<ExportScreen />, queryClient);
    expect(screen.getByTestId('SET-12.viewAs')).toBeTruthy();
    expect(screen.getByText('In der Ansicht als Mitglied nicht verfügbar')).toBeTruthy();
    expect(screen.queryByTestId('SET-12.cta.primary')).toBeNull();
    expect(fetchMock.mock.calls.some(([request]) => (request as Request).url.includes('/me/exports'))).toBe(false);
  });

  it('"Fahrzeug hinzufügen" anywhere says why nothing opens', async () => {
    await act(async () => startView());
    let add: () => void = () => undefined;
    function Probe() {
      add = useAddVehicle();
      return null;
    }
    await renderScreen(<Probe />);
    act(() => add());
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('In der Ansicht als Mitglied kannst du nichts ändern.', expect.anything());
  });
});
