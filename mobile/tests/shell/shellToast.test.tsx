/**
 * The shell toast host in the real router (expo-router/testing-library): it clears the sticky CTA bar of the focused
 * screen only, the tab bar where there is one, and goes back down when the bar leaves.
 */
import { stickyBarHeight } from '@/ui/StickyCTABar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router as appRouter, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import SharedLayout, { unstable_settings } from '@/app/(tabs)/(home,discover,garage,messages,profile)/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import { ShellToastHost } from '@/features/shell/ShellToastHost';
import { TabRootScreen } from '@/features/shell/TabRootScreen';
import { useSessionStore } from '@/state/session';
import { setTabBarHidden, useShellStore } from '@/state/shell';
import { hydrateThemePreference, size, space, ThemeProvider } from '@/theme';
import { EmptyState, Screen, StickyCTABar } from '@/ui';

import { flat } from '../ui/helpers';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-haptics', () => ({}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
}));

/** One row: hairline, 12 + button L + 12. The test safe area has no inset. */
const ONE_ROW = 1 + space[12] + size.button.l + space[12];
/** At 200 % font the primary wraps under the draft action. */
const TWO_ROWS = ONE_ROW + size.button.s + space[8];

function Root() {
  return (
    <>
      <Stack />
      <ShellToastHost />
    </>
  );
}

const form = (id: string) =>
  function Form() {
    return (
      <Screen testID={`${id}.root`}>
        <StickyCTABar label="Weiter" onPress={() => undefined} testID={`${id}.cta`} />
      </Screen>
    );
  };

const plain = (id: string) =>
  function Plain() {
    return <Screen testID={`${id}.root`} />;
  };

/**
 * A tab root of the test's own, since every real tab has its screen now: the shell's TabRootScreen (header, collapsing
 * title, tab-bar padding) with a plain body, which is all these tests need from a tab.
 */
function StandInTab({ routeId, titleKey, testID }: { routeId: string; titleKey: `tabs.${string}`; testID: string }) {
  const { t } = useTranslation('common');
  return (
    <TabRootScreen routeId={routeId} title={t(titleKey)} bodyTestID={testID}>
      <EmptyState icon="wrench" title={t('states.comingSoon')} body={t('shell.placeholderBody')} />
    </TabRootScreen>
  );
}

const tabRoot = (name: string, id: string) =>
  function TabRoot() {
    return <StandInTab routeId={id} titleKey={`tabs.${name}`} testID={`screen.${name}`} />;
  };

const tree = () => ({
  _layout: { default: Root },
  '(auth)/_layout': { default: () => <Stack /> },
  '(auth)/sign-in': form('AUTH-03'),
  '(auth)/reset-password': form('AUTH-07'),
  '(auth)/legal': plain('LEGAL'),
  '(tabs)/_layout': { default: TabsLayout },
  '(tabs)/(home,discover,garage,messages,profile)/_layout': { default: SharedLayout, unstable_settings },
  '(tabs)/(home)/index': tabRoot('home', 'HOME-01'),
  '(tabs)/(discover)/discover/index': tabRoot('discover', 'DISC-01'),
  '(tabs)/(garage)/garage/index': tabRoot('garage', 'GAR-01'),
  '(tabs)/(messages)/messages/index': tabRoot('messages', 'MSG-01'),
  '(tabs)/(profile)/profile/index': tabRoot('profile', 'PROF-01'),
  '(tabs)/(profile)/profile/edit': form('PROF-02'),
});

// The root layout's query client: the tab badges read the unread count (M2.2), a guest asks nothing.
const shellQueries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Providers = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>
    <QueryClientProvider client={shellQueries}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  </GestureHandlerRootView>
);

const open = (initialUrl: string) => renderRouter(tree() as never, { initialUrl, wrapper: Providers });
const bottom = () => flat(screen.getByTestId('toast.host').props.style).bottom;
const layOut = (id: string, height: number) =>
  fireEvent(screen.getByTestId(`${id}.cta.sticky`), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });

configure({ asyncUtilTimeout: 30_000 });
jest.setTimeout(120_000);

beforeAll(hydrateThemePreference);

beforeEach(() => {
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null });
  useShellStore.setState({ tabBarHidden: false });
});

describe('the shell toast and a sticky CTA bar', () => {
  it('outside the tabs it sits 8 above the bar, from the first frame on (one row until its layout says more)', async () => {
    await open('/sign-in');
    await screen.findByTestId('AUTH-03.root');
    // M2.8: not on the content first and then moving up under a pointer.
    expect(bottom()).toBe(stickyBarHeight(0) + space[8]);
    await layOut('AUTH-03', ONE_ROW);
    expect(bottom()).toBe(ONE_ROW + space[8]);
    // 200 % font.
    await layOut('AUTH-03', TWO_ROWS);
    expect(bottom()).toBe(TWO_ROWS + space[8]);
  });

  it('a screen pushed over the form takes the bar out, and back brings it in again', async () => {
    await open('/sign-in');
    await screen.findByTestId('AUTH-03.root');
    await layOut('AUTH-03', ONE_ROW);

    await act(async () => appRouter.push('/legal'));
    await screen.findByTestId('LEGAL.root');
    await waitFor(() => expect(bottom()).toBe(space[8]));

    await act(async () => appRouter.back());
    await waitFor(() => expect(bottom()).toBe(ONE_ROW + space[8]));
  });

  it('after a reset, AUTH-07 replaced by AUTH-03: the old bar is gone and the new one counts', async () => {
    await open('/reset-password');
    await screen.findByTestId('AUTH-07.root');
    await layOut('AUTH-07', TWO_ROWS);
    expect(bottom()).toBe(TWO_ROWS + space[8]);

    await act(async () => appRouter.replace('/sign-in'));
    await screen.findByTestId('AUTH-03.root');
    await waitFor(() => expect(screen.queryByTestId('AUTH-07.root')).toBeNull());
    expect(bottom()).toBe(stickyBarHeight(0) + space[8]);
    await layOut('AUTH-03', ONE_ROW);
    expect(bottom()).toBe(ONE_ROW + space[8]);
  });

  it('in a tab it clears the higher of tab bar and form bar, only while that tab is in front', async () => {
    await open('/profile/edit');
    await screen.findByTestId('PROF-02.root');
    await layOut('PROF-02', ONE_ROW);
    expect(bottom()).toBe(Math.max(size.tabBar, ONE_ROW) + space[8]);

    await fireEvent.press(screen.getByTestId('tab.garage'));
    await screen.findByTestId('screen.garage');
    await waitFor(() => expect(bottom()).toBe(size.tabBar + space[8]));

    await fireEvent.press(screen.getByTestId('tab.profile'));
    await screen.findByTestId('PROF-02.root');
    await waitFor(() => expect(bottom()).toBe(Math.max(size.tabBar, ONE_ROW) + space[8]));

    // An editor hides the tab bar (§9): the bar alone counts.
    await act(async () => setTabBarHidden(true));
    expect(bottom()).toBe(ONE_ROW + space[8]);
  });
});
