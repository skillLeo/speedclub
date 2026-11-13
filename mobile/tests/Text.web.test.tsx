/** 09 §4.2 on the member web: the family stack with a weight, and the desktop sizes from layout.breakpoints.desktop. */
import { act, render, screen } from '@testing-library/react-native';
import { Profiler } from 'react';
import { Dimensions, Platform, StyleSheet, type TextStyle } from 'react-native';

import { fonts, hydrateThemePreference, layout, ThemeProvider } from '@/theme';
import { Text } from '@/ui/Text';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

/** A browser window: its width answers the media queries, and crossing a query's width fires its change listeners. */
let windowWidth = 390;
const mediaLists: { query: string; listeners: Set<() => void> }[] = [];
const minWidthOf = (query: string) => Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity);
Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: (query: string) => {
    const entry = { query, listeners: new Set<() => void>() };
    mediaLists.push(entry);
    return {
      media: query,
      get matches() {
        return windowWidth >= minWidthOf(query);
      },
      addEventListener: (_: string, listener: () => void) => entry.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => entry.listeners.delete(listener),
    };
  },
});

const originalOS = Platform.OS;

function windowOf(width: number, height: number = 900) {
  const crossed = mediaLists.filter(({ query }) => windowWidth >= minWidthOf(query) !== width >= minWidthOf(query));
  windowWidth = width;
  // react-native-web reports every visualViewport resize through Dimensions, the source useWindowDimensions reads.
  Dimensions.set({ window: { width, height, scale: 1, fontScale: 1 }, screen: { width, height, scale: 1, fontScale: 1 } });
  for (const { listeners } of crossed) for (const listener of listeners) listener();
}

async function styleOf(variant: 'heroNumeral' | 'body' | 'headline' | 'title1') {
  await render(
    <ThemeProvider>
      <Text testID="t" variant={variant}>
        510
      </Text>
    </ThemeProvider>,
  );
  return StyleSheet.flatten(screen.getByTestId('t').props.style as TextStyle);
}

describe('Text on web', () => {
  beforeAll(hydrateThemePreference);

  beforeEach(() => {
    Platform.OS = 'web';
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('keeps the mobile sizes below the desktop breakpoint', async () => {
    windowOf(layout.breakpoints.desktop - 1);
    expect(await styleOf('heroNumeral')).toMatchObject({ fontSize: 64, lineHeight: 64 });
    expect(await styleOf('body')).toMatchObject({ fontSize: 15, lineHeight: 22 });
  });

  it('takes the desktop sizes from the desktop breakpoint on', async () => {
    windowOf(layout.breakpoints.desktop);
    expect(await styleOf('heroNumeral')).toMatchObject({ fontSize: 88, lineHeight: 88 });
    expect(await styleOf('title1')).toMatchObject({ fontSize: 36, lineHeight: 40 });
    expect(await styleOf('body')).toMatchObject({ fontSize: 16, lineHeight: 24 });
    // A role without a desktop size keeps its one size.
    expect(await styleOf('headline')).toMatchObject({ fontSize: 17, lineHeight: 22 });
  });

  it('names the family stack and the weight, never a PostScript name', async () => {
    windowOf(390);
    expect(await styleOf('heroNumeral')).toMatchObject({ fontFamily: fonts.numeral.css, fontWeight: '600' });
    expect(await styleOf('body')).toMatchObject({ fontFamily: fonts.ui.css, fontWeight: '400' });
  });

  it('re-renders a Text only when the window crosses the desktop width, never on a height-only resize (MF-3)', async () => {
    windowOf(390);
    let renders = 0;
    await render(
      <ThemeProvider>
        <Profiler id="text" onRender={() => (renders += 1)}>
          <Text testID="t" variant="body">
            510 PS
          </Text>
        </Profiler>
      </ThemeProvider>,
    );
    const afterMount = renders;
    // The keyboard opens, Safari's toolbar collapses: the height changes, the width does not.
    await act(async () => windowOf(390, 520));
    await act(async () => windowOf(390, 760));
    // A width change that stays below the breakpoint is no reason either.
    await act(async () => windowOf(1000, 760));
    expect(renders).toBe(afterMount);
    await act(async () => windowOf(layout.breakpoints.desktop, 760));
    expect(renders).toBe(afterMount + 1);
    expect(StyleSheet.flatten(screen.getByTestId('t').props.style as TextStyle)).toMatchObject({ fontSize: 16, lineHeight: 24 });
  });

  it('keeps the mobile size on the desktop where a card asks for it', async () => {
    windowOf(layout.breakpoints.desktop);
    await render(
      <ThemeProvider>
        <Text testID="t" variant="displayTitle" desktopSize={false}>
          Golf
        </Text>
      </ThemeProvider>,
    );
    expect(StyleSheet.flatten(screen.getByTestId('t').props.style as TextStyle)).toMatchObject({ fontSize: 30, lineHeight: 34 });
  });
});
