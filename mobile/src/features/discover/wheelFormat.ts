/**
 * DISC-04 Räder-Vergleich: the cells of the wheel-setup table in §3.9's notation. The server sends the stored numbers
 * (contract §6); the client formats them, so the table reads "19″ × 9,5J ET35", "255/35 R19", "−35 mm" in German and
 * "19″ × 9.5J ET35" in English. A part the owner left empty is left out; a cell with nothing says so with an en dash.
 */
import { formatLowering, formatWheel } from '@/lib/units';
import type { FormatLocale } from '@/lib/format';
import { formatNumber, keepNameTogether } from '@/lib/format';

/** Shown in a cell the owner left empty: a dash reads as "no value" in a table, an empty cell as a rendering fault. */
export const EMPTY_CELL = '–';
const NBSP = ' ';

type Num = number | null | undefined;

/** "19″ × 9,5J ET35"; the rear diameter falls back to the front one, which is the only one stored for a square set (ADR-112). */
export function wheelSizeCell(diameter: Num, width: Num, offset: Num, locale: FormatLocale): string {
  const text = formatWheel({ diameter: diameter ?? null, width: width ?? null, offset: offset ?? null }, locale);
  return text || EMPTY_CELL;
}

export type AxleWheel = { diameter: Num; width: Num; offset: Num };

const isEmpty = (value: Num) => value === null || value === undefined;

/**
 * Front and rear sizes. The rear diameter is only stored when it differs from the front (ADR-112); a rear with no value
 * at all is a square set, so it reads as the whole front ("19″ × 9,5J ET35" on both axles).
 */
export function wheelAxles(front: AxleWheel, rear: AxleWheel, locale: FormatLocale): { front: string; rear: string } {
  const frontCell = wheelSizeCell(front.diameter, front.width, front.offset, locale);
  const square = isEmpty(rear.diameter) && isEmpty(rear.width) && isEmpty(rear.offset);
  return {
    front: frontCell,
    rear: square ? frontCell : wheelSizeCell(rear.diameter ?? front.diameter, rear.width, rear.offset, locale),
  };
}

const TYRE = /^\s*(\d{3})\s*\/\s*(\d{2})\s*(Z?R)\s*(\d{2}(?:[.,]\d)?)\s*$/i;

/** "255/35 R19" whatever spacing was typed; anything that is not a tyre size stays as written. */
export function tyreCell(value: string | null | undefined, locale: FormatLocale): string {
  const text = value?.trim();
  if (!text) return EMPTY_CELL;
  const match = TYRE.exec(text);
  if (!match) return text;
  const [, width, aspect, construction = 'R', rim = ''] = match;
  const rimText = formatNumber(Number(rim.replace(',', '.')), locale, { maxFractionDigits: 1 });
  return `${width}/${aspect}${NBSP}${construction.toUpperCase()}${rimText}`;
}

/** One value for both axles when they match ("−35 mm"), else "−35 / −30 mm". */
function pairCell(front: Num, rear: Num, one: (value: number) => string, bare: (value: number) => string, unit: string): string {
  const hasFront = front !== null && front !== undefined;
  const hasRear = rear !== null && rear !== undefined;
  if (!hasFront && !hasRear) return EMPTY_CELL;
  if (hasFront && (!hasRear || rear === front)) return one(front);
  if (!hasFront && hasRear) return one(rear);
  return `${bare(front as number)} / ${bare(rear as number)}${NBSP}${unit}`;
}

/** Lowering is stored as millimetres down (0–200, §3.3) and reads as a signed change: "−35 mm". */
export function loweringCell(front: Num, rear: Num, locale: FormatLocale): string {
  const signed = (value: number) => formatLowering(-value, locale);
  const bare = (value: number) => signed(value).replace(/ mm$/u, '');
  return pairCell(front, rear, signed, bare, 'mm');
}

/** Spacers widen the track: "+10 mm", "+10 / +15 mm"; none fitted reads as the dash. */
export function spacerCell(front: Num, rear: Num, locale: FormatLocale): string {
  const clean = (value: Num) => (value === 0 ? null : value);
  const one = (value: number) => `+${formatNumber(value, locale)}${NBSP}mm`;
  const bare = (value: number) => `+${formatNumber(value, locale)}`;
  return pairCell(clean(front), clean(rear), one, bare, 'mm');
}

/** "BBS LM", "KW V3": brand and model as the owner named them. */
/** A model name this short stays on one line, so it never breaks inside itself ("TE37 / SL", DQ-452). */
const WHOLE_MODEL_MAX = 18;

export function partCell(brand: string | null | undefined, model: string | null | undefined): string {
  const name = model?.trim();
  // Brand and model join with a normal space, the model's own words with no-break spaces: "Rays Volk Racing / TE37 SL".
  // A longer one still keeps its code with a short suffix ("Volk Racing TE37\u00A0SL", DQ-452 round 4: the seed names are 19 and 21).
  const whole = name
    ? name.length <= WHOLE_MODEL_MAX
      ? keepNameTogether(name).replace(/ /g, '\u00A0')
      : keepNameTogether(name).replace(/ (\S+) (\S{1,4})$/u, ' $1\u00A0$2')
    : name;
  const text = [brand?.trim(), whole].filter(Boolean).join(' ');
  return text || EMPTY_CELL;
}
