/**
 * The geometry of VEH-01's loading state (§8 "matching final geometry exactly", FS-3 "skeleton mirrors hero/strip/rows").
 * The skeleton does not know the vehicle yet, so it sets FS-3's own example the way the page sets it: its title and
 * sub-line wrap word by word at the real width and font scale, and its buttons have the size of their real labels.
 */
import { size, space, typeScale, typography, type SizedTypeVariant } from '@/theme';
import { displayTitleFontSize, displayTitleSize, drawnScale, estimateDisplayTitle, type DisplayTitlePlacement } from '@/ui/displayTitleLayout';
import { estimateLines } from '@/ui/Skeleton';
import { estimatedSpecStripColumns, provenanceRowsOf, specStripHeight, specStripRows, type SpecStripEntry } from '@/ui/specStripLayout';

/**
 * A text as word widths in em of its type variant and the width of its spaces. M4.1 re-measured them for the 2.0 faces from
 * the shipped TTF advance widths (fontTools, tracking included), corrected by the kerning Chromium showed on the v1 values.
 */
export type WordWidths = { words: readonly number[]; space: number };

/** FS-3's title "Skyline GT-R R34" in `display.title` (Archivo SemiExpanded 600, its −1 % tracking included). */
export const BLUEPRINT_TITLE: WordWidths = { words: [3.73, 2.66, 2.115], space: 0.25 };

/** FS-3's sub-line "2002 · 2,6 l R6 Biturbo (RB26DETT) · Bayside Blue" in `callout` (Inter 500). */
export const BLUEPRINT_SUBLINE: WordWidths = {
  words: [2.523, 0.303, 1.524, 0.252, 1.278, 3.476, 5.918, 0.303, 3.782, 2.098],
  space: 0.267,
};

/**
 * The same sub-line as the page keeps it together up to font scale 1.2 (DQ-167): "2002 ·", "2,6 l R6 Biturbo (RB26DETT) ·" and
 * "Bayside Blue" each stay on one line.
 */
export const BLUEPRINT_SUBLINE_PARTS: WordWidths = { words: [3.094, 14.085, 6.146], space: 0.267 };

/** FS-3's spec strip, as VEH-01 shows it for the R34 (the parity vehicle), in the 2.0 anatomy (09 §5 SpecStrip). */
export const BLUEPRINT_SPEC_STRIP: readonly SpecStripEntry[] = [
  { value: '500', unit: 'PS', label: 'Leistung', provenance: 'Prüfstand' },
  { value: '540', unit: 'Nm', label: 'Drehmoment', provenance: 'Prüfstand' },
  { value: '2002', label: 'Baujahr' },
  { value: 'AWD', label: 'Antrieb' },
];

/**
 * DQ-801: the strip's skeleton height at this width, with the rule SpecStrip uses (specStripLayout.ts) applied to FS-3's
 * example values: one row of four where they fit, else the 2×2 grid. `hairline` is the divider width of the platform.
 */
export function blueprintStripHeight(width: number, fontScale: number, desktop: boolean, hairline: number): number {
  const columns = estimatedSpecStripColumns(BLUEPRINT_SPEC_STRIP, width, fontScale, desktop, hairline);
  const rows = specStripRows(BLUEPRINT_SPEC_STRIP.length, columns);
  return specStripHeight(rows, fontScale, desktop, hairline, provenanceRowsOf(BLUEPRINT_SPEC_STRIP, columns));
}

/** FS-3's make "NISSAN" in `label.caps` (Inter 600, +4 % tracking included). */
export const BLUEPRINT_EYEBROW_EM = 4.09;

/**
 * The lines a text takes when it breaks only at its spaces, as the page's text does: each line as wide as its words.
 * A word wider than the line takes a line of its own.
 */
