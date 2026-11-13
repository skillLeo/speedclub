/**
 * ADR-425/426: the size of a `display.title`, decided before its first paint from the width its parent lays it out at. Pure,
 * so Jest covers it; DisplayTitle seeds its state from it. The Blade pages decide with the same tables and the same thresholds
 * (`web/app/Support/DisplayTitleLayout.php`): one source of decision on both sides (ADR-425 as amended after code review
 * round 3).
 *
 * ADR-426 a, the rule. The title shrinks (to `typeScale.displayTitle.minSize` / `minLineHeight`, 24/28) only when shrinking
 * saves a line:
 * - placement `page`: the full size (30/34 on phones and tablets, 44/48 on the web desktop) while it needs at most 2 lines,
 *   else 24/28, never truncated;
 * - placement `card` (a title in a fixed card or on a photo band): 30/34 at every width while it fits 1 line; 24/28 when that
 *   brings it to exactly 1 line; otherwise the page rule at 30/34 (2 lines stay at 30, 3 or more shrink to 24).
 * A word wider than the line would break inside itself on the screen, so it counts as more lines than any threshold: an
 * estimated overflow at the full size that disappears at 24 shrinks the title, as the Blade page does.
 *
 * The estimate wraps the title at its breakable spaces (U+0020) with the advance widths of the shipped font plus its positive
 * pair kerning (DISPLAY_TITLE_KERNING: per adjacent pair the largest positive adjustment the font's GPOS applies; negative
 * kerning is ignored). Archivo kerns most pairs tighter, but some wider ("5-" and "-1" +0.04 em, "A/" +0.035 em), so the
 * plain unkerned sum is not an upper bound; with the positive pairs added it is, and a line is never estimated narrower than
 * the screen draws it. The estimate therefore never claims a fit the screen denies. It is final wherever it is unambiguous:
 * the title then never measures itself. Only Android 14+ above font scale 1 is ambiguous (it scales sp non-linearly, so the
 * drawn size lies between 1× and the font scale): where the answer differs across that range, and for copy that may
 * hyphenate, the title is laid out invisibly until it has counted its own lines.
 */
import { Platform } from 'react-native';

import { isWeb } from '@/lib/platform';
import { typeScale, typography, typographyDesktop } from '@/theme';

import { vehicleTitleText } from './textBreaks';

/**
 * Archivo SemiExpanded 600 (`mobile/assets/fonts/ArchivoSemiExpanded-SemiBold.ttf`, unitsPerEm 1000): advance width / unitsPerEm
 * from fontTools 4.68 (`hmtx`), rounded up to 3 decimals. display.title sets proportional figures (no `tnum`), so the digits
 * are the default glyphs. A letter with a diacritic has its base letter's advance in this font (checked for U+00C0–U+024F),
 * so "Š" counts as "S". U+202F is not in the cmap: the space stands in. Word joiner and zero-width space draw nothing.
 */
export const DISPLAY_TITLE_ADVANCES: Readonly<Record<string, number>> = {
  '0': 0.666, '1': 0.623, '2': 0.665, '3': 0.669, '4': 0.657, '5': 0.668, '6': 0.67, '7': 0.634, '8': 0.675, '9': 0.669,
  '.': 0.306, ',': 0.306, '–': 0.563, '—': 1.125, '-': 0.375, '/': 0.302, '+': 0.678, '×': 0.678, '−': 0.678,
  ' ': 0.26, '\u00a0': 0.26, '\u202f': 0.26, '\u2060': 0, '\u200b': 0,
  '(': 0.353, ')': 0.353, '&': 0.827, "'": 0.235, '’': 0.282, '·': 0.376, ':': 0.324, '!': 0.305, '?': 0.647, '"': 0.438,
  '„': 0.49, '“': 0.49, '%': 1.029, '#': 0.661, '*': 0.419, '″': 0.338, '′': 0.164, '°': 0.4, ß: 0.691,
  A: 0.809, B: 0.801, C: 0.834, D: 0.831, E: 0.769, F: 0.699, G: 0.904, H: 0.849, I: 0.314, J: 0.642, K: 0.801, L: 0.643, M: 0.978,
  N: 0.849, O: 0.9, P: 0.763, Q: 0.9, R: 0.819, S: 0.759, T: 0.717, U: 0.834, V: 0.768, W: 1.073, X: 0.8, Y: 0.769, Z: 0.734,
  a: 0.648, b: 0.661, c: 0.636, d: 0.661, e: 0.653, f: 0.368, g: 0.66, h: 0.65, i: 0.266, j: 0.264, k: 0.615, l: 0.266, m: 0.993,
  n: 0.65, o: 0.672, p: 0.661, q: 0.661, r: 0.4, s: 0.604, t: 0.382, u: 0.65, v: 0.591, w: 0.865, x: 0.615, y: 0.591, z: 0.57,
};

