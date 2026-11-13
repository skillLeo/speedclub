/**
 * display.title through one component (DQ-802/808/903, ADR-425, ADR-426): car names never hyphenate, the size shrinks to 24/28
 * only where that saves a line (page and card rules), breaks are balanced, a trailing short code stays with its word, and the
 * size is final on the first frame wherever the estimate is certain.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, useWindowDimensions, type TextStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { homeKeys } from '@/api/queries/home';
import { publicViewerNow } from '@/api/queries/vehicles';
import { FeaturedHero, FeaturedHeroSkeleton, featuredHeroLayout } from '@/features/home/components/FeaturedHero';
import { ProfileSummary, VehicleIdentity } from '@/features/vehicle/components/ProfileSummary';
import { heroIdentityWidth, profileSummaryWidth, summaryTitlePlacement } from '@/features/vehicle/layout';
import { breakpointFor, hydrateThemePreference, layout, ThemeProvider, typeScale, typography, typographyDesktop } from '@/theme';
import { Skeleton } from '@/ui';
import { DisplayTitle, displayTitleSkeleton } from '@/ui/DisplayTitle';
import {
  certainlyOneLine,
  DISPLAY_TITLE_ADVANCES,
  DISPLAY_TITLE_KERNING,
  displayTitleSize,
  displayTitleText,
  drawnScale,
  estimateDisplayTitle,
  estimatedTitleLines,
  estimatedTitleWidth,
  shrunkFitsOneLine,
  type DisplayTitlePlacement,
} from '@/ui/displayTitleLayout';
import { bindTrailingCode, TRAILING_CODE_MAX, vehicleNameText, vehicleTitleText } from '@/ui/textBreaks';

import { GTI, M4 } from '../home/fixtures';
import { R34 } from '../vehicle/fixtures';
import { renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));
// FeaturedHero's skeleton reads the featured builds from the query cache, so the API stack is imported (never called here).
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) }),
  usePathname: () => '/',
}));

const dimensions = useWindowDimensions as jest.Mock;
const windowOf = (width: number, fontScale: number = 1) => dimensions.mockReturnValue({ width, height: 852, scale: 3, fontScale });

beforeAll(hydrateThemePreference);
beforeEach(() => windowOf(393));

const styleOf = (testID = 't'): TextStyle => StyleSheet.flatten(screen.getByTestId(testID).props.style as TextStyle) ?? {};
const LINE = typography.displayTitle.lineHeight;
const FULL = { fontSize: typography.displayTitle.fontSize, lineHeight: LINE };
/** ADR-426 g: the shrink pair is the role's own minSize / minLineHeight, 24/28. */
const SHRUNK = { fontSize: typeScale.displayTitle.minSize, lineHeight: typeScale.displayTitle.minLineHeight };

/** The size the title paints at, and whether it paints at all. */
const paint = (testID = 't') => {
  const style = styleOf(testID);
  return { fontSize: style.fontSize, lineHeight: style.lineHeight, hidden: style.opacity === 0 };
};

/** Its box (onLayout) and, on native, its lines (onTextLayout, exact at any font scale: SF-R2-1). */
async function layOut(width: number, lines: number, lineHeight: number = LINE, testID = 't') {
  // fireEvent is async in RNTL 14 and wraps act itself.
  await fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { width, height: lines * lineHeight, x: 0, y: 0 } } });
  await fireEvent(screen.getByTestId(testID), 'textLayout', {
    nativeEvent: { lines: Array.from({ length: lines }, () => ({ width, height: lineHeight, x: 0, y: 0, text: '' })) },
  });
}

const GOLF = 'Volkswagen Golf GTI VIII (CD)';
const SKYLINE = 'Skyline GT-R R34';
const CLAIM = 'CARS. PEOPLE. CULTURE.';
const PUBLISHED = 'Dein Build ist online';
/** Three lines at 30 on every phone, still three at 24. */
const LONG_NAME = 'Mercedes-Benz E 63 S AMG 4MATIC+ T-Modell Final Edition';

