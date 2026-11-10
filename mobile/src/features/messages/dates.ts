/**
 * Day separators of FS-7 ("Heute", "Gestern", "Mo., 3. Nov.") and the inbox time, always in Europe/Berlin (02 §3.9), whatever the
 * device's own zone. Hermes has Intl with time zones; the parts are read by type, so the order of the locale does not matter.
 */
import { formatTime, TIME_ZONE, type FormatLocale } from '@/lib/format';

const INTL_LOCALE: Record<FormatLocale, string> = { de: 'de-DE', en: 'en-GB' };

const formats = new Map<string, Intl.DateTimeFormat>();

function format(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: TIME_ZONE });
    formats.set(key, formatter);
  }
  return formatter;
}

/** "2026-11-03": the calendar day in Berlin. */
export function berlinDayKey(date: Date): string {
  const parts = format('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Whole calendar days between two Berlin day keys, counted on UTC noon so a DST change cannot shift it. */
export function daysBetween(fromKey: string, toKey: string): number {
  const noon = (key: string) => Date.parse(`${key}T12:00:00Z`);
  return Math.round((noon(toKey) - noon(fromKey)) / 86_400_000);
}

export type DayLabels = { today: string; yesterday: string };

/** "Heute", "Gestern", "Di., 3. Nov.", and with the year once it is not this year's: "Mo., 3. Nov. 2025". */
export function dayLabel(date: Date, reference: Date, locale: FormatLocale, labels: DayLabels): string {
  const key = berlinDayKey(date);
  const today = berlinDayKey(reference);
  const days = daysBetween(key, today);
  if (days === 0) return labels.today;
  if (days === 1) return labels.yesterday;
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return format(INTL_LOCALE[locale], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/**
 * The time of an inbox row: "14:32" today, "Gestern", the short weekday within the week ("Di."), then "03.11.26". Short on
 * purpose: it trails the name in a 360 row.
 */
export function inboxTime(date: Date, reference: Date, locale: FormatLocale, yesterday: string): string {
  const days = daysBetween(berlinDayKey(date), berlinDayKey(reference));
  if (days <= 0) return formatTime(date, locale);
  if (days === 1) return yesterday;
  if (days < 7) return format(INTL_LOCALE[locale], { weekday: 'short' }).format(date);
  return format(INTL_LOCALE[locale], { day: '2-digit', month: '2-digit', year: '2-digit' }).format(date);
}