/**
 * ADR-425 as amended: the positive pair kerning of Archivo SemiExpanded 600, in em, the shared table of the app and the Blade
 * pages (`web/app/Support/DisplayTitleLayout.php` parses this literal in its parity test). Derived with fontTools 4.68 from
 * `mobile/assets/fonts/ArchivoSemiExpanded-SemiBold.ttf`: every GPOS PairPos lookup (formats 1 and 2, class-based included) of
 * the `kern` feature for the default script and language (DFLT/dflt, lookup 0, the same for latn), glyphs mapped to characters
 * through the cmap for the characters the estimate knows (A–Z, a–z, 0–9 as the default proportional figures, . , – - / + × ( )
 * & ' space U+00A0; U+202F is not in the cmap), the largest XAdvance adjustment per pair where it is above 0, / unitsPerEm
 * (1000), rounded up to 3 decimals. Every other pair of the font kerns at 0 or tighter.
 */
export const DISPLAY_TITLE_KERNING: Readonly<Record<string, number>> = {
  'A/': 0.035, 'K/': 0.035, 'L/': 0.035, 'f7': 0.025, 'f)': 0.025, "f'": 0.01, 't)': 0.008,
  '0–': 0.04, '0-': 0.04, "0'": 0.005, '1–': 0.04, '1-': 0.04, '2–': 0.01, '2-': 0.01, '3–': 0.04, '3-': 0.04,
  '4–': 0.04, '4-': 0.04, '5–': 0.04, '5-': 0.04, '6–': 0.02, '6-': 0.02, '8–': 0.03, '8-': 0.03, '9–': 0.04, '9-': 0.04,
  '–0': 0.04, '–1': 0.04, '–2': 0.04, '–3': 0.04, '–4': 0.04, '–5': 0.04, '–6': 0.04, '–8': 0.03, '–9': 0.02,
  '-0': 0.04, '-1': 0.04, '-2': 0.04, '-3': 0.04, '-4': 0.04, '-5': 0.04, '-6': 0.04, '-8': 0.03, '-9': 0.02,
};

/** Any other character: the widest letter (W), so an unknown glyph never makes a line look shorter than it is. */
const FALLBACK_EM = Math.max(...Object.entries(DISPLAY_TITLE_ADVANCES).filter(([char]) => /^\p{L}$/u.test(char)).map(([, em]) => em));
/** The role's tracking in em (−1 %, the same at 30, 44 and 24). */
const TRACKING_EM = typography.displayTitle.letterSpacing / typography.displayTitle.fontSize;
/** Breakable spaces only: U+00A0 ("C 63", "VIII (CD)") and the word joiner ("GT-R") keep their words whole. */
const BREAK = / +/;
/** The comparison tolerance of a width, the same as the Blade page's (floating point only, not a slack). */
const EPSILON = 1e-6;
/** Android 14 (API 34) scales sp non-linearly: large text grows less than the font scale (ADR-423). */
const NON_LINEAR_SCALING_API = 34;

/** The table character a character is measured as: itself, else its base letter (NFD), else null (the fallback width). */
function tableChar(char: string): string | null {
  if (DISPLAY_TITLE_ADVANCES[char] !== undefined) return char;
  const base = char.normalize('NFD').charAt(0);
  return DISPLAY_TITLE_ADVANCES[base] !== undefined ? base : null;
}

function advanceOf(char: string): number {
  const own = tableChar(char);
  const em = own === null ? FALLBACK_EM : (DISPLAY_TITLE_ADVANCES[own] ?? FALLBACK_EM);
  return em === 0 ? 0 : em + TRACKING_EM;
}