export function wrapWords({ words, space: spaceEm }: WordWidths, fontSize: number, width: number): number[] {
  const lines: number[] = [];
  let line = 0;
  for (const word of words) {
    const wordWidth = word * fontSize;
    const next = line === 0 ? wordWidth : line + spaceEm * fontSize + wordWidth;
    if (line > 0 && next > width) {
      lines.push(line);
      line = wordWidth;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines;
}

/** The lines of FS-3's title or sub-line in a type variant at a font scale and a width. */
export function blueprintLines(text: WordWidths, variant: 'displayTitle' | 'callout', fontScale: number, width: number): number[] {
  return wrapWords(text, typography[variant].fontSize * fontScale, Math.max(0, width));
}

/**
 * DQ-802 / ADR-426 a-b: VEH-01's title under DisplayTitle's rule. Placement `page` (phones, tablets): its lines at the full size
 * with the font scale (the desktop size, 44, on the web desktop: NH-3) while they are at most two, else its lines at 24.
 * Placement `card` (the web desktop's side card, ADR-426 b): 30 at every width while it takes 1 line, 24 when that brings it to
 * 1 line, otherwise the page rule at 30. `shrunk` true for 24, which is 24/28 on every width, as DisplayTitle sets it. `text` is
 * in em.
 */
export function displayTitleLines(
  text: WordWidths,
  fontScale: number,
  width: number,
  desktop: boolean = false,
  placement: DisplayTitlePlacement = 'page',
): { lines: number[]; shrunk: boolean } {
  const room = Math.max(0, width);
  const full = wrapWords(text, displayTitleFontSize(desktop && placement === 'page') * fontScale, room);
  const small = wrapWords(text, typeScale.displayTitle.minSize * fontScale, room);
  const shrunk = displayTitleSize(placement, full.length, small.length) === 'shrunk';
  return shrunk ? { lines: small, shrunk } : { lines: full, shrunk };
}

/**
 * NH-R3-1: a title the skeleton already knows (GAR-02's garage card), set by DisplayTitle's own estimate (displayTitleLayout.ts):
 * the same size, the same conditional binding of a trailing code (ADR-426 c) and the same line count as the loaded title
 * decides on its first frame, each line at its estimated width. Null without a width (the caller then sets FS-3's example).
 */
export function knownTitleLines(
  title: string,
  fontScale: number,
  width: number,
  desktop: boolean = false,
  placement: DisplayTitlePlacement = 'page',
): { lines: number[]; shrunk: boolean } | null {
  if (!(width > 0) || title.trim() === '') return null;
  const fit = estimateDisplayTitle({
    name: title,
    kind: 'vehicle',
    width,
    fontSize: displayTitleFontSize(desktop && placement === 'page'),
    placement,
    scale: drawnScale(fontScale),
  });
  return { lines: fit.widths, shrunk: fit.shrunk };
}

export type ButtonSize = 'm' | 's';

/** The height of a Button: its minimum, or the scaled label line, padding and border once that is taller (§8). */
export function buttonHeight(buttonSize: ButtonSize, fontScale: number): number {
  const label = typography.bodyStrong;
  const padding = buttonSize === 's' ? space[4] : space[8];
  return Math.max(size.button[buttonSize], label.lineHeight * fontScale + 2 * padding + 2 * size.border.control);
}

/** A Button's width beside its label: side padding, which holds the border (§8, Button), and, with an icon, the icon and its gap. */
export function buttonChrome(buttonSize: ButtonSize, icon: boolean): number {
  const glyph = icon ? (buttonSize === 's' ? size.icon.s : size.icon.m) + space[8] : 0;
  return 2 * size.buttonPaddingX[buttonSize] + glyph;
}

/** Inter's average glyph in em, for a label before it is measured (the skeleton is still hidden then). */
const LABEL_CHAR_EM = 0.55;

/** Every Button size sets its label in body.strong (09 §5), so the size no longer changes the estimate. */
export function estimatedLabelWidth(label: string, _buttonSize: ButtonSize, fontScale: number): number {
  const type = typography.bodyStrong;
  return label.length * LABEL_CHAR_EM * type.fontSize * fontScale;
}

/**
 * The one-line width of a text in a type variant, for a skeleton line that must not be longer than its content (§8). The
 * caller caps it at the line it sits on.
 */
export function estimatedTextWidth(text: string, variant: SizedTypeVariant, fontScale: number): number {
  return text.length * LABEL_CHAR_EM * typography[variant].fontSize * fontScale;
}

/**
 * The skeleton lines of a known text at the width it has: how many lines it takes, and a single line only as long as the
 * text. Before the width is measured it is one line of the text's estimated width.
 */
export function textSkeleton(text: string, variant: SizedTypeVariant, fontScale: number, available: number): { lines: number; width: number | '100%' } {
  const lines = estimateLines(text.length, variant, fontScale, available);
  const oneLine = estimatedTextWidth(text, variant, fontScale);
  return { lines, width: lines > 1 ? '100%' : available > 0 ? Math.min(available, oneLine) : oneLine };
}
