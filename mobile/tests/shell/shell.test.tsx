/**
 * The real tab layout, shared layout and placeholders in the real router (expo-router/testing-library), on an
 * in-memory route tree that mirrors src/app.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Link, router as appRouter } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import NotFoundRoute from '@/app/+not-found';
import AuthLayout from '@/app/(auth)/_layout';
import SharedLayout, { unstable_settings } from '@/app/(tabs)/(home,discover,garage,messages,profile)/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import { AuthRequiredSheet } from '@/features/shell/AuthRequiredSheet';
import { RoutePlaceholder } from '@/features/shell/RoutePlaceholder';
import { TabRootScreen } from '@/features/shell/TabRootScreen';
import { completeAuthIntent, openAuthPrompt, setMember, useSessionStore } from '@/state/session';
import { setTabBarHidden, useShellStore } from '@/state/shell';
import { hydrateThemePreference, layout, size, space, ThemeProvider, typography } from '@/theme';
import { EmptyState } from '@/ui';

import { flat, visualOf } from '../ui/helpers';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-haptics', () => ({}));

const mockDimensions = jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockDimensions(),
}));

type TabName = 'home' | 'discover' | 'garage' | 'messages' | 'profile';

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

// The app's sample vehicle link left with M1.6. The harness keeps one of its own per tab root, into the shared route.
const tabRoot = (name: TabName, id: string) =>
  function Root() {
    return (
      <>
        <StandInTab routeId={id} titleKey={`tabs.${name}`} testID={`screen.${name}`} />
        <Link href="/v/spike-demo" asChild>
          <Pressable role="link" aria-label="vehicle" testID={`screen.${name}.vehicle`} />
        </Link>
      </>
    );
  };

const tree = () => ({
  '(tabs)/_layout': { default: TabsLayout },
  '(tabs)/(home,discover,garage,messages,profile)/_layout': { default: SharedLayout, unstable_settings },
  '(tabs)/(home,discover,garage,messages,profile)/v/[slug]/index': () => (
    <RoutePlaceholder routeId="VEH-01" titleKey="routes.vehicle" headerTestID="vehicle" />
  ),
  '(tabs)/(home)/index': tabRoot('home', 'HOME-01'),
  '(tabs)/(discover)/discover/index': tabRoot('discover', 'DISC-01'),
  '(tabs)/(garage)/garage/index': tabRoot('garage', 'GAR-01'),
  '(tabs)/(messages)/messages/index': tabRoot('messages', 'MSG-01'),
  '(tabs)/(profile)/profile/index': tabRoot('profile', 'PROF-01'),
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

const open = (initialUrl: string = '/', routes: object = tree()) =>
  renderRouter(routes as never, { initialUrl, wrapper: Providers });

const TABS: readonly TabName[] = ['home', 'discover', 'garage', 'messages', 'profile'];

const selected = () => TABS.filter((name) => screen.getByTestId(`tab.${name}`).props.accessibilityState?.selected === true);

// The first render of the route tree compiles a lot on a busy machine.
configure({ asyncUtilTimeout: 30_000 });
jest.setTimeout(120_000);

const windowOf = (width: number, height: number = 900) =>
  mockDimensions.mockReturnValue({ width, height, scale: 1, fontScale: 1 });

beforeAll(hydrateThemePreference);

beforeEach(() => {
  windowOf(390, 844);
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null });
  useShellStore.setState({ tabBarHidden: false });
});

describe('a direct load of a QR owner screen (DQ-171)', () => {
  const qrRoute = () => <RoutePlaceholder routeId="QR-02" titleKey="routes.vehicle" headerTestID="qr" />;
  /** The bundler lists the route files alphabetically, and of two equal routes a cold link takes the group listed first. */
  const asBundled = (routes: object) => Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)));
  /** The route as it was under ADR-101: shared by all five tabs, so a cold link took the first alphabetical group, Discover. */
  const allTabs = () => asBundled({ ...tree(), '(tabs)/(home,discover,garage,messages,profile)/qr/[vehicleId]/index': qrRoute });
  /** The route as it is since ADR-164. nav-shared-routes.spec.ts checks the real tree in the exported app. */
  const ownerTabs = () => asBundled({ ...tree(), '(tabs)/(garage,profile)/qr/[vehicleId]/index': qrRoute });

  it('why the route moved: under all five groups it highlights Entdecken', async () => {
    await open('/qr/01JVEHICLE', allTabs());
    await screen.findByTestId('qr');
    expect(selected()).toEqual(['discover']);
  });

  it('under Garage and Profile it highlights Garage and keeps the address', async () => {
    await open('/qr/01JVEHICLE', ownerTabs());
    await screen.findByTestId('qr');
    expect(selected()).toEqual(['garage']);
    expect(screen).toHavePathname('/qr/01JVEHICLE');
  });

  it('opened from Profile it stays in Profile', async () => {
    await open('/profile', ownerTabs());
    await screen.findByTestId('screen.profile');
    await act(async () => appRouter.push('/qr/01JVEHICLE'));
    await screen.findByTestId('qr');
    expect(selected()).toEqual(['profile']);
  });

  it('opened from a build in Entdecken it moves to Garage, where the owner screen belongs', async () => {
    await open('/discover', ownerTabs());
    await screen.findByTestId('screen.discover');
    await act(async () => appRouter.push('/qr/01JVEHICLE'));
    await screen.findByTestId('qr');
    expect(selected()).toEqual(['garage']);
  });

  it('back from a direct load goes to the root of Garage', async () => {
    await open('/qr/01JVEHICLE', ownerTabs());
    await screen.findByTestId('qr');
    await act(async () => appRouter.back());
    await screen.findByTestId('screen.garage');
    expect(screen).toHavePathname('/garage');
  });
});

