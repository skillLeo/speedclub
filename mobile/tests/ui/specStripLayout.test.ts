/** DQ-801: the spec strip's columns by fit, and the geometry the VEH-01 skeleton shares with it. */
import { maxFontScale, space, typography, typographyDesktop } from '@/theme';
import {
  capsOf,
  estimatedInterWidth,
  LABEL_MEDIUM_EM,
  LABEL_MEDIUM_FALLBACK_EM,
  LABEL_SEMIBOLD_EM,
  LABEL_SEMIBOLD_FALLBACK_EM,
  LABEL_SEMIBOLD_KERN,
} from '@/ui/specLabelMetrics';
import {
  estimatedSpecContentWidths,
  estimatedSpecLabelWidth,
  estimatedSpecStripColumns,
  estimatedValueLineWidth,
  estimatedValueWidth,
  fitsColumns,
  NUMERAL_ADVANCES,
  NUMERAL_FALLBACK_EM,
  NUMERAL_KERNING,
  provenanceRowsOf,
  SPEC_CELL_GAP,
  SPEC_CELL_PADDING_X,
  SPEC_UNIT_GAP,
  specCellWidth,
  specStripColumns,
  specStripHeight,
  specStripRows,
  specStripType,
} from '@/ui/specStripLayout';

/** FS-3's R34 in the 2.0 anatomy (09 §5 SpecStrip), the values of SpecStripLayoutTest.php. */
const R34 = [
  { value: '500', unit: 'PS', label: 'Leistung', provenance: 'Prüfstand' },
  { value: '540', unit: 'Nm', label: 'Drehmoment', provenance: 'Prüfstand' },
  { value: '2002', label: 'Baujahr' },
  { value: 'AWD', label: 'Antrieb' },
];

describe('specStripColumns', () => {
  it('pads every cell with space.12, so a numeral never touches a hairline', () => {
    expect(SPEC_CELL_PADDING_X).toBe(space[12]);
    // 87.5 per cell at 350: 63.5 of text. 63 fits, 64 does not.
    expect(fitsColumns({ width: 350, count: 4, divider: 0, contentWidths: [63] }, 4)).toBe(true);
    expect(fitsColumns({ width: 350, count: 4, divider: 0, contentWidths: [64] }, 4)).toBe(false);
  });

  it('keeps one row when every value and label fits its cell', () => {
    expect(specStripColumns({ width: 350, count: 4, divider: 1, contentWidths: [56, 56, 56, 60, 20, 20, 40, 45] })).toBe(4);
  });

  it('becomes the 2×2 grid when one value does not fit a quarter (2002 at 40 is 74 + 24)', () => {
    expect(specStripColumns({ width: 350, count: 4, divider: 1, contentWidths: [56, 56, 74, 60] })).toBe(2);
  });

  it('falls back to one column when not even half the strip holds a value, and never claims more than the items', () => {
    expect(specStripColumns({ width: 200, count: 4, divider: 1, contentWidths: [120] })).toBe(1);
    expect(specStripColumns({ width: 1000, count: 3, divider: 1, contentWidths: [50] })).toBe(3);
    expect(specStripColumns({ width: 1000, count: 1, divider: 1, contentWidths: [50] })).toBe(1);
  });

  it('is at most 2×2 above the stacking font scale (09 §4.2), even when four would fit', () => {
    expect(specStripColumns({ width: 1000, count: 4, divider: 1, contentWidths: [50], fontScale: 2 })).toBe(2);
    expect(specStripColumns({ width: 1000, count: 4, divider: 1, contentWidths: [50], fontScale: 1.2 })).toBe(4);
  });

  it('subtracts the dividers from the cells', () => {
    expect(specCellWidth(353, 4, 1)).toBe(87.5);
  });
});

