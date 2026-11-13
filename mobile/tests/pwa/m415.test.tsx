// M4.15 Platform (09 §8.13–§8.16): the install hint's browsers, Web Push's key and body, the worker's route message, MEM-01 behind
// its flag, and SET-11 "System".
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { chooseLocale, localeOfPreference, readLocalePreference } from '@/api/queries/auth';
import { BUNDLED_APP_CONFIG, type AppConfig } from '@/api/queries/appConfig';
import { vapidPublicKey } from '@/api/queries/webPush';
import { installVariant, isIosSafari } from '@/features/pwa/installHint';
import { appRouteOf } from '@/features/pwa/serviceWorker';
import { keyBytes, subscriptionBody } from '@/features/pwa/webPush';
import { LanguageScreen } from '@/features/settings/screens/LanguageScreen';
import { MembershipScreen } from '@/features/settings/screens/MembershipScreen';
import i18n from '@/i18n';
import { getStored } from '@/lib/storage';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, setThemePreference } from '@/theme';

import { renderScreen } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
const mockFlags: Record<string, boolean> = {};
jest.mock('@/api/queries/appConfig', () => ({
  ...jest.requireActual<object>('@/api/queries/appConfig'),
  useFlag: (key: string) => mockFlags[key] === true,
}));
// eslint-disable-next-line no-var -- the hoisted expo-localization mock runs before a `let` would be initialised (i18n reads it on import).
var mockDeviceLanguage: { code: string } | undefined = { code: 'de' };
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: mockDeviceLanguage?.code ?? 'de' }] }));

const de = i18n.getFixedT('de', 'settings') as unknown as (key: string) => string;

beforeAll(hydrateThemePreference);

beforeEach(async () => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockFlags)) delete mockFlags[key];
  mockDeviceLanguage = { code: 'de' };
  await AsyncStorage.clear();
  await i18n.changeLanguage('de');
  setThemePreference('carbon');
  useSessionStore.setState({ status: 'guest', member: null });
});

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36';
const env = (userAgent: string, extra: Partial<{ platform: string; maxTouchPoints: number; standalone: boolean; webdriver: boolean }> = {}) => ({
  userAgent,
  platform: 'iPhone',
  maxTouchPoints: 5,
  standalone: false,
  webdriver: false,
  ...extra,
});

describe('the install hint (09 §7.15)', () => {
  it('shows Safari the steps, a Chromium browser its prompt, and nobody inside the installed app', () => {
    expect(installVariant(env(SAFARI), false)).toBe('ios');
    expect(installVariant(env(ANDROID, { platform: 'Linux' }), true)).toBe('prompt');
    expect(installVariant(env(ANDROID, { platform: 'Linux' }), false)).toBeNull();
    expect(installVariant(env(SAFARI, { standalone: true }), false)).toBeNull();
  });

  it('knows iPadOS in desktop mode and leaves other iOS browsers out', () => {
    expect(isIosSafari({ userAgent: SAFARI.replace('iPhone; CPU iPhone OS 18_5 like Mac OS X', 'Macintosh; Intel Mac OS X 10_15_7'), platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIosSafari({ userAgent: CHROME_IOS, platform: 'iPhone', maxTouchPoints: 5 })).toBe(false);
  });

  it('stays away from automated browsers unless the QA override asks for it', () => {
    expect(installVariant(env(SAFARI, { webdriver: true }), false)).toBeNull();
    expect(installVariant(env(SAFARI, { webdriver: true }), false, true)).toBe('ios');
    expect(installVariant(env(ANDROID, { platform: 'Linux', webdriver: true }), false, true)).toBe('ios');
  });
});

describe('Web Push (ADR-452)', () => {
  const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

  it('reads the VAPID key of app-config, and hides the option without one', () => {
    const config = (webPush: unknown) => ({ ...BUNDLED_APP_CONFIG, web_push: webPush }) as AppConfig;
    expect(vapidPublicKey(config({ vapid_public_key: KEY }))).toBe(KEY);
    expect(vapidPublicKey(config({ vapid_public_key: null }))).toBeNull();
    expect(vapidPublicKey(config({ vapid_public_key: 'short' }))).toBeNull();
    expect(vapidPublicKey(BUNDLED_APP_CONFIG)).toBeNull();
  });

  it('turns the key into the 65 bytes of a P-256 point', () => {
    const bytes = keyBytes(KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });

  it('sends endpoint, keys and the user agent, nothing else', () => {
    const subscription = {
      toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' }, expirationTime: null }),
    } as unknown as PushSubscription;
    expect(subscriptionBody(subscription, 'Safari')).toEqual({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' }, user_agent: 'Safari' });
    expect(() => subscriptionBody({ toJSON: () => ({ endpoint: 'x' }) } as unknown as PushSubscription, '')).toThrow();
  });

  it('opens a tapped notification at its app route, the start for anything outside the app', () => {
    expect(appRouteOf('/app/v/r34?ref=push', '/app/')).toBe('/v/r34?ref=push');
    expect(appRouteOf('/app/', '/app/')).toBe('/');
    expect(appRouteOf('/app', '/app/')).toBe('/');
    expect(appRouteOf('/admin', '/app/')).toBe('/');
  });
});

describe('MEM-01 Mitgliedschaft (09 §7.13, flag membership)', () => {
  it('does not exist while the flag is off', async () => {
    await renderScreen(<MembershipScreen routeId="MEM-01" />);
    expect(screen.getByTestId('SYS-03.root')).toBeTruthy();
    expect(screen.queryByTestId('MEM-01.root')).toBeNull();
  });

  it('shows the plan, the sample perks and a disabled purchase, with no price and no count', async () => {
    mockFlags.membership = true;
    await renderScreen(<MembershipScreen routeId="MEM-01" />);
    expect(screen.getByTestId('MEM-01.plan')).toHaveTextContent(de('membership.plan'));
    expect(screen.getByTestId('MEM-01.sample')).toBeTruthy();
    expect(screen.getByTestId('MEM-01.perk.garage')).toBeTruthy();
    expect(screen.getByTestId('MEM-01.cta')).toHaveTextContent(de('membership.cta'));
    expect(screen.getByTestId('MEM-01.cta')).toBeDisabled();
    expect(screen.getByTestId('MEM-01.cancel')).toHaveTextContent(de('membership.cancelAnytime'));
    // No figure anywhere: neither a price nor a count.
    expect(screen.getByTestId('MEM-01.content')).not.toHaveTextContent(/\d|€/);
    await fireEvent.press(screen.getByTestId('MEM-01.legal.privacy'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/settings/legal/[doc]', params: { doc: 'privacy' } });
  });
});

describe('SET-11 "System" (ADR-451)', () => {
  it('follows the device language and keeps "system" as the choice', async () => {
    mockDeviceLanguage = { code: 'en' };
    await act(() => chooseLocale('system'));
    expect(await getStored('sc.locale')).toBe('system');
    expect(i18n.language).toBe('en');
    expect(await readLocalePreference()).toBe('system');
    expect(localeOfPreference('de')).toBe('de');
    await act(() => chooseLocale('de'));
    expect(i18n.language).toBe('de');
  });

  it('offers System, Deutsch and English, System naming what it shows now', async () => {
    await renderScreen(<LanguageScreen />);
    expect(screen.getByTestId('SET-11.language.system')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('SET-11.language.system'));
    await waitFor(async () => expect(await getStored('sc.locale')).toBe('system'));
    expect(screen.getByText('Wie auf deinem Gerät, gerade Deutsch')).toBeTruthy();
  });
});