describe('tab bar', () => {
  it('has the five destinations in German, in order, in a tablist, with one selected', async () => {
    await open();
    await screen.findByTestId('screen.home');
    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Start',
      'Entdecken',
      'Garage',
      'Nachrichten',
      'Profil',
    ]);
    expect(screen.getByTestId('shell.tabbar.list').props.role ?? screen.getByTestId('shell.tabbar.list').props.accessibilityRole).toBe('tablist');
    expect(screen.getByTestId('shell.tabbar.list').props['aria-label']).toBe('Hauptnavigation');
    expect(selected()).toEqual(['home']);
  });

  it('follows the metrics of §8', async () => {
    await open();
    await screen.findByTestId('screen.home');
    const button = flat(screen.getByTestId('tab.home').props.style);
    expect(button.height).toBe(size.tabBar);
    expect(button.flex).toBe(1);
    const indicator = flat(screen.getByTestId('shell.tabbar.indicator', { includeHiddenElements: true }).props.style);
    expect(indicator.width).toBe(space[16]);
    expect(indicator.height).toBe(space[2]);
    // Its bottom edge sits 6 above the icon, whose top is at 12.
    expect((indicator.top as number) + (indicator.height as number) + 6).toBe(space[12]);
    const label = screen.getByText('Nachrichten');
    expect(flat(label.props.style).fontSize).toBe(typography.tab.fontSize);
    expect(label.props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('at 360, with cells of exactly 72, the label is capped at 1.15', async () => {
    windowOf(360, 780);
    await open();
    await screen.findByTestId('screen.home');
    expect(screen.getByText('Nachrichten').props.maxFontSizeMultiplier).toBe(1.15);
  });

  it('at 320 the label stays on one line, is complete for readers, and is capped lower', async () => {
    windowOf(320, 568);
    await open();
    await screen.findByTestId('screen.home');
    const label = screen.getByText('Nachrichten');
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props['aria-label']).toBe('Nachrichten');
    expect(label.props.maxFontSizeMultiplier).toBe(1);
  });

  it('switching tabs changes selection and keeps each stack', async () => {
    const router = await open();
    await screen.findByTestId('screen.home');

    await fireEvent.press(screen.getByTestId('tab.garage'));
    await screen.findByTestId('screen.garage');
    expect(selected()).toEqual(['garage']);
    expect(router.getPathname()).toBe('/garage');

    await fireEvent.press(await screen.findByTestId('screen.garage.vehicle'));
    await screen.findByTestId('vehicle.back');
    expect(router.getPathname()).toBe('/v/spike-demo');
    expect(router.getSegments()).toContain('(garage)');
    expect(selected()).toEqual(['garage']);

    await fireEvent.press(screen.getByTestId('tab.discover'));
    await screen.findByTestId('screen.discover');
    expect(router.getPathname()).toBe('/discover');

    await fireEvent.press(screen.getByTestId('tab.garage'));
    await waitFor(() => expect(router.getPathname()).toBe('/v/spike-demo'));
    expect(router.getSegments()).toContain('(garage)');
  });

  it('re-tapping the active tab pops to its root', async () => {
    const router = await open('/garage');
    await fireEvent.press(await screen.findByTestId('screen.garage.vehicle'));
    await screen.findByTestId('vehicle.back');

    await fireEvent.press(screen.getByTestId('tab.garage'));
    await waitFor(() => expect(router.getPathname()).toBe('/garage'));
    expect(selected()).toEqual(['garage']);
  });

  it('re-tapping at the root changes nothing', async () => {
    const router = await open('/discover');
    await screen.findByTestId('screen.discover');
    await fireEvent.press(screen.getByTestId('tab.discover'));
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/discover');
    expect(selected()).toEqual(['discover']);
  });

  // Which group wins depends on the order of the route files, so the real one (Discover, ADR-101) is locked by the
  // Playwright spec on the export. This checks what holds for any tab: back reaches the anchor of that tab.
  it('a cold deep link has an anchor to go back to', async () => {
    const router = await open('/v/spike-demo');
    await screen.findByTestId('vehicle.back');
    expect(selected()).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('vehicle.back'));
    await waitFor(() => expect(router.getPathname()).toBe('/'));
    expect(selected()).toEqual(['home']);
  });

  it('long press shows the large label and does not switch the tab', async () => {
    const router = await open();
    await screen.findByTestId('screen.home');
    let prevented = false;
    await fireEvent(screen.getByTestId('tab.messages'), 'longPress', {
      preventDefault: () => {
        prevented = true;
      },
      isDefaultPrevented: () => prevented,
    });
    expect(await screen.findByTestId('shell.tabbar.largeLabel', { includeHiddenElements: true })).toBeTruthy();
    expect(router.getPathname()).toBe('/');
    await fireEvent(screen.getByTestId('tab.messages'), 'pressOut');
    expect(screen.queryByTestId('shell.tabbar.largeLabel', { includeHiddenElements: true })).toBeNull();
  });

  it('an editor can hide it', async () => {
    await open();
    await screen.findByTestId('screen.home');
    expect(screen.getByTestId('shell.tabbar')).toBeTruthy();
    await act(async () => setTabBarHidden(true));
    expect(screen.queryByTestId('shell.tabbar')).toBeNull();
  });
});