describe('estimates (before measuring, and for the skeleton)', () => {
  it('counts tabular figures, separators and capitals from the Archivo Condensed advances', () => {
    expect(estimatedValueWidth('2002', 40)).toBeCloseTo(4 * 0.472 * 40, 5);
    // A five-glyph value at 40 does not fit a phone's quarter (DQ-801: about 81).
    expect(estimatedValueWidth('1.020', 40) + 2 * SPEC_CELL_PADDING_X).toBeGreaterThan(specCellWidth(353, 4, 1));
  });

  describe('the shared glyph table (SF-R2-2, the same numbers as SpecStripLayout.php)', () => {
    /**
     * The real advances of the shipped ArchivoCondensed-SemiBold.ttf in font units (unitsPerEm 1000), read with fontTools 4.68
     * from `hmtx`, digits through their `tnum` glyphs. Written out here, not taken from the table, so a table that under-measures
     * a glyph fails.
     */
    const UNITS: Readonly<Record<string, number>> = { A: 548, W: 768, D: 575, R: 564, F: 463, M: 712, I: 241, C: 572, T: 499, '.': 234, ',': 234 };
    const DIGIT_UNITS = 472;
    const realWidth = (value: string, size: number) =>
      [...value].reduce((sum, char) => sum + (/\d/.test(char) ? DIGIT_UNITS : (UNITS[char] as number)) / 1000, 0) * size;

    it.each(['AWD', 'RWD', 'FWD', '4MATIC', '1.725', '3,9'])('estimates %s at 40 as the sum of the table and never below the font', (value) => {
      const tableSum = [...value].reduce((sum, char) => sum + (NUMERAL_ADVANCES[char] ?? NUMERAL_FALLBACK_EM), 0) * 40;
      expect(estimatedValueWidth(value, 40)).toBeCloseTo(tableSum, 6);
      expect(estimatedValueWidth(value, 40)).toBeGreaterThanOrEqual(realWidth(value, 40));
    });

    it('adds the font’s positive pair kerning, so a value with "A/" is never estimated narrower than it is drawn (ruling 3)', () => {
      // GPOS PairPos of ArchivoCondensed-SemiBold.ttf (fontTools 4.68, DFLT/dflt kern lookup 0): A/ K/ L/ +23 units, f) +17,
      // f' +10, t) +2; the tnum digits have no positive pair. Written out from the font, not taken from the table.
      expect(NUMERAL_KERNING).toEqual({ 'A/': 0.023, 'K/': 0.023, 'L/': 0.023, 'f)': 0.017, "f'": 0.01, 't)': 0.002 });
      const plain = (value: string) => [...value].reduce((sum, char) => sum + (NUMERAL_ADVANCES[char] ?? NUMERAL_FALLBACK_EM), 0);
      expect(estimatedValueWidth('A/T', 40)).toBeCloseTo((plain('A/T') + 23 / 1000) * 40, 6);
      // Digits and separators kern at 0 or tighter: their estimate stays the plain sum.
      expect(estimatedValueWidth('1.725', 40)).toBeCloseTo(plain('1.725') * 40, 6);
    });

    it('takes the widest letter, W, for a character outside the table', () => {
      expect(NUMERAL_FALLBACK_EM).toBe(0.768);
      expect(estimatedValueWidth('Ø', 40)).toBeCloseTo(0.768 * 40, 6);
      // U+202F is not in Archivo's cmap: it counts as the space.
      expect(NUMERAL_ADVANCES['\u202F']).toBe(NUMERAL_ADVANCES[' ']);
    });

    // The value-only strip of the first-frame cases: short labels, so the numerals decide.
    const NO_YEAR = [
      { value: '500', label: 'PS' },
      { value: '540', label: 'Nm' },
      { value: '–', label: 'Jahr' },
      { value: 'AWD', label: 'Typ' },
    ];
    const stripWidth = (window: number) => window - 2 * (window >= 430 ? 24 : 20);

    // Where the old 0.6 letter estimate (72 for "AWD") claimed a quarter that the real 75.6 does not fit.
    it.each([
      [426, 3],
      [429, 3],
      [430, 3],
      [440, 3],
      [448, 3],
      [449, 2.625],
      [449, 2],
    ])('gives 500 · 540 · – · AWD two columns on the first frame at %i dp, %f× (no "AW/D")', (window, density) => {
      expect(estimatedSpecStripColumns(NO_YEAR, stripWidth(window), 1, false, 1 / density)).toBe(2);
    });

    it('keeps four columns where a quarter really holds "AWD" in hero.numeral (ADR-431 b): from a 587 strip', () => {
      expect(estimatedSpecStripColumns(NO_YEAR, 586.99, 1, false, 1)).toBe(2);
      expect(estimatedSpecStripColumns(NO_YEAR, 587, 1, false, 1)).toBe(4);
      expect(realWidth('AWD', 64)).toBeLessThanOrEqual(specCellWidth(587, 4, 1) - 2 * SPEC_CELL_PADDING_X);
    });
  });

  it('sets hero.numeral on the page and hero.numeral.s in the desktop card (ADR-431 b), capped at 1.3×', () => {
    expect(specStripType(1, false).valueSize).toBe(typography.heroNumeral.fontSize);
    expect(specStripType(2, false).valueSize).toBe(typography.heroNumeral.fontSize * maxFontScale.heroNumeral);
    expect(specStripType(1, true).valueSize).toBe(typographyDesktop.heroNumeralS.fontSize);
    expect(specStripType(2, true).valueSize).toBe(typographyDesktop.heroNumeralS.fontSize * maxFontScale.heroNumeralS);
    expect(specStripType(2, false).labelSize).toBe(typography.labelCaps.fontSize * 2);
    expect(specStripType(2, false).provenanceSize).toBe(typography.caption.fontSize * 2);
    expect(specStripType(2, false).labelTracking).toBe(typography.labelCaps.letterSpacing * 2);
  });

  it('gives FS-3’s R34 the 2×2 grid on every phone, one row from 587 and one column at 200 % on a phone', () => {
    for (const width of [320, 350, 390, 450, 586]) expect(estimatedSpecStripColumns(R34, width, 1, false, 1)).toBe(2);
    // SpecStripLayoutTest.php: 587 and 293 at scale 1 (hero.numeral), 401 at scale 2, 467 and 233 on the desktop (hero.numeral.s).
    expect(estimatedSpecStripColumns(R34, 587, 1, false, 1)).toBe(4);
    expect(estimatedSpecStripColumns(R34, 292.99, 1, false, 1)).toBe(1);
    expect(estimatedSpecStripColumns(R34, 293, 1, false, 1)).toBe(2);
    expect(estimatedSpecStripColumns(R34, 466.99, 1, true, 1)).toBe(2);
    expect(estimatedSpecStripColumns(R34, 467, 1, true, 1)).toBe(4);
    expect(estimatedSpecStripColumns(R34, 600, 2, false, 1)).toBe(2);
    expect(estimatedSpecStripColumns(R34, 400.99, 2, false, 1)).toBe(1);
    expect(estimatedSpecStripColumns(R34, 401, 2, true, 1)).toBe(2);
  });

  it('measures the height row by row, a provenance line only where a row has one, a hairline between rows', () => {
    expect(SPEC_CELL_GAP).toBe(space[4]);
    const row = 2 * space[16] + typography.labelCaps.lineHeight + space[4] + typography.heroNumeral.lineHeight;
    expect(specStripHeight(1, 1, false, 1)).toBe(row);
    expect(specStripHeight(2, 1, false, 1)).toBe(2 * row + 1);
    expect(specStripHeight(2, 1, false, 1, provenanceRowsOf(R34, 2))).toBe(2 * row + space[4] + typography.caption.lineHeight + 1);
    expect(provenanceRowsOf(R34, 2)).toEqual([true, false]);
    expect(provenanceRowsOf(R34, 1)).toEqual([true, true, false, false]);
    expect(specStripRows(4, 2)).toBe(2);
    expect(specStripRows(5, 4)).toBe(2);
  });
});

