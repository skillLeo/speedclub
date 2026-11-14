/**
 * Android widget "Mein Auto" (M4.19): how wide the widget's text draws, so its layout (layout.ts) can tell a fit from a cut before
 * Android draws it. A widget's box is fixed and RemoteViews cannot measure text, so the estimate decides what is shown.
 *
 * - Inter (callout, callout.strong, label.caps): the advances of `src/ui/specLabelMetrics.ts` (read from the shipped TTFs).
 * - Archivo SemiExpanded SemiBold (display.wordmark, the car name): the table below, read from the shipped
 *   `mobile/assets/fonts/ArchivoSemiExpanded-SemiBold.ttf` (unitsPerEm 1000; hmtx advance / unitsPerEm, rounded up to 3 decimals;
 *   `tests/widget/metrics.test.ts` re-reads the font file and compares). Kerning is not read: every pair adds
 *   `WORDMARK_PAIR_ALLOWANCE`, a safety allowance (not a measured value), so an estimate errs wide and never claims a fit the
 *   launcher then cuts.
 */
import { estimatedInterWidth } from '@/ui/specLabelMetrics';

export const WORDMARK_EM: Readonly<Record<string, number>> = {
  A: 0.809, B: 0.801, C: 0.834, D: 0.831, E: 0.769, F: 0.699, G: 0.904, H: 0.849, I: 0.314, J: 0.642, K: 0.801, L: 0.643, M: 0.978,
  N: 0.849, O: 0.9, P: 0.763, Q: 0.9, R: 0.819, S: 0.759, T: 0.717, U: 0.834, V: 0.768, W: 1.073, X: 0.8, Y: 0.769, Z: 0.734,
  a: 0.648, b: 0.661, c: 0.636, d: 0.661, e: 0.653, f: 0.368, g: 0.66, h: 0.65, i: 0.266, j: 0.264, k: 0.615, l: 0.266, m: 0.993,
  n: 0.65, o: 0.672, p: 0.661, q: 0.661, r: 0.4, s: 0.604, t: 0.382, u: 0.65, v: 0.591, w: 0.865, x: 0.615, y: 0.591, z: 0.57,
  '0': 0.666, '1': 0.623, '2': 0.665, '3': 0.669, '4': 0.657, '5': 0.668, '6': 0.67, '7': 0.634, '8': 0.675, '9': 0.669,
  'Ä': 0.809, 'Ö': 0.9, 'Ü': 0.834, 'ä': 0.648, 'ö': 0.672, 'ü': 0.65, 'ß': 0.691, 'é': 0.653, 'è': 0.653, 'à': 0.648,
  ' ': 0.26, '.': 0.306, ',': 0.306, '–': 0.563, '-': 0.375, '/': 0.302, '(': 0.353, ')': 0.353, '&': 0.827, "'": 0.235,
  '+': 0.678, ':': 0.324,
};

/** Any character outside the table: the widest letter (W), so a rare glyph never makes the estimate narrow. */
export const WORDMARK_FALLBACK_EM = 1.073;
/** Per adjacent pair, in em: a safety allowance for positive kerning and rounding (not read from the font). */
export const WORDMARK_PAIR_ALLOWANCE = 0.02;

export type WidgetFace = 'wordmark' | 'medium' | 'semibold';

/** The one-line width of `text` in dp at `fontSize` (dp) with `tracking` (dp after every character, as Android adds it). */
export function estimatedWidth(text: string, face: WidgetFace, fontSize: number, tracking: number): number {
  if (face !== 'wordmark') return estimatedInterWidth(text, fontSize, tracking, face);
  const chars = [...text];
  if (chars.length === 0) return 0;
  const em = chars.reduce((sum, char) => sum + (WORDMARK_EM[char] ?? WORDMARK_FALLBACK_EM), 0) + (chars.length - 1) * WORDMARK_PAIR_ALLOWANCE;
  return em * fontSize + chars.length * tracking;
}

/**
 * How many lines `text` takes when Android wraps it at spaces into `width`: greedy, like StaticLayout's simple strategy.
 * A single word wider than the line returns Infinity: Android would break it mid-word, which the widget treats as no fit.
 */
export function wrappedLines(text: string, width: number, measure: (part: string) => number): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let lines = 1;
  let line = '';
  for (const word of words) {
    if (measure(word) > width) return Number.POSITIVE_INFINITY;
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) {
      line = next;
    } else {
      lines += 1;
      line = word;
    }
  }
  return lines;
}
