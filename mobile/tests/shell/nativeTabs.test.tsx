/**
 * M4.5 navigation shell (09 §6): the one tab config, native tabs behind `nav.native_tabs` with the JS shell as fallback, the
 * native press rule (haptic, Android re-tap), the toast clearance over a native bar and the link map.
 * Jest runs the iOS preset, so `(tabs)/_layout` resolves to `_layout.native.tsx` and NativeTabs renders its iOS host views.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { Text as RNText } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import SharedLayout, {
  unstable_settings,
} from '@/app/(tabs)/(home,discover,garage,messages,profile)/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import { TAB_DESTINATIONS } from '@/features/shell/destinations';
import { LEGACY_REDIRECTS, LINK_MAP, rewriteLinkedPath, type LinkEntry } from '@/features/shell/linkMap';
import { mapIncomingPath } from '@/features/shell/nativeIntent';
import {
  NATIVE_TABS_FLAG,
  reportNativeTabContentFrame,
  setNativeTabsActive,
  tabChromeFor,
  useNativeTabBarStore,
} from '@/features/shell/navMode';
import { onNativeTabPress } from '@/features/shell/NativeTabsLayout';
import { ANDROID_TAB_ICONS } from '@/features/shell/nativeTabIcons';
import { registerScroller } from '@/features/shell/retap';
import { toastTabBarOffset } from '@/features/shell/ShellToastHost';
import de from '@/i18n/locales/de/common.json';
import en from '@/i18n/locales/en/common.json';
import { setTabBarHidden, useShellStore } from '@/state/shell';
import { hydrateThemePreference, size, ThemeProvider } from '@/theme';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-haptics', () => ({}));

const mockHapticFor = jest.fn();
jest.mock('@/lib/haptics', () => ({
  ...jest.requireActual('@/lib/haptics'),
  hapticFor: (intent: string) => mockHapticFor(intent),
}));

const mockBadges = jest.fn(() => ({ messages: 0, home: false, notifications: 0 }));
jest.mock('@/features/shell/useTabBadges', () => ({ useTabBadges: () => mockBadges() }));

const mockChrome = jest.fn<'native' | 'js', []>(() => 'native');
jest.mock('@/features/shell/navMode', () => ({
  ...jest.requireActual('@/features/shell/navMode'),
  useTabChrome: () => mockChrome(),
}));

const mockDismissAll = jest.fn();
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, router: { ...actual.router, dismissAll: () => mockDismissAll() } };
});

configure({ asyncUtilTimeout: 30_000 });
jest.setTimeout(120_000);

const MOBILE = join(__dirname, '..', '..');
const APP = join(MOBILE, 'src', 'app');

beforeAll(hydrateThemePreference);
beforeEach(() => {
  mockHapticFor.mockClear();
  mockDismissAll.mockClear();
  mockBadges.mockReturnValue({ messages: 0, home: false, notifications: 0 });
  mockChrome.mockReturnValue('native');
  useShellStore.setState({ tabBarHidden: false });
  useNativeTabBarStore.setState({ active: false, obstruction: 0 });
});

describe('the tab config (09 §6.1)', () => {
  it('lists the five tabs of the brief in order, each with its route group', () => {
    expect(TAB_DESTINATIONS.map((tab) => tab.name)).toEqual([
      'home',
      'discover',
      'garage',
      'messages',
      'profile',
    ]);
    for (const tab of TAB_DESTINATIONS) {
      expect(tab.route).toBe(`(${tab.name})`);
      expect(tab.testID).toBe(`tab.${tab.name}`);
      expect(existsSync(join(APP, '(tabs)', tab.route))).toBe(true);
    }
  });

  it('has the labels of the copy glossary, in sentence case in both languages (no lowercase "garage")', () => {
    expect(TAB_DESTINATIONS.map((tab) => de.tabs[tab.name])).toEqual([
      'Start',
      'Entdecken',
      'Garage',
      'Nachrichten',
      'Profil',
    ]);
    expect(TAB_DESTINATIONS.map((tab) => en.tabs[tab.name])).toEqual([
      'Home',
      'Discover',
      'Garage',
      'Messages',
      'Profile',
    ]);
    for (const label of [...Object.values(de.tabs), ...Object.values(en.tabs)]) {
      expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
      expect(label.slice(1)).toBe(label.slice(1).toLowerCase());
    }
  });

  it('gives every tab an SF Symbol pair, a Material Symbol pair and the Android PNG pair at all five densities', () => {
    const icons = join(MOBILE, 'assets', 'tabs');
    const files = readdirSync(icons);
    for (const tab of TAB_DESTINATIONS) {
      expect(tab.sf.default).toBeTruthy();
      expect(tab.sf.selected).toBeTruthy();
      expect(tab.md.default).toMatch(/^[a-z_]+$/);
      expect(ANDROID_TAB_ICONS[tab.name].default).toBeTruthy();
      expect(ANDROID_TAB_ICONS[tab.name].selected).toBeTruthy();
      for (const weight of ['regular', 'fill']) {
        for (const suffix of ['', '@1.5x', '@2x', '@3x', '@4x'])
          expect(files).toContain(`${tab.icon}-${weight}${suffix}.png`);
      }
    }
  });
});

describe('nav.native_tabs (09 §8.18: on by default, a kill switch)', () => {
  it('runs native tabs on iOS and Android unless the flag says false, and never on the web', () => {
    expect(tabChromeFor({}, false)).toBe('native');
    expect(tabChromeFor({ [NATIVE_TABS_FLAG]: true }, false)).toBe('native');
    expect(tabChromeFor({ [NATIVE_TABS_FLAG]: false }, false)).toBe('js');
    expect(tabChromeFor({}, true)).toBe('js');
    expect(tabChromeFor({ [NATIVE_TABS_FLAG]: true }, true)).toBe('js');
  });

  it('keeps the web route file free of native tabs', () => {
    const web = readFileSync(join(APP, '(tabs)', '_layout.tsx'), 'utf8');
    expect(web).not.toMatch(/native-tabs|NativeTabsLayout/);
    expect(readFileSync(join(APP, '(tabs)', '_layout.native.tsx'), 'utf8')).toMatch(/NativeTabsLayout/);
  });
});

const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Providers = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>
    <QueryClientProvider client={queries}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  </GestureHandlerRootView>
);

const stand = (id: string) =>
  function Screen() {
    return <RNText testID={`screen.${id}`}>{id}</RNText>;
  };

const tree = () => ({
  '(tabs)/_layout': { default: TabsLayout },
  '(tabs)/(home,discover,garage,messages,profile)/_layout': { default: SharedLayout, unstable_settings },
  '(tabs)/(home)/index': stand('home'),
  '(tabs)/(discover)/discover/index': stand('discover'),
  '(tabs)/(garage)/garage/index': stand('garage'),
  '(tabs)/(messages)/messages/index': stand('messages'),
  '(tabs)/(profile)/profile/index': stand('profile'),
});

const open = (initialUrl = '/') => renderRouter(tree() as never, { initialUrl, wrapper: Providers });

/** NativeTabs' iOS host screens, one per tab, in order. */
const nativeTabs = () => screen.container.queryAll((node) => (node.type as unknown) === 'RNSTabsScreenIOS');

