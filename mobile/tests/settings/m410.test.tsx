// M4.10 settings (09 §7.9, §8.11): the settings search, the SET-01 value line, units, the SET-09 categories, SM14's request, SET-22,
// SET-25 and the reduce-motion choice.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { useMemberSettings } from '@/api/queries/settings';
import { NOTIFICATION_CATEGORIES, visibleCategories } from '@/features/settings/screens/NotificationSettingsScreen';
import { AppIconScreen } from '@/features/settings/screens/AppIconScreen';
import { SettingsScreen } from '@/features/settings/screens/SettingsScreen';
import { WhatsNewScreen } from '@/features/settings/screens/WhatsNewScreen';
import { entryVisible, normaliseSearch, SEARCH_INDEX, searchSettings } from '@/features/settings/search';
import { languageSummary } from '@/features/settings/unitsSummary';
import { RELEASE_NOTES } from '@/features/settings/whatsNew';
import i18n from '@/i18n';
import { formatDistance, formatTorqueIn, formatWeight, getDisplayUnits, setDisplayUnits } from '@/lib/displayUnits';
import { useSessionStore } from '@/state/session';
import { __peekThemeRevealForTests, changeTheme, getThemePreference, hydrateThemePreference, setThemePreference, takeThemeReveal } from '@/theme';
import { Text } from '@/ui';
import { getReduceMotionChoice, setReduceMotionChoice, useMotionPreference } from '@/ui/motion';

import { renderScreen } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
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

const NBSP = ' ';
const de = i18n.getFixedT('de', 'settings') as unknown as (key: string) => string;
const en = i18n.getFixedT('en', 'settings') as unknown as (key: string) => string;
const member = { member: true, web: false, flags: {} };

beforeAll(hydrateThemePreference);

beforeEach(async () => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockFlags)) delete mockFlags[key];
  await AsyncStorage.clear();
  setThemePreference('carbon');
  useSessionStore.setState({ status: 'guest', member: null });
});

describe('settings search (SET-26)', () => {
  it('finds a page by its title and by the words people use for it', () => {
    expect(searchSettings('Passwort', de, member)[0]?.id).toBe('password');
    expect(searchSettings('2FA', de, member)[0]?.id).toBe('twoFactor');
    expect(searchSettings('dark mode', en, member)[0]?.id).toBe('appearance');
    expect(searchSettings('Meilen', de, member).map((result) => result.id)).toContain('units');
  });

  it('finds a setting inside a page and says where it lives', () => {
    const [first] = searchSettings('Ruhezeiten', de, member);
    expect(first).toEqual({ id: 'quietHours', title: 'Ruhezeiten', detail: 'Mitteilungen', path: '/settings/notifications' });
    expect(searchSettings('erwähnen', de, member)[0]?.path).toBe('/settings/privacy');
  });

  it('reads umlauts both ways and ignores case', () => {
    expect(normaliseSearch('Erwähnungen ß')).toBe('erwaehnungen ss');
    expect(searchSettings('erwahnung', de, member).map((result) => result.id)).toContain('mentions');
    expect(searchSettings('ERWAEHNUNG', de, member).map((result) => result.id)).toContain('mentions');
  });

  it('never leads to a row SET-01 hides: member pages, native pages and flagged pages', () => {
    expect(searchSettings('Passwort', de, { member: false, web: false, flags: {} })).toEqual([]);
    expect(searchSettings('Face ID', de, { member: true, web: true, flags: {} }).map((result) => result.id)).not.toContain('appLock');
    expect(searchSettings('Reifenwechsel', de, member)).toEqual([]);
    expect(searchSettings('Reifenwechsel', de, { ...member, flags: { maintenance: true } })[0]?.id).toBe('reminders');
    expect(searchSettings('Icon', de, { member: true, web: false, flags: { app_icons: true } })[0]?.id).toBe('appIcon');
    expect(searchSettings('Icon', de, { member: true, web: true, flags: { app_icons: true } })).toEqual([]);
  });

  it('has a title and synonyms in both languages for every entry', () => {
    for (const entry of SEARCH_INDEX) {
      for (const t of [de, en]) {
        const key = entry.item ? `search.items.${entry.id}` : `rows.${entry.key}`;
        expect(t(key)).not.toBe(key);
        expect(t(`search.synonyms.${entry.id}`)).not.toBe(`search.synonyms.${entry.id}`);
      }
    }
    expect(SEARCH_INDEX.every((entry) => entryVisible(entry, { member: true, web: false, flags: { maintenance: true, businesses: true, membership: true, app_icons: true } }))).toBe(true);
  });

  it('shows the matches in place of the list, opens one, and says when nothing matches', async () => {
    useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null } });
    await renderScreen(<SettingsScreen />);
    expect(screen.getByTestId('SET-01.security')).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId('SET-01.search.field'), 'Sitzungen'));
    expect(screen.queryByTestId('SET-01.security')).toBeNull();
    expect(screen.getByTestId('SET-01.search.count')).toHaveTextContent(/Treffer/);
    await fireEvent.press(screen.getByTestId('SET-01.search.result.sessions.body'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/security/sessions');
    await act(async () => fireEvent.changeText(screen.getByTestId('SET-01.search.field'), 'Vergaser'));
    expect(screen.getByTestId('SET-01.search.empty')).toHaveTextContent(/Nichts zu „Vergaser“ gefunden\./);
  });
});