describe('the trailing short code (ADR-426 c as amended)', () => {
  /** Bound at 30 in a 393 phone's line (353): every pair below fits it. */
  const at393 = (name: string) => displayTitleText(name, 'vehicle', 30, 353);
  const always = () => true;

  it('binds a trailing code of at most 4 characters to the word before it, at display time, where the pair fits', () => {
    expect(at393(SKYLINE)).toBe('Skyline GT-\u2060R\u00a0R34');
    expect(at393(GOLF)).toBe('Volkswagen Golf GTI VIII\u00a0(CD)');
    expect(at393('BMW M4 Competition G82')).toBe('BMW M4 Competition\u00a0G82');
    // A five-character token stays free to wrap.
    expect(at393('Porsche 911 GT3 Touring')).toBe('Porsche 911 GT3 Touring');
    expect(at393('Audi RS 6 Avant')).toBe('Audi RS\u00a06 Avant');
    expect(bindTrailingCode('Golf 12345', always)).toBe('Golf 12345');
    expect(TRAILING_CODE_MAX).toBe(4);
    // A single word has nothing to bind to.
    expect(bindTrailingCode('R34', always)).toBe('R34');
    // The plain helper (meta lines, rows) is unchanged, and without a width nothing is bound.
    expect(vehicleNameText(GOLF)).toBe(GOLF);
    expect(vehicleTitleText(GOLF)).toBe(GOLF);
    expect(displayTitleText(GOLF, 'vehicle', 30, null)).toBe(GOLF);
  });

  it('MF-R3-2: never binds where no breakable space would remain before the pair', () => {
    for (const name of ['Porsche 911', 'Toyota GR86', 'Lamborghini Urus', 'Mercedes-Benz W124', 'Nissan GT-R']) {
      expect(bindTrailingCode(vehicleNameText(name), always)).toBe(vehicleNameText(name));
      expect(at393(name)).toBe(vehicleNameText(name));
      expect(at393(name)).not.toContain('\u00a0');
    }
  });

  it('MF-R3-2: binds only where the pair fits the line at the size it is drawn', () => {
    // "GT-R R34" at 30: G 904, T 717, - 375, R 819, U+00A0 260, R 819, 3 669, 4 657 (fontTools, unitsPerEm 1000), −0.01 em
    // tracking each, the word joiner drawing nothing, no positive pair: 154.2. It fits a 155 line, not a 154 one.
    const pair = `${vehicleNameText('GT-R')}\u00a0R34`;
    expect(estimatedTitleWidth(pair, 30)).toBeCloseTo((0.904 + 0.717 + 0.375 + 0.819 + 0.26 + 0.819 + 0.669 + 0.657 - 0.08) * 30, 6);
    expect(displayTitleText(SKYLINE, 'vehicle', 30, 155)).toContain('\u00a0R34');
    expect(displayTitleText(SKYLINE, 'vehicle', 30, 154)).not.toContain('\u00a0');
    // At 200 % (60) the pair is 308.4 wide: bound in a 353 line, breakable in a 300 one.
    expect(displayTitleText(SKYLINE, 'vehicle', 60, 353)).toContain('\u00a0R34');
    expect(displayTitleText(SKYLINE, 'vehicle', 60, 300)).not.toContain('\u00a0');
    expect(bindTrailingCode('Nissan Skyline GT-R R34', () => false)).toBe('Nissan Skyline GT-R R34');
  });

  it('measures a bound code as one word, so the estimate never breaks before it', () => {
    const bound = at393(GOLF);
    const vIIIcd = estimatedTitleWidth('VIII\u00a0(CD)', 30);
    // Just too narrow for "… VIII (CD)" on the first line: the pair moves down together (2 lines either way, never "(CD)" alone).
    const width = estimatedTitleWidth('Volkswagen Golf GTI VIII', 30) + 1;
    expect(estimatedTitleLines(bound, 30, width).lines).toBe(2);
    expect(vIIIcd).toBeGreaterThan(estimatedTitleWidth('(CD)', 30));
  });
});

