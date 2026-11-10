import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { AppearanceScreen, THEME_OPTIONS } from '@/features/settings/screens/AppearanceScreen';
import { settingsSkeletonGroups, SettingsScreen, valueStacks } from '@/features/settings/screens/SettingsScreen';
import { appVersionInfo } from '@/features/settings/version';
import { useSessionStore } from '@/state/session';
import { getThemePreference, hydrateThemePreference, setThemePreference } from '@/theme';

import appVersion from '../../version.json';
import { renderScreen } from './harness';

const NO_BREAK = String.fromCharCode(0xa0);
/** The web build ships version.json; every release build bumps it (build-apk.ps1), so the tests read it rather than pin a number. */
const VERSION = appVersion.versionName;
const BUILD = String(appVersion.versionCode);
/** React Native's own test window unless a test sets one. */
const mockWindow: { current: { width: number; height: number; scale: number; fontScale: number } | null } = { current: null };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => {
  const actual = jest.requireActual<{ default: () => unknown }>('react-native/Libraries/Utilities/useWindowDimensions');
  return { __esModule: true, default: () => mockWindow.current ?? actual.default() };
});

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
const mockSignOut = jest.fn();
const mockApplication: { nativeApplicationVersion: string | null; nativeBuildVersion: string | null } = {
  nativeApplicationVersion: null,
  nativeBuildVersion: null,
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-application', () => ({
  get nativeApplicationVersion() {
    return mockApplication.nativeApplicationVersion;
  },
  get nativeBuildVersion() {
    return mockApplication.nativeBuildVersion;
  },
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/queries/auth', () => ({
  ...jest.requireActual<object>('@/api/queries/auth'),
  useSignOut: () => ({
    isPending: false,
    mutate: (_input: unknown, options?: { onSettled?: () => void }) => {
      mockSignOut();
      options?.onSettled?.();
    },
  }),
}));

beforeAll(hydrateThemePreference);

beforeEach(async () => {
  jest.clearAllMocks();
  mockWindow.current = null;
  setThemePreference('carbon');
  await AsyncStorage.clear();
  useSessionStore.setState({ status: 'guest', member: null });
});

const radio = (option: string) => screen.getByTestId(`SET-10.option.${option}`);
const checkedOptions = () => THEME_OPTIONS.filter((option) => radio(option).props.accessibilityState?.checked === true || radio(option).props['aria-checked'] === true);

describe('SET-10 Appearance', () => {
  it('offers the four themes of FS-12 as one radio group, with the current one selected', async () => {
    await renderScreen(<AppearanceScreen />);
    const group = screen.getByTestId('SET-10.options');
    expect(group.props.role).toBe('radiogroup');
    expect(group.props['aria-label']).toBe('Erscheinungsbild');
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(checkedOptions()).toEqual(['carbon']);
    expect(radio('carbon')).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Schwarz (OLED), Echtes Schwarz für OLED-Displays' })).toBeTruthy();
  });

  it('applies and stores a choice at once', async () => {
    await renderScreen(<AppearanceScreen />);
    await fireEvent.press(screen.getByTestId('SET-10.option.black'));
    expect(getThemePreference()).toBe('black');
    expect(radio('black')).toBeChecked();
    expect(radio('carbon')).not.toBeChecked();
    await waitFor(async () => expect(await AsyncStorage.getItem('sc.theme')).toBe('black'));
  });

  it('moves with the arrow keys in reading order, up and down included', async () => {
    await renderScreen(<AppearanceScreen />);
    const group = screen.getByTestId('SET-10.options');
    await act(async () => fireEvent(group, 'keyDown', { key: 'ArrowRight', preventDefault: jest.fn() }));
    expect(getThemePreference()).toBe('black');
    await act(async () => fireEvent(group, 'keyDown', { key: 'ArrowDown', preventDefault: jest.fn() }));
    expect(getThemePreference()).toBe('light');
    await act(async () => fireEvent(group, 'keyDown', { key: 'ArrowUp', preventDefault: jest.fn() }));
    expect(getThemePreference()).toBe('black');
    await act(async () => fireEvent(group, 'keyDown', { key: 'End', preventDefault: jest.fn() }));
    expect(getThemePreference()).toBe('system');
    await act(async () => fireEvent(group, 'keyDown', { key: 'ArrowRight', preventDefault: jest.fn() }));
    expect(getThemePreference()).toBe('carbon');
  });

  it('says where the choice lives', async () => {
    await renderScreen(<AppearanceScreen />);
    expect(screen.getByTestId('SET-10.note')).toHaveTextContent(/^Die Auswahl gilt auf diesem Gerät\. Wenn du angemeldet bist/);
    await act(async () => useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null } }));
    expect(screen.getByTestId('SET-10.note')).toHaveTextContent('Gilt auf diesem Gerät und wird in deinem Konto gespeichert.');
  });
});

