/**
 * One rule for where names may break (M2.2 design QA DQ-282, DQ-291, DQ-295):
 * - a handle ("@paul.roadster") breaks only after its "." or "_", never inside a letter run and never with a hyphen: a zero-width
 *   space goes after them in the shown text. Screen readers skip it, so the accessible name stays the same;
 * - a vehicle name wraps at its spaces, never inside a word, and a hyphenated name stays whole ("GT-R"); a model letter stays with
 *   the number after it ("C 63", "A 45", DQ-310), as the two are one designation;
 * - a meta line "a · b · c" wraps at its "·" first, and the "·" stays at the end of the part before it. A short part ("vor 2 Std.",
 *   "Frankfurt am Main") stays whole; a longer one wraps at its own spaces.
 */
import { isNumericValue, keepFiguresTogether, keepNameTogether, type ValueSegment } from '@/lib/format';

const ZERO_WIDTH_SPACE = '\u200B';
const NO_BREAK_SPACE = '\u00A0';
const META_SEPARATOR = ' · ';

/** A part this short fits whole on its own line of a phone's row, beside a trailing button at 360 (about 130 of text). */
export const WHOLE_PART_MAX = 18;

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