describe('ADR-426 a, the page and card rules', () => {
  /**
   * The width a title is laid out at on a window: a phone's text between the gutters; on a desktop the 5/12 side card the rule
   * tables were written for (ADR-426 b). The card's geometry is fixed here, so these rows test the rule, not a page layout (VEH-01's
   * title moved onto its hero in DQ-1048).
   */
  const SIDE_CARD = (content: number, gutter: number) => ((Math.min(content, layout.contentMax + 2 * gutter) - 2 * gutter - gutter) * 5) / 12 - 2 * gutter;
  const widthAt = (window: number) =>
    window >= layout.breakpoints.desktop ? SIDE_CARD(window - layout.sidebar, breakpointFor(window).gutter) : window - 2 * breakpointFor(window).gutter;

  const decide = (title: string, window: number, fontScale: number, placement: DisplayTitlePlacement, copy = false) => {
    const desktop = window >= layout.breakpoints.desktop && placement === 'page';
    const fit = estimateDisplayTitle({
      name: title,
      kind: copy ? 'copy' : 'vehicle',
      width: widthAt(window),
      fontSize: desktop ? typographyDesktop.displayTitle.fontSize : typography.displayTitle.fontSize,
      placement,
      scale: { low: fontScale, high: fontScale },
    });
    return { size: fit.shrunk ? 24 : desktop ? 44 : 30, lines: fit.lines, certain: fit.certain };
  };

  it('reads the rule from the line counts', () => {
    // Page: full up to 2 lines, else 24.
    expect(displayTitleSize('page', 1, null)).toBe('full');
    expect(displayTitleSize('page', 2, 1)).toBe('full');
    expect(displayTitleSize('page', 3, 3)).toBe('shrunk');
    // Card: 1 line full; 2 lines → 24 only when 24 is 1 line; 3+ → 24.
    expect(displayTitleSize('card', 1, 1)).toBe('full');
    expect(displayTitleSize('card', 2, 1)).toBe('shrunk');
    expect(displayTitleSize('card', 2, 2)).toBe('full');
    expect(displayTitleSize('card', 3, 2)).toBe('shrunk');
  });

  // [title, window, font scale, placement, size, lines] — certain estimates only (the first frame is final there).
  it.each`
    title        | window  | fs   | placement | size  | lines
    ${GOLF}      | ${360}  | ${1} | ${'page'} | ${30} | ${2}
    ${GOLF}      | ${360}  | ${1} | ${'card'} | ${30} | ${2}
    ${GOLF}      | ${375}  | ${1} | ${'page'} | ${30} | ${2}
    ${GOLF}      | ${375}  | ${1} | ${'card'} | ${30} | ${2}
    ${GOLF}      | ${393}  | ${1} | ${'page'} | ${30} | ${2}
    ${GOLF}      | ${412}  | ${1} | ${'page'} | ${30} | ${2}
    ${GOLF}      | ${412}  | ${1} | ${'card'} | ${24} | ${1}
    ${GOLF}      | ${1280} | ${1} | ${'page'} | ${24} | ${2}
    ${GOLF}      | ${1440} | ${1} | ${'page'} | ${44} | ${2}
    ${GOLF}      | ${1440} | ${1} | ${'card'} | ${24} | ${1}
    ${GOLF}      | ${1440} | ${2} | ${'card'} | ${24} | ${2}
    ${SKYLINE}   | ${360}  | ${1} | ${'page'} | ${30} | ${1}
    ${SKYLINE}   | ${360}  | ${2} | ${'page'} | ${30} | ${2}
    ${SKYLINE}   | ${375}  | ${2} | ${'card'} | ${30} | ${2}
    ${SKYLINE}   | ${393}  | ${1} | ${'card'} | ${30} | ${1}
    ${SKYLINE}   | ${393}  | ${2} | ${'page'} | ${30} | ${2}
    ${SKYLINE}   | ${412}  | ${2} | ${'card'} | ${30} | ${2}
    ${SKYLINE}   | ${1280} | ${1} | ${'page'} | ${44} | ${2}
    ${SKYLINE}   | ${1280} | ${1} | ${'card'} | ${30} | ${1}
    ${SKYLINE}   | ${1280} | ${2} | ${'card'} | ${30} | ${2}
    ${SKYLINE}   | ${1440} | ${1} | ${'page'} | ${44} | ${1}
    ${SKYLINE}   | ${1440} | ${1} | ${'card'} | ${30} | ${1}
    ${LONG_NAME} | ${360}  | ${1} | ${'page'} | ${24} | ${3}
    ${LONG_NAME} | ${375}  | ${1} | ${'card'} | ${24} | ${3}
    ${LONG_NAME} | ${393}  | ${1} | ${'page'} | ${24} | ${3}
    ${LONG_NAME} | ${412}  | ${1} | ${'card'} | ${24} | ${3}
    ${LONG_NAME} | ${1280} | ${1} | ${'card'} | ${24} | ${3}
    ${LONG_NAME} | ${1440} | ${1} | ${'page'} | ${24} | ${2}
  `('$title at $window, font scale $fs, $placement: $size on $lines lines, certain', ({ title, window, fs, placement, size, lines }) => {
    expect(decide(title, window, fs, placement)).toEqual({ size, lines, certain: true });
  });

  it.each`
    title          | window  | fs   | placement | size  | lines
    ${CLAIM}       | ${360}  | ${1} | ${'page'} | ${30} | ${2}
    ${CLAIM}       | ${375}  | ${1} | ${'page'} | ${30} | ${2}
    ${CLAIM}       | ${393}  | ${1} | ${'page'} | ${30} | ${2}
    ${CLAIM}       | ${412}  | ${1} | ${'page'} | ${30} | ${2}
    ${CLAIM}       | ${1440} | ${1} | ${'page'} | ${44} | ${2}
    ${PUBLISHED}   | ${360}  | ${1} | ${'page'} | ${30} | ${1}
    ${PUBLISHED}   | ${360}  | ${2} | ${'page'} | ${30} | ${2}
    ${PUBLISHED}   | ${375}  | ${1} | ${'card'} | ${30} | ${1}
    ${PUBLISHED}   | ${393}  | ${2} | ${'page'} | ${30} | ${2}
    ${PUBLISHED}   | ${412}  | ${1} | ${'card'} | ${30} | ${1}
    ${PUBLISHED}   | ${1280} | ${1} | ${'page'} | ${44} | ${2}
    ${PUBLISHED}   | ${1440} | ${1} | ${'card'} | ${30} | ${1}
  `('copy "$title" at $window, font scale $fs, $placement: $size on $lines lines, certain', ({ title, window, fs, placement, size, lines }) => {
    expect(decide(title, window, fs, placement, true)).toEqual({ size, lines, certain: true });
  });

  it('never shrinks a title that 24 would leave on as many lines (DQ-903)', () => {
    // AUTH-02 and HOME-01 at 393: two lines at 30, two lines at 24, so 30 stays.
    expect(decide(CLAIM, 393, 1, 'page')).toMatchObject({ size: 30 });
    expect(decide(GOLF, 375, 1, 'card')).toMatchObject({ size: 30, lines: 2 });
  });

  it('decides at the width itself, with no kerning slack: the threshold the Blade page uses (ruling 1)', () => {
    // Golf at 393 in a card: 2 lines at 30, and 24 needs more than 353 for one line, so 30 stays, final.
    expect(decide(GOLF, 393, 1, 'card')).toEqual({ size: 30, lines: 2, certain: true });
    expect(shrunkFitsOneLine(GOLF, 353, { low: 1, high: 1 })).toBe(false);
    expect(shrunkFitsOneLine(GOLF, 372, { low: 1, high: 1 })).toBe(true);
    expect(shrunkFitsOneLine(GOLF, 320, { low: 1, high: 1 })).toBe(false);
    // Only Android 14+'s scale range leaves 24 open: one line at 1×, more at 2×.
    expect(shrunkFitsOneLine(GOLF, 372, { low: 1, high: 2 })).toBeNull();
  });

  it('shrinks where a word is wider than the line at the full size and fits at 24, as the Blade page does', () => {
    // At 200 % "Volkswagen" is 390 wide at 60, more than a 360 phone's 320; at 48 it is 312 and fits.
    expect(estimatedTitleWidth('Volkswagen', 60)).toBeGreaterThan(320);
    expect(estimatedTitleWidth('Volkswagen', 48)).toBeLessThanOrEqual(320);
    expect(decide(GOLF, 360, 2, 'page')).toEqual({ size: 24, lines: 3, certain: true });
  });

  it.each`
    name                    | window | fs   | size
    ${'Porsche 911'}        | ${393} | ${2} | ${30}
    ${'Toyota GR86'}        | ${360} | ${2} | ${30}
    ${'Mercedes-Benz W124'} | ${360} | ${1} | ${30}
    ${'Lamborghini Urus'}   | ${393} | ${2} | ${24}
  `('MF-R3-2: "$name" at $window, font scale $fs wraps at its space, every word inside the line ($size)', ({ name, window, fs, size }) => {
    const fit = decide(name, window, fs, 'page');
    expect(fit).toMatchObject({ size, certain: true });
    const width = widthAt(window);
    const text = displayTitleText(name, 'vehicle', size * fs, width);
    for (const word of text.split(' ')) expect(estimatedTitleWidth(word, size * fs)).toBeLessThanOrEqual(width);
  });
});

