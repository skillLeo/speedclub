import { act, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { profileSummaryWidth } from '@/features/vehicle/layout';
import { breakpointFor, hydrateThemePreference, maxFontScale, space, themes, ThemeProvider, typography } from '@/theme';
import { setReducedMotionPreview } from '@/ui/motion';
import { __resetOdometerSessionForTests } from '@/ui/motion/OdometerNumber';
import { SpecStrip } from '@/ui/SpecStrip';

import { flat, renderUi, textOf } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

/** FS-3's R34 in the 2.0 anatomy (09 §5 SpecStrip): data label, numeral with unit, provenance. */
const items = [
  { value: '500', unit: 'PS', label: 'Leistung', provenance: 'Prüfstand' },
  { value: '540', unit: 'Nm', label: 'Drehmoment', provenance: 'Prüfstand' },
  { value: '2002', label: 'Baujahr' },
  { value: 'AWD', label: 'Antrieb' },
];
/** One-line widths as a phone draws them at 1.0 (numerals from the font's advances, Inter as Chromium measures it). */
const DRAWN = { '500': 57, '540': 57, '2002': 76, AWD: 76, PS: 15, Nm: 19, Leistung: 62, Drehmoment: 86, Baujahr: 57, Antrieb: 52, Prüfstand: 62 };

const rowsOf = (testID: string) => screen.getByTestId(testID).children;
/** The providers of renderUi, for a rerender that mounts a new strip. */
const wrapped = (element: ReactElement) => (
  <GestureHandlerRootView>
    <ThemeProvider>{element}</ThemeProvider>
  </GestureHandlerRootView>
);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
  __resetOdometerSessionForTests();
});
afterEach(async () => {
  await act(async () => setReducedMotionPreview(null));
});

/** The strip's width and the one-line width of each text, as onLayout reports them on screen. */
async function layOut(width: number, widths: Readonly<Record<string, number>>) {
  // fireEvent is async in RNTL 14 and wraps act itself; an outer act made them overlap.
  await fireEvent(screen.getByTestId('s'), 'layout', { nativeEvent: { layout: { width, height: 0, x: 0, y: 0 } } });
  for (const text of screen.getAllByText(/.+/, { includeHiddenElements: true })) {
    const content = String(text.props.children);
    if (widths[content] !== undefined && text.props.onLayout) {
      await fireEvent(text, 'layout', { nativeEvent: { layout: { width: widths[content], height: 0, x: 0, y: 0 } } });
    }
  }
}

