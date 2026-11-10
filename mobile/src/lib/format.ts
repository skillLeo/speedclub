/**
 * Locale-aware numbers and dates (02_PRODUCT_SPEC.md §3.9). Dates always render in Europe/Berlin.
 * Hermes has no Intl.RelativeTimeFormat, so the relative labels are a small table in this file.
 */
import { differenceInCalendarDays, differenceInHours, differenceInMinutes } from 'date-fns';

import { now as clockNow } from './clock';

export type FormatLocale = 'de' | 'en';

export const TIME_ZONE = 'Europe/Berlin';
const MINUS = '−';
const DEFAULT_MAX_FRACTION_DIGITS = 3;
const INTL_LOCALE: Record<FormatLocale, string> = { de: 'de-DE', en: 'en-GB' };

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: FormatLocale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${options.minimumFractionDigits}|${options.maximumFractionDigits}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], options);
    numberFormats.set(key, formatter);
  }
  return formatter;
}

function dateFormat(locale: FormatLocale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone: TIME_ZONE });
    dateFormats.set(key, formatter);
  }
  return formatter;
}

const NUMBER_SEPARATORS: Record<FormatLocale, { group: string; decimal: string }> = {
  de: { group: '.', decimal: ',' },
  en: { group: ',', decimal: '.' },
};

/**
 * A number that uses the group separator: 1 to 3 digits, the first of them 1 to 9, then only groups of exactly 3, then an
 * optional decimal part. A grouped number never starts with a 0 group, so "0.500" in German is a decimal typed with the wrong
 * mark and is refused, not read as 500.
 */
const GROUPED_NUMBER: Record<FormatLocale, RegExp> = {
  de: /^[-+]?[1-9]\d{0,2}(?:\.\d{3})+(?:,\d*)?$/,
  en: /^[-+]?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d*)?$/,
};

/**
 * Reads what a person typed in this locale: "1.500" is 1500 in German and 1.5 in English. NaN when it is not a number.
 * A group separator without three digits behind it ("110.5" in German) is refused, not guessed: one key must not mean two
 * things depending on how many digits follow it, and dropping it would store 1105.
 */
export function parseNumber(text: string, locale: FormatLocale = 'de'): number {
  const { group, decimal } = NUMBER_SEPARATORS[locale];
  const compact = text.replace(/[\s\u00A0\u202F]/g, '').replace(MINUS, '-');
  if (compact.includes(group) && !GROUPED_NUMBER[locale].test(compact)) return Number.NaN;
  const plain = compact.replaceAll(group, '').replace(decimal, '.');
  return plain === '' ? Number.NaN : Number(plain);
}

export type NumberOptions = { minFractionDigits?: number; maxFractionDigits?: number };

/** "1.500", "2,9", "−35". Uses a real minus sign and never prints a negative zero. */
export function formatNumber(value: number, locale: FormatLocale = 'de', options: NumberOptions = {}): string {
  if (!Number.isFinite(value)) return '–';
  // Intl throws a RangeError when the minimum exceeds the maximum.
  const minimumFractionDigits = options.minFractionDigits ?? 0;
  const formatted = numberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits: Math.max(options.maxFractionDigits ?? DEFAULT_MAX_FRACTION_DIGITS, minimumFractionDigits),
  }).format(value);
  return /^-[0.,]*$/.test(formatted) ? formatted.slice(1) : formatted.replace('-', MINUS);
}

/** Half away from zero, so −2,5 and 2,5 round symmetrically. */
export function roundInt(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded;
}

const NO_BREAK_SPACE = '\u00A0';
const WORD_JOINER = '\u2060';
const withoutJoiners = (text: string) => text.replaceAll(WORD_JOINER, '');

/**
 * §4 "never break key data": a string of values such as "19″ × 9,5J ET35 · 255/35 R19" or "Serie → KW V3 · −35 mm" may
 * only wrap after a separator. Spaces inside a value become no-break spaces and the separator stays with the value
 * before it, so no line starts with it. `wholeValues` false lets a value wrap at its own spaces, for a font so large that
 * a whole value no longer fits one line and would otherwise split inside a word.
 */
