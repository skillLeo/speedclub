/**
 * Client round 6 (R6-3): the gauge's number is hero.numeral.s. Client round 4 (11 R4-1.2) still holds: the full score "1.000" must
 * stay inside the needle's inner circle, so it takes the next step, hero.numeral.xs.
 */
import { screen } from '@testing-library/react-native';

import { hydrateThemePreference, typography } from '@/theme';
import { BuildScoreGauge, gaugeNumeralVariant } from '@/ui/BuildScoreGauge';
import { __resetOdometerSessionForTests } from '@/ui/motion/OdometerNumber';

import { flat, renderUi } from './helpers';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// At the system font size the token sizes apply as they are (the hero numerals cap at 1.3 above it).
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

beforeAll(hydrateThemePreference);
beforeEach(() => __resetOdometerSessionForTests());

describe('gaugeNumeralVariant', () => {
  it('takes hero.numeral.s for up to three digits and hero.numeral.xs for a grouped thousand', () => {
    expect(gaugeNumeralVariant('0')).toBe('heroNumeralS');
    expect(gaugeNumeralVariant('642')).toBe('heroNumeralS');
    expect(gaugeNumeralVariant('999')).toBe('heroNumeralS');
    expect(gaugeNumeralVariant('1.000')).toBe('heroNumeralXs');
    expect(gaugeNumeralVariant('1,000')).toBe('heroNumeralXs');
  });

  it('keeps every numeral inside the needle’s inner circle (0.6 r) at the 120 box, at 1.35 em for three digits and 2.0 em for "1.000"', () => {
    // Archivo Condensed SemiBold, tabular figures: three digits are 1.35 em wide, "1.000" 2.0 em (measured from the font file).
    const radius = 120 / 2 - 2 - 2;
    const inner = 2 * 0.6 * radius;
    expect(1.35 * typography[gaugeNumeralVariant('642')].fontSize).toBeLessThanOrEqual(inner);
    expect(2.0 * typography[gaugeNumeralVariant('1.000')].fontSize).toBeLessThanOrEqual(inner);
  });
});

describe('BuildScoreGauge numeral size', () => {
  /** The font size of one glyph cell of the gauge's number (the odometer draws a Text per character; the centre layer is aria-hidden). */
  const sizeOf = (glyph: string) => flat(screen.getByText(glyph, { includeHiddenElements: true }).props.style).fontSize;

  it('draws 1.000 at hero.numeral.xs', async () => {
    await renderUi(
      <BuildScoreGauge total={1000} valueText="1.000" scaleText="von 1.000" stageText="Stufe 5" accessibilityLabel="Build Score 1.000 von 1.000, Stufe 5" box={120} testID="g" />,
    );
    expect(sizeOf('.')).toBe(typography.heroNumeralXs.fontSize);
    expect(sizeOf('1')).toBe(typography.heroNumeralXs.fontSize);
  });

  it('draws 814 at hero.numeral.s', async () => {
    await renderUi(<BuildScoreGauge total={814} valueText="814" scaleText="von 1.000" stageText="Stufe 5" accessibilityLabel="Build Score 814 von 1.000, Stufe 5" box={120} testID="g" />);
    expect(sizeOf('8')).toBe(typography.heroNumeralS.fontSize);
  });
});
