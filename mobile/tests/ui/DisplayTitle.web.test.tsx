/**
 * DQ-802 / ADR-426 on the member web: a car name stays whole with no-wrap spans; "C 63" and a bound trailing code keep their
 * U+00A0, which the Blade parity test folds; breaks are balanced with `text-wrap: balance`, which react-native-web 0.21 writes
 * to the DOM.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { Platform, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { hydrateThemePreference, layout, ThemeProvider, typeScale, typography, typographyDesktop } from '@/theme';
import { BALANCED_WEB_WRAP, DisplayTitle } from '@/ui/DisplayTitle';
import { estimateDisplayTitle } from '@/ui/displayTitleLayout';

import { renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

// A desktop browser window.
Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    matches: Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity) <= layout.breakpoints.desktop,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }),
});

// The real react-native-web and React DOM's server renderer (neither ships types here): what the browser gets.
const { renderToStaticMarkup } = jest.requireActual<{ renderToStaticMarkup: (element: ReactElement) => string }>('react-dom/server');
const { Text: WebText } = jest.requireActual<{ Text: ComponentType<{ style?: StyleProp<TextStyle>; children?: ReactNode }> }>('react-native-web');

const originalOS = Platform.OS;
beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

const styleOf = (): TextStyle => StyleSheet.flatten(screen.getByTestId('t').props.style as TextStyle) ?? {};

describe('DisplayTitle on web', () => {
  it('reads as the plain name, with "GT-R" in a no-wrap span and no hyphenation', async () => {
    await renderUi(<DisplayTitle testID="t" placement="page">Nissan Skyline GT-R R34</DisplayTitle>);
    const title = screen.getByTestId('t');
    expect(title).toHaveTextContent('Nissan Skyline GT-R R34');
    expect(styleOf()).toMatchObject({ hyphens: 'none' });
    const kept = screen.getByText('GT-R');
    expect(StyleSheet.flatten(kept.props.style as TextStyle)).toMatchObject({ whiteSpace: 'nowrap' });
  });

  it('takes the desktop size on a page and the mobile size in a card (DQ-808)', async () => {
    await renderUi(<DisplayTitle testID="t" placement="page">Golf</DisplayTitle>);
    expect(styleOf().fontSize).toBe(44);
    await renderUi(
      <DisplayTitle testID="t" placement="card">
        Golf
      </DisplayTitle>,
    );
    expect(styleOf().fontSize).toBe(typography.displayTitle.fontSize);
  });

  it('keeps the U+00A0 of a model designation in its text, as the Blade page writes it (NH-4)', async () => {
    await renderUi(<DisplayTitle testID="t" placement="page">Mercedes-AMG C 63 S</DisplayTitle>);
    const parts = ([] as unknown[]).concat(screen.getByTestId('t').props.children);
    expect(parts.filter((part): part is string => typeof part === 'string').join('')).toContain('C\u00A063');
    // The hyphenated name is its own no-wrap span, without a word joiner.
    expect(screen.getByText('Mercedes-AMG')).toBeTruthy();
  });

  it('paints a long desktop page title at 24/28 on its first frame (MF-R2-1), and counts lines from its height after', async () => {
    await renderUi(
      <DisplayTitle testID="t" placement="page" layoutWidth={400}>
        Mercedes-Benz E 63 S AMG 4MATIC+ T-Modell Final Edition
      </DisplayTitle>,
    );
    expect(styleOf()).toMatchObject({ fontSize: typeScale.displayTitle.minSize, lineHeight: typeScale.displayTitle.minLineHeight });
    expect(styleOf().opacity).toBeUndefined();
    await renderUi(
      <DisplayTitle testID="t" placement="page" layoutWidth={400}>
        Skyline GT-R R34
      </DisplayTitle>,
    );
    expect(styleOf()).toMatchObject({ fontSize: typographyDesktop.displayTitle.fontSize, lineHeight: typographyDesktop.displayTitle.lineHeight });
    // Without a width it measures itself: three desktop lines (3 × 48) shrink it (the web's QA scale is linear).
    await renderUi(<DisplayTitle testID="t" placement="page">Volkswagen Golf GTI VIII (CD)</DisplayTitle>);
    await fireEvent(screen.getByTestId('t'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 3 * typographyDesktop.displayTitle.lineHeight, x: 0, y: 0 } },
    });
    expect(styleOf().fontSize).toBe(typeScale.displayTitle.minSize);
  });

  it('keeps a bound trailing code in its text with U+00A0, after the no-wrap span of "GT-R" (ADR-426 c)', async () => {
    // Bound where the width is known and the pair fits it.
    await renderUi(
      <DisplayTitle testID="t" placement="page" layoutWidth={400}>
        Nissan Skyline GT-R R34
      </DisplayTitle>,
    );
    const parts = ([] as unknown[]).concat(screen.getByTestId('t').props.children);
    expect(parts.filter((part): part is string => typeof part === 'string')).toContain('\u00a0R34');
    expect(screen.getByTestId('t')).toHaveTextContent('Nissan Skyline GT-R R34');
  });

  it('balances its breaks with text-wrap-style: balance, and react-native-web writes it to the DOM (ADR-426 c)', async () => {
    await renderUi(
      <DisplayTitle testID="t" placement="page">
        Volkswagen Golf GTI VIII (CD)
      </DisplayTitle>,
    );
    expect(styleOf()).toMatchObject({ textWrapStyle: 'balance' });
    // Android's prop stays off the DOM.
    expect(screen.getByTestId('t').props.textBreakStrategy).toBeUndefined();
    // The same style through react-native-web 0.21's own Text: it reaches the element's style attribute.
    const html = renderToStaticMarkup(<WebText style={[{ fontSize: 30 }, BALANCED_WEB_WRAP]}>Golf</WebText>);
    expect(html).toMatch(/style="[^"]*text-wrap-style:balance/);
    // DQ-922: the longhand only, so a nowrap set elsewhere keeps its text-wrap-mode.
    expect(html).not.toMatch(/text-wrap:/);
  });

  it('sets a card title at 30/34 on the web desktop, where a page title would take 44/48 and orphan the code (ADR-426 b)', async () => {
    // The VEH-01 desktop side card at 1280 is about 355 wide: "Skyline GT-R R34" is one line at 30, two at 44.
    await renderUi(
      <DisplayTitle testID="t" placement="card" layoutWidth={355}>
        Skyline GT-R R34
      </DisplayTitle>,
    );
    expect(styleOf()).toMatchObject({ fontSize: typography.displayTitle.fontSize, lineHeight: typography.displayTitle.lineHeight });
    expect(styleOf().opacity).toBeUndefined();
    await renderUi(
      <DisplayTitle testID="t" placement="page" layoutWidth={355}>
        Skyline GT-R R34
      </DisplayTitle>,
    );
    expect(styleOf()).toMatchObject({ fontSize: typographyDesktop.displayTitle.fontSize });
  });

  it('counts web lines with the drawn line box: a shrunk title divides by 28, not 48', async () => {
    await renderUi(
      <DisplayTitle testID="t" placement="page">
        Mercedes-Benz E 63 S AMG 4MATIC+ T-Modell Final Edition
      </DisplayTitle>,
    );
    await fireEvent(screen.getByTestId('t'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 3 * typographyDesktop.displayTitle.lineHeight, x: 0, y: 0 } },
    });
    expect(styleOf().fontSize).toBe(typeScale.displayTitle.minSize);
    // Four lines at 28 at the same width: it stays shrunk.
    await fireEvent(screen.getByTestId('t'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 4 * typeScale.displayTitle.minLineHeight, x: 0, y: 0 } },
    });
    expect(styleOf().fontSize).toBe(typeScale.displayTitle.minSize);
  });

  it('MF-R3-1: a new width remounts the text, so the first ResizeObserver callback of the new node releases an ambiguous title', async () => {
    const CLAIM = 'CARS. PEOPLE. CULTURE.';
    const at = (width: number) =>
      estimateDisplayTitle({ name: CLAIM, kind: 'copy', width, fontSize: typographyDesktop.displayTitle.fontSize, placement: 'page', scale: { low: 1, high: 1 } });
    // One line at 44 in 700: final. Three in 340: shrunk by the estimate, but copy may hyphenate, so it counts its own lines.
    expect(at(700)).toMatchObject({ shrunk: false, certain: true });
    expect(at(340)).toMatchObject({ shrunk: true, certain: false });
    const title = (width: number) => (
      <GestureHandlerRootView>
        <ThemeProvider>
          <DisplayTitle testID="t" kind="copy" placement="page" layoutWidth={width}>
            {CLAIM}
          </DisplayTitle>
        </ThemeProvider>
      </GestureHandlerRootView>
    );
    const view = await renderUi(
      <DisplayTitle testID="t" kind="copy" placement="page" layoutWidth={700}>
        {CLAIM}
      </DisplayTitle>,
    );
    expect(styleOf().opacity).toBeUndefined();
    const first = screen.getByTestId('t');
    await view.rerender(title(340));
    expect(screen.getByTestId('t')).not.toBe(first);
    expect(styleOf().opacity).toBe(0);
    // Only the new node's first layout (its box may be the same as before): three desktop lines, so 24, drawn.
    await fireEvent(screen.getByTestId('t'), 'layout', {
      nativeEvent: { layout: { width: 340, height: 3 * typographyDesktop.displayTitle.lineHeight, x: 0, y: 0 } },
    });
    expect(styleOf().opacity).toBeUndefined();
    expect(styleOf().fontSize).toBe(typeScale.displayTitle.minSize);
  });

  it('SF-R3-3: without a width it is not drawn before its first count', async () => {
    await renderUi(<DisplayTitle testID="t" placement="page">Volkswagen Golf GTI VIII (CD)</DisplayTitle>);
    expect(styleOf().opacity).toBe(0);
    await fireEvent(screen.getByTestId('t'), 'layout', {
      nativeEvent: { layout: { width: 700, height: typographyDesktop.displayTitle.lineHeight, x: 0, y: 0 } },
    });
    expect(styleOf().opacity).toBeUndefined();
    expect(styleOf().fontSize).toBe(typographyDesktop.displayTitle.fontSize);
  });
});
