/**
 * GAR-06 [SIG `sig.hu_au_reminder`] (02_PRODUCT_SPEC §5, §7): the month of the next HU/AU, owner only and never public. The
 * server sends the reminder 30 days before the month starts (09:00 Europe/Berlin), once per due date.
 */
import { formatDate, formatMonthYear, type FormatLocale } from '@/lib/format';

import { maskMonth, monthText, parseMonth } from './modForm';

/** Days between the reminder and the first day of the due month. */
export const HU_AU_REMINDER_DAYS = 30;
/** A car's first HU comes after three years, so nothing further ahead is a real due date. */
export const HU_AU_MONTHS_AHEAD = 36;
/** An overdue HU can still be entered, up to two years back. */
export const HU_AU_MONTHS_BACK = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarDay = { year: number; month: number; day: number };

/** "2027-03" → the typed text "03/2027", the same mask as the mod editor's month. */
export const huAuText = monthText;
export const maskHuAu = maskMonth;

function monthIndex(value: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

/** "2026-11" for a date, read in Berlin time like every date of the app. */
export function monthOf(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

export type HuAuCheck = { ok: true; value: string | null } | { ok: false; reason: 'format' | 'tooEarly' | 'tooLate' };

/** The typed text as the API takes it: empty clears, otherwise a month within the bounds around `today`. */
export function checkHuAu(text: string, today: Date): HuAuCheck {
  if (text.trim() === '') return { ok: true, value: null };
  const value = parseMonth(text);
  const index = value ? monthIndex(value) : null;
  const current = monthIndex(monthOf(today));
  if (!value || index === null || current === null) return { ok: false, reason: 'format' };
  if (index < current - HU_AU_MONTHS_BACK) return { ok: false, reason: 'tooEarly' };
  if (index > current + HU_AU_MONTHS_AHEAD) return { ok: false, reason: 'tooLate' };
  return { ok: true, value };
}

/** The day the reminder goes out: 30 days before the first of the due month. */
export function reminderDay(due: string): CalendarDay | null {
  const index = monthIndex(due);
  if (index === null) return null;
  const first = Date.UTC(Math.floor(index / 12), index % 12, 1);
  const reminder = new Date(first - HU_AU_REMINDER_DAYS * DAY_MS);
  return { year: reminder.getUTCFullYear(), month: reminder.getUTCMonth() + 1, day: reminder.getUTCDate() };
}

export type HuAuState = 'upcoming' | 'reminderPassed' | 'dueNow' | 'overdue';

/**
 * Where the due date stands today: still ahead with a reminder to come, ahead but inside the 30 days (no reminder any more),
 * in the current month, or past.
 */
export function huAuState(due: string, today: Date): HuAuState | null {
  const index = monthIndex(due);
  const current = monthIndex(monthOf(today));
  const reminder = reminderDay(due);
  if (index === null || current === null || !reminder) return null;
  if (index < current) return 'overdue';
  if (index === current) return 'dueNow';
  const todayKey = berlinDayKey(today);
  const reminderKey = reminder.year * 10_000 + reminder.month * 100 + reminder.day;
  return todayKey >= reminderKey ? 'reminderPassed' : 'upcoming';
}

function berlinDayKey(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return read('year') * 10_000 + read('month') * 100 + read('day');
}

/** "30.01.2027", in the app's date format. Noon UTC is the same calendar day in Berlin all year. */
export function formatCalendarDay(day: CalendarDay, locale: FormatLocale): string {
  return formatDate(new Date(Date.UTC(day.year, day.month - 1, day.day, 12)), locale);
}

/** "März 2027" for the stored month. */
export function formatDueMonth(due: string, locale: FormatLocale): string | null {
  const index = monthIndex(due);
  if (index === null) return null;
  return formatMonthYear(new Date(Date.UTC(Math.floor(index / 12), index % 12, 15, 12)), locale);
}