describe('SET-01 (09 §7.9)', () => {
  it('names language and units in one value: "Deutsch · PS · km"', () => {
    expect(languageSummary(de, 'de', 'ps_kw', 'km')).toBe('Deutsch · PS · km');
    expect(languageSummary(en, 'en', 'hp', 'mi')).toBe('English · hp · mi');
  });

  it('hides Garage & Erinnerungen without the maintenance flag, and ends with the version caption', async () => {
    useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null } });
    await renderScreen(<SettingsScreen />);
    expect(screen.queryByTestId('SET-01.reminders')).toBeNull();
    expect(screen.getByTestId('SET-01.footer')).toHaveTextContent(/^SPEED CLUB .+ \(Build/);
    expect(screen.getByTestId('SET-01.cache')).toBeTruthy();
  });

  it('leads to SET-23 with the maintenance flag', async () => {
    mockFlags.maintenance = true;
    useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null } });
    await renderScreen(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('SET-01.reminders.body'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/reminders');
  });

  it('asks before clearing the cache', async () => {
    useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null } });
    await renderScreen(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('SET-01.cache.body'));
    expect(screen.getByTestId('SET-01.cache.dialog')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('SET-01.cache.dialog.cancel'));
  });
});

describe('SET-11 units (M4.13 API)', () => {
  it('converts only for display, from the stored km, Nm and kg', () => {
    expect(formatDistance(12400, 'km', 'de')).toBe(`12.400${NBSP}km`);
    expect(formatDistance(12400, 'mi', 'de')).toBe(`7.705${NBSP}mi`);
    expect(formatTorqueIn(650, 'nm', 'de')).toBe(`650${NBSP}Nm`);
    expect(formatTorqueIn(650, 'lbft', 'en')).toBe(`479${NBSP}lb-ft`);
    expect(formatWeight(1725, 'lb', 'en')).toBe(`3,803${NBSP}lb`);
  });

  it('takes the account units when the settings load, and ignores unknown values', () => {
    setDisplayUnits({ distance: 'mi', torque: 'lbft', weight: 'stone' });
    expect(getDisplayUnits()).toEqual({ distance: 'mi', torque: 'lbft', weight: 'kg' });
    setDisplayUnits({ distance: 'km', torque: 'nm' });
    expect(getDisplayUnits()).toEqual({ distance: 'km', torque: 'nm', weight: 'kg' });
    expect(typeof useMemberSettings).toBe('function');
  });
});

describe('SET-09 categories', () => {
  it('offers a type only while its feature is on, and Fälligkeiten with maintenance or the v1 HU/AU reminder', () => {
    const keys = (flags: Record<string, boolean>) => visibleCategories(flags).map((category) => [category.key, category.rows.map((row) => row.type)]);
    expect(keys({})).toEqual([
      ['builds', ['followed_published', 'new_follower']],
      ['messages', ['new_message', 'message_request']],
    ]);
    const all = visibleCategories({ build_reactions: true, mentions: true, build_comments: true, vehicle_follow: true, events: true, maintenance: true });
    expect(all.map((category) => category.key)).toEqual(['builds', 'messages', 'events', 'garage']);
    expect(all[0]?.rows.map((row) => row.type)).toEqual(['followed_published', 'reaction', 'mention', 'comment', 'new_follower', 'vehicle_follower']);
    expect(visibleCategories({ 'sig.hu_au_reminder': true }).map((category) => category.key)).toContain('garage');
    // ADR-441: one key for every maintenance reminder, with its e-mail switch.
    expect(NOTIFICATION_CATEGORIES.find((category) => category.key === 'garage')?.rows).toEqual([{ type: 'hu_au_reminder', email: true }]);
  });
});