export function keepValuesTogether(values: string, wholeValues: boolean = true): string {
  return valueSegments(values, wholeValues)
    .map((segment) => segment.text)
    .join('');
}

/** A hyphen between two letters or figures, without a word joiner after it yet. */
const NAME_HYPHEN = /([\p{L}\p{N}])-(?!\u2060)(?=[\p{L}\p{N}])/gu;

/**
 * §4 "never break key data", DQ-047: a model name such as "Nissan Skyline GT-R R34" or "Mazda RX-7" may wrap at its
 * spaces, never at a hyphen inside a name ("GT-" / "R"). A word joiner after the hyphen keeps both halves on one line;
 * the hyphen itself stays the same glyph, and screen readers skip the joiner.
 */
export function keepNameTogether(name: string): string {
  return name.replace(NAME_HYPHEN, `$1-${WORD_JOINER}`);
}

/** A hyphenated word up to this long fits a column at 200 %: "GT-R", "Hi-Power", "RX-7". */
const SHORT_NAME_LENGTH = 12;

/**
 * DQ-047 for text that may hold a model name but is not one, such as a mod's name or a dialog title: "HKS Hi-Power" stays
 * whole, while "Aero-Seitenschweller" keeps its hyphen as the place to wrap, because whole it would not fit at a large font.
 */
export function keepShortNamesTogether(text: string): string {
  // An address someone may copy stays whole, as in settings/markdown/parse.ts joinShortPrefixes.
  return text.replace(/\S+/g, (word) => (word.length <= SHORT_NAME_LENGTH && !/:\/\/|@/.test(word) ? keepNameTogether(word) : word));
}

/** A figure with at most two letters around it, the way dimensions are written: "2.568", "−35", "19″", "9,5J", "ET35", "255/35", "R19". */
const FIGURE = /^[−+-]?[A-Za-z]{0,2}\d[\d.,/]*[A-Za-z]{0,2}[″′°%]?$/;
const VALUE_SEPARATOR = /^[×·→/]$/;
const UNIT = /^(?:mm|cm|cm³|ccm|m|km|km\/h|l|kg|t|bar|psi|PS|kW|hp|Nm|U\/min|V|Ah|W|dB|Zoll|°|%)$/;

/**
 * §4 tnum is for numbers. Tabular figures in Inter also set the hyphen to the width of a digit, so "6-Gang manuell" reads
 * as "6 - Gang". Figures, units and separators count as numeric; any word or a hyphen inside a token makes it text.
 */
export function isNumericValue(value: string): boolean {
  const tokens = withoutJoiners(value).trim().split(/\s+/);
  return tokens.some((token) => /\d/.test(token)) && tokens.every((token) => FIGURE.test(token) || VALUE_SEPARATOR.test(token) || UNIT.test(token));
}

export type ValueSegment = { text: string; numeric: boolean };

/**
 * A string of values cut at its arrows and middle dots, with the wrapping of `keepValuesTogether`. `numeric` marks the
 * segments that may use tabular figures: in "Serie → 6-Kolben · 380 mm" that is "380 mm" alone (§4, `isNumericValue`).
 */
export function valueSegments(values: string, wholeValues: boolean = true): ValueSegment[] {
  return values.split(/\s+([·→])\s+/).map((part, index) => {
    if (index % 2 === 1) return { text: `${NO_BREAK_SPACE}${part} `, numeric: false };
    const value = keepValueSlashes(part.trim());
    return { text: wholeValues ? value.replace(/\s+/g, NO_BREAK_SPACE) : value, numeric: isNumericValue(value) };
  });
}

const LINE_CUT = /^[·→]$/;
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;
const isValueToken = (token: string) => !LINE_CUT.test(token) && (FIGURE.test(token) || VALUE_SEPARATOR.test(token) || UNIT.test(token));
const withoutPunctuation = (token: string) => token.replace(TRAILING_PUNCTUATION, '');
/** A slash with a character on both sides. */
const INNER_SLASH = /([^\s/])\/(?=[^\s/])/g;

/**
 * §4 "never break key data", the `.sc-keep` of App\Support\KeepTogether::figures: a value with a slash ("265/35", "U/min")
 * never wraps after it. A word joiner does what `keepNameTogether` does for a hyphen. A word with a slash ("Serie/Sport")
 * may wrap there as before.
 */
