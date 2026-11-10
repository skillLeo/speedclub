/**
 * The geometry of VEH-01's loading state (§8 "matching final geometry exactly", FS-3 "skeleton mirrors hero/strip/rows").
 * The skeleton does not know the vehicle yet, so it sets FS-3's own example the way the page sets it: its title and
 * sub-line wrap word by word at the real width and font scale, and its buttons have the size of their real labels.
 */
import { size, space, typography, type TypeVariant } from '@/theme';
import { estimateLines } from '@/ui/Skeleton';

/** A text as word widths in em of its type variant and the width of its spaces, measured in Chromium. */
export type WordWidths = { words: readonly number[]; space: number };

/** FS-3's title "Skyline GT-R R34" in `display.l` (Barlow Semi Condensed 700, its tracking included). */
export const BLUEPRINT_TITLE: WordWidths = { words: [2.862, 1.861, 1.546], space: 0.191 };

/** FS-3's sub-line "2002 · 2,6 l R6 Biturbo (RB26DETT) · Bayside Blue" in `supporting`. */
export const BLUEPRINT_SUBLINE: WordWidths = {
  words: [2.482, 0.289, 1.494, 0.242, 1.264, 3.42, 5.871, 0.289, 3.729, 2.071],
  space: 0.281,
};

/**
 * The same sub-line as the page keeps it together up to font scale 1.2 (DQ-167): "2002 ·", "2,6 l R6 Biturbo (RB26DETT) ·" and
 * "Bayside Blue" each stay on one line.
 */
export const BLUEPRINT_SUBLINE_PARTS: WordWidths = { words: [3.052, 13.985, 6.081], space: 0.281 };

/** FS-3's eyebrow "NISSAN" in `eyebrow`, its letter spacing included. */
export const BLUEPRINT_EYEBROW_EM = 4.25;

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
export function blueprintLines(text: WordWidths, variant: 'displayL' | 'supporting', fontScale: number, width: number): number[] {
  return wrapWords(text, typography[variant].fontSize * fontScale, Math.max(0, width));
}

export type ButtonSize = 'm' | 's';

/** The height of a Button: its minimum, or the scaled label line, padding and border once that is taller (§8). */
export function buttonHeight(buttonSize: ButtonSize, fontScale: number): number {
  const label = buttonSize === 's' ? typography.labelS : typography.label;
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

export function estimatedLabelWidth(label: string, buttonSize: ButtonSize, fontScale: number): number {
  const type = buttonSize === 's' ? typography.labelS : typography.label;
  return label.length * LABEL_CHAR_EM * type.fontSize * fontScale;
}

/**
 * The one-line width of a text in a type variant, for a skeleton line that must not be longer than its content (§8). The
 * caller caps it at the line it sits on.
 */
export function estimatedTextWidth(text: string, variant: TypeVariant, fontScale: number): number {
  return text.length * LABEL_CHAR_EM * typography[variant].fontSize * fontScale;
}

/**
 * The skeleton lines of a known text at the width it has: how many lines it takes, and a single line only as long as the
 * text. Before the width is measured it is one line of the text's estimated width.
 */
export function textSkeleton(text: string, variant: TypeVariant, fontScale: number, available: number): { lines: number; width: number | '100%' } {
  const lines = estimateLines(text.length, variant, fontScale, available);
  const oneLine = estimatedTextWidth(text, variant, fontScale);
  return { lines, width: lines > 1 ? '100%' : available > 0 ? Math.min(available, oneLine) : oneLine };
}
