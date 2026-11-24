/**
 * ADM-37 Season Wrapped releases (m5.9e contract §1, RemoteConfigSchema): `wrapped.releases` = {"2027-saison": "2027-11-01T10:00:00+01:00"}.
 * The editor picks a day and a time in Europe/Berlin; the value carries the Berlin offset of that moment (+01:00 in winter, +02:00 in
 * summer), so the server stores exactly what the person chose. RemoteConfigSchema keeps the releases only when a payload has the
 * `wrapped` key, so the editor's payload always carries it (withWrapped) and a publish never drops the dates.
 */
const ZONE = 'Europe/Berlin';

export type Releases = Record<string, string>;

/** The payload as the server sends it: no `wrapped` before the first release was saved, and PHP sends an empty map as []. */
export function normalizeReleases(value: unknown): Releases {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const releases: Releases = {};
    for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
        if (typeof at === 'string') releases[key] = at;
    }
    return sortReleases(releases);
}

/** Season keys ascending, as the server's ksort: the form's JSON then equals the saved payload's. */
export function sortReleases(releases: Releases): Releases {
    return Object.fromEntries(Object.entries(releases).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function withWrapped<P extends { wrapped?: { releases?: unknown } | null }>(payload: P): P & { wrapped: { releases: Releases } } {
    return { ...payload, wrapped: { releases: normalizeReleases(payload.wrapped?.releases) } };
}

/** Minutes east of UTC that Berlin has at this instant. */
function offsetAt(at: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
    const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((local - at.getTime()) / 60000);
}

function offsetText(minutes: number): string {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * "2027-11-01" + "10:00" (Berlin) → "2027-11-01T10:00:00+01:00"; '' when either part is missing or malformed (the server then answers
 * the field error). A time that does not exist on the spring-forward night resolves to the offset after the change.
 */
export function berlinToIso(day: string, time: string): string {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    const t = /^(\d{2}):(\d{2})$/.exec(time);
    if (!d || !t) return '';
    const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
    let offset = offsetAt(new Date(wall));
    offset = offsetAt(new Date(wall - offset * 60000));
    return `${day}T${time}:00${offsetText(offset)}`;
}

/** An ISO date-time → its Berlin day and time ("2027-11-01", "10:00"); empty parts for a value that is no date. */
export function isoToBerlin(value: string): { day: string; time: string } {
    const at = new Date(value);
    if (value === '' || Number.isNaN(at.getTime())) return { day: '', time: '' };
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
    const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** "+01:00" for a complete Berlin day and time, else null (the row's zone line). */
export function berlinOffset(day: string, time: string): string | null {
    const iso = berlinToIso(day, time);
    return iso === '' ? null : iso.slice(-6);
}

/** The seasons the editor offers: last year to next year, season and calendar year each, plus every key already planned. */
export function seasonOptions(year: number, planned: string[]): string[] {
    const keys = new Set(planned);
    for (let y = year - 1; y <= year + 1; y++) {
        keys.add(`${y}-saison`);
        keys.add(`${y}-jahr`);
    }
    return [...keys].filter((key) => /^2\d{3}-(saison|jahr)$/.test(key)).sort();
}
