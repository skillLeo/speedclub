/**
 * DQ-P5-017: Statistiken belongs to Profil (and a car's to Garage). The routes live in the shared tab group, so a cold link fell into
 * Entdecken and the bar marked Entdecken. Real router (expo-router/testing-library) on an in-memory tree that mirrors src/app.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, screen, waitFor } from '@testing-library/react-native';
import { router as appRouter } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import SharedLayout, { unstable_settings } from '@/app/(tabs)/(home,discover,garage,shop,profile)/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import { insightsLanding, LandInOwnTab } from '@/features/insights/coldLink';
import { resetLandingForTests } from '@/features/messages/coldLink';
import { useSessionStore } from '@/state/session';
import { useShellStore } from '@/state/shell';
import { hydrateThemePreference, ThemeProvider } from '@/theme';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => undefined), impactAsync: jest.fn(async () => undefined), notificationAsync: jest.fn(async () => undefined), performAndroidHapticsAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: {}, NotificationFeedbackType: {}, AndroidHaptics: {} }));
jest.mock('@/features/shell/navMode', () => ({ ...jest.requireActual('@/features/shell/navMode'), useTabChrome: () => 'js' }));
jest.mock('@/features/shell/useTabBadges', () => ({ useTabBadges: () => ({ messages: 0, home: false, notifications: 0 }) }));
jest.mock('@/api/queries/appConfig', () => {
  const actual = jest.requireActual('@/api/queries/appConfig');
  return {
    ...actual,
    useAppConfig: () => ({ config: { ...actual.BUNDLED_APP_CONFIG, flags: { events: true } }, confirmed: true, released: false, refetch: jest.fn(), isFetching: false }),
    useFlag: (key: string) => key === 'events',
  };
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }) }));

configure({ asyncUtilTimeout: 30_000 });
jest.setTimeout(120_000);

const plain = (id: string) =>
  function Plain() {
    return <View testID={`${id}.root`} />;
  };

/** The INS-01 routes as src/app wraps them. */
const insights = (id: string) =>
  function Insights() {
    return (
      <LandInOwnTab>
        <View testID={`${id}.root`} />
      </LandInOwnTab>
    );
  };

const tree = () =>
  Object.fromEntries(
    Object.entries({
      '(tabs)/_layout': { default: TabsLayout },
      '(tabs)/(home,discover,garage,shop,profile)/_layout': { default: SharedLayout, unstable_settings },
      '(tabs)/(home,discover,garage,shop,profile)/insights/index': insights('INS-01'),
      '(tabs)/(home,discover,garage,shop,profile)/vehicles/[id]/insights': insights('INS-01-vehicle'),
      '(tabs)/(home)/index': plain('HOME-01'),
      '(tabs)/(discover)/discover/index': plain('DISC-01'),
      '(tabs)/(garage)/garage/index': plain('GAR-01'),
      '(tabs)/(shop)/shop/index': plain('SHOP-01'),
      '(tabs)/(profile)/profile/index': plain('PROF-01'),
    }).sort(([a], [b]) => a.localeCompare(b)),
  );

const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Providers = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>
    <QueryClientProvider client={queries}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  </GestureHandlerRootView>
);

const open = (initialUrl: string) => renderRouter(tree() as never, { initialUrl, wrapper: Providers });
const isSelected = (id: string) => screen.getByTestId(id).props.accessibilityState?.selected === true;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  resetLandingForTests();
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null });
  useShellStore.setState({ tabBarHidden: false });
});

describe('INS-01 cold links (DQ-P5-017)', () => {
  it('knows the tab of each statistics path, keeping the query', () => {
    expect(insightsLanding('/insights', '')).toEqual({ group: '(profile)', href: '/(tabs)/(profile)/insights' });
    expect(insightsLanding('/insights/', '?qaState=empty')).toEqual({ group: '(profile)', href: '/(tabs)/(profile)/insights?qaState=empty' });
    expect(insightsLanding('/vehicles/01JCAR/insights', '')).toEqual({ group: '(garage)', href: '/(tabs)/(garage)/vehicles/01JCAR/insights' });
    expect(insightsLanding('/vehicles/01JCAR', '')).toBeNull();
    expect(insightsLanding('/discover', '')).toBeNull();
  });

  it('a cold link to /insights opens it in Profil over the profile, and Profil is the marked tab', async () => {
    const router = await open('/insights');
    await screen.findByTestId('INS-01.root');
    await waitFor(() => expect(router.getSegments()).toContain('(profile)'));
    expect(router.getPathname()).toBe('/insights');
    expect(isSelected('tab.profile')).toBe(true);
    expect(isSelected('tab.discover')).toBe(false);
    await act(async () => appRouter.back());
    await screen.findByTestId('PROF-01.root');
  });

  it("a cold link to a car's statistics opens them in Garage", async () => {
    const router = await open('/vehicles/01JCAR/insights');
    await screen.findByTestId('INS-01-vehicle.root');
    await waitFor(() => expect(router.getSegments()).toContain('(garage)'));
    expect(router.getPathname()).toBe('/vehicles/01JCAR/insights');
    expect(isSelected('tab.garage')).toBe(true);
  });

  it('opened from another tab, the statistics stay in that tab', async () => {
    const router = await open('/discover');
    await screen.findByTestId('DISC-01.root');
    await act(async () => appRouter.push('/insights'));
    await screen.findByTestId('INS-01.root');
    expect(router.getSegments()).toContain('(discover)');
  });
});