describe('SET-01 Settings', () => {
  it('shows only rows that work today, with the current theme and the version', async () => {
    mockWindow.current = { width: 390, height: 844, scale: 2, fontScale: 1 };
    await renderScreen(<SettingsScreen />);
    expect(screen.getByTestId('SET-01.appearance.value')).toHaveTextContent('Carbon');
    expect(screen.getByTestId('SET-01.version.value')).toHaveTextContent(`${VERSION} (Build ${BUILD})`);
    // "(Build n)" stays on one line: the space before the number does not break.
    expect(screen.getByTestId('SET-01.version.value').props.children).toBe(`${VERSION} (Build${NO_BREAK}${BUILD})`);
    expect(screen.queryByTestId('SET-01.signOut')).toBeNull();
    await fireEvent.press(screen.getByTestId('SET-01.legal.body'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/legal');
  });

  it('puts a value under its title from font scale 1.5 until the row has measured itself (DQ-103)', async () => {
    mockWindow.current = { width: 360, height: 780, scale: 2, fontScale: 1.5 };
    await renderScreen(<SettingsScreen />);
    expect(screen.queryByTestId('SET-01.appearance.value')).toBeNull();
    expect(screen.queryByTestId('SET-01.version.value')).toBeNull();
    expect(screen.getByTestId('SET-01.appearance')).toHaveTextContent('ErscheinungsbildCarbon');
    expect(screen.getByTestId('SET-01.version')).toHaveTextContent(`Version${VERSION} (Build ${BUILD})`);
  });

  // DQ-138: measured, not by font scale. A 328 row (360 minus the gutters) has 296 inside its insets, 32 of it for the icon.
  it('keeps a value beside its title only while the title stays on one line there', () => {
    const row = { width: 328, icon: true, chevron: true };
    // 32 + 120 + 12 + (60 + 8 + 16) = 248
    expect(valueStacks({ ...row, title: 120, value: 60 })).toBe(false);
    // 32 + 140 + 12 + (110 + 8 + 16) = 318: the title would wrap beside "Schwarz (OLED)"
    expect(valueStacks({ ...row, title: 140, value: 110 })).toBe(true);
    // Without the chevron the same title and value fit: 32 + 140 + 12 + 110 = 294
    expect(valueStacks({ ...row, chevron: false, title: 140, value: 110 })).toBe(false);
  });

  it('stacks a value that would not stay on one line in its half of the row', () => {
    // 140 + 24 is more than half of 296, however short the title
    expect(valueStacks({ width: 328, icon: true, chevron: true, title: 40, value: 140 })).toBe(true);
  });

  it('has no answer before the row and both texts are measured', () => {
    expect(valueStacks({ width: 0, icon: true, chevron: true, title: 120, value: 60 })).toBeNull();
    expect(valueStacks({ width: 328, icon: true, chevron: true, title: 0, value: 60 })).toBeNull();
    expect(valueStacks({ width: 328, icon: true, chevron: true, title: 120, value: 0 })).toBeNull();
  });

  it('signs a member out after the dialog, and opens Welcome', async () => {
    useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null } });
    await renderScreen(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('SET-01.signOut'));
    expect(screen.getByTestId('SET-01.signOutDialog')).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('SET-01.signOutDialog.confirm'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/welcome');
  });

  it('keeps the member signed in on cancel', async () => {
    useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null } });
    await renderScreen(<SettingsScreen />);
    await fireEvent.press(screen.getByTestId('SET-01.signOut'));
    await fireEvent.press(screen.getByTestId('SET-01.signOutDialog.cancel'));
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe('SET-01 design QA round 1 (M2.8)', () => {
  const member = () =>
    useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null } });

  it('DQ-422: builds the skeleton from the real groups, row by row, never longer than the list', () => {
    const row = 56;
    const legal = 72;
    expect(settingsSkeletonGroups(true)).toEqual([
      { titled: false, height: row },
      { titled: true, height: 3 * row },
      { titled: true, height: 3 * row },
      { titled: true, height: 3 * row },
      { titled: true, height: 2 * row },
      { titled: true, height: 2 * row },
      { titled: true, height: legal },
      { titled: true, height: row },
      { titled: false, height: row },
    ]);
    // A guest: App (Erscheinungsbild, Sprache), Hilfe, Rechtliches, Über die App; no Abmelden.
    expect(settingsSkeletonGroups(false)).toEqual([
      { titled: true, height: 2 * row },
      { titled: true, height: row },
      { titled: true, height: legal },
      { titled: true, height: row },
    ]);
  });

  it('DQ-422: draws a member\'s skeleton while the session loads, one card per group, the first without a label', async () => {
    useSessionStore.setState({ status: 'loading', member: null });
    mockWindow.current = { width: 390, height: 844, scale: 2, fontScale: 1 };
    await renderScreen(<SettingsScreen />);
    expect(screen.getByTestId('SET-01.skeleton')).toBeTruthy();
    expect(screen.getAllByTestId(/^SET-01\.skeleton\.card\./)).toHaveLength(9);
    expect(screen.getByTestId('SET-01.skeleton.card.1')).toHaveStyle({ height: 168 });
    expect(screen.getByTestId('SET-01.skeleton.card.6')).toHaveStyle({ height: 72 });
    // Konto's group has no label, so its card is the group's only child.
    expect(screen.getByTestId('SET-01.skeleton.group.0').children).toHaveLength(1);
    expect(screen.getByTestId('SET-01.skeleton.group.1').children).toHaveLength(2);
  });

  it('DQ-434: the single-row Konto group carries no label repeating its row', async () => {
    member();
    mockWindow.current = { width: 390, height: 844, scale: 2, fontScale: 1 };
    await renderScreen(<SettingsScreen />);
    expect(screen.getByTestId('SET-01.account')).toBeTruthy();
    expect(screen.getAllByText('Konto')).toHaveLength(1);
    expect(screen.getByText('Sicherheit')).toBeTruthy();
  });

  it('DQ-420: on desktop the default detail\'s row is selected in the pane and the detail has no back', async () => {
    mockWindow.current = { width: 1280, height: 800, scale: 1, fontScale: 1 };
    await renderScreen(<SettingsScreen />);
    // A guest's default detail is Erscheinungsbild.
    expect(screen.getByTestId('SET-01.appearance.body')).toBeSelected();
    expect(screen.getByTestId('SET-01.language.body')).not.toBeSelected();
    expect(screen.getByTestId('SET-01.header')).toBeTruthy();
    expect(screen.queryByTestId('SET-01.header.back')).toBeNull();
  });

  it('DQ-420: on a phone the list stands alone, with back', async () => {
    mockWindow.current = { width: 390, height: 844, scale: 2, fontScale: 1 };
    await renderScreen(<SettingsScreen />);
    expect(screen.getByTestId('SET-01.header.back')).toBeTruthy();
    expect(screen.getByTestId('SET-01.appearance.body')).not.toBeSelected();
  });
});

describe('appVersionInfo', () => {
  it('reads the binary on native and version.json on web', () => {
    expect(appVersionInfo()).toEqual({ version: VERSION, build: BUILD });
    mockApplication.nativeApplicationVersion = '0.4.0';
    mockApplication.nativeBuildVersion = '12';
    expect(appVersionInfo()).toEqual({ version: '0.4.0', build: '12' });
    mockApplication.nativeApplicationVersion = null;
    mockApplication.nativeBuildVersion = null;
  });
});