describe('DisplayTitle', () => {
  it('requires every call site to state its placement (ADR-426 a; the type check runs over the tests)', () => {
    // @ts-expect-error -- placement is required: a display title without it does not compile.
    const missing = <DisplayTitle>Volkswagen Golf GTI</DisplayTitle>;
    expect(missing.props.placement).toBeUndefined();
    const page = <DisplayTitle placement="page">Volkswagen Golf GTI</DisplayTitle>;
    expect(page.props.placement).toBe('page');
  });

  it('sets a car name in display.title, kept whole at its hyphen, model letters and trailing code, never hyphenated', async () => {
    await renderUi(
      <DisplayTitle testID="t" placement="page">
        Mercedes-AMG C 63 S
      </DisplayTitle>,
    );
    const title = screen.getByTestId('t');
    // Without a width no trailing code is bound (ADR-426 c as amended); the model designation stays whole.
    expect(title.props.children).toBe(vehicleNameText('Mercedes-AMG C 63 S'));
    expect(title.props.children).toContain('C\u00a063 S');
    expect(displayTitleText('Mercedes-AMG C 63 S', 'vehicle', 30, 353)).toContain('C\u00a063\u00a0S');
    expect(title.props.android_hyphenationFrequency ?? 'none').toBe('none');
    expect(styleOf()).toMatchObject({ fontFamily: typography.displayTitle.fontFamily, fontSize: typography.displayTitle.fontSize });
  });

  it('asks Android for balanced breaks (ADR-426 c)', async () => {
    const os = Platform.OS;
    Platform.OS = 'android';
    try {
      await renderUi(
        <DisplayTitle testID="t" placement="page">
          {SKYLINE}
        </DisplayTitle>,
      );
      expect(screen.getByTestId('t').props.textBreakStrategy).toBe('balanced');
      // No web-only style reaches native.
      expect((styleOf() as Record<string, unknown>).textWrapStyle).toBeUndefined();
    } finally {
      Platform.OS = os;
    }
  });

  it('page: keeps the size up to two lines and shrinks to 24/28 from a third (ADR-426 a)', async () => {
    await renderUi(
      <DisplayTitle testID="t" placement="page">
        {GOLF}
      </DisplayTitle>,
    );
    await layOut(353, 2);
    expect(paint()).toEqual({ ...FULL, hidden: false });
    await layOut(353, 4);
    const shrunk = styleOf();
    expect({ fontSize: shrunk.fontSize, lineHeight: shrunk.lineHeight }).toEqual(SHRUNK);
    // The role's −1 % tracking at 24.
    expect(shrunk.letterSpacing).toBeCloseTo(-0.01 * typeScale.displayTitle.minSize, 5);
    // At 24 it may take three lines: a title never truncates, and the same width keeps the decision.
    await layOut(353, 3, SHRUNK.lineHeight);
    expect(paint().fontSize).toBe(SHRUNK.fontSize);
    expect(screen.getByTestId('t').props.numberOfLines).toBeUndefined();
    // A wider window decides again (here from a certain estimate: one line at 30).
    await layOut(700, 1, SHRUNK.lineHeight);
    expect(paint()).toEqual({ ...FULL, hidden: false });
  });

  it('card without a width: two counted lines at 30 stay at 30 when 24 takes two lines too (no probe on a linear scale)', async () => {
    await renderUi(
      <DisplayTitle testID="t" placement="card">
        {GOLF}
      </DisplayTitle>,
    );
    // SF-R3-3: without a width it is laid out, not drawn, until it has counted its lines.
    expect(paint()).toEqual({ ...FULL, hidden: true });
    await layOut(353, 2);
    expect(paint()).toEqual({ ...FULL, hidden: false });
    // Its next layout at 30 confirms the two lines: settled, no probe.
    await layOut(353, 2);
    expect(paint()).toEqual({ ...FULL, hidden: false });
  });

  it('card without a width: decides from the estimate after counting when 24 certainly fits one line, without a probe', async () => {
    await renderUi(
      <DisplayTitle testID="t" placement="card">
        {GOLF}
      </DisplayTitle>,
    );
    await layOut(380, 2);
    expect(paint()).toEqual({ ...SHRUNK, hidden: false });
  });

  describe('on Android 14+ at 200 %, where the drawn size lies between 1× and 2×', () => {
    const os = Platform.OS;
    const version = Object.getOwnPropertyDescriptor(Platform, 'Version');
    beforeEach(() => {
      Platform.OS = 'android';
      Object.defineProperty(Platform, 'Version', { configurable: true, get: () => 36 });
      windowOf(412, 2);
    });
    afterEach(() => {
      Platform.OS = os;
      if (version) Object.defineProperty(Platform, 'Version', version);
    });

    it('card: two lines at 30, 24 on one line only at 1×: probes 24 invisibly and keeps it when it takes one line', async () => {
      expect(shrunkFitsOneLine(GOLF, 372, drawnScale(2))).toBeNull();
      await renderUi(
        <DisplayTitle testID="t" placement="card" layoutWidth={372}>
          {GOLF}
        </DisplayTitle>,
      );
      expect(paint()).toEqual({ ...FULL, hidden: true });
      await layOut(372, 2, 41);
      expect(paint()).toEqual({ ...SHRUNK, hidden: true });
      await layOut(372, 1, 33);
      expect(paint()).toEqual({ ...SHRUNK, hidden: false });
    });

    it('card: back to 30 when the probe at 24 still takes two lines (no shrink without a saved line)', async () => {
      await renderUi(
        <DisplayTitle testID="t" placement="card" layoutWidth={372}>
          {GOLF}
        </DisplayTitle>,
      );
      await layOut(372, 2, 41);
      await layOut(372, 2, 33);
      expect(paint()).toEqual({ ...FULL, hidden: false });
      await layOut(372, 2, 41);
      expect(paint()).toEqual({ ...FULL, hidden: false });
    });
  });

  it('counts native lines from the text layout, not the height: three lines at 200 % on Android 14+ shrink (SF-R2-1)', async () => {
    windowOf(393, 2);
    await renderUi(
      <DisplayTitle testID="t" placement="page">
        {GOLF}
      </DisplayTitle>,
    );
    // Android 14+ draws a 34 sp line at about 41 dp at 2.0: three lines are 124 high, and 124 / 68 rounds to 2.
    const box = 124;
    expect(Math.round(box / (LINE * 2))).toBe(2);
    await fireEvent(screen.getByTestId('t'), 'layout', { nativeEvent: { layout: { width: 353, height: box, x: 0, y: 0 } } });
    // The height alone decides nothing on native.
    expect(styleOf().fontSize).toBe(typography.displayTitle.fontSize);
    await fireEvent(screen.getByTestId('t'), 'textLayout', {
      nativeEvent: { lines: [0, 1, 2].map(() => ({ width: 300, height: box / 3, x: 0, y: 0, text: '' })) },
    });
    expect(styleOf().fontSize).toBe(typeScale.displayTitle.minSize);
  });

  it('lets a brand moment hyphenate like copy, without binding codes', async () => {
    await renderUi(
      <DisplayTitle testID="t" kind="copy" placement="page">
        Willkommen im Club
      </DisplayTitle>,
    );
    expect(screen.getByTestId('t')).toHaveTextContent('Willkommen im Club');
    expect(screen.getByTestId('t').props.children).toBe('Willkommen im Club');
    expect(screen.getByTestId('t').props.android_hyphenationFrequency ?? 'normal').not.toBe('none');
  });

  it('draws the skeleton under the same rule and estimate: title.2 line boxes (28) stand in for the shrunk 24/28', () => {
    expect(typography.title2.lineHeight).toBe(SHRUNK.lineHeight);
    expect(displayTitleSkeleton(GOLF, 1, 353, 'page')).toEqual({ variant: 'displayTitle', lines: 2 });
    expect(displayTitleSkeleton(GOLF, 1, 372, 'card')).toEqual({ variant: 'title2', lines: 1 });
    expect(displayTitleSkeleton(SKYLINE, 1, 353, 'card')).toEqual({ variant: 'displayTitle', lines: 1 });
    expect(displayTitleSkeleton(LONG_NAME, 1, 353, 'page')).toEqual({ variant: 'title2', lines: 3 });
  });
});

