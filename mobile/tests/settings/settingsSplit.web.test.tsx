// DQ-420 (M2.8 design QA round 1): the desktop settings split on web. The pane marks the detail's row with aria-current="page",
// and the detail has no back while the list stands beside it, as the MSG split.
import { screen } from '@testing-library/react-native';

import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { hydrateThemePreference } from '@/theme';
import { Text } from '@/ui';

import { renderScreen } from './harness';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
const mockWindow: { current: { width: number; height: number; scale: number; fontScale: number } } = {
  current: { width: 1280, height: 800, scale: 1, fontScale: 1 },
};
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow.current }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  usePathname: () => '/settings/privacy',
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true }),
  useFocusEffect: jest.fn(),
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/state/online', () => ({ ...jest.requireActual('@/state/online'), useOnline: () => true }));
jest.mock('@/api/queries/auth', () => ({
  ...jest.requireActual<object>('@/api/queries/auth'),
  useMe: () => ({ data: undefined }),
  useSignOut: () => ({ isPending: false, mutate: jest.fn() }),
}));

beforeAll(hydrateThemePreference);

function Page() {
  return (
    <SettingsPage routeId="SET-10" title="Erscheinungsbild" fallback="/settings" section="appearance">
      <Text variant="body">Inhalt</Text>
    </SettingsPage>
  );
}

describe('settings split on web (DQ-420)', () => {
  it('marks the detail’s row in the pane with aria-current="page", and no other', async () => {
    await renderScreen(<Page />);
    expect(screen.getByTestId('SET-10.nav.appearance.body').props['aria-current']).toBe('page');
    expect(screen.getByTestId('SET-10.nav.language.body').props['aria-current']).toBeUndefined();
  });

  it('shows no back in the detail while the list stands beside it', async () => {
    await renderScreen(<Page />);
    expect(screen.getByTestId('SET-10.nav')).toBeTruthy();
    expect(screen.queryByTestId('SET-10.header.back')).toBeNull();
  });

  it('keeps back below 1280, where the page stands alone', async () => {
    mockWindow.current = { width: 768, height: 1024, scale: 1, fontScale: 1 };
    await renderScreen(<Page />);
    expect(screen.queryByTestId('SET-10.nav')).toBeNull();
    expect(screen.getByTestId('SET-10.header.back')).toBeTruthy();
    mockWindow.current = { width: 1280, height: 800, scale: 1, fontScale: 1 };
  });
});