describe('breakpoints', () => {
  it.each([
    [320, 'shell.tabbar'],
    [767, 'shell.tabbar'],
    [768, 'shell.rail'],
    [1279, 'shell.rail'],
    [1280, 'shell.sidebar'],
    [1440, 'shell.sidebar'],
  ])('%i shows %s only', async (width, shown) => {
    windowOf(width);
    await open();
    await screen.findByTestId('screen.home');
    for (const id of ['shell.tabbar', 'shell.rail', 'shell.sidebar']) {
      expect(screen.queryByTestId(id) !== null).toBe(id === shown);
    }
    expect(selected()).toEqual(['home']);
  });

  it('the rail is 72 wide', async () => {
    windowOf(1000);
    await open();
    await screen.findByTestId('screen.home');
    expect(flat(screen.getByTestId('shell.rail').props.style).width).toBe(layout.rail);
  });

  it('the sidebar is 240 wide, with the logo, add vehicle, and sign-in or the name', async () => {
    windowOf(1280);
    await open();
    await screen.findByTestId('screen.home');
    expect(flat(screen.getByTestId('shell.sidebar').props.style).width).toBe(layout.sidebar);
    expect(screen.getByTestId('shell.sidebar.logo')).toBeTruthy();
    expect(screen.getByText('Fahrzeug hinzufügen')).toBeTruthy();
    // The guest row is built like the member row: same 56 row, same 12 padding, so nothing jumps on sign-in.
    const signIn = screen.getByTestId('shell.sidebar.signIn');
    expect(signIn.props.role ?? signIn.props.accessibilityRole).toBe('link');
    expect(signIn.props.accessibilityLabel).toBe('Anmelden');
    const guest = visualOf('shell.sidebar.signIn');
    expect(guest.minHeight).toBe(size.row.single);
    expect(guest.paddingHorizontal).toBe(space[12]);
    expect(guest.flexDirection).toBe('row');

    await act(async () => setMember({ id: '1', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
    expect(screen.queryByTestId('shell.sidebar.signIn')).toBeNull();
    expect(screen.getByTestId('shell.sidebar.account').props.accessibilityLabel).toBe('Lukas');
    expect(visualOf('shell.sidebar.account').minHeight).toBe(guest.minHeight);
  });

  it('at 200 % the only desktop sign-in is never cut, and only a long member name may be', async () => {
    mockDimensions.mockReturnValue({ width: 1280, height: 900, scale: 1, fontScale: 2 });
    await open();
    await screen.findByTestId('screen.home');
    expect(screen.getByText('Anmelden').props.numberOfLines).toBeUndefined();

    await act(async () => setMember({ id: '1', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
    // DQ-129: two lines from font scale 1.5, one below it.
    expect(screen.getByText('Lukas').props.numberOfLines).toBe(2);
  });

  it('DQ-129: below font scale 1.5 a member name keeps its one line', async () => {
    mockDimensions.mockReturnValue({ width: 1280, height: 900, scale: 1, fontScale: 1.3 });
    await open();
    await screen.findByTestId('screen.home');
    await act(async () => setMember({ id: '1', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }));
    expect(screen.getByText('Lukas').props.numberOfLines).toBe(1);
  });

  it('DQ-078: the destinations and the sign-in stop growing at 1.5, so "Nachrichten" stays on one line of its row', async () => {
    mockDimensions.mockReturnValue({ width: 1280, height: 900, scale: 1, fontScale: 2 });
    await open();
    await screen.findByTestId('screen.home');
    expect(screen.getByText('Nachrichten').props.maxFontSizeMultiplier).toBe(1.5);
    expect(screen.getByText('Anmelden').props.maxFontSizeMultiplier).toBe(1.5);
  });

  it('the logo box is whole pixels, so the rows below it sit on the grid', async () => {
    windowOf(1280);
    await open();
    await screen.findByTestId('screen.home');
    const logo = flat(screen.getByTestId('shell.sidebar.logo').props.style);
    expect(logo.width).toBe(layout.sidebar / 2);
    expect(logo.height).toBe(36);
  });

  it('adding a vehicle asks a guest to sign in', async () => {
    windowOf(1280);
    await open();
    await screen.findByTestId('screen.home');
    await fireEvent.press(screen.getByTestId('shell.sidebar.addVehicle'));
    expect(useSessionStore.getState().promptOpen).toBe(true);
  });

  it('the rail and the sidebar name their tablist', async () => {
    windowOf(1000);
    await open();
    await screen.findByTestId('screen.home');
    expect(screen.getByTestId('shell.rail.list').props['aria-label']).toBe('Hauptnavigation');

    windowOf(1280);
    await act(async () => useShellStore.setState({ tabBarHidden: true }));
    expect(screen.getByTestId('shell.sidebar.list').props['aria-label']).toBe('Hauptnavigation');
  });

  it('after sign-in the wizard opens once: the guest intent holds a path and no action', async () => {
    windowOf(1280);
    await open();
    await screen.findByTestId('screen.home');
    await fireEvent.press(screen.getByTestId('shell.sidebar.addVehicle'));
    const { intent } = useSessionStore.getState();
    expect(intent?.action).toBeUndefined();
    expect(intent?.returnTo).toBe('/add-vehicle/new/vehicle');
    expect(completeAuthIntent()).toBe('/add-vehicle/new/vehicle');
  });

  it('a member adding a vehicle goes straight to the wizard', async () => {
    windowOf(1280);
    useSessionStore.setState({ status: 'member', member: { id: '1', username: 'lukas.sc', displayName: null, avatarUrl: null } });
    const router = await open('/', {
      ...tree(),
      '(modals)/add-vehicle/[draftId]/vehicle': () => <RoutePlaceholder routeId="GAR-03" titleKey="routes.addVehicle" />,
    });
    await screen.findByTestId('screen.home');
    await fireEvent.press(screen.getByTestId('shell.sidebar.addVehicle'));
    await waitFor(() => expect(router.getPathname()).toBe('/add-vehicle/new/vehicle'));
    expect(useSessionStore.getState().promptOpen).toBe(false);
  });

  it('crossing a breakpoint does not remount the screens', async () => {
    const mounted = jest.fn();
    function Counted() {
      useEffect(mounted, []);
      return <StandInTab routeId="HOME-01" titleKey="tabs.home" testID="screen.home" />;
    }
    await open('/', { ...tree(), '(tabs)/(home)/index': Counted });
    await screen.findByTestId('screen.home');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('shell.tabbar')).toBeTruthy();

    // The store update re-renders the frame, which reads the new width.
    windowOf(1000);
    await act(async () => useShellStore.setState({ tabBarHidden: true }));
    expect(screen.getByTestId('shell.rail')).toBeTruthy();
    expect(screen.getByTestId('screen.home')).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});

describe('auth intent', () => {
  const authTree = () => ({
    ...tree(),
    '(auth)/_layout': { default: AuthLayout },
    '(auth)/sign-in': () => <RoutePlaceholder routeId="AUTH-03" titleKey="routes.signIn" headerTestID="signIn" />,
    '(auth)/sign-up': () => <RoutePlaceholder routeId="AUTH-04" titleKey="routes.signUp" headerTestID="signUp" />,
  });

  it('the direct sign-in of the sidebar drops an older intent', async () => {
    windowOf(1280);
    const router = await open('/', authTree());
    await screen.findByTestId('screen.home');
    useSessionStore.setState({ intent: { returnTo: '/garage' } });
    await fireEvent.press(screen.getByTestId('shell.sidebar.signIn'));
    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'));
    expect(useSessionStore.getState().intent).toBeNull();
  });

  it('survives inside the auth stack and is gone once a guest leaves it', async () => {
    windowOf(1280);
    await open('/', authTree());
    await screen.findByTestId('screen.home');
    await fireEvent.press(screen.getByTestId('shell.sidebar.signIn'));
    await screen.findByTestId('signIn.back');
    useSessionStore.setState({ intent: { returnTo: '/garage' } });

    await act(async () => appRouter.push('/sign-up'));
    await screen.findByTestId('signUp.back');
    expect(useSessionStore.getState().intent).toEqual({ returnTo: '/garage' });

    await act(async () => appRouter.dismissTo('/'));
    await waitFor(() => expect(useSessionStore.getState().intent).toBeNull());
  });

  it('a member leaving the auth stack keeps it for completeAuthIntent', async () => {
    windowOf(1280);
    await open('/', authTree());
    await screen.findByTestId('screen.home');
    await fireEvent.press(screen.getByTestId('shell.sidebar.signIn'));
    await screen.findByTestId('signIn.back');
    useSessionStore.setState({ intent: { returnTo: '/garage' } });

    await act(async () => setMember({ id: '1', username: 'lukas.sc', displayName: null, avatarUrl: null }));
    await act(async () => appRouter.dismissTo('/'));
    await screen.findByTestId('screen.home');
    expect(useSessionStore.getState().intent).toEqual({ returnTo: '/garage' });
  });

  const withSheet = () => ({
    ...authTree(),
    '(tabs)/(home)/index': () => (
      <>
        <StandInTab routeId="HOME-01" titleKey="tabs.home" testID="screen.home" />
        <AuthRequiredSheet />
      </>
    ),
  });

  it('the sheet carries an internal returnTo to sign-in', async () => {
    const router = await open('/', withSheet());
    await screen.findByTestId('screen.home');
    await act(async () => openAuthPrompt({ returnTo: '/garage' }));
    await fireEvent.press(await screen.findByTestId('shell.authRequired.signIn'));
    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'));
    expect(router.getSearchParams().returnTo).toBe('/garage');
  });

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example'])('the sheet never carries %s', async (returnTo) => {
    const router = await open('/', withSheet());
    await screen.findByTestId('screen.home');
    await act(async () => openAuthPrompt({ returnTo }));
    await fireEvent.press(await screen.findByTestId('shell.authRequired.signUp'));
    await waitFor(() => expect(router.getPathname()).toBe('/sign-up'));
    expect(router.getSearchParams().returnTo).toBeUndefined();
  });
});

describe('not found', () => {
  it('the home link navigates through PressableScale', async () => {
    const router = await open('/nowhere', { ...tree(), '+not-found': NotFoundRoute });
    const home = await screen.findByTestId('SYS-03.home');
    expect(home.props.href).toBe('/');
    await fireEvent.press(home);
    await screen.findByTestId('screen.home');
    expect(router.getPathname()).toBe('/');
  });
});