describe('native tabs in the route tree', () => {
  it('renders the five tabs with their labels and keeps every stack in its group', async () => {
    await open('/garage');
    await screen.findByTestId('screen.garage');
    const tabs = nativeTabs();
    expect(tabs.map((tab) => tab.props.title)).toEqual([
      'Start',
      'Entdecken',
      'Garage',
      'Nachrichten',
      'Profil',
    ]);
    expect(screen.queryByTestId('shell.tabbar')).toBeNull();
    expect(useNativeTabBarStore.getState().active).toBe(true);
  });

  it('shows the unread count on Nachrichten and a dot on Start, and names them for screen readers', async () => {
    mockBadges.mockReturnValue({ messages: 3, home: true, notifications: 2 });
    await open('/');
    await screen.findByTestId('screen.home');
    const [home, , , messages] = nativeTabs();
    expect(messages?.props.badgeValue).toBe('3');
    expect(home?.props.badgeValue).toBe(' ');
    const labels = screen.container.queryAll(
      (node) => typeof node.props.tabBarItemAccessibilityLabel === 'string',
    );
    expect(labels.map((node) => node.props.tabBarItemAccessibilityLabel)).toEqual(
      expect.arrayContaining(['Start, Neue Benachrichtigungen', 'Nachrichten, 3\u00A0ungelesen']),
    );
  });

  it('hides the bar while an editor asks for it (§9)', async () => {
    await open('/');
    await screen.findByTestId('screen.home');
    const host = () => screen.container.queryAll((node) => (node.type as unknown) === 'RNSTabsHostIOS')[0];
    expect(host()?.props.tabBarHidden ?? false).toBe(false);
    await act(async () => setTabBarHidden(true));
    expect(host()?.props.tabBarHidden).toBe(true);
  });

  it('falls back to the JS shell when the flag is off', async () => {
    mockChrome.mockReturnValue('js');
    await open('/discover');
    await screen.findByTestId('screen.discover');
    expect(nativeTabs()).toHaveLength(0);
    expect(screen.getByTestId('shell.tabbar')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tab.garage'));
    expect(await screen.findByTestId('screen.garage')).toBeTruthy();
  });
});

describe('a press on a native tab', () => {
  const props = (focused: boolean, depth?: number) => ({
    navigation: { isFocused: () => focused },
    route: depth === undefined ? {} : { state: { routes: Array.from({ length: depth }, () => ({})) } },
  });

  it('plays the selection haptic when it changes the tab, and does nothing else', () => {
    onNativeTabPress(props(false), true);
    expect(mockHapticFor).toHaveBeenCalledWith('tabChange');
    expect(mockDismissAll).not.toHaveBeenCalled();
  });

  it('on Android re-taps: first to the top, then back to the root', () => {
    let atTop = false;
    const unregister = registerScroller(() => {
      if (atTop) return false;
      atTop = true;
      return true;
    });
    onNativeTabPress(props(true, 3), true);
    expect(mockDismissAll).not.toHaveBeenCalled();
    onNativeTabPress(props(true, 3), true);
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    unregister();
    expect(mockHapticFor).not.toHaveBeenCalled();
  });

  it('on iOS leaves the re-tap to UITabBarController', () => {
    onNativeTabPress(props(true, 3), false);
    expect(mockDismissAll).not.toHaveBeenCalled();
  });
});

describe('the toast over a tab bar', () => {
  it('clears the JS bar on phones, the measured native bar anywhere, nothing outside the tabs or with the bar hidden', () => {
    const none = { active: false, obstruction: 0 };
    expect(toastTabBarOffset({ inTabs: true, phone: true, hidden: false, native: none })).toBe(size.tabBar);
    expect(toastTabBarOffset({ inTabs: true, phone: false, hidden: false, native: none })).toBe(0);
    expect(
      toastTabBarOffset({
        inTabs: true,
        phone: false,
        hidden: false,
        native: { active: true, obstruction: 80 },
      }),
    ).toBe(80);
    expect(
      toastTabBarOffset({
        inTabs: false,
        phone: true,
        hidden: false,
        native: { active: true, obstruction: 80 },
      }),
    ).toBe(0);
    expect(
      toastTabBarOffset({
        inTabs: true,
        phone: true,
        hidden: true,
        native: { active: true, obstruction: 80 },
      }),
    ).toBe(0);
  });

  it('measures the native bar from the tab content, without the safe inset the host adds itself', () => {
    setNativeTabsActive(true);
    reportNativeTabContentFrame(760, 892, 52);
    expect(useNativeTabBarStore.getState().obstruction).toBe(80);
    reportNativeTabContentFrame(892, 892, 34);
    expect(useNativeTabBarStore.getState().obstruction).toBe(0);
    setNativeTabsActive(false);
    expect(useNativeTabBarStore.getState()).toEqual({ active: false, obstruction: 0 });
  });
});

describe('the link map (09 §6.5)', () => {
  /** The route file a ready entry needs: under a tab group, the shared groups, or at the root. */
  const routeExists = (route: string) => {
    const relative = route.replace(/^\//, '');
    const groups = readdirSync(join(APP, '(tabs)')).filter((name) => name.startsWith('('));
    const roots = [APP, join(APP, '(auth)'), ...groups.map((group) => join(APP, '(tabs)', group))];
    return roots.some(
      (root) => existsSync(join(root, `${relative}.tsx`)) || existsSync(join(root, relative, 'index.tsx')),
    );
  };
  const appConfig = readFileSync(join(MOBILE, 'app.config.ts'), 'utf8');

  it('has a screen for every ready path, and the App Links claim exactly the ready share paths', () => {
    for (const entry of LINK_MAP) {
      if (entry.ready) expect(routeExists(entry.route)).toBe(true);
      const prefix = entry.public.split('{')[0] ?? '';
      if (/^\/[a-z]+\/$/.test(prefix)) expect(appConfig.includes(`'${prefix}'`)).toBe(entry.ready);
    }
  });

  it('leaves the routes of later modules alone until they exist', () => {
    for (const entry of LINK_MAP.filter((link) => !link.ready)) expect(entry.module).toMatch(/^M4\.\d+$/);
    expect(rewriteLinkedPath('/e/treffen-hockenheim')).toBe('/e/treffen-hockenheim');
    // M4.6: AUTH-04 links go to AUTH-12; AUTH-05 stays for the password registration's mail.
    expect(rewriteLinkedPath('/sign-up')).toBe('/auth/email');
    expect(rewriteLinkedPath('/verify-email')).toBe('/verify-email');
    expect(mapIncomingPath('https://speedclub.example/app/v/r34?x=1', ['speedclub.example'])).toBe(
      '/v/r34?x=1',
    );
  });

  it('rewrites a ready path to its route and a ready legacy route to its successor, query kept', () => {
    const links: LinkEntry[] = [
      { public: '/e/{slug}', route: '/events/[slug]', screen: 'EVT-02', ready: true },
    ];
    const redirects = LEGACY_REDIRECTS.map((redirect) => ({ ...redirect, ready: true }));
    expect(rewriteLinkedPath('/e/treffen-hockenheim?ref=qr', links, redirects)).toBe(
      '/events/treffen-hockenheim?ref=qr',
    );
    expect(rewriteLinkedPath('/e/treffen/attendees', links, redirects)).toBe('/events/treffen/attendees');
    expect(rewriteLinkedPath('/events/x', links, redirects)).toBe('/events/x');
    expect(rewriteLinkedPath('/sign-up?ref=c', links, redirects)).toBe('/auth/email?ref=c');
    expect(rewriteLinkedPath('/verify-email/', links, redirects)).toBe('/auth/code');
    expect(rewriteLinkedPath('/sign-in', links, redirects)).toBe('/sign-in');
  });
});
