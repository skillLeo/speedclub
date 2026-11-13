/**
 * DQ-801: how many columns the spec strip (09 §5 SpecStrip, FS-3) can give its items, decided by fit and not by font scale
 * alone. A hero numeral (hero.numeral 64/64 on the page; hero.numeral.s 48/48 in the web desktop's card, ADR-431 b) never wraps inside a value and never
 * touches a hairline: every line of a cell (2.0: the `label.caps` data label, the numeral with its `label.unit` unit, the
 * provenance caption) plus `space.12` on each side must fit its cell. All items in one row when they
 * fit, else two columns (the 09 §4.2 2×2 grid), else one. From the stacking font scale the strip is at most 2×2 (09 §4.2
 * "spec strip wraps into a 2×2 grid" at large text).
 *
 * Pure, so Jest covers it: the component feeds it the widths its texts measure on screen (onLayout of an unconstrained copy),
 * and the VEH-01 skeleton feeds it estimates for FS-3's example values.
 */
import { maxFontScale, size, space, typography, typographyDesktop } from '@/theme';

import { capsOf, estimatedInterWidth } from './specLabelMetrics';

/** The side padding of a cell (DQ-801: space.4 let numerals touch the hairlines). */
export const SPEC_CELL_PADDING_X = space[12];
/** The vertical padding of a cell. */
export const SPEC_CELL_PADDING_Y = space[16];
/** The gap between the data label, the value line and the provenance line (2.0: space.4). */
export const SPEC_CELL_GAP = space[4];
/** 09 §5: three to five items; more than this never share one row. */
export const SPEC_STRIP_MAX_ONE_ROW = 5;
/** Above this font scale the strip is at most two columns, like every row that stacks (rowParts STACK_FONT_SCALE). */
export const SPEC_STACK_FONT_SCALE = 1.2;

export type SpecStripFit = {
  /** The strip's inner width. */
  width: number;
  /** Number of items. */
  count: number;
  /** The one-line width of every value and every label, in any order. */
  contentWidths: readonly number[];
  /** Width of the vertical hairline between two cells. */
  divider: number;
  /** The font scale; above SPEC_STACK_FONT_SCALE the strip has at most two columns. */
  fontScale?: number;
  padding?: number;
};

/** The column counts to try, widest first. */
function candidates(count: number, fontScale: number): number[] {
  const oneRow = Math.min(count, SPEC_STRIP_MAX_ONE_ROW);
  const all = fontScale > SPEC_STACK_FONT_SCALE ? [Math.min(oneRow, 2), 1] : [oneRow, 2, 1];
  return [...new Set(all.filter((columns) => columns >= 1 && columns <= Math.max(1, count)))];
}

/** The width of one cell when the strip has `columns` columns. */
export function specCellWidth(width: number, columns: number, divider: number): number {
  return (width - (columns - 1) * divider) / columns;
}

/** True when every content width plus the padding on both sides fits a cell of `columns` columns. */
export function fitsColumns(fit: SpecStripFit, columns: number): boolean {
  const padding = fit.padding ?? SPEC_CELL_PADDING_X;
  const cell = specCellWidth(fit.width, columns, fit.divider);
  return fit.contentWidths.every((contentWidth) => Math.ceil(contentWidth) + 2 * padding <= cell);
}

/** The most columns in which everything fits; one column when nothing else does. */
export function specStripColumns(fit: SpecStripFit): number {
  const options = candidates(fit.count, fit.fontScale ?? 1);
  return options.find((columns) => fitsColumns(fit, columns)) ?? options[options.length - 1] ?? 1;
}

/**
 * SF-R2-2: Archivo Condensed 600 advance widths in em, the shared glyph table of the app and the public page (ADR-422 a parity:
 * `web/app/Support/SpecStripLayout.php` carries the same numbers). Read from the shipped TTF
 * (`mobile/assets/fonts/ArchivoCondensed-SemiBold.ttf`, byte-identical to the web copies, unitsPerEm 1000) with fontTools 4.68:
 * advance width / unitsPerEm, rounded up to 3 decimals. Digits are the `tnum` glyphs (`zero.tf` …), which the strip sets
 * (`tabular-nums`). U+202F is not in the cmap; the space's advance stands in. The font's positive pair kerning is added
 * (NUMERAL_KERNING) and its negative kerning left out, so the estimate is never less than what the screen draws and never claims
 * a fit the screen denies ("AWD" is 75.6 at 40 here, 72 as drawn): the principle of the display title's estimate (ADR-425 as
 * amended, ruling 3).
 */
