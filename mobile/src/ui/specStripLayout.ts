/**
 * DQ-801: how many columns the spec strip (09 §5 SpecStrip, FS-3) can give its items, decided by fit and not by font scale
 * alone. A hero numeral (hero.numeral 64/64 on the page; hero.numeral.s 48/48 in the web desktop's card, ADR-431 b) never wraps inside a value and never
 * touches a hairline: every line of a cell (2.0: the `label.caps` data label, the numeral with its `label.unit` unit, the
 * provenance caption) plus `space.12` on each side must fit its cell. All items in one row when they
 * fit, else two columns (the 09 §4.2 2×2 grid), else one. From the stacking font scale the strip is at most 2×2 (09 §4.2
 * "spec strip wraps into a 2×2 grid" at large text). ADR-422 e (DQ-P5-066): in the 2×2 grid the provenance caption may wrap at
 * a regular space, so there it counts by its widest unbreakable segment ("Herstellerangabe (KI-Vorschlag)" takes two lines and
 * keeps the grid); a row of three to five still needs it whole on one line.
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
/**
 * ADR-422 e (DQ-P5-066): in a grid of at most this many columns (the 2×2 grid, or two items side by side) the provenance caption
 * may wrap, so it counts by its widest unbreakable segment; a wider row needs every caption whole on one line.
 */
export const SPEC_WRAP_MAX_COLUMNS = 2;

