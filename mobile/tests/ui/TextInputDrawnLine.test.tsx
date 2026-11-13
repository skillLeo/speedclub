/**
 * N12 (APK Build 12, DQ-133, DQ-153): a multiline field caps its text box in whole lines as they are DRAWN. React Native 0.88
 * converts the input's line height with `TypedValue.applyDimension(COMPLEX_UNIT_SP)` on Android (TextAttributes
 * .effectiveLineHeight → PixelUtil.toPixelFromSP), which is non-linear from Android 14: the 24 of `input` is drawn at 36 at
 * font scale 2.0. The field measures one line of its own role and sizes the cap from it, so no cut line ever shows.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, useWindowDimensions, type TextStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { bioRowsFor } from '@/features/profile/screens/EditProfileScreen';
import { hydrateThemePreference, size, space, ThemeProvider, typography } from '@/theme';
import { Composer } from '@/ui/Composer';
import { linearInputLine, multilineMaxHeight, resolveRows, TEXT_INPUT_ROLE, TextInput } from '@/ui/TextInput';

import { measureOf, queryMeasureOf, renderUi } from './helpers';

// EditProfileScreen (for bioRowsFor) imports the API and session stack.
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 360, height: 640, scale: 2, fontScale: 2 })),
}));

const dimensions = useWindowDimensions as jest.Mock;
const originalOS = Platform.OS;
const BIO =
  'Schrauber aus Stuttgart.\nR34 seit 2021 in der Garage.\nZiel: ein Auto zum Fahren.\nTreffen gern am Wochenende.';
/** The emulator of Build 12: 360×640 dp, font scale 2.0, a line of `input` drawn at 72 px = 36 dp. */
const DRAWN_AT_2 = 36;
/** What Build 12 shipped: 24 × rows in unscaled dp on native. */
const OLD_LINE = typography.input.lineHeight;

const styleOf = (testID: string, hidden = false) =>
  (StyleSheet.flatten(screen.getByTestId(testID, { includeHiddenElements: hidden }).props.style as TextStyle) ?? {}) as TextStyle &
    Record<string, unknown>;

async function measure(testID: string, height: number) {
  await fireEvent(measureOf(testID, 'line'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 300, height } },
  });
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'android';
});
afterEach(() => {
  Platform.OS = originalOS;
  dimensions.mockReturnValue({ width: 360, height: 640, scale: 2, fontScale: 2 });
});

describe('the pure rules', () => {
  it.each([24, 30, 36, 37.5, 48])('a cap is a whole number of %s-high lines', (line) => {
    for (const rows of [1, 3, 5, 7]) {
      const cap = multilineMaxHeight(line, rows);
      expect(cap / line).toBe(rows);
    }
  });

  it('maxRows as a function gets the drawn line and is floored to whole lines, at least one', () => {
    expect(resolveRows(5, 36)).toBe(5);
    expect(resolveRows((line) => 256 / line, 36)).toBe(7);
    expect(resolveRows(() => 0.4, 36)).toBe(1);
  });

  it('DQ-133 at 360×640 dp × 2.0: the bio grows to 7 drawn lines (252 of the 256 that 40 % allows), not 5 × 24 = 120', () => {
    const rows = bioRowsFor(640, DRAWN_AT_2);
    expect(rows).toBe(7);
    const cap = multilineMaxHeight(DRAWN_AT_2, rows);
    expect(cap).toBe(252);
    expect(cap).toBeLessThanOrEqual(640 * 0.4);
    expect(cap + DRAWN_AT_2).toBeGreaterThan(640 * 0.4);
    expect(cap).toBeGreaterThanOrEqual(OLD_LINE * 5);
  });

  it('DQ-133 never gives fewer than 5 rows, and at 1.0 the share is the same rule (640 × 0.4 / 24 → 10)', () => {
    expect(bioRowsFor(320, DRAWN_AT_2)).toBe(5);
    expect(bioRowsFor(640, 24)).toBe(10);
  });
});