/** The positive kerning between two drawn characters (0 for a pair the font kerns at 0 or tighter, or does not know). */
function kerningOf(left: string | null, right: string | null): number {
  if (left === null || right === null) return 0;
  const a = tableChar(left);
  const b = tableChar(right);
  return a === null || b === null ? 0 : (DISPLAY_TITLE_KERNING[a + b] ?? 0);
}

/** A run of text measured: its width in em and its first and last drawn character (a zero-advance joiner is skipped). */
type Run = { em: number; first: string | null; last: string | null };

function runOf(text: string): Run {
  let em = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const char of text) {
    const advance = advanceOf(char);
    // The word joiner and the zero-width space draw nothing; the shaper kerns across them, so the pair is the visible one.
    if (advance === 0) continue;
    em += advance + kerningOf(last, char);
    first ??= char;
    last = char;
  }
  return { em, first, last };
}

/**
 * The width of a text in display.title at `fontSize`, tracking included: the unkerned advances plus the font's positive pair
 * kerning, so never less than the screen draws it (ADR-425 as amended).
 */
export function estimatedTitleWidth(text: string, fontSize: number): number {
  return runOf(text).em * fontSize;
}

export type EstimatedLines = {
  lines: number;
  /** A word is wider than the line: the screen would break inside it. */
  overflow: boolean;
  /** The width of each line, for a skeleton that draws them. */
  widths: number[];
};

/**
 * The lines a title takes when it breaks only at its spaces, greedily, each word at its estimated width. A word wider than
 * the line counts as one line here, so `overflow` reports it. Balanced wrapping (web `text-wrap: balance`, Android
 * `textBreakStrategy="balanced"`) evens the lines out but keeps their number.
 */
export function estimatedTitleLines(text: string, fontSize: number, width: number): EstimatedLines {
  const words = text.split(BREAK).filter((word) => word !== '');
  const space = runOf(' ');
  const widths: number[] = [];
  let line: Run | null = null;
  let overflow = false;
  for (const word of words) {
    const run = runOf(word);
    if (run.em * fontSize > width + EPSILON) overflow = true;
    if (line === null) {
      line = run;
      continue;
    }
    const joined: number = line.em + kerningOf(line.last, ' ') + space.em + kerningOf(' ', run.first) + run.em;
    if (joined * fontSize > width + EPSILON) {
      widths.push(line.em * fontSize);
      line = run;
    } else {
      line = { em: joined, first: line.first, last: run.last ?? line.last };
    }
  }
  widths.push((line?.em ?? 0) * fontSize);
  return { lines: widths.length, overflow, widths };
}

/**
 * ADR-426 a/b: `page` for the title of a page (VEH-01 on phones and tablets, AUTH-02, GAR-04, a stacked phone hero); `card`
 * for a title in a fixed card or on a photo band (FeaturedHero on its photo, the VEH-01/GAR-02 side card on the web desktop).
 */
export type DisplayTitlePlacement = 'page' | 'card';
export type DisplayTitleSize = 'full' | 'shrunk';
/** `vehicle`: a car name (never hyphenated, its trailing code bound where ADR-426 c allows); `copy`: a sentence that may hyphenate. */
export type DisplayTitleKind = 'vehicle' | 'copy';

/** The most lines the full size may take on a page (09 §4.2 "max 2 lines"). */
export const DISPLAY_TITLE_PAGE_MAX_LINES = typeScale.displayTitle.maxLines;

/**
 * ADR-426 a as a function of the title's lines at the full size and at 24 (Infinity for a word wider than the line).
 * `shrunkLines` is only read for a card whose full size takes exactly 2 lines (`needsShrunkLines`); pass null when it is not
 * known and not needed.
 */
export function displayTitleSize(placement: DisplayTitlePlacement, fullLines: number, shrunkLines: number | null): DisplayTitleSize {
  if (fullLines <= 1) return 'full';
  if (placement === 'card' && shrunkLines === 1) return 'shrunk';
  return fullLines <= DISPLAY_TITLE_PAGE_MAX_LINES ? 'full' : 'shrunk';
}