export const NUMERAL_ADVANCES: Readonly<Record<string, number>> = {
  '0': 0.472, '1': 0.472, '2': 0.472, '3': 0.472, '4': 0.472, '5': 0.472, '6': 0.472, '7': 0.472, '8': 0.472, '9': 0.472,
  '.': 0.234, ',': 0.234, '–': 0.375, '-': 0.272, '/': 0.275, '+': 0.537, '×': 0.537, ' ': 0.151, '\u00A0': 0.151, '\u202F': 0.151,
  A: 0.548, B: 0.547, C: 0.572, D: 0.575, E: 0.52, F: 0.463, G: 0.613, H: 0.575, I: 0.241, J: 0.459, K: 0.561, L: 0.45, M: 0.712,
  N: 0.577, O: 0.616, P: 0.53, Q: 0.616, R: 0.564, S: 0.515, T: 0.499, U: 0.567, V: 0.527, W: 0.768, X: 0.545, Y: 0.546, Z: 0.512,
  a: 0.457, b: 0.467, c: 0.438, d: 0.467, e: 0.454, f: 0.26, g: 0.45, h: 0.46, i: 0.213, j: 0.211, k: 0.44, l: 0.213, m: 0.69,
  n: 0.461, o: 0.468, p: 0.467, q: 0.467, r: 0.287, s: 0.415, t: 0.259, u: 0.461, v: 0.405, w: 0.615, x: 0.434, y: 0.404, z: 0.404,
};
/**
 * The positive pair kerning of Archivo Condensed 600, in em, shared with `web/app/Support/SpecStripLayout.php` (parity test).
 * Derived as DISPLAY_TITLE_KERNING (displayTitleLayout.ts) from `mobile/assets/fonts/ArchivoCondensed-SemiBold.ttf`: the GPOS
 * `kern` PairPos lookups (formats 1 and 2) of DFLT/dflt, the digits as the `tnum` glyphs the strip draws (`zero.tf` …, which
 * have no positive pairs), the largest XAdvance adjustment above 0 per pair / unitsPerEm (1000), rounded up to 3 decimals.
 */
export const NUMERAL_KERNING: Readonly<Record<string, number>> = {
  'A/': 0.023, 'K/': 0.023, 'L/': 0.023, 'f)': 0.017, "f'": 0.01, 't)': 0.002,
};
/** Any character outside the table: the widest letter in it (W, 0.768). */
export const NUMERAL_FALLBACK_EM = Math.max(
  ...Object.entries(NUMERAL_ADVANCES)
    .filter(([char]) => /^[A-Za-z]$/.test(char))
    .map(([, em]) => em),
);
/** A value's width in the strip's numeral (Archivo Condensed 600) at `fontSize`: the advances plus the positive pair kerning of each adjacent pair. */
export function estimatedValueWidth(value: string, fontSize: number): number {
  let em = 0;
  let previous: string | null = null;
  for (const char of value) {
    em += (NUMERAL_ADVANCES[char] ?? NUMERAL_FALLBACK_EM) + (previous === null ? 0 : (NUMERAL_KERNING[previous + char] ?? 0));
    previous = char;
  }
  return em * fontSize;
}

/**
 * SpecStrip 2.0 (09 §5): one item of the strip. `label` is the data label (`label.caps`, "Leistung" → LEISTUNG), `unit` the unit
 * next to the numeral (`label.unit`, "Nm" keeps its case), `provenance` the caption under it ("Herstellerangabe", "Prüfstand").
 */
export type SpecStripEntry = {
  value: string;
  unit?: string | null;
  label: string;
  provenance?: string | null;
};

/** The space between a numeral and its unit. */
export const SPEC_UNIT_GAP = space[4];

/**
 * ADR-431 b: the numeral role of the strip. On the page (phones and tablets, the public page below 1280) it is `hero.numeral`;
 * in the desktop's side card (VEH-01/GAR-02 and WEB-01 from 1280) the compact `hero.numeral.s`. The public page's
 * SpecStripLayout.php makes the same choice by width.
 */
export function specStripNumeralVariant(desktop: boolean): 'heroNumeral' | 'heroNumeralS' {
  return desktop ? 'heroNumeralS' : 'heroNumeral';
}

