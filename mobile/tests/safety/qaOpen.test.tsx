// qaOpen=report (M2.8 capture): the visual matrix cannot tap, so a QA URL opens the page's report sheet once its target is there.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';

import { SafetyContext, unavailableSafety, type SafetyAdapter } from '@/features/safety/data';
import type { ReportTarget } from '@/features/safety/model';
import { useReport } from '@/features/safety/useReport';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { renderWithProviders } from '../home/harness';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
  usePathname: () => '/v/bmw-m3-e46',
  useNavigation: () => ({ addListener: () => () => undefined, getParent: () => undefined }),
  useFocusEffect: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('@/lib/qa', () => ({ ...jest.requireActual<object>('@/lib/qa'), qa: { open: 'report' } }));

beforeAll(hydrateThemePreference);
beforeEach(() => setMember({ id: 'member-lukas', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
afterEach(() => useSessionStore.setState({ status: 'loading', member: null }));

const target: ReportTarget = { type: 'vehicle', id: '01JVEH', label: 'BMW M3 (E46)', owner: 'paul.roadster' };
const safety: SafetyAdapter = { ...unavailableSafety, available: true };

function Host({ ready }: { ready: boolean }) {
  const flow = useReport(ready ? target : null, { routeId: 'VEH-01' });
  return <View>{flow.element}</View>;
}

describe('qaOpen=report', () => {
  it('opens the report sheet by itself once the target is there', async () => {
    await renderWithProviders(
      <SafetyContext value={safety}>
        <Host ready />
      </SafetyContext>,
    );
    expect(await screen.findByTestId('VEH-01.report.target')).toHaveTextContent(/BMW M3 \(E46\)/);
  });

  it('waits while the session is loading, then opens once (PROF-02 capture, H3)', async () => {
    useSessionStore.setState({ status: 'loading', member: null });
    await renderWithProviders(
      <SafetyContext value={safety}>
        <Host ready />
      </SafetyContext>,
    );
    // While loading, openFor would send a member through the guest path and spend the one try.
    expect(screen.queryByTestId('VEH-01.report.target')).toBeNull();
    expect(screen.queryByTestId('auth.sheet')).toBeNull();

    await act(async () => setMember({ id: 'member-lukas', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
    expect(await screen.findByTestId('VEH-01.report.target')).toHaveTextContent(/BMW M3 \(E46\)/);

    // Closed, it stays closed: the status changing again does not open it a second time.
    await fireEvent.press(screen.getByTestId('VEH-01.report.scrim'));
    await waitFor(() => expect(screen.queryByTestId('VEH-01.report.target')).toBeNull());
    await act(async () => useSessionStore.setState({ status: 'guest', member: null }));
    await act(async () => setMember({ id: 'member-lukas', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
    expect(screen.queryByTestId('VEH-01.report.target')).toBeNull();
  });
});
