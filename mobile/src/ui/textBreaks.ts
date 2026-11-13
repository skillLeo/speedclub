/**
 * One rule for where names may break (M2.2 design QA DQ-282, DQ-291, DQ-295):
 * - a handle ("@paul.roadster") breaks only after its "." or "_", never inside a letter run and never with a hyphen: a zero-width
 *   space goes after them in the shown text. Screen readers skip it, so the accessible name stays the same;
 * - a vehicle name wraps at its spaces, never inside a word, and a hyphenated name stays whole ("GT-R"); a model letter stays with
 *   the number after it ("C 63", "A 45", DQ-310), as the two are one designation; in a display title a trailing code of at most
 *   4 characters stays with the word before it ("GT-R R34", "VIII (CD)", ADR-426 c) where a breakable space remains before the
 *   pair and the pair fits the line;
 * - a meta line "a · b · c" wraps at its "·" first, and the "·" stays at the end of the part before it. A short part ("vor 2 Std.",
 *   "Frankfurt am Main") stays whole; a longer one wraps at its own spaces.
 */
import { isNumericValue, keepFiguresTogether, keepNameTogether, WHOLE_VALUE_MAX, type ValueSegment } from '@/lib/format';

const ZERO_WIDTH_SPACE = '\u200B';
const NO_BREAK_SPACE = '\u00A0';
const META_SEPARATOR = ' · ';

/**
 * A part this short fits whole on its own line of a phone's row, beside a trailing button at 360 (about 130 of text). One budget
 * with a whole value (format WHOLE_VALUE_MAX, ADR-424), so the two cannot drift apart (NH-7).
 */
export const WHOLE_PART_MAX = WHOLE_VALUE_MAX;

/** "@paul.roadster" → "@paul.<U+200B>roadster": a break after "." or "_" when the handle is wider than its line. */
export function handleText(handle: string): string {
  return handle.replace(/([._])(?=\S)/g, `$1${ZERO_WIDTH_SPACE}`);
}

/** One or two capitals standing alone, then a space and a figure: the "C" of "C 63 AMG", the "A" of "A 45 S". */
const MODEL_LETTER = /(^|\s)(\p{Lu}{1,2}) (?=\p{N})/gu;

/** "Mercedes-Benz C 63 AMG W204" → "C<U+00A0>63": a model designation never splits after its letter (DQ-310). */
export function keepModelLettersTogether(text: string): string {
  return text.replace(MODEL_LETTER, `$1$2${NO_BREAK_SPACE}`);
}

/** A vehicle name: wraps at its spaces, a hyphenated name and a model designation ("C 63") stay whole. */
export function vehicleNameText(name: string): string {
  return keepModelLettersTogether(keepNameTogether(name));
}

/** ADR-426 c: a trailing code this short ("R34", "(CD)", "G82") never stands alone on the last line of a display title. */
export const TRAILING_CODE_MAX = 4;
/** Characters that draw nothing and do not count towards the code's length (the word joiner of "GT-R", a zero-width space). */
const INVISIBLE = /[\u2060\u200B]/g;

/**
 * "Nissan Skyline GT-R R34" → "Nissan Skyline GT-R<U+00A0>R34" (ADR-426 c as amended after code review round 3): the last
 * space-separated token, when it has at most TRAILING_CODE_MAX visible characters, is bound to the word before it, but only
 * when a breakable space remains before that pair ("Porsche 911", "Toyota GR86" and "Lamborghini Urus" stay breakable: bound,
 * they would be one word that a narrow line breaks inside) and `fits` says the pair ("GT-R<U+00A0>R34") fits the line at the
 * size it is drawn. A display-time step only: the stored name keeps its plain space, the Blade page binds the same way, and
 * the parity test folds every white space (U+00A0 included).
 */
export function bindTrailingCode(text: string, fits: (pair: string) => boolean): string {
  const at = text.lastIndexOf(' ');
  if (at <= 0) return text;
  const code = text.slice(at + 1);
  const before = text.slice(0, at);
  const visible = [...code.replace(INVISIBLE, '')].length;
  if (visible === 0 || visible > TRAILING_CODE_MAX || before.trim() === '') return text;
  // The breakable space that would remain before the pair.
  const remaining = before.lastIndexOf(' ');
  if (remaining <= 0 || before.slice(0, remaining).trim() === '') return text;
  const pair = `${before.slice(remaining + 1)}${NO_BREAK_SPACE}${code}`;
  return fits(pair) ? `${before}${NO_BREAK_SPACE}${code}` : text;
}

/**
 * A car name as display.title sets it: vehicleNameText, and, given `fits` (DisplayTitle knows the width and the drawn size),
 * its trailing short code bound to the word before it (ADR-426 c). Without `fits` nothing is bound: no width, no binding.
 * displayTitleLayout's displayTitleText supplies `fits` from the estimate.
 */