/** The sizes the strip's roles render at: the numeral capped at 1.3× (09 §4.2), the Inter roles scaled freely. */
export function specStripType(fontScale: number, desktop: boolean) {
  const numeral = desktop ? { ...typography.heroNumeralS, ...typographyDesktop.heroNumeralS } : typography.heroNumeral;
  const numeralScale = Math.min(fontScale, desktop ? maxFontScale.heroNumeralS : maxFontScale.heroNumeral);
  return {
    valueSize: numeral.fontSize * numeralScale,
    valueLine: numeral.lineHeight * numeralScale,
    labelSize: typography.labelCaps.fontSize * fontScale,
    labelLine: typography.labelCaps.lineHeight * fontScale,
    labelTracking: typography.labelCaps.letterSpacing * fontScale,
    unitSize: typography.labelUnit.fontSize * fontScale,
    unitTracking: typography.labelUnit.letterSpacing * fontScale,
    provenanceSize: typography.caption.fontSize * fontScale,
    provenanceLine: typography.caption.lineHeight * fontScale,
    provenanceTracking: typography.caption.letterSpacing * fontScale,
  };
}

type StripType = ReturnType<typeof specStripType>;

/** The numeral and, beside it, the unit: one line that never wraps. */
export function estimatedValueLineWidth(entry: Pick<SpecStripEntry, 'value' | 'unit'>, type: StripType): number {
  const value = estimatedValueWidth(entry.value, type.valueSize);
  const unit = entry.unit ? estimatedInterWidth(entry.unit, type.unitSize, type.unitTracking, 'semibold') : 0;
  return unit > 0 ? value + SPEC_UNIT_GAP + unit : value;
}

/** The data label in capitals, `label.caps`. */
export function estimatedSpecLabelWidth(label: string, type: StripType): number {
  return estimatedInterWidth(capsOf(label), type.labelSize, type.labelTracking, 'semibold');
}

/** The provenance caption, or 0 without one. */
export function estimatedProvenanceWidth(provenance: string | null | undefined, type: StripType): number {
  return provenance ? estimatedInterWidth(provenance, type.provenanceSize, type.provenanceTracking, 'medium') : 0;
}

/** Every one-line width a cell must hold, item by item: value line, data label, provenance (when there is one). */
export function estimatedSpecContentWidths(items: readonly SpecStripEntry[], fontScale: number, desktop: boolean): number[] {
  const type = specStripType(fontScale, desktop);
  return items.flatMap((item) => [
    estimatedValueLineWidth(item, type),
    estimatedSpecLabelWidth(item.label, type),
    ...(item.provenance ? [estimatedProvenanceWidth(item.provenance, type)] : []),
  ]);
}

/**
 * Columns from the estimates above. `width` is a real width: the strip's own, or the one its parent lays it out at. N1b
 * (Build 9): an unknown width is never "unlimited", which put four values into one row and broke them inside the number
 * ("20/02") until the strip had measured itself; it counts as no room, so the fewest columns.
 *
 * ADR-422 d (M4.4): this is the decision of the app and of the public page alike. The app's measurements only ever take
 * columns away (a font that draws wider than its table), never add them, so both sides choose the same columns.
 */
export function estimatedSpecStripColumns(
  items: readonly SpecStripEntry[],
  width: number,
  fontScale: number,
  desktop: boolean,
  divider: number,
): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return specStripColumns({ width, count: items.length, divider, fontScale, contentWidths: estimatedSpecContentWidths(items, fontScale, desktop) });
}

/**
 * One row's height: padding, the data label, the gap, the value line and, when an item of the row has one, the gap and the
 * provenance line.
 */
export function specStripRowHeight(fontScale: number, desktop: boolean, withProvenance: boolean): number {
  const type = specStripType(fontScale, desktop);
  const base = 2 * SPEC_CELL_PADDING_Y + type.labelLine + SPEC_CELL_GAP + type.valueLine;
  return withProvenance ? base + SPEC_CELL_GAP + type.provenanceLine : base;
}

/** The strip's height: its rows (`provenance[row]` true for a row with a provenance line), a hairline between rows. */
export function specStripHeight(rows: number, fontScale: number, desktop: boolean, hairline: number, provenance: readonly boolean[] = []): number {
  let height = 0;
  for (let row = 0; row < rows; row += 1) height += specStripRowHeight(fontScale, desktop, provenance[row] ?? false);
  return height + Math.max(0, rows - 1) * hairline;
}

/** Which rows hold an item with a provenance line, for `columns` columns. */
export function provenanceRowsOf(items: readonly Pick<SpecStripEntry, 'provenance'>[], columns: number): boolean[] {
  const rows: boolean[] = [];
  items.forEach((item, index) => {
    const row = Math.floor(index / Math.max(1, columns));
    rows[row] = (rows[row] ?? false) || Boolean(item.provenance);
  });
  return rows;
}

/** The number of rows `count` items take in `columns` columns. */
export function specStripRows(count: number, columns: number): number {
  return Math.ceil(count / Math.max(1, columns));
}

/** The control border, which web draws for every hairline (Hairline, the cell dividers). */
export const WEB_HAIRLINE = size.border.control;