describe('SM14 theme reveal', () => {
  it('hands the provider the swatch origin for the next change only', () => {
    changeTheme('light', { origin: { x: 120, y: 300 }, reveal: true });
    expect(getThemePreference()).toBe('light');
    expect(takeThemeReveal()).toEqual({ mode: 'disc', origin: { x: 120, y: 300 } });
    expect(takeThemeReveal()).toBeNull();
  });

  it('keeps the plain crossfade with the flag off, reduced motion or no origin (a keyboard press)', () => {
    changeTheme('black', { origin: { x: 1, y: 1 }, reveal: false });
    expect(__peekThemeRevealForTests()).toBeNull();
    changeTheme('carbon', { origin: null, reveal: true });
    expect(__peekThemeRevealForTests()).toBeNull();
  });

  it('drops a request the provider never took', () => {
    changeTheme('light', { origin: { x: 10, y: 10 }, reveal: true });
    expect(takeThemeReveal(Date.now() + 10_000)).toBeNull();
  });

  it('grows the disc from the tapped card on SET-10 when the flag is on', async () => {
    mockFlags.theme_reveal = true;
    const { AppearanceScreen } = jest.requireActual<typeof import('@/features/settings/screens/AppearanceScreen')>('@/features/settings/screens/AppearanceScreen');
    await renderScreen(<AppearanceScreen />);
    await act(async () => fireEvent.press(screen.getByTestId('SET-10.option.light'), { nativeEvent: { pageX: 80, pageY: 240 } }));
    expect(getThemePreference()).toBe('light');
  });
});

describe('Bewegung reduzieren', () => {
  function Probe() {
    const motion = useMotionPreference();
    return <Text variant="body">{motion.reduced ? 'reduced' : 'full'}</Text>;
  }

  it('reduces motion app-wide on "Immer" and stores the choice', async () => {
    await renderScreen(<Probe />);
    expect(screen.getByText('full')).toBeTruthy();
    await act(async () => setReduceMotionChoice('always'));
    expect(screen.getByText('reduced')).toBeTruthy();
    expect(getReduceMotionChoice()).toBe('always');
    expect(await AsyncStorage.getItem('sc.reduceMotion')).toBe('always');
    await act(async () => setReduceMotionChoice('system'));
    expect(await AsyncStorage.getItem('sc.reduceMotion')).toBeNull();
    expect(screen.getByText('full')).toBeTruthy();
  });
});

describe('SET-22 and SET-25', () => {
  it('SET-22 shows the picker with the current icon and says it comes with an update (no module in this build)', async () => {
    mockFlags.app_icons = true;
    await renderScreen(<AppIconScreen />);
    expect(screen.getByTestId('SET-22.picker')).toBeTruthy();
    expect(screen.getByTestId('SET-22.picker.black')).toBeChecked();
    expect(screen.getByTestId('SET-22.notAvailable')).toBeTruthy();
  });

  it('SET-22 without the flag is a plain "nur in der App" page', async () => {
    await renderScreen(<AppIconScreen />);
    expect(screen.getByTestId('SET-22.unavailable')).toBeTruthy();
  });

  it('SET-25 lists the releases newest first, each change with one line', async () => {
    await renderScreen(<WhatsNewScreen />);
    expect(screen.getByTestId('SET-25.installed')).toHaveTextContent(/^Auf diesem Gerät: Version/);
    expect(screen.getByText('Version 2.0.0')).toBeTruthy();
    const dates = RELEASE_NOTES.map((note) => note.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const note of RELEASE_NOTES) for (const item of note.items) expect(de(`whatsNew.items.${item}Body`)).not.toMatch(/whatsNew/);
  });
});
