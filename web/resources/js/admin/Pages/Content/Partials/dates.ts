import { now } from '../../../lib/qa';

/**
 * Schedules of ADM-29/30 are days in Europe/Berlin (the DateRangeField's ISO days) and stored as UTC instants: a start at 00:00 of its
 * day, an end at 00:00 of the day after (the last day counts in full).
 */
const ZONE = 'Europe/Berlin';

function offsetMinutes(at: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
    const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((local - at.getTime()) / 60000);
}

/** "2026-06-14" → the instant of 00:00 Berlin that day (or, for an end, of the next day). '' → null. */
export function dayToInstant(day: string, end = false): string | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) return null;
    const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + (end ? 1 : 0));
    const offset = offsetMinutes(new Date(guess));
    return new Date(guess - offset * 60000).toISOString().replace('.000Z', 'Z');
}

/** The Berlin day of an instant (for an end: of the moment just before it). null → ''. */
export function instantToDay(value: string | null | undefined, end = false): string {
    if (value === null || value === undefined || value === '') return '';
    const at = new Date(new Date(value).getTime() - (end ? 1 : 0));
    if (Number.isNaN(at.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    return parts;
}

export type Schedule = 'live' | 'scheduled' | 'ended';

export function scheduleOf(starts: string | null, ends: string | null, at: Date = now()): Schedule {
    const time = at.getTime();
    if (starts !== null && Date.parse(starts) > time) return 'scheduled';
    if (ends !== null && Date.parse(ends) <= time) return 'ended';
    return 'live';
}

/** The most entries live at one moment (the server's rule: at most N featured builds live at once). */
export function peakLive(entries: { starts_at: string | null; ends_at: string | null }[]): number {
    const points: [number, number][] = [];
    for (const entry of entries) {
        points.push([entry.starts_at === null ? -Infinity : Date.parse(entry.starts_at), 1]);
        points.push([entry.ends_at === null ? Infinity : Date.parse(entry.ends_at), -1]);
    }
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let live = 0;
    let peak = 0;
    for (const [, step] of points) {
        live += step;
        peak = Math.max(peak, live);
    }
    return peak;
}