describe('TextInput (multiline) on Android 14+ at font scale 2.0', () => {
  it('measures one line of the field’s own role, invisible and hidden from screen readers', async () => {
    await renderUi(<TextInput label="Über dich" multiline value={BIO} onChangeText={jest.fn()} testID="bio" />);
    const line = measureOf('bio', 'line');
    const lineStyle = (StyleSheet.flatten(line.props.style as TextStyle) ?? {}) as TextStyle & Record<string, unknown>;
    const field = styleOf('bio');
    for (const key of ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'includeFontPadding'] as const) {
      expect(lineStyle[key]).toEqual(field[key]);
    }
    expect(TEXT_INPUT_ROLE).toBe('input');
    // The OS scales it like the field: no fixed scale, no cap, no hyphenation.
    expect(line.props.allowFontScaling).not.toBe(false);
    expect(line.props.maxFontSizeMultiplier).toBeUndefined();
    expect(line.props.android_hyphenationFrequency).toBe('none');
    expect(line.props['aria-hidden']).toBe(true);
    expect(line.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(lineStyle.position).toBe('absolute');
    expect(lineStyle.opacity).toBe(0);
  });

  it('caps the text box at whole drawn lines: 5 × 36 instead of 5 × 24, the 12 above and below outside it', async () => {
    await renderUi(<TextInput label="Über dich" multiline maxRows={5} value={BIO} onChangeText={jest.fn()} testID="bio" />);
    // Before the first measurement the linear line stands in (exact on iOS and below Android 14).
    expect(styleOf('bio').maxHeight).toBe(linearInputLine(2) * 5);
    await measure('bio', DRAWN_AT_2);
    const cap = styleOf('bio').maxHeight as number;
    expect(cap).toBe(180);
    expect(cap % DRAWN_AT_2).toBe(0);
    expect(cap).toBeGreaterThanOrEqual(OLD_LINE * 5);
    const box = screen.getByTestId('bio.field').children[0];
    expect(StyleSheet.flatten(box && typeof box !== 'string' ? box.props.style : undefined).paddingVertical).toBe(space[12]);
  });

  it('PROF-03 bio at 360×640 × 2.0: the share rule and the cap use the same drawn line (7 × 36 + 2 × 12)', async () => {
    await renderUi(
      <TextInput
        label="Über dich"
        multiline
        maxRows={(line) => bioRowsFor(640, line)}
        value={BIO}
        onChangeText={jest.fn()}
        testID="bio"
      />,
    );
    await measure('bio', DRAWN_AT_2);
    const cap = styleOf('bio').maxHeight as number;
    expect(cap).toBe(7 * DRAWN_AT_2);
    expect(cap).toBeGreaterThanOrEqual(OLD_LINE * 5);
    // The field around it: the text box plus its padding, still within 40 % of the window plus that padding.
    expect(cap + 2 * space[12]).toBeLessThanOrEqual(640 * 0.4 + 2 * space[12]);
  });

  it('remembers the drawn line per font scale, so a later field starts at the measured line', async () => {
    await renderUi(<TextInput label="Notizen" multiline maxRows={4} testID="notes" />);
    expect(styleOf('notes').maxHeight).toBe(4 * DRAWN_AT_2);
  });

  it('follows a live font-scale change with a new measurement', async () => {
    const field = (label: string) => (
      <GestureHandlerRootView>
        <ThemeProvider>
          <TextInput label={label} multiline maxRows={4} testID="n" />
        </ThemeProvider>
      </GestureHandlerRootView>
    );
    const view = await renderUi(<TextInput label="Notizen" multiline maxRows={4} testID="n" />);
    dimensions.mockReturnValue({ width: 360, height: 640, scale: 2, fontScale: 1.5 });
    await act(async () => view.rerender(field('Notizen')));
    // Not measured at 1.5 yet: the linear line.
    expect(styleOf('n').maxHeight).toBe(linearInputLine(1.5) * 4);
    await measure('n', 28);
    expect(styleOf('n').maxHeight).toBe(4 * 28);
  });

  it('a single-line field has no measuring line and no cap', async () => {
    await renderUi(<TextInput label="Stadt" testID="city" />);
    expect(queryMeasureOf('city', 'line')).toBeNull();
    expect(styleOf('city').maxHeight).toBeUndefined();
  });
});

describe('Composer on Android 14+ at font scale 2.0 (A7 note, code review round 3)', () => {
  it('caps its text at whole drawn lines with the same measuring line: 5 × 36, not 5 × 24 × 2 in unscaled dp', async () => {
    dimensions.mockReturnValue({ width: 360, height: 640, scale: 2, fontScale: 2.5 });
    await renderUi(<Composer value={BIO} onChangeText={jest.fn()} onSend={jest.fn()} placeholder="Nachricht schreiben" sendLabel="Senden" testID="c" />);
    const line = measureOf('c', 'line');
    expect(line.props['aria-hidden']).toBe(true);
    // Not measured at 2.5 yet: the linear line stands in.
    expect(styleOf('c.input').maxHeight).toBe(linearInputLine(2.5) * size.composerMaxLines);
    // Android 14+ draws the 24 sp line at 40 dp at 2.5: the old cap (24 × 2.5 × 5 = 300) ended 20 into the 8th line.
    await measure('c', 40);
    const cap = styleOf('c.input').maxHeight as number;
    expect(cap).toBe(40 * size.composerMaxLines);
    expect(cap % 40).toBe(0);
  });
});
