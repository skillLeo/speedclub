import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen } from '@testing-library/react-native';
import { NavigationBar } from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform, Text as RNText, useColorScheme } from 'react-native';

import {
  breakpointFor,
  createStyles,
  getTheme,
  hydrateThemePreference,
  resolveColor,
  resolveThemeName,
  setThemePreference,
  motion,
  themes,
  ThemeProvider,
  useTheme,
} from '@/theme';
import { READY_GATE_TIMEOUT_MS } from '@/lib/ready';
import { isThemePreference } from '@/theme/theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'dark'),
}));

const mockedScheme = useColorScheme as unknown as jest.Mock;

const FRAME_MS = 17;

function flushFrames() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

describe('resolveThemeName', () => {
  it('returns a concrete preference unchanged', () => {
    expect(resolveThemeName('carbon', 'light')).toBe('carbon');
    expect(resolveThemeName('black', 'light')).toBe('black');
    expect(resolveThemeName('light', 'dark')).toBe('light');
  });

  it('maps system through tokens', () => {
    expect(resolveThemeName('system', 'dark')).toBe('carbon');
    expect(resolveThemeName('system', 'light')).toBe('light');
  });

  it('treats an unknown system scheme as dark', () => {
    expect(resolveThemeName('system', null)).toBe('carbon');
    expect(resolveThemeName('system', undefined)).toBe('carbon');
  });
});

