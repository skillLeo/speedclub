import { getActiveLanguage, trans } from 'laravel-vue-i18n';
import { now } from './qa';

/** Dates and numbers as 03/06 prescribe: "14.06.2026, 18:42" in Europe/Berlin, tnum numbers. */
const TIME_ZONE = 'Europe/Berlin';

function locale(): string {
    return getActiveLanguage() === 'en' ? 'en-GB' : 'de-DE';
}

function toDate(value: string | Date | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | Date | null | undefined): string {
    const date = toDate(value);
    if (date === null) return '–';
    return new Intl.DateTimeFormat(locale(), {
        timeZone: TIME_ZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
    const date = toDate(value);
    if (date === null) return '–';
    return new Intl.DateTimeFormat(locale(), { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
    const date = toDate(value);
    if (date === null) return '–';
    return new Intl.DateTimeFormat(locale(), { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(date);
}

/** "14.06." for chart axes. */
export function formatDayShort(value: string | Date | null | undefined): string {
    const date = toDate(value);
    if (date === null) return '–';
    return new Intl.DateTimeFormat(locale(), { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' }).format(date);
}

export function formatMonth(value: string): string {
    const date = toDate(`${value}-01T12:00:00Z`);
    if (date === null) return value;
    return new Intl.DateTimeFormat(locale(), { timeZone: TIME_ZONE, month: 'short', year: 'numeric' }).format(date);
}

export function formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) return '–';
    return new Intl.NumberFormat(locale()).format(value);
}

export function formatPercent(value: number): string {
    return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(value);
}

/**
 * "vor 5 Minuten" / "5 minutes ago". A moment in the future (client clock skew, or a frozen ?qaNow= while the server writes live
 * events) is clamped to "gerade eben": a past event never reads "in 7 Tagen" (DQ-545).
 */
export function formatRelative(value: string | Date | null | undefined): string {
    const date = toDate(value);
    if (date === null) return '–';
    const seconds = Math.round((date.getTime() - now().getTime()) / 1000);
    if (seconds > -45) return trans('ui.time.just_now');
    const abs = Math.abs(seconds);
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    if (abs < 60) return rtf.format(seconds, 'second');
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day');
    return formatDate(date);
}

/**
 * A QR short code as printed on the sticker: upper case, in groups of four ("8TR0 Q3MC", 03 §4 `code`). Spaces and dashes of the input
 * go first, so the stored and the display form give the same result.
 */
export function formatQrCode(code: string | null | undefined): string {
    if (code === null || code === undefined || code === '') return '–';
    const clean = code.replace(/[\s-]/g, '').toUpperCase();
    return clean.replace(/(.{4})(?=.)/g, '$1 ');
}

/** The date pattern of the active locale for date fields: "TT.MM.JJJJ" (de) or "DD/MM/YYYY" (en-GB, as the tables print dates). */
export function dateSeparator(): '.' | '/' {
    return getActiveLanguage() === 'en' ? '/' : '.';
}
