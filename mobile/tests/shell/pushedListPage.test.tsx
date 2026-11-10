// DQ-420: a pushed list page in the settings split (SET-08, SET-16) has no back while the list stands beside it.
import { screen } from '@testing-library/react-native';

import { PushedListPage } from '@/features/shell/PushedListPage';
import { hydrateThemePreference } from '@/theme';
import { Text } from '@/ui';

import { renderUi } from '../ui/helpers';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/state/online', () => ({ ...jest.requireActual('@/state/online'), useOnline: () => true }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), getParent: () => undefined }),
  usePathname: () => '/settings/reports',
  useFocusEffect: jest.fn(),
}));

beforeAll(hydrateThemePreference);

const list = () => <Text variant="body">Liste</Text>;

describe('PushedListPage', () => {
  it('draws back when given one, and none without (the settings split)', async () => {
    await renderUi(<PushedListPage routeId="SET-16" title="Meldungen" onBack={jest.fn()} renderList={list} onScrollToTop={jest.fn()} />);
    expect(screen.getByTestId('SET-16.header.back')).toBeTruthy();
    await renderUi(<PushedListPage routeId="SET-08" title="Blockiert" renderList={list} onScrollToTop={jest.fn()} />);
    expect(screen.queryByTestId('SET-08.header.back')).toBeNull();
  });
});