describe('DisplayTitle, the first frame (MF-R2-1, ADR-425)', () => {
  /** The seeded featured build of HOME-01. */
  const SEEDED = { ...GTI, full_title: GOLF };

  it('estimates from the shipped font: the advances of Archivo SemiExpanded 600 with the −1 % tracking', () => {
    // "R34": R 819, 3 669, 4 657 (fontTools, unitsPerEm 1000), each −0.01 em of tracking; no positive kerning between them.
    expect(estimatedTitleWidth('R34', 30)).toBeCloseTo((0.819 + 0.669 + 0.657 - 0.03) * 30, 6);
    // The word joiner of "GT-R" draws nothing; U+00A0 is the space's advance.
    expect(estimatedTitleWidth(vehicleNameText('GT-R'), 30)).toBeCloseTo(estimatedTitleWidth('GT-R', 30), 6);
    expect(estimatedTitleWidth('C\u00a063', 30)).toBeCloseTo(estimatedTitleWidth('C 63', 30), 6);
  });

  it('adds the font’s positive pair kerning, so the estimate is never narrower than the screen draws it (SF-R3-2)', () => {
    // GPOS PairPos of ArchivoSemiExpanded-SemiBold.ttf (fontTools 4.68, DFLT/dflt kern lookup 0), in font units: digit–hyphen
    // and hyphen–digit up to +40, A/ K/ L/ +35, f) f7 +25, f' +10, t) +8, 0' +5. Written out from the font, not from the table.
    const FONT = { '5-': 40, '-1': 40, '-5': 40, '9-': 40, '6-': 20, '8-': 30, '-9': 20, '2-': 10, 'A/': 35, 'K/': 35, 'L/': 35, 'f)': 25, f7: 25, "f'": 10, 't)': 8, "0'": 5 };
    for (const [pair, units] of Object.entries(FONT)) expect(DISPLAY_TITLE_KERNING[pair]).toBe(units / 1000);
    // Every pair is above 0 and joins two characters of the advance table.
    for (const [pair, em] of Object.entries(DISPLAY_TITLE_KERNING)) {
      expect(em).toBeGreaterThan(0);
      expect([...pair].every((char) => DISPLAY_TITLE_ADVANCES[char] !== undefined)).toBe(true);
    }
    const tracked = (chars: string) => [...chars].reduce((sum, char) => sum + (DISPLAY_TITLE_ADVANCES[char] as number) - 0.01, 0);
    // "MX-5": M 978, X 800, - 375, 5 668 and the "-5" pair, +40.
    expect(estimatedTitleWidth('MX-5', 30)).toBeCloseTo((0.978 + 0.8 + 0.375 + 0.668 - 0.04 + 0.04) * 30, 6);
    // "2.5-16" carries two pairs ("5-" and "-1"): +0.08 em, 2.4 at 30, more than the old 2 px rounding slack.
    expect(estimatedTitleWidth('2.5-16', 30) - tracked('2.5-16') * 30).toBeCloseTo(0.08 * 30, 6);
    // The word joiner of "GT-R" draws nothing; the shaper kerns across it, and so does the estimate ("T-5R").
    expect(estimatedTitleWidth(vehicleNameText('T-5R'), 30)).toBeCloseTo(estimatedTitleWidth('T-5R', 30), 6);
    expect(estimatedTitleWidth('T-5R', 30) - tracked('T-5R') * 30).toBeCloseTo(0.04 * 30, 6);
  });

  it.each([393, 375, 360])('HOME-01 at %i dp: the seeded two-line title stacks under a clear photo, at 30/34, on its first frame (ADR-426 d)', async (window) => {
    windowOf(window);
    const { gutter } = breakpointFor(window);
    expect(featuredHeroLayout({ title: GOLF, width: window, bleed: true, gutter, fontScale: 1, fontStacked: false })).toEqual({
      stacked: true,
      textWidth: window - 2 * gutter,
      placement: 'page',
    });
    await renderUi(<FeaturedHero vehicle={SEEDED} width={window} bleed gutter={gutter} onOpen={jest.fn()} testID="HOME-01.featured" />);
    // No layout event has fired: this is the first frame. Nothing sits on the photo.
    expect(screen.queryByTestId('HOME-01.featured.band')).toBeNull();
    expect(screen.getByTestId('HOME-01.featured.below')).toBeTruthy();
    expect(paint('HOME-01.featured.title')).toEqual({ ...FULL, hidden: false });
    // Its own layout agrees, so nothing moves.
    await layOut(window - 2 * gutter, 2, LINE, 'HOME-01.featured.title');
    expect(paint('HOME-01.featured.title')).toEqual({ ...FULL, hidden: false });
  });

  it('HOME-01 at 412 dp: the seeded title fits one line at 24, so it stays on the photo at 24/28 from its first frame', async () => {
    windowOf(412);
    const { gutter } = breakpointFor(412);
    expect(certainlyOneLine(GOLF, 412 - 2 * gutter, { low: 1, high: 1 })).toBe(true);
    await renderUi(<FeaturedHero vehicle={SEEDED} width={412} bleed gutter={gutter} onOpen={jest.fn()} testID="HOME-01.featured" />);
    expect(screen.getByTestId('HOME-01.featured.band')).toBeTruthy();
    expect(screen.queryByTestId('HOME-01.featured.below')).toBeNull();
    expect(paint('HOME-01.featured.title')).toEqual({ ...SHRUNK, hidden: false });
  });

  it.each([393, 360])('HOME-01 at %i dp: a title on one line stays on the photo at 30/34 on its first frame', async (window) => {
    windowOf(window);
    const { gutter } = breakpointFor(window);
    await renderUi(<FeaturedHero vehicle={M4} width={window} bleed gutter={gutter} onOpen={jest.fn()} testID="HOME-01.featured" />);
    expect(screen.getByTestId('HOME-01.featured.band')).toBeTruthy();
    expect(paint('HOME-01.featured.title')).toEqual({ ...FULL, hidden: false });
  });

  it('HOME-01 inside the column (tablet, desktop): the band stays on the photo and the title is a card title', () => {
    expect(featuredHeroLayout({ title: GOLF, width: 640, bleed: false, gutter: 24, fontScale: 1, fontStacked: false })).toMatchObject({
      stacked: false,
      placement: 'card',
    });
    // From 200 % font every hero stacks.
    expect(featuredHeroLayout({ title: 'Golf', width: 640, bleed: false, gutter: 24, fontScale: 2, fontStacked: true })).toMatchObject({ stacked: true, placement: 'card' });
  });

  it.each`
    window | stacked
    ${360} | ${true}
    ${375} | ${true}
    ${393} | ${true}
    ${412} | ${false}
  `('HOME-01 skeleton at $window dp decides like the loaded hero: stacked $stacked', async ({ window, stacked }) => {
    windowOf(window);
    const { gutter } = breakpointFor(window);
    await renderUi(
      <Skeleton testID="s">
        <FeaturedHeroSkeleton width={window} bleed gutter={gutter} />
      </Skeleton>,
    );
    expect(screen.queryByTestId('HOME-01.skeleton.featured.below') !== null).toBe(stacked);
  });

  it('NH-R3-2: the HOME-01 skeleton decides from the cached featured title when there is one, else from the typical title', async () => {
    windowOf(393);
    const { gutter } = breakpointFor(393);
    const client = new QueryClient();
    client.setQueryData(homeKeys.featured(publicViewerNow()), [{ source: 'editorial', vehicle: M4 }]);
    const skeleton = (
      <QueryClientProvider client={client}>
        <Skeleton testID="s">
          <FeaturedHeroSkeleton width={393} bleed gutter={gutter} />
        </Skeleton>
      </QueryClientProvider>
    );
    const { unmount } = await renderUi(skeleton);
    // The cached title takes one line on the band: no block under the photo, as the loaded hero.
    expect(screen.queryByTestId('HOME-01.skeleton.featured.below')).toBeNull();
    await unmount();
    client.clear();
    await renderUi(skeleton);
    expect(screen.getByTestId('HOME-01.skeleton.featured.below')).toBeTruthy();
  });

  it.each([393, 360])('VEH-01 at %i dp: the title paints at its final size on its first frame', async (window) => {
    windowOf(window);
    const layoutWidth = profileSummaryWidth('phone', window, breakpointFor(window).gutter);
    const { unmount } = await renderUi(<ProfileSummary vehicle={{ ...R34, owner: null }} routeId="VEH-01" identity="canvas" layoutWidth={layoutWidth} />);
    // "Skyline GT-R R34": two lines at most, so 30/34.
    expect(paint('VEH-01.title')).toEqual({ ...FULL, hidden: false });
    await unmount();
    // A name that takes three lines at 30: 24/28 from the first frame.
    await renderUi(<ProfileSummary vehicle={{ ...R34, owner: null, title: LONG_NAME }} routeId="VEH-01" identity="canvas" layoutWidth={layoutWidth} />);
    expect(paint('VEH-01.title')).toEqual({ ...SHRUNK, hidden: false });
  });

  it('VEH-01/GAR-02: a page title on the hero at every width (DQ-1047/1048)', async () => {
    expect(summaryTitlePlacement('desktop')).toBe('page');
    expect(summaryTitlePlacement('tablet')).toBe('page');
    expect(summaryTitlePlacement('phone')).toBe('page');
    windowOf(393);
    await renderUi(<VehicleIdentity vehicle={{ ...R34, owner: null }} routeId="VEH-01" tone="photo" layoutWidth={heroIdentityWidth('phone', 393, 20)} />);
    expect(paint('VEH-01.title')).toEqual({ ...FULL, hidden: false });
  });

  it('takes the estimate’s size as final: its own counted lines never override it (one source of decision, SF-R3-1)', async () => {
    // "Mercedes-AMG C 63 S" in a 353 card: 2 lines at 30 by the estimate, 1 at 24, so 24, as the Blade page decides it.
    expect(
      estimateDisplayTitle({ name: 'Mercedes-AMG C 63 S', kind: 'vehicle', width: 353, fontSize: 30, placement: 'card', scale: { low: 1, high: 1 } }),
    ).toMatchObject({ shrunk: true, lines: 1, certain: true });
    await renderUi(
      <DisplayTitle testID="t" placement="card" layoutWidth={353}>
        Mercedes-AMG C 63 S
      </DisplayTitle>,
    );
    expect(paint()).toEqual({ ...SHRUNK, hidden: false });
    // A screen that kerns it tighter reports other lines: the size stays.
    await layOut(353, 2, SHRUNK.lineHeight);
    expect(paint()).toEqual({ ...SHRUNK, hidden: false });
  });

  it('SF-R3-3: without a width it is laid out invisibly until it has counted its lines, never painted at a size it may drop', async () => {
    await renderUi(
      <DisplayTitle testID="t" placement="page">
        {LONG_NAME}
      </DisplayTitle>,
    );
    expect(paint()).toEqual({ ...FULL, hidden: true });
    await layOut(353, 4);
    expect(paint()).toEqual({ ...SHRUNK, hidden: false });
  });

  it('MF-R3-1: a new width remounts the measured text, so an ambiguous title is never left waiting for an event that does not come', async () => {
    const os = Platform.OS;
    const version = Object.getOwnPropertyDescriptor(Platform, 'Version');
    Platform.OS = 'android';
    Object.defineProperty(Platform, 'Version', { configurable: true, get: () => 36 });
    try {
      windowOf(412, 2);
      const name = 'BMW M4 Competition';
      const at = (width: number) => estimateDisplayTitle({ name, kind: 'vehicle', width, fontSize: 30, placement: 'page', scale: drawnScale(2) });
      expect(at(400).certain).toBe(true);
      expect(at(353).certain).toBe(false);
      const providers = (width: number) => (
        <GestureHandlerRootView>
          <ThemeProvider>
            <DisplayTitle testID="t" placement="page" layoutWidth={width}>
              {name}
            </DisplayTitle>
          </ThemeProvider>
        </GestureHandlerRootView>
      );
      const view = await renderUi(
        <DisplayTitle testID="t" placement="page" layoutWidth={400}>
          {name}
        </DisplayTitle>,
      );
      expect(paint()).toEqual({ ...FULL, hidden: false });
      const first = screen.getByTestId('t');
      // The same width: the same paragraph.
      await view.rerender(providers(400));
      expect(screen.getByTestId('t')).toBe(first);
      await view.rerender(providers(353));
      // A new paragraph (Fabric sends its first textLayout even with the lines unchanged), laid out invisibly.
      expect(screen.getByTestId('t')).not.toBe(first);
      expect(paint().hidden).toBe(true);
      // Its first event releases it.
      await fireEvent(screen.getByTestId('t'), 'textLayout', {
        nativeEvent: { lines: [0, 1].map(() => ({ width: 300, height: 41, x: 0, y: 0, text: '' })) },
      });
      expect(paint()).toEqual({ ...FULL, hidden: false });
    } finally {
      Platform.OS = os;
      if (version) Object.defineProperty(Platform, 'Version', version);
    }
  });

  it('MF-R3-2: "Porsche 911" at 393/fs 2 and "Mercedes-Benz W124" at 360/fs 1 are never drawn with a word wider than the line', async () => {
    const cases = [
      { name: 'Porsche 911', window: 393, fs: 2 },
      { name: 'Mercedes-Benz W124', window: 360, fs: 1 },
      { name: 'Toyota GR86', window: 360, fs: 2 },
    ];
    for (const { name, window, fs } of cases) {
      windowOf(window, fs);
      const width = window - 2 * breakpointFor(window).gutter;
      const { unmount } = await renderUi(
        <DisplayTitle testID="t" placement="page" layoutWidth={width}>
          {name}
        </DisplayTitle>,
      );
      const drawn = paint();
      expect(drawn.hidden).toBe(false);
      const text = String(screen.getByTestId('t').props.children);
      expect(text).not.toContain('\u00a0');
      // Native draws the style's size times the OS font scale (linear here).
      for (const word of text.split(' ')) expect(estimatedTitleWidth(word, (drawn.fontSize as number) * fs)).toBeLessThanOrEqual(width);
      await unmount();
    }
  });

  it('still binds "Skyline GT-R R34" and "Volkswagen Golf GTI VIII (CD)" where the pair fits', async () => {
    windowOf(393);
    const { unmount } = await renderUi(
      <DisplayTitle testID="t" placement="page" layoutWidth={353}>
        {SKYLINE}
      </DisplayTitle>,
    );
    expect(screen.getByTestId('t').props.children).toBe('Skyline GT-\u2060R\u00a0R34');
    await unmount();
    await renderUi(
      <DisplayTitle testID="t" placement="page" layoutWidth={353}>
        {GOLF}
      </DisplayTitle>,
    );
    expect(screen.getByTestId('t').props.children).toBe('Volkswagen Golf GTI VIII\u00a0(CD)');
  });

  it('on Android 14+ at 200 %, waits for its lines when the non-linear scale could go either way', async () => {
    const os = Platform.OS;
    const version = Object.getOwnPropertyDescriptor(Platform, 'Version');
    Platform.OS = 'android';
    Object.defineProperty(Platform, 'Version', { configurable: true, get: () => 36 });
    try {
      windowOf(393, 2);
      // In 353 this name takes two lines at 30 sp drawn at 1×, more at a linear 60: the estimate cannot tell.
      await renderUi(
        <DisplayTitle testID="t" placement="page" layoutWidth={353}>
          {GOLF}
        </DisplayTitle>,
      );
      expect(paint().hidden).toBe(true);
      await layOut(353, 3, 41);
      expect(paint()).toMatchObject({ fontSize: typeScale.displayTitle.minSize, hidden: false });
    } finally {
      Platform.OS = os;
      if (version) Object.defineProperty(Platform, 'Version', version);
    }
  });
});
