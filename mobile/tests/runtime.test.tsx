import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { processColor } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n from '@/i18n';
import { toFormatLocale, useFormat } from '@/lib/useFormat';
import { appFonts } from '@/theme/fonts';
import { fonts, getTheme, hydrateThemePreference, motion, ThemeProvider, themes, typography, useMotion } from '@/theme';
import { Icon, phosphorIcons, type IconName } from '@/ui/icons/Icon';
import { Screen } from '@/ui/Screen';

import version from '../version.json';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual('react-native-reanimated'),
  useReducedMotion: jest.fn(() => false),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve('stored')),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

describe('fonts', () => {
  it('loads exactly the families the tokens name', () => {
    const tokenFamilies = [...Object.values(fonts.ui.native), ...Object.values(fonts.display.native)].sort();
    expect(Object.keys(appFonts).sort()).toEqual(tokenFamilies);
  });

  it('loads every family the type scale uses', () => {
    for (const style of Object.values(typography)) {
      expect(Object.keys(appFonts)).toContain(style.fontFamily);
    }
  });
});

describe('ready gates', () => {
  function loadReady() {
    let ready!: typeof import('@/lib/ready');
    jest.isolateModules(() => {
      ready = jest.requireActual('@/lib/ready');
    });
    return ready;
  }

  it('opens only when every gate is released', () => {
    const { registerReadyGate, isAppReady } = loadReady();
    const fonts = registerReadyGate('fonts');
    const session = registerReadyGate('session');
    expect(isAppReady()).toBe(false);
    fonts();
    expect(isAppReady()).toBe(false);
    session();
    expect(isAppReady()).toBe(true);
  });

  it('survives a gate released twice', () => {
    const { registerReadyGate, isAppReady } = loadReady();
    const a = registerReadyGate('a');
    const b = registerReadyGate('b');
    a();
    a();
    expect(isAppReady()).toBe(false);
    b();
    expect(isAppReady()).toBe(true);
  });

  it('never traps the app behind a stuck gate', () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { registerReadyGate, isAppReady, READY_GATE_TIMEOUT_MS } = loadReady();
    registerReadyGate('session');
    jest.advanceTimersByTime(READY_GATE_TIMEOUT_MS - 1);
    expect(isAppReady()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(isAppReady()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    jest.useRealTimers();
  });
});

describe('haptics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('plays on native', () => {
    const { haptics } = jest.requireActual<typeof import('@/lib/haptics')>('@/lib/haptics');
    haptics.selection();
    haptics.light();
    haptics.success();
    haptics.warning();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
  });

  it('stays silent when disabled', () => {
    const { haptics, setHapticsEnabled } = jest.requireActual<typeof import('@/lib/haptics')>('@/lib/haptics');
    setHapticsEnabled(false);
    haptics.success();
    setHapticsEnabled(true);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('does nothing on web', () => {
    jest.isolateModules(() => {
      jest.doMock('@/lib/platform', () => ({ isWeb: true, isNative: false }));
      const { haptics } = jest.requireActual<typeof import('@/lib/haptics')>('@/lib/haptics');
      haptics.selection();
      jest.dontMock('@/lib/platform');
    });
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });
});

describe('secure storage', () => {
  it('keeps no token on web', async () => {
    let secure!: typeof import('@/lib/secure');
    let store!: typeof import('expo-secure-store');
    jest.isolateModules(() => {
      jest.doMock('@/lib/platform', () => ({ isWeb: true, isNative: false }));
      secure = jest.requireActual('@/lib/secure');
      store = jest.requireMock('expo-secure-store');
      jest.dontMock('@/lib/platform');
    });
    await secure.setSecure('sc.authToken', 'secret');
    await expect(secure.getSecure('sc.authToken')).resolves.toBeNull();
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });
});