export function vehicleTitleText(name: string, fits?: (pair: string) => boolean): string {
  const text = vehicleNameText(name.trim());
  return fits ? bindTrailingCode(text, fits) : text;
}

/**
 * DQ-926: a car, part or brand name inside a sentence ("{{vehicle}} hat jetzt einen eigenen QR-Code"). The characters it sets
 * keep the name's own breaks: a word joiner after a hyphen of the name ("GT-R", "Slip-On"), a no-break space after a model
 * letter ("C 63"), and one binding its trailing code ("R34", "(CD)") to the word before it where a breakable space remains
 * before the pair (ADR-426 c; in running text the pair always fits a line when it is no longer than WHOLE_PART_MAX). They
 * cannot stop hyphenation: whether the name hyphenates is up to the Text it sits in. Where the surface takes a node, set it
 * in a SlotText slot (a span that never hyphenates); a plain string (a toast, a dialog title) takes the hyphenation of its Text.
 */
export function nameInText(name: string): string {
  return bindTrailingCode(vehicleNameText(name.trim()), (pair) => [...pair.replace(INVISIBLE, '')].length <= WHOLE_PART_MAX);
}

/**
 * DQ-927: an e-mail address, a URL or a username inside a sentence shows exactly the characters on file: it never breaks at a
 * hyphen of its own ("speed-club") and may break only after "@", "." and "/", where a zero-width space is set (screen readers
 * skip it; a copy on the web drops it, webDocument listenForCopy). Hyphenation is up to the Text it sits in: a SlotText slot,
 * or a Text with `hyphenate={false}`. Display only: never into a field or a request.
 */
export function identifierText(value: string): string {
  return keepNameTogether(value).replace(/([@./])(?=[^\s./\u2060\u200B])/g, `$1${ZERO_WIDTH_SPACE}`);
}

/**
 * DQ-927: product names that appear inside our own copy. They never hyphenate ("Google Authentica- / tor"); SlotText's `keep`
 * sets them in a span that does not. Longest first, so "Google Authenticator" wins over "Authenticator".
 */
export const PRODUCT_NAMES: readonly string[] = ['Google Authenticator', 'Google Play', 'App Store', 'Authenticator', '1Password', 'Bitwarden'];

const isHandle = (part: string) => /^@\S+$/.test(part);

/**
 * "@jann.ptrs · BMW M4 Competition · vor 2 Std.", made to wrap at the "·" first and never inside a word. `separator` says on which
 * line the "·" stays when the line breaks there: at the end of the part before it (the feed's rule), or at the start of the next
 * (a status meta beside a pill, "Inhalt entfernt / · 23.10.2026", DQ-445a).
 */
export function metaLineText(meta: string, wholePartMax: number = WHOLE_PART_MAX, separator: 'ends' | 'starts' = 'ends'): string {
  const parts = meta.split(META_SEPARATOR);
  return parts
    .map((part) => {
      if (isHandle(part)) return handleText(part);
      const whole = parts.length > 1 && part.length <= wholePartMax ? part.replace(/ /g, NO_BREAK_SPACE) : part;
      return vehicleNameText(whole);
    })
    .join(separator === 'ends' ? `${NO_BREAK_SPACE}· ` : ` ·${NO_BREAK_SPACE}`);
}

const DIFF_PART = /\s+·\s+/;
const DIFF_ARROW = /\s+→\s+/;

/**
 * DQ-313, one wrap rule for meta and diff: a build update's diff ("Aero & Karosserie: Serie → Maxton Design Seitenschweller · −35 mm")
 * wraps at its "·" first. Before and after stay together around "→", so the line never ends on "Serie →"; a short part stays whole,
 * a longer one wraps at its own spaces with its figures kept together. `wholeParts` false is for a large font: a part then wraps
 * anywhere between words, and after an arrow too, so a long pair cannot run past its column.
 */
export function diffSegments(diff: string, wholeParts: boolean = true): ValueSegment[] {
  const parts = diff.trim().split(DIFF_PART);
  const arrow = wholeParts ? `${NO_BREAK_SPACE}→${NO_BREAK_SPACE}` : `${NO_BREAK_SPACE}→ `;
  return parts.flatMap((part, partIndex) => {
    const whole = wholeParts && part.length <= WHOLE_PART_MAX;
    const sides = part.split(DIFF_ARROW).flatMap((side, sideIndex): ValueSegment[] => {
      const kept = keepFiguresTogether(side.trim(), wholeParts);
      const text = whole ? kept.replace(/ /g, NO_BREAK_SPACE) : kept;
      const segment = { text, numeric: isNumericValue(side) };
      return sideIndex === 0 ? [segment] : [{ text: arrow, numeric: false }, segment];
    });
    return partIndex === 0 ? sides : [{ text: `${NO_BREAK_SPACE}· `, numeric: false }, ...sides];
  });
}
