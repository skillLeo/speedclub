/**
 * Client round 7, item 2 (R7-2): "make the car data preview text in the beginning (Leistung, Drehmoment, …) just a little bit bigger on
 * phone, so just the text, e.g. Leistung 150 PS". On a phone the SpecStrip's value takes one numeral step up (hero.numeral.xs 32 →
 * hero.numeral.s 40) and its data label and unit one Inter step up (label.caps / label.unit 11 → caption 12, the label still in
 * capitals). Tablet and desktop keep their roles. The fit rule still holds at 360 and at 200 %: the strip wraps into the 2×2 grid or
 * one column, never clips.
 */
import { screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { breakpointFor, hydrateThemePreference, maxFontScale, typography } from '@/theme';
import { SpecStrip } from '@/ui/SpecStrip';
import {
  estimatedSpecContentWidths,
  estimatedSpecGridWidths,
  estimatedSpecStripColumns,
  fitsColumns,
  specStripLabelVariant,
  specStripNumeralVariant,
  specStripType,
  specStripUnitVariant,
} from '@/ui/specStripLayout';
import { profileSummaryWidth } from '@/features/vehicle/layout';

import { flat, renderUi, textOf } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

/** The vehicle page's strip: "Leistung 150 PS", torque, year, drive (FS-3 values, long German labels). */
const ITEMS = [
  { value: '150', unit: 'PS', label: 'Leistung', provenance: 'Herstellerangabe' },
  { value: '1.250', unit: 'Nm', label: 'Drehmoment', provenance: 'Prüfstand' },
  { value: '2002', label: 'Baujahr' },
  { value: 'AWD', label: 'Antrieb' },
];

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 393, height: 852, scale: 3, fontScale: 1 }));

describe('R7-2 SpecStrip type on a phone', () => {
  it('takes one step up on a phone only: hero.numeral.s for the value, caption for the label and the unit', () => {
    expect(specStripNumeralVariant('phone')).toBe('heroNumeralS');
    expect(specStripLabelVariant('phone')).toBe('caption');
    expect(specStripUnitVariant('phone')).toBe('caption');
    expect(typography.heroNumeralS.fontSize).toBeGreaterThan(typography.heroNumeralXs.fontSize);
    expect(typography.caption.fontSize).toBeGreaterThan(typography.labelCaps.fontSize);
    // Tablet page and desktop card unchanged.
    expect(specStripNumeralVariant(false)).toBe('heroNumeral');
    expect(specStripNumeralVariant(true)).toBe('heroNumeralS');
    expect(specStripLabelVariant(false)).toBe('labelCaps');
    expect(specStripLabelVariant(true)).toBe('labelCaps');
    expect(specStripUnitVariant(true)).toBe('labelUnit');
    // The estimate measures what the screen draws.
    const type = specStripType(1, 'phone');
    expect(type.valueSize).toBe(typography.heroNumeralS.fontSize);
    expect(type.labelSize).toBe(typography.caption.fontSize);
    expect(type.unitSize).toBe(typography.caption.fontSize);
  });

  it('renders "LEISTUNG 150 PS" on VEH-01’s phone strip at the larger roles', async () => {
    await renderUi(<SpecStrip items={ITEMS} layoutWidth={profileSummaryWidth('phone', 393, breakpointFor(393).gutter)} testID="VEH-01.specStrip" />);
    const label = flat(screen.getByTestId('VEH-01.specStrip.0.label').props.style);
    expect(label.fontSize).toBe(typography.caption.fontSize);
    expect(textOf(screen.getByTestId('VEH-01.specStrip.0.label').props.style).textTransform).toBe('uppercase');
    expect(flat(screen.getByTestId('VEH-01.specStrip.0.value').props.style).fontSize).toBe(typography.heroNumeralS.fontSize);
    expect(flat(screen.getByTestId('VEH-01.specStrip.0.unit').props.style).fontSize).toBe(typography.caption.fontSize);
    expect(screen.getByTestId('VEH-01.specStrip.0')).toHaveTextContent('Leistung150PSHerstellerangabe');
  });

  it.each([
    [360, 1],
    [390, 1],
    [430, 1],
    [360, 2],
    [390, 2],
  ])('at %i dp and font scale %f every line fits its cell: the strip wraps (2×2 or one column), never clips', (window, fontScale) => {
    const width = profileSummaryWidth('phone', window, breakpointFor(window).gutter);
    const columns = estimatedSpecStripColumns(ITEMS, width, fontScale, 'phone', 1);
    // Four larger cells never share a phone's row.
    expect(columns).toBeLessThanOrEqual(2);
    const fit = {
      width,
      count: ITEMS.length,
      divider: 1,
      fontScale,
      contentWidths: estimatedSpecContentWidths(ITEMS, fontScale, 'phone'),
      gridContentWidths: estimatedSpecGridWidths(ITEMS, fontScale, 'phone'),
    };
    expect(fitsColumns(fit, columns)).toBe(true);
    // The numeral stops growing at its cap (1.3×), the Inter lines reflow freely.
    expect(specStripType(fontScale, 'phone').valueSize).toBe(typography.heroNumeralS.fontSize * Math.min(fontScale, maxFontScale.heroNumeralS));
  });
});
