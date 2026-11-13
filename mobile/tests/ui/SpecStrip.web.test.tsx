/**
 * N1b on the member web (react-native-web): the same first-frame rule as native. With the width its parent lays it out at the
 * strip has its final columns before any layout; without one it is laid out invisibly until it knows its width. R34 on the
 * desktop card keeps the same columns before and after its texts are measured.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, useWindowDimensions, type ViewStyle } from 'react-native';

import { profileSummaryWidth } from '@/features/vehicle/layout';
import { breakpointFor, hydrateThemePreference, layout, ThemeProvider, typography, typographyDesktop } from '@/theme';
import { SpecStrip } from '@/ui/SpecStrip';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

/** A browser window whose width answers the desktop media query. */
let windowWidth = 390;
const minWidthOf = (query: string) => Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity);
Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    get matches() {
      return windowWidth >= minWidthOf(query);
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
});

const R34 = [
  { value: '500', unit: 'PS', label: 'Leistung', provenance: 'Prüfstand' },
  { value: '540', unit: 'Nm', label: 'Drehmoment', provenance: 'Prüfstand' },
  { value: '2002', label: 'Baujahr' },
  { value: 'AWD', label: 'Antrieb' },
];

const originalOS = Platform.OS;
const rowsOf = () => screen.getByTestId('s').children;
const opacity = () => (StyleSheet.flatten(screen.getByTestId('s').props.style as ViewStyle) as ViewStyle).opacity;

function windowOf(width: number) {
  windowWidth = width;
  dimensions.mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 });
}

async function layOut(width: number, widths: Readonly<Record<string, number>>) {
  // fireEvent is async in RNTL 14 and wraps act itself.
  await fireEvent(screen.getByTestId('s'), 'layout', { nativeEvent: { layout: { width, height: 0, x: 0, y: 0 } } });
  for (const text of screen.getAllByText(/.+/, { includeHiddenElements: true })) {
    const content = String(text.props.children);
    if (widths[content] !== undefined && text.props.onLayout) {
      await fireEvent(text, 'layout', { nativeEvent: { layout: { width: widths[content], height: 0, x: 0, y: 0 } } });
    }
  }
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

describe('SpecStrip on web, first frame (N1b)', () => {
  it.each([360, 390, 430])('at %i px with the page width: the 2×2 grid before any layout', async (width) => {
    windowOf(width);
    await render(
      <ThemeProvider>
        <SpecStrip items={R34} layoutWidth={profileSummaryWidth('phone', width, breakpointFor(width).gutter)} testID="s" />
      </ThemeProvider>,
    );
    expect(rowsOf()).toHaveLength(2);
    expect(opacity()).toBeUndefined();
  });

  it('without a width: invisible but laid out until its own width is known', async () => {
    windowOf(390);
    await render(
      <ThemeProvider>
        <SpecStrip items={R34} testID="s" />
      </ThemeProvider>,
    );
    expect(opacity()).toBe(0);
    expect(rowsOf().length).toBeGreaterThanOrEqual(2);
    await layOut(350, {});
    expect(opacity()).toBeUndefined();
    expect(rowsOf()).toHaveLength(2);
  });

  it.each([layout.breakpoints.desktop, 1440])('R34 on the desktop card at %i: the same columns before and after measuring', async (width) => {
    windowOf(width);
    const card = profileSummaryWidth('desktop', width - layout.sidebar, breakpointFor(width).gutter);
    await render(
      <ThemeProvider>
        <SpecStrip items={R34} layoutWidth={card} testID="s" />
      </ThemeProvider>,
    );
    const before = rowsOf().length;
    // The desktop numeral (48) puts "2002" beyond a quarter of the card: the 2×2 grid, as WEB-01.
    expect(before).toBe(2);
    // NH-2: the values at their real advances, not the estimator's output: the shipped ArchivoCondensed-SemiBold.ttf read with
    // fontTools 4.68 (unitsPerEm 1000; digits through `tnum`, 472; A 548, W 768, D 575), unkerned. The Inter lines at their
    // advances (Inter-SemiBold / Inter-Medium, unitsPerEm 2048) with the roles' tracking, unkerned.
    const size = typographyDesktop.heroNumeralS.fontSize;
    const em = (units: number) => (units / 1000) * size;
    const caps = (units: number, chars: number) => (units / 2048) * typography.labelCaps.fontSize + chars * typography.labelCaps.letterSpacing;
    await layOut(card, {
      '500': em(3 * 472),
      '540': em(3 * 472),
      '2002': em(4 * 472),
      AWD: em(548 + 768 + 575),
      PS: caps(2653, 2),
      Nm: caps(3399, 2),
      Leistung: caps(10245, 8),
      Drehmoment: caps(15081, 10),
      Baujahr: caps(9887, 7),
      Antrieb: caps(8890, 7),
      Prüfstand: (10397 / 2048) * typography.caption.fontSize + 8 * typography.caption.letterSpacing,
    });
    expect(rowsOf()).toHaveLength(before);
    expect(opacity()).toBeUndefined();
  });
});