function keepValueSlashes(text: string): string {
  return text.replace(/\S+/g, (token) => {
    const plain = withoutJoiners(token);
    return plain.includes('/') && isValueToken(withoutPunctuation(plain)) ? plain.replace(INNER_SLASH, `$1/${WORD_JOINER}`) : token;
  });
}

/**
 * DQ-216, §4 "never break key data", for a line of any length, such as a Verlauf summary or a member's note. A segment
 * of such a line can be wider than its column, and `valueSegments` keeping it whole then breaks inside a token ("ET2" /
 * "2"), so its words wrap at their spaces and only figures stay together: a run such as "18″ × 9,5J ET22" or "−35 mm".
 * `wholeRuns` false is for a font so large that a run may not fit one line: a figure then keeps only its unit.
 * DQ-231: at any font a line wraps after its cuts "·" and "→" and never before them, as KeepTogether::figures does on Blade.
 */
export function keepFiguresTogether(line: string, wholeRuns: boolean = true): string {
  const kept = line.replace(/(\S+) +(?=(\S+))/g, (match, left: string, right: string) => {
    const next = withoutPunctuation(right);
    const together = LINE_CUT.test(right) || (wholeRuns ? isValueToken(left) && isValueToken(next) : FIGURE.test(left) && UNIT.test(next));
    return together ? `${left}${NO_BREAK_SPACE}` : match;
  });
  return keepValueSlashes(kept);
}

/** "März 2023" */
export function formatMonthYear(date: Date, locale: FormatLocale = 'de'): string {
  return dateFormat(locale, { month: 'long', year: 'numeric' }).format(date);
}

/** "14.06.2026" */
export function formatDate(date: Date, locale: FormatLocale = 'de'): string {
  return dateFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** "14:30" */
export function formatTime(date: Date, locale: FormatLocale = 'de'): string {
  return dateFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/** "14.06.2026, 14:30" */
export function formatDateTime(date: Date, locale: FormatLocale = 'de'): string {
  return `${formatDate(date, locale)}, ${formatTime(date, locale)}`;
}

const RELATIVE: Record<
  FormatLocale,
  {
    justNow: string;
    yesterday: string;
    minutes: (n: string) => string;
    hours: (n: string) => string;
    days: (n: string) => string;
  }
> = {
  de: {
    justNow: 'gerade eben',
    yesterday: 'gestern',
    minutes: (n) => `vor ${n} Min.`,
    hours: (n) => `vor ${n} Std.`,
    days: (n) => `vor ${n} Tagen`,
  },
  en: {
    justNow: 'just now',
    yesterday: 'yesterday',
    minutes: (n) => `${n} min ago`,
    hours: (n) => `${n} hr ago`,
    days: (n) => `${n} days ago`,
  },
};

/** The calendar day in Berlin as a local Date, so date-fns counts Berlin days across DST changes. */
function berlinDay(date: Date): Date {
  const parts = dateFormat('en', { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(part('year'), part('month') - 1, part('day'));
}

/**
 * "gerade eben", "vor 3 Min.", "vor 3 Std." (same Berlin day), "gestern", "vor 3 Tagen" (up to 6),
 * then "14.06.2026". A date further in the future than clock skew shows the date.
 */
export function formatRelative(date: Date, locale: FormatLocale = 'de', reference: Date = clockNow()): string {
  const labels = RELATIVE[locale];
  const seconds = (reference.getTime() - date.getTime()) / 1000;
  if (seconds < -60) return formatDate(date, locale);
  if (seconds < 60) return labels.justNow;
  const minutes = differenceInMinutes(reference, date);
  if (minutes < 60) return labels.minutes(formatNumber(minutes, locale));
  const days = differenceInCalendarDays(berlinDay(reference), berlinDay(date));
  if (days === 0) return labels.hours(formatNumber(differenceInHours(reference, date), locale));
  if (days === 1) return labels.yesterday;
  if (days <= 6) return labels.days(formatNumber(days, locale));
  return formatDate(date, locale);
}