/** Whether the rule needs the lines at 24 too: only a card that takes exactly 2 lines at 30 (1 line at 24 → 24, else 30). */
export function needsShrunkLines(placement: DisplayTitlePlacement, fullLines: number): boolean {
  return placement === 'card' && fullLines === DISPLAY_TITLE_PAGE_MAX_LINES;
}

/** The unscaled full size: the desktop size for a page title on the web desktop, else the mobile one (a card: at every width). */
export function displayTitleFontSize(desktop: boolean): number {
  return (desktop ? typographyDesktop.displayTitle : typography.displayTitle).fontSize;
}

/** The unscaled full line height, as displayTitleFontSize. */
export function displayTitleLineHeight(desktop: boolean): number {
  return (desktop ? typographyDesktop.displayTitle : typography.displayTitle).lineHeight;
}

/** The shrunk pair (ADR-426 g): `display.title` minSize / minLineHeight, 24/28, on every width. */
export const DISPLAY_TITLE_SHRUNK = {
  fontSize: typeScale.displayTitle.minSize,
  lineHeight: typeScale.displayTitle.minLineHeight,
} as const;

/** The font scales the title may be drawn at: exactly the font scale, or between 1 and it on Android 14+ (ADR-423). */
export function drawnScale(fontScale: number, platform: string = Platform.OS, version: unknown = Platform.Version): { low: number; high: number } {
  const nonLinear = !isWeb && platform === 'android' && Number(version) >= NON_LINEAR_SCALING_API && fontScale > 1;
  return nonLinear ? { low: 1, high: fontScale } : { low: fontScale, high: fontScale };
}

/**
 * ADR-426 c as amended: the text display.title draws at `fontSize` (the drawn size, font scale included) in `width`. A car name
 * keeps its hyphenated words and model designations whole (vehicleNameText), and its trailing short code is bound to the word
 * before it only where a breakable space remains before that pair and the pair fits the line at this size; without a width
 * nothing is bound. Copy is drawn as it is.
 */
export function displayTitleText(name: string, kind: DisplayTitleKind, fontSize: number, width: number | null): string {
  if (kind === 'copy') return name;
  if (width === null || !Number.isFinite(width) || width <= 0) return vehicleTitleText(name);
  return vehicleTitleText(name, (pair) => estimatedTitleWidth(pair, fontSize) <= width + EPSILON);
}

export type DisplayTitleEstimate = {
  /** The title as given (a car name, or copy for `kind: 'copy'`). */
  name: string;
  kind: DisplayTitleKind;
  /** The width the title is laid out at. */
  width: number;
  /** The unscaled full size (displayTitleFontSize). */
  fontSize: number;
  placement: DisplayTitlePlacement;
  /**
   * The font scales the full size may be drawn at, lowest and highest. Linear platforms (web, iOS, Android before 14) draw at
   * exactly the font scale; Android 14+ scales large sp less than the font scale, so somewhere between 1 and it.
   */
  scale: { low: number; high: number };
  /** False: bind no trailing code (a title whose width only its own box tells). */
  bind?: boolean;
};

export type DisplayTitleFit = {
  shrunk: boolean;
  /** The estimate is final; false only where Android 14+'s scale range or hyphenating copy leaves the answer open. */
  certain: boolean;
  /** Its lines at the size it is set at, at the highest scale. */
  lines: number;
  /** The width of each of those lines. */
  widths: number[];
  /** The text as it is drawn at that size (displayTitleText). */
  text: string;
};

/** The texts drawn at the full size and at 24: the trailing code is bound per size (ADR-426 c), at the highest scale. */
function textsOf({ name, kind, width, fontSize, scale, bind = true }: DisplayTitleEstimate): { full: string; small: string } {
  const bindWidth = bind ? width : null;
  return {
    full: displayTitleText(name, kind, fontSize * scale.high, bindWidth),
    small: displayTitleText(name, kind, DISPLAY_TITLE_SHRUNK.fontSize * scale.high, bindWidth),
  };
}

type Extreme = { full: EstimatedLines; small: EstimatedLines; fullCount: number; smallCount: number };

