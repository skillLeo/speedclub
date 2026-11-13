// A12 (M4.1 fix round 8): the desktop settings pane at 200 % grows until every label's longest word fits its column, so
// "Meldungen" never breaks between two letters ("Meldunge / n"); at 100 % it stays the 280 pane of FS-12.
import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { hydrateThemePreference, layout } from '@/theme';
import { Text } from '@/ui';

import { renderScreen } from './harness';

const mockQa = { fontScale: 2 };
jest.mock('@/lib/qa', () => {
  const actual = jest.requireActual<{ qa: object }>('@/lib/qa');
  return {
    ...actual,
    qa: new Proxy(actual.qa, { get: (target, key) => (key === 'fontScale' ? mockQa.fontScale : Reflect.get(target, key)) }),
  };
});
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

const paneWidth = () => StyleSheet.flatten(screen.getByTestId('SET-10.nav').props.style).width as number;

describe('settings pane at a large font (A12)', () => {
  it('widens the pane at font scale 2, so the rows keep their words whole', async () => {
    mockQa.fontScale = 2;
    await renderScreen(<Page />);
    expect(paneWidth()).toBeGreaterThan(layout.settingsPane);
    expect(screen.getByTestId('SET-10.nav.appearance.body')).toBeTruthy();
  });

  it('keeps the 280 pane at font scale 1', async () => {
    mockQa.fontScale = 1;
    await renderScreen(<Page />);
    expect(paneWidth()).toBe(layout.settingsPane);
  });
});