describe('SpecStrip 2.0', () => {
  it('has no ground (ADR-431 b), four equal start-aligned columns in one row with 16 vertical and 12 side padding', async () => {
    // Wide enough for all four in hero.numeral (N1b: the columns come from a real width, never an unlimited one).
    await renderUi(<SpecStrip items={items} layoutWidth={600} testID="s" />);
    const strip = flat(screen.getByTestId('s').props.style);
    expect(strip.backgroundColor).toBeUndefined();
    expect(strip.borderRadius).toBeUndefined();
    expect(rowsOf('s')).toHaveLength(1);
    // The first cell of a row starts on the text edge; the others keep 12 after their hairline.
    expect(flat(screen.getByTestId('s.0').props.style).paddingLeft).toBe(0);
    const cell = flat(screen.getByTestId('s.3').props.style);
    // Equal shares of the row, padding inside, as the public page's grid.
    expect(cell.width).toBe('25%');
    expect(cell.alignItems).toBe('flex-start');
    expect(cell.paddingVertical).toBe(space[16]);
    // DQ-801: 4 let the numerals touch the hairlines.
    expect(cell.paddingHorizontal).toBe(space[12]);
    expect(cell.gap).toBe(space[4]);
  });

  it('sets the data label in label.caps, the value in hero.numeral on the page with its label.unit unit, the provenance in caption', async () => {
    await renderUi(<SpecStrip items={items} layoutWidth={600} testID="s" />);
    const label = flat(screen.getByTestId('s.1.label').props.style);
    expect(label.fontSize).toBe(typography.labelCaps.fontSize);
    expect(textOf(screen.getByTestId('s.1.label').props.style).textTransform).toBe('uppercase');
    expect(label.color).toBe(themes.carbon.color.text.secondary);
    expect(flat(screen.getByTestId('s.1.value').props.style).fontSize).toBe(typography.heroNumeral.fontSize);
    const unit = flat(screen.getByTestId('s.1.unit').props.style);
    expect(unit.fontSize).toBe(typography.labelUnit.fontSize);
    // ADR-420: "Nm" keeps its case.
    expect(textOf(screen.getByTestId('s.1.unit').props.style).textTransform).toBeUndefined();
    const provenance = flat(screen.getByTestId('s.1.provenance').props.style);
    expect(provenance.fontSize).toBe(typography.caption.fontSize);
    expect(provenance.color).toBe(themes.carbon.color.text.tertiary);
    // A column without a unit or a provenance draws neither.
    expect(screen.queryByTestId('s.2.unit')).toBeNull();
    expect(screen.queryByTestId('s.2.provenance')).toBeNull();
    expect(flat(screen.getByTestId('s.0').props.style).borderLeftWidth).toBeUndefined();
    expect(flat(screen.getByTestId('s.1').props.style).borderLeftColor).toBe(themes.carbon.color.border.subtle);
  });

  it('reads each cell as one sentence on native: name, value with unit, provenance', async () => {
    await renderUi(<SpecStrip items={items} layoutWidth={600} testID="s" />);
    expect(screen.getByTestId('s.1').props['aria-label']).toBe('Drehmoment, 540 Nm, Prüfstand');
    expect(screen.getByTestId('s.2').props['aria-label']).toBe('Baujahr, 2002');
  });

  it('becomes the 2×2 grid on a phone, where a quarter cannot hold DREHMOMENT', async () => {
    await renderUi(<SpecStrip items={items} layoutWidth={350} testID="s" />);
    expect(rowsOf('s')).toHaveLength(2);
    expect(flat(screen.getByTestId('s.2').props.style).borderLeftWidth).toBeUndefined();
    expect(flat(screen.getByTestId('s.3').props.style).borderLeftColor).toBe(themes.carbon.color.border.subtle);
  });

  it('becomes one column at 200 % on a phone, so no label or number breaks or clips', async () => {
    dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
    await renderUi(<SpecStrip items={items} testID="s" />);
    await layOut(320, {});
    expect(rowsOf('s')).toHaveLength(4);
    expect(screen.getByText('AWD')).toBeTruthy();
  });

  it('has no fixed height on a text container', async () => {
    await renderUi(<SpecStrip items={items} testID="s" />);
    expect(flat(screen.getByTestId('s').props.style).height).toBeUndefined();
    expect(flat(screen.getByTestId('s.0').props.style).height).toBeUndefined();
  });

  it('keeps the estimate’s columns when the screen measures narrower: the public page decides the same (ADR-422 d)', async () => {
    await renderUi(<SpecStrip items={items} testID="s" />);
    // 400 is below the 451 the estimate needs for four: two columns, even though these drawn widths would fit four.
    await layOut(400, { ...DRAWN, Drehmoment: 60, Leistung: 50 });
    expect(rowsOf('s')).toHaveLength(2);
  });

  it('takes columns away once a measured line would not fit, so a numeral never runs into a hairline (DQ-801)', async () => {
    await renderUi(<SpecStrip items={items} testID="s" />);
    await layOut(600, DRAWN);
    expect(rowsOf('s')).toHaveLength(1);
    // A font that draws wider than its table: DREHMOMENT at 130 cannot sit in a quarter of 600.
    await layOut(600, { Drehmoment: 130 });
    expect(rowsOf('s')).toHaveLength(2);
  });

  it('measures one-line copies outside the strip, hidden from readers, so the strip reads each text once in reading order', async () => {
    await renderUi(<SpecStrip items={items} testID="s" />);
    expect(screen.getAllByText('2002')).toHaveLength(1);
    expect(screen.getAllByText('2002', { includeHiddenElements: true })).toHaveLength(2);
    expect(screen.getByTestId('s')).toHaveTextContent('Leistung500PSPrüfstandDrehmoment540NmPrüfstandBaujahr2002AntriebAWD');
  });

  it('keeps the hero numeral cap of 1.3', async () => {
    await renderUi(<SpecStrip items={items} testID="s" />);
    expect(screen.getByText('2002').props.maxFontSizeMultiplier).toBe(maxFontScale.heroNumeralS);
  });

  describe('SM6 odometer (once per vehicle per session)', () => {
    it('rolls the numerals the first time a vehicle shows, and never again', async () => {
      const view = await renderUi(<SpecStrip key="a" items={items} layoutWidth={600} rollKey="veh-1" testID="s" />);
      expect(screen.getByTestId('s.0.roll')).toBeTruthy();
      // AWD has no digit: it stands.
      expect(screen.queryByTestId('s.3.roll')).toBeNull();
      expect(screen.getByTestId('s.0.roll').props['aria-label']).toBe('500');
      // A new strip for the same vehicle (the screen opened again).
      await view.rerender(wrapped(<SpecStrip key="b" items={items} layoutWidth={600} rollKey="veh-1" testID="s" />));
      expect(screen.queryByTestId('s.0.roll')).toBeNull();
      expect(screen.getByTestId('s.0.value')).toHaveTextContent('500');
    });

    it('never rolls under reduced motion or without a key', async () => {
      await act(async () => setReducedMotionPreview(true));
      const view = await renderUi(<SpecStrip key="a" items={items} layoutWidth={600} rollKey="veh-2" testID="s" />);
      expect(screen.queryByTestId('s.0.roll')).toBeNull();
      await act(async () => setReducedMotionPreview(null));
      await view.rerender(wrapped(<SpecStrip key="b" items={items} layoutWidth={600} testID="s" />));
      expect(screen.queryByTestId('s.0.roll')).toBeNull();
    });
  });

  describe('first frame (N1b, APK Build 9)', () => {
    /** FS-3's R34 values: one row of four broke them inside the number ("20/02", "AW/D") until the strip measured itself. */
    const phoneWidth = (window: number) => profileSummaryWidth('phone', window, breakpointFor(window).gutter);
    const opacityOf = (testID: string) => flat(screen.getByTestId(testID).props.style).opacity;

    it.each([360, 390, 430])('at %i dp with the width VEH-01 lays it out at: the 2×2 grid before any layout, visible', async (window) => {
      dimensions.mockReturnValue({ width: window, height: 800, scale: 2, fontScale: 1 });
      await renderUi(<SpecStrip items={items} layoutWidth={phoneWidth(window)} testID="s" />);
      // No onLayout has fired yet: this is the first frame.
      expect(rowsOf('s')).toHaveLength(2);
      expect(opacityOf('s')).toBeUndefined();
      // And the measured layout keeps it (no jump): the widths the Android 16 emulator measured at 1.0.
      await layOut(phoneWidth(window), DRAWN);
      expect(rowsOf('s')).toHaveLength(2);
    });

    it.each([360, 390, 430])('at %i dp without a width: never more than two columns, and invisible until it is known', async (window) => {
      dimensions.mockReturnValue({ width: window, height: 800, scale: 2, fontScale: 1 });
      await renderUi(<SpecStrip items={items} testID="s" />);
      expect(rowsOf('s').length).toBeGreaterThanOrEqual(2);
      expect(opacityOf('s')).toBe(0);
      // Laid out while hidden, so its texts stay readable once it shows.
      expect(flat(screen.getByTestId('s').props.style).display).toBeUndefined();
      await layOut(phoneWidth(window), {});
      expect(opacityOf('s')).toBeUndefined();
      expect(rowsOf('s')).toHaveLength(2);
    });

    it('at 2.0 with the width: one column on the first frame already', async () => {
      dimensions.mockReturnValue({ width: 360, height: 640, scale: 2, fontScale: 2 });
      await renderUi(<SpecStrip items={items} layoutWidth={phoneWidth(360)} testID="s" />);
      expect(rowsOf('s')).toHaveLength(4);
    });

    it('takes its own measured width over the parent’s once it has one', async () => {
      await renderUi(<SpecStrip items={items} layoutWidth={320} testID="s" />);
      expect(rowsOf('s')).toHaveLength(2);
      await layOut(800, {});
      expect(rowsOf('s')).toHaveLength(1);
    });
  });
});