function extremeAt(texts: { full: string; small: string }, fontSize: number, scale: number, width: number): Extreme {
  const full = estimatedTitleLines(texts.full, fontSize * scale, width);
  const small = estimatedTitleLines(texts.small, DISPLAY_TITLE_SHRUNK.fontSize * scale, width);
  // A word wider than the line breaks inside itself: more lines than any threshold (the Blade page's PHP_INT_MAX).
  return { full, small, fullCount: full.overflow ? Infinity : full.lines, smallCount: small.overflow ? Infinity : small.lines };
}

/**
 * The class of an extreme as the rule reads it. Lines only grow with the scale, so where both extremes are in one class every
 * scale between them is too, and so is the size. A card is not monotone in its size (1 line at 30, 1 at 24, 2 at 30, 3+ at
 * 24), hence its classes.
 */
function classOf(placement: DisplayTitlePlacement, extreme: Extreme): string {
  if (placement === 'page') return extreme.fullCount <= DISPLAY_TITLE_PAGE_MAX_LINES ? 'full' : 'shrunk';
  if (extreme.fullCount <= 1) return 'one';
  if (extreme.fullCount === DISPLAY_TITLE_PAGE_MAX_LINES) return `two:${extreme.smallCount === 1}`;
  return 'many';
}

/**
 * The size the title is set at, and whether that is final. The rule reads the conservative estimate at the width (no slack:
 * the Blade page decides at the same thresholds). It is final unless the lowest and the highest scale it may be drawn at
 * (Android 14+ above font scale 1) fall into different classes, or copy may hyphenate where hyphenation could change it.
 */
export function estimateDisplayTitle(input: DisplayTitleEstimate): DisplayTitleFit {
  const { width, fontSize, placement, scale, kind } = input;
  if (!Number.isFinite(width) || width <= 0) return { shrunk: false, certain: false, lines: 1, widths: [], text: input.name };
  const texts = textsOf(input);
  const low = extremeAt(texts, fontSize, scale.low, width);
  const high = extremeAt(texts, fontSize, scale.high, width);
  const shrunk = displayTitleSize(placement, high.fullCount, high.smallCount) === 'shrunk';
  const drawn = shrunk ? high.small : high.full;
  // Hyphenation only removes lines: a page title at the full size stays there, and so does a card title on one line.
  const hyphenSafe = kind !== 'copy' || (!shrunk && (placement === 'page' || high.fullCount === 1));
  return {
    shrunk,
    certain: classOf(placement, low) === classOf(placement, high) && hyphenSafe,
    lines: drawn.lines,
    widths: drawn.widths,
    text: shrunk ? texts.small : texts.full,
  };
}

/**
 * ADR-426 d: whether the car name certainly takes one line in a card, at 30 or at 24, which is the case exactly when it takes
 * one line at 24 at the highest scale it can be drawn at (the card rule then sets it on that one line).
 */
export function certainlyOneLine(name: string, width: number, scale: { low: number; high: number }): boolean {
  if (!Number.isFinite(width) || width <= 0) return false;
  const size = DISPLAY_TITLE_SHRUNK.fontSize * scale.high;
  const small = estimatedTitleLines(displayTitleText(name, 'vehicle', size, width), size, width);
  return small.lines === 1 && !small.overflow;
}

/**
 * Whether the car name takes one line at 24, when the estimate is sure of it either way (true or false), else null (only
 * within Android 14+'s scale range). A card that counted 2 lines at 30 reads it, so it shrinks or stays without laying itself
 * out at 24 first. `bind` false: no trailing code is bound (a title without a known width).
 */
export function shrunkFitsOneLine(name: string, width: number, scale: { low: number; high: number }, bind: boolean = true): boolean | null {
  if (!Number.isFinite(width) || width <= 0) return null;
  const text = displayTitleText(name, 'vehicle', DISPLAY_TITLE_SHRUNK.fontSize * scale.high, bind ? width : null);
  const high = estimatedTitleLines(text, DISPLAY_TITLE_SHRUNK.fontSize * scale.high, width);
  if (high.lines === 1 && !high.overflow) return true;
  const low = estimatedTitleLines(text, DISPLAY_TITLE_SHRUNK.fontSize * scale.low, width);
  return low.lines > 1 || low.overflow ? false : null;
}