describe('Icon', () => {
  beforeAll(hydrateThemePreference);

  const required: IconName[] = [
    'house',
    'magnifying-glass',
    'garage',
    'chat-circle',
    'chats',
    'user',
    'plus',
    'prohibit',
    'x',
    'caret-left',
    'caret-right',
    'caret-down',
    'check',
    'warning',
    'info',
    'wrench',
    'bell',
    'bookmark-simple',
    'share-network',
    'qr-code',
    'dots-three',
    'eye',
    'eye-slash',
    'camera',
    'image',
    'trash',
    'pencil-simple',
    'magic-wand',
    'funnel',
    'sort-ascending',
    'list',
    'grid-four',
    'arrow-right',
    'star',
    'wifi-slash',
    'lock-simple',
    'arrow-clockwise',
    'download-simple',
    'link',
    'minus',
    'sign-in',
    // FS-8 and FS-12 rows (M1.5): Einstellungen, Erscheinungsbild, Rechtliches.
    'gear-six',
    'circle-half',
    'scales',
      'push-pin',
    'bell-slash',
    'archive',
    'copy',
    'flag',
    'clock',
      'device-mobile',
    'translate',
    'shield-check',
    'question',
      'chart-bar',
    'arrows-left-right',
    'calendar-blank',
    'selection',
    'keyboard',
    // M3.5 announcements and support requests, M3.7 AI labels (a lightbulb, never sparkles) and external links.
    'megaphone-simple',
    'lifebuoy',
    'lightbulb',
    'arrow-square-out',
  ];

  it('curates every icon the primitives need', () => {
    expect(Object.keys(phosphorIcons).sort()).toEqual([...required].sort());
  });

  it.each(['regular', 'fill'] as const)('renders Phosphor and custom glyphs in %s', async (weight) => {
    await render(
      <ThemeProvider>
        <Icon name="house" weight={weight} testID="phosphor" />
        <Icon name="turbo" weight={weight} testID="auto" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('phosphor')).toBeTruthy();
    expect(screen.getByTestId('auto')).toBeTruthy();
  });

  it('colours and sizes from props', async () => {
    const view = await render(
      <ThemeProvider>
        <Icon name="check" size={16} color="accent.fg" testID="i" />
      </ThemeProvider>,
    );
    const icon = screen.getByTestId('i');
    expect(icon.props.width).toBe(16);
    expect(JSON.stringify(view.toJSON())).toContain(String(processColor(themes.carbon.color.accent.fg)));
  });

  it('names a standalone icon for assistive tech', async () => {
    await render(
      <ThemeProvider>
        <Icon name="warning" label="Warnung" />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'Warnung' })).toBeTruthy();
  });
});

describe('motion tokens', () => {
  it('has the durations the crossfade relies on', () => {
    expect(motion.duration.small).toBe(200);
    expect(motion.duration.reducedCrossfade).toBe(120);
  });
});

describe('useMotion', () => {
  const reduced = jest.requireMock<{ useReducedMotion: jest.Mock }>('react-native-reanimated');

  function motionFor(reducedMotion: boolean) {
    reduced.useReducedMotion.mockReturnValue(reducedMotion);
    let result!: ReturnType<typeof useMotion>;
    function Probe() {
      result = useMotion();
      return null;
    }
    return render(<Probe />).then(() => result);
  }

  it('builds timingTo and springTo as worklets, so UI-thread callers can use them', async () => {
    const worklet = (fn: unknown) => (fn as { __workletHash?: number }).__workletHash;
    for (const flag of [false, true]) {
      const { timingTo, springTo } = await motionFor(flag);
      expect(worklet(timingTo)).toEqual(expect.any(Number));
      expect(worklet(springTo)).toEqual(expect.any(Number));
    }
  });

  it('caps durations at the crossfade under reduced motion', async () => {
    const full = await motionFor(false);
    const reducedMotion = await motionFor(true);
    expect(full.duration.small).toBe(motion.duration.small);
    expect(reducedMotion.duration.small).toBe(motion.duration.reducedCrossfade);
    expect(reducedMotion.reduced).toBe(true);
  });

  it('keeps one object per mode, so effects can depend on it', async () => {
    expect(await motionFor(false)).toBe(await motionFor(false));
  });
});

describe('first-screen gate', () => {
  it('does not report a screen when only its gate timed out', () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let ready!: typeof import('@/lib/ready');
    jest.isolateModules(() => {
      ready = jest.requireActual('@/lib/ready');
    });
    ready.registerFirstScreenGate();
    jest.advanceTimersByTime(ready.READY_GATE_TIMEOUT_MS);
    expect(ready.isAppReady()).toBe(true);
    expect(ready.isFirstScreenMounted()).toBe(false);
    ready.markFirstScreenMounted();
    expect(ready.isFirstScreenMounted()).toBe(true);
    warn.mockRestore();
    jest.useRealTimers();
  });

  it('holds the app until a Screen has mounted', async () => {
    const ready = jest.requireActual<typeof import('@/lib/ready')>('@/lib/ready');
    if (ready.isAppReady()) throw new Error('ready must start closed in this file');
    ready.registerFirstScreenGate();
    expect(ready.isAppReady()).toBe(false);
    expect(ready.isFirstScreenMounted()).toBe(false);
    await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <ThemeProvider>
          <Screen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    expect(ready.isAppReady()).toBe(true);
    expect(ready.isFirstScreenMounted()).toBe(true);
  });
});