describe('isThemePreference', () => {
  it('rejects anything else from storage', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('carbon')).toBe(true);
    expect(isThemePreference('neon')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe('getTheme', () => {
  it('returns the tokens for the name', () => {
    const t = getTheme('light', 1.5);
    expect(t.name).toBe('light');
    expect(t.colorScheme).toBe('light');
    expect(t.color.bg.canvas).toBe(themes.light.color.bg.canvas);
    expect(t.fontScale).toBe(1.5);
    expect(t.space[16]).toBe(16);
  });

  it('is stable per name and scale', () => {
    expect(getTheme('carbon', 1)).toBe(getTheme('carbon', 1));
    expect(getTheme('carbon', 1)).not.toBe(getTheme('carbon', 2));
    expect(getTheme('carbon', 1)).not.toBe(getTheme('black', 1));
  });
});

describe('resolveColor', () => {
  it('finds a colour by token path', () => {
    expect(resolveColor(getTheme('light'), 'text.secondary')).toBe(themes.light.color.text.secondary);
    expect(resolveColor(getTheme('black'), 'bg.canvas')).toBe('#000000');
  });
});

describe('createStyles', () => {
  const factory = jest.fn((t: ReturnType<typeof getTheme>) => ({
    box: { backgroundColor: t.color.bg.surface, padding: t.space[16] },
  }));
  const useStyles = createStyles(factory);
  const seen: unknown[] = [];

  function Probe() {
    seen.push(useStyles());
    return null;
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
    setThemePreference('carbon');
    seen.length = 0;
    factory.mockClear();
  });

  it('builds once per theme and returns the cached object on re-render', async () => {
    await hydrateThemePreference();
    const view = await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await view.rerender(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((styles) => styles === seen[0])).toBe(true);
    await view.unmount();
  });

  it('builds again for another theme and reuses the first on the way back', async () => {
    await hydrateThemePreference();
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    const carbon = seen.at(-1);

    await act(async () => setThemePreference('light'));
    await flushFrames();
    const light = seen.at(-1);
    expect(light).not.toBe(carbon);
    expect((light as { box: { backgroundColor: string } }).box.backgroundColor).toBe(
      themes.light.color.bg.surface,
    );

    await act(async () => setThemePreference('carbon'));
    await flushFrames();
    expect(seen.at(-1)).toBe(carbon);
  });
});

describe('ThemeProvider', () => {
  beforeAll(hydrateThemePreference);

  let mounts = 0;
  let unmounts = 0;

  function Child() {
    const theme = useTheme();
    useEffect(() => {
      mounts += 1;
      return () => {
        unmounts += 1;
      };
    }, []);
    return <RNText testID="name">{theme.name}</RNText>;
  }

  beforeEach(async () => {
    mounts = 0;
    unmounts = 0;
    mockedScheme.mockReturnValue('dark');
    await AsyncStorage.clear();
    setThemePreference('carbon');
  });

  it('throws when useTheme has no provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Child />)).rejects.toThrow('inside ThemeProvider');
    spy.mockRestore();
  });

  it('switches theme without remounting the tree', async () => {
    await render(
      <ThemeProvider>
        <Child />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('name')).toHaveTextContent('carbon');

    await act(async () => setThemePreference('black'));
    await flushFrames();

    expect(screen.getByTestId('name')).toHaveTextContent('black');
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('persists the preference under sc.theme', async () => {
    await act(async () => setThemePreference('light'));
    expect(await AsyncStorage.getItem('sc.theme')).toBe('light');
  });

  it('follows the system when the preference is system', async () => {
    setThemePreference('system');
    mockedScheme.mockReturnValue('light');
    await render(
      <ThemeProvider>
        <Child />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('name')).toHaveTextContent('light');
  });

  describe('crossfade overlay', () => {
    const overlay = () => screen.getByTestId('theme.overlay', { includeHiddenElements: true });
    // Fake timers hold every frame back until the test advances them, so the covered state can be read exactly:
    // on real frames, a loaded machine could already have started the fade by the time act() returns.
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    // The animated style applies a shared value on the next frame. The fade only starts on the frame after that,
    // because the theme swap it waits for commits in between.
    const runOneFrame = () =>
      act(async () => {
        jest.advanceTimersByTime(FRAME_MS);
      });

    const expectFadedOut = async () => {
      await act(async () => {
        jest.advanceTimersByTime(motion.duration.small + motion.duration.medium);
      });
      expect(overlay()).toHaveAnimatedStyle({ opacity: 0 });
    };

    it('covers on a change and fades out afterwards', async () => {
      await render(
        <ThemeProvider>
          <Child />
        </ThemeProvider>,
      );
      expect(overlay()).toHaveAnimatedStyle({ opacity: 0 });

      await act(async () => setThemePreference('light'));
      await runOneFrame();
      expect(overlay()).toHaveAnimatedStyle({ opacity: 1, backgroundColor: themes.carbon.color.bg.canvas });

      await expectFadedOut();
      expect(screen.getByTestId('name')).toHaveTextContent('light');
    });

    it('never stays opaque when a change is undone before its frame', async () => {
      await render(
        <ThemeProvider>
          <Child />
        </ThemeProvider>,
      );
      await act(async () => {
        setThemePreference('light');
      });
      await act(async () => {
        setThemePreference('carbon');
      });
      await expectFadedOut();
      expect(screen.getByTestId('name')).toHaveTextContent('carbon');
    });
  });

  describe('Android navigation bar', () => {
    const originalOS = Platform.OS;

    beforeEach(() => {
      Platform.OS = 'android';
      (NavigationBar.setStyle as jest.Mock).mockClear();
    });

    afterEach(() => {
      Platform.OS = originalOS;
    });

    it.each([
      ['carbon', 'light'],
      ['black', 'light'],
      ['light', 'dark'],
    ] as const)('%s gets %s icons, whatever the OS scheme says', async (name, style) => {
      mockedScheme.mockReturnValue(name === 'light' ? 'dark' : 'light');
      setThemePreference(name);
      await render(
        <ThemeProvider>
          <Child />
        </ThemeProvider>,
      );
      expect(NavigationBar.setStyle).toHaveBeenCalledTimes(1);
      expect(NavigationBar.setStyle).toHaveBeenCalledWith(style);
    });

    it('follows a theme change', async () => {
      await render(
        <ThemeProvider>
          <Child />
        </ThemeProvider>,
      );
      await act(async () => setThemePreference('light'));
      await flushFrames();
      expect(NavigationBar.setStyle).toHaveBeenLastCalledWith('dark');
    });

    it('is not touched on other platforms', async () => {
      Platform.OS = 'ios';
      await render(
        <ThemeProvider>
          <Child />
        </ThemeProvider>,
      );
      expect(NavigationBar.setStyle).not.toHaveBeenCalled();
    });
  });

  it('sets the system background to the canvas', async () => {
    await render(
      <ThemeProvider>
        <Child />
      </ThemeProvider>,
    );
    expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith(themes.carbon.color.bg.canvas);
  });
});

describe('hydrateThemePreference', () => {
  function loadFresh() {
    let preference!: typeof import('@/theme/preference');
    let storage!: typeof AsyncStorage;
    jest.isolateModules(() => {
      preference = jest.requireActual('@/theme/preference');
      storage = jest.requireMock('@react-native-async-storage/async-storage');
    });
    return { preference, storage };
  }

  it('restores a stored preference', async () => {
    const { preference, storage } = loadFresh();
    await storage.setItem('sc.theme', 'black');
    await preference.hydrateThemePreference();
    expect(preference.getThemePreference()).toBe('black');
  });

  it('ignores a garbage value and still finishes', async () => {
    const { preference, storage } = loadFresh();
    await storage.setItem('sc.theme', 'neon');
    await expect(preference.hydrateThemePreference()).resolves.toBeUndefined();
    expect(preference.getThemePreference()).toBe('carbon');
  });

  it('finishes when storage rejects', async () => {
    const { preference, storage } = loadFresh();
    jest.spyOn(storage, 'getItem').mockRejectedValueOnce(new Error('blocked'));
    await expect(preference.hydrateThemePreference()).resolves.toBeUndefined();
  });

  describe('when storage hangs', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('gives up before the ready gate does, and counts as hydrated', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { preference, storage } = loadFresh();
      const read = jest.spyOn(storage, 'getItem').mockReturnValueOnce(new Promise(() => undefined));
      let finished = false;
      void preference.hydrateThemePreference().then(() => {
        finished = true;
      });

      await jest.advanceTimersByTimeAsync(preference.THEME_HYDRATION_TIMEOUT_MS - 1);
      expect(finished).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(finished).toBe(true);
      expect(preference.THEME_HYDRATION_TIMEOUT_MS).toBeLessThan(READY_GATE_TIMEOUT_MS);
      expect(preference.getThemePreference()).toBe('carbon');
      expect(warn).toHaveBeenCalledTimes(1);

      read.mockClear();
      await preference.hydrateThemePreference();
      expect(read).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('drops a read that comes back after the timeout', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { preference, storage } = loadFresh();
      let answer!: (value: string) => void;
      jest.spyOn(storage, 'getItem').mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
      const hydration = preference.hydrateThemePreference();
      await jest.advanceTimersByTimeAsync(preference.THEME_HYDRATION_TIMEOUT_MS);
      await hydration;

      answer('black');
      await jest.advanceTimersByTimeAsync(0);
      expect(preference.getThemePreference()).toBe('carbon');
      warn.mockRestore();
    });
  });

  it('keeps a preference set while the read is running', async () => {
    const { preference, storage } = loadFresh();
    let answer!: (value: string) => void;
    jest.spyOn(storage, 'getItem').mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const hydration = preference.hydrateThemePreference();

    preference.setThemePreference('light');
    answer('black');
    await hydration;

    expect(preference.getThemePreference()).toBe('light');
  });

  it('does not read storage after a preference was set', async () => {
    const { preference, storage } = loadFresh();
    await storage.setItem('sc.theme', 'black');
    preference.setThemePreference('light');
    const read = jest.spyOn(storage, 'getItem');
    read.mockClear();

    await preference.hydrateThemePreference();

    expect(read).not.toHaveBeenCalled();
    expect(preference.getThemePreference()).toBe('light');
  });
});

describe('breakpointFor', () => {
  it.each([
    [360, 'phone', 16, 4],
    [389, 'phone', 16, 4],
    [389.5, 'phone', 16, 4],
    [390, 'phone', 20, 4],
    [767, 'phone', 20, 4],
    [768, 'tablet', 24, 8],
    [1279, 'tablet', 24, 8],
    [1280, 'desktop', 24, 12],
    [1440, 'desktop', 24, 12],
  ])('%d px is %s with gutter %i and %i columns', (width, kind, gutter, columns) => {
    expect(breakpointFor(width)).toEqual({ width, kind, gutter, columns });
  });
});
