import { keepNameTogether } from '@/lib/format';
import { metaLineText, WHOLE_PART_MAX } from '@/ui/textBreaks';

const PLATFORM_LABELS: Readonly<Record<string, string>> = { ios: 'iOS', android: 'Android' };

/** SET-06 (DQ-457): a known platform by its product name; anything else ("web", unknown values) is left out rather than shown raw. */
export function platformLabel(platform: string | null): string | null {
  return platform ? (PLATFORM_LABELS[platform.toLowerCase()] ?? null) : null;
}

const NO_BREAK_SPACE = '\u00a0';

/** Words that join a browser to its system ("Chrome auf Windows", "Safari on iPhone"): a line may always break around them. */
const CONNECTIVES = new Set(['auf', 'on', 'mit', 'with', 'via', 'unter', 'under']);

/** The characters a bound run may have at `fontScale`: WHOLE_PART_MAX at 100 %, fewer as the text grows (DQ-1012). */
export function boundRunMax(fontScale: number): number {
  return Math.floor(WHOLE_PART_MAX / Math.max(1, fontScale));
}

/** One part of a name between connectives: whole while it fits the budget, else only its model tail ("15 Pro", "S24 Ultra"). */
function bindPart(words: readonly string[], max: number): string {
  if (words.length < 2) return words.join(' ');
  if (words.join(' ').length <= max) return words.join(NO_BREAK_SPACE);
  const first = words.findIndex((word) => /\d/.test(word));
  if (first < 0 || first === words.length - 1) return words.join(' ');
  const tail = words.slice(first);
  if (tail.join(' ').length > max) return words.join(' ');
  return `${words.slice(0, first).join(' ')} ${tail.join(NO_BREAK_SPACE)}`;
}

/**
 * DQ-910, DQ-1012: a device name as the app shows it ("iPhone 15 Pro", "Galaxy S24-Ultra", "Chrome auf Windows"). A hyphen keeps
 * both halves together (`keepNameTogether`). Spaces are bound only where the bound run is short enough to fit a line of the
 * narrowest phone column at `fontScale` (`boundRunMax`): a short model name moves to the next line whole; a longer one binds only
 * its model tail ("iPhone / 15 Pro" at 200 %). A browser and its system are never bound across "auf"/"on", so "Chrome auf Windows"
 * reads "Chrome auf / Windows" at 200 % instead of one unbreakable run that the browser cuts inside a word ("Windo / ws"). The text
 * is set with hyphenation off (SET-06, SET-21, the HOME-02 new-device notice). Screen readers skip the joiners.
 */
export function deviceNameText(name: string, fontScale: number = 1): string {
  const max = boundRunMax(fontScale);
  const words = name.trim().split(/\s+/);
  const parts: string[] = [];
  let run: string[] = [];
  for (const word of words) {
    if (CONNECTIVES.has(word.toLowerCase()) && run.length > 0) {
      parts.push(bindPart(run, max), word);
      run = [];
    } else {
      run.push(word);
    }
  }
  if (run.length > 0) parts.push(bindPart(run, max));
  return keepNameTogether(parts.join(' '));
}

/**
 * SET-06 (DQ-458, N12 Build 12): "Android · App 1.0.0 · Gerade aktiv" wraps at its "·" first, and the space before each "·" is a
 * no-break space, so the "·" ends the line before the break and a line never starts with it (as the feed's meta lines and the
 * value segments of ADR-424). "Zuletzt vor 3 Tagen" (the last part) stays whole, and so does every part no longer than it.
 */
export function deviceMetaText(parts: readonly string[], used: string): string {
  return metaLineText([...parts, used].join(' · '), used.length, 'ends');
}