describe('the 2.0 lines of a cell (data label, unit, provenance; ADR-422 d)', () => {
  const type = specStripType(1, false);

  it('sets the data label in capitals with the label.caps tracking and the kerning bound between characters', () => {
    // BAUJAHR, the numbers of SpecStripLayoutTest.php.
    const caps = (0.66 + 0.728 + 0.736 + 0.58 + 0.728 + 0.746 + 0.653 + 6 * LABEL_SEMIBOLD_KERN) * 11 + 7 * 0.44;
    expect(estimatedSpecLabelWidth('Baujahr', type)).toBeCloseTo(caps, 9);
    expect(capsOf('Maß')).toBe('MASS');
    expect(estimatedInterWidth('', 11, 0.44, 'semibold')).toBe(0);
  });

  it('puts the unit space.4 after the numeral, on its line', () => {
    expect(SPEC_UNIT_GAP).toBe(space[4]);
    expect(estimatedValueLineWidth({ value: '540', unit: 'Nm' }, type)).toBeCloseTo(3 * 0.472 * 64 + 4 + (0.76 + 0.901 + 0.023) * 11 + 2 * 0.44, 9);
    expect(estimatedValueLineWidth({ value: '2002' }, type)).toBeCloseTo(estimatedValueWidth('2002', 64), 9);
  });

  it('counts a provenance line only where there is one', () => {
    expect(estimatedSpecContentWidths([R34[0]!], 1, false)).toHaveLength(3);
    expect(estimatedSpecContentWidths([R34[2]!], 1, false)).toHaveLength(2);
  });

  it('holds Inter’s real advances (fontTools 4.68, unitsPerEm 2048, rounded up) and falls back to W', () => {
    // Written out from the fonts, not from the tables: SemiBold D 1479, W 2089; Medium W 2054, ß 1290.
    expect(LABEL_SEMIBOLD_EM.D).toBeGreaterThanOrEqual(1479 / 2048);
    expect(LABEL_SEMIBOLD_EM.W).toBeGreaterThanOrEqual(2089 / 2048);
    expect(LABEL_MEDIUM_EM.W).toBeGreaterThanOrEqual(2054 / 2048);
    expect(LABEL_MEDIUM_EM['ß']).toBeGreaterThanOrEqual(1290 / 2048);
    expect(LABEL_SEMIBOLD_FALLBACK_EM).toBe(LABEL_SEMIBOLD_EM.W);
    expect(LABEL_MEDIUM_FALLBACK_EM).toBe(LABEL_MEDIUM_EM.W);
    expect(estimatedInterWidth('Š', 10, 0, 'semibold')).toBeCloseTo(LABEL_SEMIBOLD_EM.W! * 10, 9);
  });
});
