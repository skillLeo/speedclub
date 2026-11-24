/**
 * DQ-P5-204 (Phase 5 gate): the PROF-01 and BDG-01 skeletons are drawn in the shape of the page that replaces them. PROF-01 has the
 * Abzeichen row under the counts and the Statistiken · Mein Dex group under the actions; BDG-01 has the intro as drawn and groups of
 * rows as tall as a badge row with its wrapped description.
 */
import { screen } from '@testing-library/react-native';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { INSIGHTS_FLAG } from '@/api/queries/insights';
import { BadgesScreen } from '@/features/gift/screens/BadgesScreen';
import { ProfileSkeleton } from '@/features/profile/components/ProfileSkeleton';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, size, space, typography } from '@/theme';

import { newQueryClient, renderScreen } from '../qr/harness';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 1, fontScale: 1 })),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) }),
  useLocalSearchParams: () => ({}),
  usePathname: () => '/profile',
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const dimensions = useWindowDimensions as jest.Mock;
const heightOf = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID, { includeHiddenElements: true }).props.style).height as number;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 393, height: 852, scale: 1, fontScale: 1 }));

describe('PROF-01 skeleton (DQ-P5-204)', () => {
  it('draws the Abzeichen row before the actions and the two-row Statistiken · Mein Dex group before the tabs', async () => {
    const client = newQueryClient();
    client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, [INSIGHTS_FLAG]: true } }, confirmed: true });
    await renderScreen(<ProfileSkeleton width={393} columnWidth={393} withCover />, client);
    expect(screen.getByTestId('PROF-01.skeleton.badges', { includeHiddenElements: true })).toBeTruthy();
    // Statistiken (title + subtitle, 58) and Mein Dex (56), as the RowGroup draws them.
    const insightsRow = typography.body.lineHeight + typography.callout.lineHeight + 2 * space[8];
    expect(heightOf('PROF-01.skeleton.shortcuts')).toBe(Math.max(size.row.single, insightsRow) + size.row.single);
  });

  it('without the insights flag the group is the one Mein Dex row', async () => {
    const client = newQueryClient();
    client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, [INSIGHTS_FLAG]: false } }, confirmed: true });
    await renderScreen(<ProfileSkeleton width={393} columnWidth={393} />, client);
    expect(heightOf('PROF-01.skeleton.shortcuts')).toBe(size.row.single);
  });

  it('another member (PROF-02) has neither: its badge row shows only with earned badges, and it has no shortcuts', async () => {
    await renderScreen(<ProfileSkeleton width={393} columnWidth={393} variant="member" routeId="PROF-02" />);
    expect(screen.queryByTestId('PROF-02.skeleton.badges', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('PROF-02.skeleton.shortcuts', { includeHiddenElements: true })).toBeNull();
  });
});

describe('BDG-01 skeleton (DQ-P5-204)', () => {
  afterEach(() => useSessionStore.setState({ status: 'guest', member: null }));

  it('draws rows as tall as a badge row with a description over three lines at 393, in groups of 1, 1 and 2', async () => {
    useSessionStore.setState({ status: 'loading' });
    await renderScreen(<BadgesScreen own />);
    const groups = screen.getAllByTestId('BDG-01.skeleton.group', { includeHiddenElements: true });
    const heights = groups.map((group) => StyleSheet.flatten(group.props.style).height as number);
    const row = typography.body.lineHeight + 3 * typography.callout.lineHeight + 2 * space[8];
    expect(heights).toEqual([row, row, 2 * row]);
  });
});
