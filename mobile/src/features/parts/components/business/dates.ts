/**
 * Dates of the business screens on the app's own clock (`lib/clock` `now()`, which `qaNow` freezes outside production), in Berlin
 * time like every date of the app (lib/format). Pure, so the tests read them directly.
 */
import type { OpeningDay } from '@/api/queries/businesses';
import { now } from '@/lib/clock';
import { TIME_ZONE, type FormatLocale } from '@/lib/format';

import { DAY_KEYS, type DayKey } from '../../model';

const INTL_LOCALE: Record<FormatLocale, string> = { de: 'de-DE', en: 'en-GB' };
const NBSP = ' ';
const formats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: TIME_ZONE });
    formats.set(key, formatter);
  }
  return formatter;
}

/** The weekday of `date` in Berlin as the API's key ("mon" … "sun"). */
export function berlinDayKey(date: Date): DayKey {
  const short = dateFormat('en-US', { weekday: 'short' }).format(date).slice(0, 3).toLowerCase();
  return (DAY_KEYS as readonly string[]).includes(short) ? (short as DayKey) : 'mon';
}

/**
 * DQ-1148: "Heute" from the app's clock, not the server's. The API marks today by its own clock, which the QA clock (`qaNow`) cannot
 * reach, so the visual matrix highlighted the server's day. In production both clocks name the same Berlin day.
 */
export function withClientToday(days: readonly OpeningDay[], reference: Date = now()): OpeningDay[] {
  const today = berlinDayKey(reference);
  return days.map((day) => (day.today === (day.day === today) ? day : { ...day, today: day.day === today }));
}

/**
 * DQ-1155: a date in a list row, short and in words: "12. Nov." (de) and "12 Nov" (en), with the year once it is not this year's
 * ("12. Nov. 2025"). The day stays with its month (no-break space).
 */
export function shortDate(date: Date, locale: FormatLocale, reference: Date = now()): string {
  const year = (value: Date) => dateFormat('en-US', { year: 'numeric' }).format(value);
  const sameYear = year(date) === year(reference);
  const parts = dateFormat(INTL_LOCALE[locale], { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  const suffix = sameYear ? '' : ` ${part('year')}`;
  return locale === 'de' ? `${part('day')}.${NBSP}${part('month')}${suffix}` : `${part('day')}${NBSP}${part('month')}${suffix}`;
}
