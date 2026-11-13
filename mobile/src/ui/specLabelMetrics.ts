/**
 * SpecStrip 2.0 (09 §5, ADR-422 d): the Inter advances the strip's fit estimate uses for its three text roles beside the
 * numeral, shared with `web/app/Support/SpecStripLayout.php` (Pest compares both tables key by key and against the font files).
 *
 * - `label.caps` (data label, LEISTUNG) and `label.unit` (unit, Nm) are Inter SemiBold 11/14 with +4 % tracking;
 * - `caption` (provenance, Herstellerangabe) is Inter Medium 12/16 with 0.1 tracking.
 *
 * Read from the shipped TTFs (`mobile/assets/fonts/Inter-SemiBold.ttf`, `Inter-Medium.ttf`, byte-identical to the web copies,
 * unitsPerEm 2048) with fontTools 4.68: advance width / unitsPerEm, rounded up to 3 decimals. U+202F stands as itself (it is in
 * Inter's cmap). Kerning: per adjacent pair the largest positive XAdvance of the `kern` feature's PairPos lookups among these
 * characters (`LABEL_SEMIBOLD_KERN`, `LABEL_MEDIUM_KERN`), so an estimate is never narrower than the screen draws it.
 * A separate module, so the numeral table stays the first glyph table of `specStripLayout.ts` (the PHP parity parser reads it).
 */
export const LABEL_SEMIBOLD_EM: Readonly<Record<string, number>> = {
  A: 0.728, B: 0.66, C: 0.737, D: 0.723, E: 0.606, F: 0.588, G: 0.75, H: 0.746, I: 0.277, J: 0.58, K: 0.704, L: 0.566, M: 0.923,
  N: 0.76, O: 0.769, P: 0.646, Q: 0.773, R: 0.653, S: 0.651, T: 0.661, U: 0.736, V: 0.728, W: 1.021, X: 0.72, Y: 0.714, Z: 0.653,
  a: 0.575, b: 0.625, c: 0.583, d: 0.625, e: 0.592, f: 0.389, g: 0.626, h: 0.613, i: 0.262, j: 0.262, k: 0.57, l: 0.262, m: 0.901,
  n: 0.612, o: 0.609, p: 0.625, q: 0.625, r: 0.397, s: 0.55, t: 0.354, u: 0.613, v: 0.587, w: 0.84, x: 0.569, y: 0.589, z: 0.566,
  '0': 0.66, '1': 0.423, '2': 0.624, '3': 0.637, '4': 0.667, '5': 0.613, '6': 0.64, '7': 0.577, '8': 0.641, '9': 0.64,
  'Ä': 0.728, 'Ö': 0.769, 'Ü': 0.736, 'ä': 0.575, 'ö': 0.609, 'ü': 0.613, 'ß': 0.644,
  ' ': 0.252, '\u00A0': 0.252, '\u202F': 0.166, '.': 0.319, ',': 0.319, '–': 0.5, '-': 0.466, '/': 0.379, '(': 0.374, ')': 0.374,
  '³': 0.464, '²': 0.454, '·': 0.319, '&': 0.663, "'": 0.326, '+': 0.673, '×': 0.673, ':': 0.319, '%': 1.005,
};

export const LABEL_MEDIUM_EM: Readonly<Record<string, number>> = {
  A: 0.709, B: 0.657, C: 0.734, D: 0.722, E: 0.604, F: 0.59, G: 0.748, H: 0.745, I: 0.273, J: 0.576, K: 0.688, L: 0.566, M: 0.913,
  N: 0.757, O: 0.767, P: 0.642, Q: 0.769, R: 0.648, S: 0.646, T: 0.653, U: 0.741, V: 0.709, W: 1.003, X: 0.701, Y: 0.697, Z: 0.641,
  a: 0.568, b: 0.619, c: 0.578, d: 0.619, e: 0.588, f: 0.38, g: 0.62, h: 0.602, i: 0.252, j: 0.252, k: 0.56, l: 0.252, m: 0.889,
  n: 0.602, o: 0.605, p: 0.619, q: 0.619, r: 0.387, s: 0.539, t: 0.341, u: 0.602, v: 0.575, w: 0.83, x: 0.558, y: 0.576, z: 0.56,
  '0': 0.646, '1': 0.416, '2': 0.617, '3': 0.627, '4': 0.657, '5': 0.604, '6': 0.63, '7': 0.572, '8': 0.63, '9': 0.63,
  'Ä': 0.709, 'Ö': 0.767, 'Ü': 0.741, 'ä': 0.568, 'ö': 0.605, 'ü': 0.602, 'ß': 0.63,
  ' ': 0.267, '\u00A0': 0.267, '\u202F': 0.174, '.': 0.304, ',': 0.304, '–': 0.5, '-': 0.463, '/': 0.37, '(': 0.369, ')': 0.369,
  '³': 0.455, '²': 0.448, '·': 0.304, '&': 0.654, "'": 0.313, '+': 0.668, '×': 0.668, ':': 0.304, '%': 0.994,
};

/** The largest positive pair kerning of Inter SemiBold among the characters above, in em (47 units of 2048, rounded up). */
export const LABEL_SEMIBOLD_KERN = 0.023;
/** The same for Inter Medium (49 units of 2048, rounded up). */
export const LABEL_MEDIUM_KERN = 0.024;

/** Any character outside a table: its widest letter (W), so an estimate never claims a fit the screen denies. */
export function widestLetter(table: Readonly<Record<string, number>>): number {
  return Math.max(...Object.entries(table).filter(([char]) => /^\p{L}$/u.test(char)).map(([, em]) => em));
}

export const LABEL_SEMIBOLD_FALLBACK_EM = widestLetter(LABEL_SEMIBOLD_EM);
export const LABEL_MEDIUM_FALLBACK_EM = widestLetter(LABEL_MEDIUM_EM);

/**
 * The one-line width of `text` in an Inter role: the advances at `fontSize`, the face's positive kerning bound between each two
 * characters, and the tracking after every character (CSS letter-spacing and RN letterSpacing both add it after the last one).
 */
export function estimatedInterWidth(text: string, fontSize: number, tracking: number, face: 'semibold' | 'medium'): number {
  const table = face === 'semibold' ? LABEL_SEMIBOLD_EM : LABEL_MEDIUM_EM;
  const fallback = face === 'semibold' ? LABEL_SEMIBOLD_FALLBACK_EM : LABEL_MEDIUM_FALLBACK_EM;
  const kern = face === 'semibold' ? LABEL_SEMIBOLD_KERN : LABEL_MEDIUM_KERN;
  const chars = [...text];
  if (chars.length === 0) return 0;
  const em = chars.reduce((sum, char) => sum + (table[char] ?? fallback), 0) + (chars.length - 1) * kern;
  return em * fontSize + chars.length * tracking;
}

/** `label.caps` sets its text in capitals: "ß" becomes "SS", as CSS `text-transform: uppercase` and PHP `mb_strtoupper` do. */
export function capsOf(label: string): string {
  return label.toLocaleUpperCase('de-DE');
}