export type SpecStripFit = {
  /** The strip's inner width. */
  width: number;
  /** Number of items. */
  count: number;
  /** The one-line width of every value and every label, in any order. */
  contentWidths: readonly number[];
  /**
   * ADR-422 e: the same widths for a grid of at most SPEC_WRAP_MAX_COLUMNS columns, with each provenance caption counted by its
   * widest unbreakable segment (provenanceSegments). Without it the grid counts `contentWidths` too.
   */
  gridContentWidths?: readonly number[];
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

/**
 * True when every content width plus the padding on both sides fits a cell of `columns` columns. ADR-422 e: up to
 * SPEC_WRAP_MAX_COLUMNS columns the provenance counts by its widest unbreakable segment (`gridContentWidths`), so it may take a
 * second line there; a wider row counts it whole.
 */
export function fitsColumns(fit: SpecStripFit, columns: number): boolean {
  const padding = fit.padding ?? SPEC_CELL_PADDING_X;
  const cell = specCellWidth(fit.width, columns, fit.divider);
  const widths = columns <= SPEC_WRAP_MAX_COLUMNS ? (fit.gridContentWidths ?? fit.contentWidths) : fit.contentWidths;
  return widths.every((contentWidth) => Math.ceil(contentWidth) + 2 * padding <= cell);
}

/**
 * ADR-422 e: the parts a provenance caption can break into. It breaks at a regular space (U+0020) only; U+00A0 and U+2060 glue
 * their neighbours ("Herstellerangabe (KI-\u2060Vorschlag)" → "Herstellerangabe", "(KI-\u2060Vorschlag)"). A one-word caption is
 * its own only segment, so its width is the same in both checks.
 */
export function provenanceSegments(provenance: string): string[] {
  return provenance.split(' ').filter((segment) => segment.length > 0);
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
 * The strip's size: `true` the web desktop's side card, `'phone'` a phone's page, `false` the page from 768 below the desktop.
 * Callers that knew only the desktop keep passing a boolean.
 */
export type StripSize = boolean | 'phone';

/**
 * ADR-431 b: the numeral role of the strip. On a tablet's page (and the public page between 768 and 1280) it is `hero.numeral`; in
 * the desktop's side card (VEH-01/GAR-02 and WEB-01 from 1280) the compact `hero.numeral.s`. On a phone client feedback CF-2 (M5.3)
 * and R5-2b (ADR-536) had taken it down to `hero.numeral.xs`; client round 7 (R7-2, "just a little bit bigger on phone") takes it one
 * step back up, to `hero.numeral.s`. The public page's SpecStripLayout.php chooses by width on its own.
 */
export function specStripNumeralVariant(size: StripSize): 'heroNumeral' | 'heroNumeralS' {
  return size === false ? 'heroNumeral' : 'heroNumeralS';
}

/**
 * R7-2: the data label ("LEISTUNG") and the unit ("PS") one type step bigger on a phone too: `caption` (12/16) instead of
 * `label.caps` / `label.unit` (11/14); the label keeps its capitals (SpecStrip sets them), the unit its case. Elsewhere unchanged.
 */
export function specStripLabelVariant(size: StripSize): 'labelCaps' | 'caption' {
  return size === 'phone' ? 'caption' : 'labelCaps';
}

/** R7-2: the unit's role, as specStripLabelVariant. */
export function specStripUnitVariant(size: StripSize): 'labelUnit' | 'caption' {
  return size === 'phone' ? 'caption' : 'labelUnit';
}

/** The sizes the strip's roles render at: the numeral capped at 1.3× (09 §4.2), the Inter roles scaled freely. */
export function specStripType(fontScale: number, desktop: StripSize) {
  const numeral = desktop === true ? { ...typography.heroNumeralS, ...typographyDesktop.heroNumeralS } : desktop === 'phone' ? typography.heroNumeralS : typography.heroNumeral;
  const numeralScale = Math.min(fontScale, desktop === false ? maxFontScale.heroNumeral : maxFontScale.heroNumeralS);
  const label = typography[specStripLabelVariant(desktop)];
  const unit = typography[specStripUnitVariant(desktop)];
  return {
    valueSize: numeral.fontSize * numeralScale,
    valueLine: numeral.lineHeight * numeralScale,
    labelSize: label.fontSize * fontScale,
    labelLine: label.lineHeight * fontScale,
    labelTracking: label.letterSpacing * fontScale,
    unitSize: unit.fontSize * fontScale,
    unitTracking: unit.letterSpacing * fontScale,
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

/** ADR-422 e: the provenance caption's widest unbreakable segment (provenanceSegments), or 0 without one. */
export function estimatedProvenanceSegmentWidth(provenance: string | null | undefined, type: StripType): number {
  return provenance ? Math.max(0, ...provenanceSegments(provenance).map((segment) => estimatedProvenanceWidth(segment, type))) : 0;
}

/** Every one-line width a cell must hold, item by item: value line, data label, provenance (when there is one). */
export function estimatedSpecContentWidths(items: readonly SpecStripEntry[], fontScale: number, desktop: StripSize): number[] {
  const type = specStripType(fontScale, desktop);
  return items.flatMap((item) => [
    estimatedValueLineWidth(item, type),
    estimatedSpecLabelWidth(item.label, type),
    ...(item.provenance ? [estimatedProvenanceWidth(item.provenance, type)] : []),
  ]);
}

/**
 * ADR-422 e: the widths a cell of the 2×2 grid must hold: as estimatedSpecContentWidths, but the provenance by its widest
 * unbreakable segment, since it may wrap there.
 */
export function estimatedSpecGridWidths(items: readonly SpecStripEntry[], fontScale: number, desktop: StripSize): number[] {
  const type = specStripType(fontScale, desktop);
  return items.flatMap((item) => [
    estimatedValueLineWidth(item, type),
    estimatedSpecLabelWidth(item.label, type),
    ...(item.provenance ? [estimatedProvenanceSegmentWidth(item.provenance, type)] : []),
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
  desktop: StripSize,
  divider: number,
): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return specStripColumns({
    width,
    count: items.length,
    divider,
    fontScale,
    contentWidths: estimatedSpecContentWidths(items, fontScale, desktop),
    gridContentWidths: estimatedSpecGridWidths(items, fontScale, desktop),
  });
}

/**
 * One row's height: padding, the data label, the gap, the value line and, when an item of the row has one, the gap and the
 * provenance line.
 */
export function specStripRowHeight(fontScale: number, desktop: StripSize, withProvenance: boolean): number {
  const type = specStripType(fontScale, desktop);
  const base = 2 * SPEC_CELL_PADDING_Y + type.labelLine + SPEC_CELL_GAP + type.valueLine;
  return withProvenance ? base + SPEC_CELL_GAP + type.provenanceLine : base;
}

/** The strip's height: its rows (`provenance[row]` true for a row with a provenance line), a hairline between rows. */
export function specStripHeight(rows: number, fontScale: number, desktop: StripSize, hairline: number, provenance: readonly boolean[] = []): number {
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

/**
 * DQ-1216: the SpecStrip's card form (09 §5 VehicleCard 2.0, ONB-01/02): three `hero.numeral.s` with their `label.unit` over a
 * `label.caps` data label, no hairlines, `MINI_SPEC_GAP` between columns. The same fit rule as the strip (ADR-422): a column holds
 * its value line and its label whole, or the spec takes fewer columns. From MINI_SPEC_STACK_FONT_SCALE it is at most two (2 + 1).
 */
export const MINI_SPEC_GAP = space[12];
/** The gap between the rows of a reflowed mini spec. */
export const MINI_SPEC_ROW_GAP = space[16];
/** 09 §14.1 200 %: from here the three cells never share one row. */
export const MINI_SPEC_STACK_FONT_SCALE = 1.5;

export type MiniSpecEntry = Pick<SpecStripEntry, 'value' | 'unit' | 'label'>;

/** The sizes the card's roles render at: `hero.numeral.s` capped at 1.3× (its web desktop size with `desktop`), Inter scaled freely. */
export function miniSpecType(fontScale: number, desktop: boolean): StripType {
  const numeral = desktop ? { ...typography.heroNumeralS, ...typographyDesktop.heroNumeralS } : typography.heroNumeralS;
  const numeralScale = Math.min(fontScale, maxFontScale.heroNumeralS);
  return { ...specStripType(fontScale, false), valueSize: numeral.fontSize * numeralScale, valueLine: numeral.lineHeight * numeralScale };
}

/** Every one-line width a mini spec cell must hold: its value line and its data label. */
export function estimatedMiniSpecWidths(items: readonly MiniSpecEntry[], fontScale: number, desktop: boolean): number[] {
  const type = miniSpecType(fontScale, desktop);
  return items.flatMap((item) => [estimatedValueLineWidth(item, type), estimatedSpecLabelWidth(item.label, type)]);
}

/** The width of one mini spec column. */
export function miniSpecCellWidth(width: number, columns: number): number {
  return (width - (columns - 1) * MINI_SPEC_GAP) / columns;
}

/** Columns for the card's mini spec at `width` (an unknown width counts as no room: one column). */
export function miniSpecColumns(items: readonly MiniSpecEntry[], width: number, fontScale: number, desktop: boolean): number {
  if (!Number.isFinite(width) || width <= 0 || items.length === 0) return 1;
  const widths = estimatedMiniSpecWidths(items, fontScale, desktop);
  const most = fontScale >= MINI_SPEC_STACK_FONT_SCALE ? Math.min(items.length, 2) : items.length;
  for (let columns = most; columns > 1; columns -= 1) {
    const cell = miniSpecCellWidth(width, columns);
    if (widths.every((contentWidth) => Math.ceil(contentWidth) <= cell)) return columns;
  }
  return 1;
}