describe('useFormat', () => {
  let format!: ReturnType<typeof useFormat>;
  function Probe() {
    format = useFormat();
    return null;
  }

  afterAll(() => i18n.changeLanguage('de'));

  it('follows the current language', async () => {
    await i18n.changeLanguage('de');
    await render(<Probe />);
    expect(format.locale).toBe('de');
    expect(format.number(1500.5)).toBe('1.500,5');
    expect(format.power(510, 'ps')).toBe('510\u00A0PS (375\u00A0kW)');
    expect(format.lowering(-35)).toBe('−35\u00A0mm');

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(format.locale).toBe('en');
    expect(format.number(1500.5)).toBe('1,500.5');
    expect(format.date(new Date('2026-06-14T12:00:00Z'))).toBe('14/06/2026');
  });

  it('maps a language tag to its formatter locale', () => {
    expect(toFormatLocale('en-GB')).toBe('en');
    expect(toFormatLocale('de-AT')).toBe('de');
    expect(toFormatLocale('fr')).toBe('de');
    expect(toFormatLocale(undefined)).toBe('de');
  });
});

describe('persisted query cache', () => {
  it('is busted by environment and by build', () => {
    jest.doMock('@react-native-community/netinfo', () => ({ addEventListener: () => () => undefined }));
    const { persistOptions } = jest.requireActual<typeof import('@/api/queryClient')>('@/api/queryClient');
    expect(persistOptions.buster).toBe(
      `${process.env.EXPO_PUBLIC_APP_ENV ?? 'local'}|${version.versionName}+${version.versionCode}`,
    );
  });
});

describe('QA report on <html>', () => {
  const originalEnv = process.env.EXPO_PUBLIC_APP_ENV;

  function loadDocument(env: string, search: string) {
    process.env.EXPO_PUBLIC_APP_ENV = env;
    const dataset: Record<string, string> = {};
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: { dataset, lang: '' }, querySelector: () => null },
    });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search } } });
    let webDocument!: typeof import('@/theme/webDocument');
    jest.isolateModules(() => {
      jest.doMock('@/lib/platform', () => ({ isWeb: true, isNative: false }));
      webDocument = jest.requireActual('@/theme/webDocument');
      jest.dontMock('@/lib/platform');
    });
    return { webDocument, dataset };
  }

  afterEach(() => {
    process.env.EXPO_PUBLIC_APP_ENV = originalEnv;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  function report(webDocument: typeof import('@/theme/webDocument')) {
    webDocument.applyThemeToDocument(getTheme('light', 2));
    webDocument.applyLocaleToDocument('en');
    webDocument.reportQaSession();
  }

  it('states what was applied', () => {
    const { webDocument, dataset } = loadDocument('local', '?qaState=empty&qaMotion=off');
    report(webDocument);
    expect(dataset).toEqual({
      theme: 'light',
      qaTheme: 'light',
      qaFontScale: '2',
      qaLocale: 'en',
      qaState: 'empty',
      qaMotion: 'off',
    });
  });

  it('reports default and on when nothing is forced', () => {
    const { webDocument, dataset } = loadDocument('local', '');
    webDocument.reportQaSession();
    expect(dataset).toEqual({ qaState: 'default', qaMotion: 'on' });
  });

  it('reports nothing in production', () => {
    const { webDocument, dataset } = loadDocument('production', '?qaState=empty&qaMotion=off');
    report(webDocument);
    expect(dataset).toEqual({ theme: 'light' });
  });

  it('keeps the report behind the expressions the bundler inlines', () => {
    const source = readFileSync(join(__dirname, '../src/theme/webDocument.ts'), 'utf8');
    const reports = source.match(/dataset\.qa[A-Z]\w+ =/g) ?? [];
    expect(reports).toHaveLength(5);
    expect(source.match(/process\.env\.EXPO_PUBLIC_APP_ENV !== 'production'/g)).toHaveLength(3);
  });
});
