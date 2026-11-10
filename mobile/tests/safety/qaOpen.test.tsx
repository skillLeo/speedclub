// qaOpen=report (M2.8 capture): the visual matrix cannot tap, so a QA URL opens the page's report sheet once its target is there.
import { screen } from '@testing-library/react-native';
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
});
