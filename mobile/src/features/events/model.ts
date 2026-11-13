/**
 * M4.12 Events (09 §8.7, §7.10): what the screens say about an event — its day and time in Europe/Berlin, its place as far as the
 * reader may see it (ADR-437 c), its answers, its review state (ADR-439) — and the sample event of the empty states (09 §8.19).
 * Pure functions, tested in tests/events/model.test.ts.
 */
import type { TFunction } from 'i18next';

import type { EventCard, EventDetail, EventLocation, EventStatus, EventType } from '@/api/queries/events';
import { photoFields } from '@/features/profile/media';
import type { FormatLocale } from '@/lib/format';
import type { PhotoFields } from '@/ui';

export const ZONE = 'Europe/Berlin';
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** The wall clock in Berlin of an instant. */
export type BerlinParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
  weekday: 'short',
});

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function berlinParts(date: Date): BerlinParts {
  const parts = partsFormat.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
    weekday: Math.max(0, WEEKDAYS.indexOf(part('weekday'))),
  };
}

/** Minutes Berlin is ahead of UTC at that instant (60 in winter, 120 in summer). */
function berlinOffsetMinutes(instant: number): number {
  const p = berlinParts(new Date(instant));
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((wall - Math.floor(instant / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
}

/**
 * The instant of a Berlin wall-clock time ("14.06.2026 18:30" as the organiser typed it), across DST changes: the offset is
 * read at the guessed instant and once more at the corrected one.
 */
export function berlinToDate(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}): Date {
  const wall = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);
  let instant = wall - berlinOffsetMinutes(wall) * MINUTE_MS;
  instant = wall - berlinOffsetMinutes(instant) * MINUTE_MS;
  return new Date(instant);
}

export function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-06-14": the Berlin day of an instant, the key of a date group. */
export function berlinDayKey(date: Date): string {
  const p = berlinParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const intl = (locale: FormatLocale) => (locale === 'de' ? 'de-DE' : 'en-GB');

/** EventCard / EVT-02 date block (09 §5): the day as a numeral ("14") and the month as a data label ("Juni" → set in caps). */
export function dateBlock(date: Date, locale: FormatLocale): { day: string; month: string; weekday: string } {
  const p = berlinParts(date);
  const month = new Intl.DateTimeFormat(intl(locale), { timeZone: ZONE, month: 'short' })
    .format(date)
    .replace(/\.$/, '');
  const weekday = new Intl.DateTimeFormat(intl(locale), { timeZone: ZONE, weekday: 'short' })
    .format(date)
    .replace(/\.$/, '');
  return { day: String(p.day), month, weekday };
}

function clock(date: Date, locale: FormatLocale): string {
  return new Intl.DateTimeFormat(intl(locale), {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function dayWithMonth(date: Date, locale: FormatLocale, withWeekday: boolean): string {
  const text = new Intl.DateTimeFormat(intl(locale), {
    timeZone: ZONE,
    day: 'numeric',
    month: 'long',
    ...(withWeekday ? { weekday: 'short' } : {}),
  }).format(date);
  // DQ-1005: the day stays with its month.
  return text.replace(/(\d{1,2}\.?) /, '$1 ');
}

/**
 * The time of an event (SKILL §9 "19:30 Uhr"): "18:00–21:00 Uhr" on one day; over midnight or several days the end names its day:
 * "Sa., 14. Juni, 10:00 – So., 15. Juni, 18:00 Uhr". Without an end: "ab 18:00 Uhr".
 */
export function timeRange(start: Date, end: Date | null, locale: FormatLocale, t: TFunction): string {
  const from = clock(start, locale);
  if (!end) return t('events:time.from', { time: from });
  const to = clock(end, locale);
  if (berlinDayKey(start) === berlinDayKey(end)) return t('events:time.range', { from, to });
  return t('events:time.span', {
    from: `${dayWithMonth(start, locale, true)}, ${from}`,
    to: `${dayWithMonth(end, locale, true)}, ${to}`,
  });
}

/** "Sa., 14. Juni · 18:00–21:00 Uhr": the whole when in one caption. */
export function whenLine(start: Date, end: Date | null, locale: FormatLocale, t: TFunction): string {
  if (end && berlinDayKey(start) !== berlinDayKey(end)) return timeRange(start, end, locale, t);
  return `${dayWithMonth(start, locale, true)} · ${timeRange(start, end, locale, t)}`;
}

/** The list's date group (EVT-01 "grouped by date"): Heute · Morgen · "Samstag, 14. Juni" (with the year when it is not this one). */
export function dayGroupLabel(date: Date, now: Date, locale: FormatLocale, t: TFunction): string {
  const day = berlinDayKey(date);
  const today = berlinDayKey(now);
  const ahead = daysBetween(today, day);
  if (ahead === 0) return t('events:groups.today');
  if (ahead === 1) return t('events:groups.tomorrow');
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(intl(locale), {
    timeZone: ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
    .format(date)
    .replace(/(\d{1,2}\.?) /, '$1 ');
}

/**
 * DQ-1113: EVT-01's groups are spans of time, so the card's date block is the only date: Heute · Morgen · Diese Woche · Dieses
 * Wochenende · Nächste Woche · "Später im November" · "Dezember" (with the year when it is not this one). Weeks run Monday to Sunday
 * in Berlin; the list is sorted by start, so every group is one run.
 */
export function weekGroupLabel(date: Date, now: Date, locale: FormatLocale, t: TFunction): string {
  const day = berlinDayKey(date);
  const today = berlinDayKey(now);
  const ahead = daysBetween(today, day);
  if (ahead <= 0) return t('events:groups.today');
  if (ahead === 1) return t('events:groups.tomorrow');
  const sinceMonday = (berlinParts(now).weekday + 6) % 7;
  const week = Math.floor((sinceMonday + ahead) / 7);
  if (week === 0) {
    const weekday = berlinParts(date).weekday;
    return weekday === 0 || weekday === 6 ? t('events:groups.weekend') : t('events:groups.thisWeek');
  }
  if (week === 1) return t('events:groups.nextWeek');
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const month = new Intl.DateTimeFormat(intl(locale), {
    timeZone: ZONE,
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
  return day.slice(0, 7) === today.slice(0, 7) ? t('events:groups.laterIn', { month }) : month;
}

export type EventListRow<T extends Pick<EventCard, 'id' | 'starts_at'>> =
  { kind: 'day'; key: string; label: string } | { kind: 'event'; key: string; event: T };

/** Cards by their Berlin start day, soonest first as the server sends them; a header before each day. */
export function groupByDay<T extends Pick<EventCard, 'id' | 'starts_at'>>(
  events: readonly T[],
  now: Date,
  locale: FormatLocale,
  t: TFunction,
): EventListRow<T>[] {
  return groupBy(events, (start) =>
    start ? dayGroupLabel(start, now, locale, t) : t('events:groups.noDate'),
  );
}

/** DQ-1113: cards under the span-of-time headers of `weekGroupLabel` (EVT-01, the profile's Treffen tab). */
export function groupByWeek<T extends Pick<EventCard, 'id' | 'starts_at'>>(
  events: readonly T[],
  now: Date,
  locale: FormatLocale,
  t: TFunction,
): EventListRow<T>[] {
  return groupBy(events, (start) =>
    start ? weekGroupLabel(start, now, locale, t) : t('events:groups.noDate'),
  );
}

function groupBy<T extends Pick<EventCard, 'id' | 'starts_at'>>(
  events: readonly T[],
  labelOf: (start: Date | null) => string,
): EventListRow<T>[] {
  const rows: EventListRow<T>[] = [];
  let current: string | null = null;
  for (const event of events) {
    const label = labelOf(parseInstant(event.starts_at));
    if (label !== current) {
      current = label;
      rows.push({ kind: 'day', key: `group.${rows.length}.${label}`, label });
    }
    rows.push({ kind: 'event', key: event.id, event });
  }
  return rows;
}

/** The kind as a word: Treffen · Ausfahrt · Trackday · Messe. */
export function typeLabel(type: EventType, t: TFunction): string {
  return t(`events:type.${type}`);
}

/** The place as far as this reader may see it (ADR-437 c). */
export type PlaceText = {
  /** Venue, or the city when the venue is hidden. */
  title: string;
  /** Street, postcode and city of an exact place; the after-RSVP line of a hidden one. */
  lines: string[];
  exact: boolean;
  /** A hidden place the reader would see after "Zusagen". */
  hidden: boolean;
};

export function placeText(location: EventLocation, t: TFunction): PlaceText {
  const city = location.city?.trim() || null;
  if (!location.exact) {
    const hidden = location.visibility === 'after_rsvp';
    return {
      title: city ?? t('events:place.unknown'),
      lines: hidden ? [t('events:place.afterRsvp')] : [],
      exact: false,
      hidden,
    };
  }
  const venue = location.venue_name?.trim() || null;
  const street = location.street?.trim() || null;
  const town = [location.postcode?.trim(), city].filter(Boolean).join(' ');
  const lines = [street, town].filter((line): line is string => Boolean(line));
  return {
    title: venue ?? street ?? city ?? t('events:place.unknown'),
    lines: venue ? lines : lines.slice(street ? 1 : 0),
    exact: true,
    hidden: false,
  };
}

/** The card's caption: "Hamburg · 18:00–21:00 Uhr", or with the distance "Hamburg · 12 km". */
export function cardCaption(
  event: EventCard,
  locale: FormatLocale,
  t: TFunction,
  distance?: (km: number) => string,
): string {
  const start = parseInstant(event.starts_at);
  const end = parseInstant(event.ends_at);
  const parts = [event.location.city?.trim() || t('events:place.unknown')];
  if (event.distance_km !== null && distance) parts.push(distance(event.distance_km));
  if (start) parts.push(timeRange(start, end, locale, t));
  return parts.join(' · ');
}

/** The answers in one line ("38 Zusagen · 12 interessiert"); null on samples (no invented counts, 09 §8.19). */
export function countsLine(
  counts: EventCard['counts'],
  t: TFunction,
  format: (n: number) => string,
): string | null {
  if (!counts) return null;
  const going = t('events:counts.going', { count: counts.going, value: format(counts.going) });
  if (counts.interested === 0) return going;
  return `${going} · ${t('events:counts.interested', { count: counts.interested, value: format(counts.interested) })}`;
}

/**
 * DQ-1118: the answers a card shows. Nothing on samples (09 §8.19) and nothing before publication (a draft or an event in review
 * cannot be answered, so "0 Zusagen" would only be an undesigned zero); "Noch keine Zusagen" once it is open and nobody answered.
 */
export function cardCounts(
  event: Pick<EventCard, 'counts' | 'is_sample' | 'status'>,
  t: TFunction,
  format: (n: number) => string,
): string | null {
  if (event.is_sample || !event.counts) return null;
  if (event.status !== 'published' && event.status !== 'cancelled') return null;
  if (event.counts.going + event.counts.interested === 0)
    return event.status === 'published' ? t('events:counts.none') : null;
  return countsLine(event.counts, t, format);
}

/** Whether the event has ended (its end, or its start when it has none). */
export function hasEnded(event: Pick<EventCard, 'starts_at' | 'ends_at'>, now: Date): boolean {
  const end = parseInstant(event.ends_at) ?? parseInstant(event.starts_at);
  return end !== null && end.getTime() <= now.getTime();
}

/**
 * The state the organiser's review notice explains (ADR-439): pending is frozen, a rejection names its reason, a draft waits for
 * "Senden". Null for a published event and for everybody but the organiser.
 */
export type ReviewNotice = { kind: 'draft' | 'pending' | 'rejected' | 'cancelled'; reason: string | null };

export function reviewNotice(
  event: Pick<EventDetail, 'status' | 'review' | 'cancellation_reason'>,
): ReviewNotice | null {
  const reason = event.review?.reason?.trim() || null;
  switch (event.status) {
    case 'draft':
      return { kind: 'draft', reason: null };
    case 'pending_review':
      return { kind: 'pending', reason: null };
    case 'rejected':
      return { kind: 'rejected', reason };
    case 'cancelled':
      return {
        kind: 'cancelled',
        reason:
          typeof event.cancellation_reason === 'string' ? event.cancellation_reason.trim() || null : null,
      };
    default:
      return null;
  }
}

/** The status pill of an organiser's own card (EVT-05 Organisiert). */
export function statusLabel(status: EventStatus, t: TFunction): string {
  return t(`events:status.${status}`);
}

/** Text fields typed `unknown` by the generator (description, organiser rules): a string or nothing. */
export function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** "Route" (EVT-02): the platform's maps with the exact place, or null when the reader may not see it. */
export function routeUrl(location: EventLocation, platform: 'ios' | 'android' | 'web'): string | null {
  if (!location.exact || location.lat === null || location.lng === null) return null;
  const point = `${location.lat},${location.lng}`;
  if (platform === 'ios') return `https://maps.apple.com/?daddr=${encodeURIComponent(point)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(point)}`;
}

/** The point to centre a map on: the exact place when the reader may see it, else the area (snapped to 0.05°, ADR-437 c). */
export function mapPoint(location: EventLocation): { lat: number; lng: number; exact: boolean } | null {
  if (location.exact && location.lat !== null && location.lng !== null)
    return { lat: location.lat, lng: location.lng, exact: true };
  if (location.area.lat !== null && location.area.lng !== null)
    return { lat: location.area.lat, lng: location.area.lng, exact: false };
  return null;
}

/**
 * DQ-1111: the photo of an event without its own cover (and of the empty states' sample), so no event page is ever photo-free: a
 * licensed seed photo (design/seed-photos/CREDITS.md, porsche-992-01: a 911 at night, plate blurred) that no other screen uses, shown
 * with the caption "Symbolbild". Focal point and thumbhash from the seed manifest.
 */
export const FALLBACK_COVER: PhotoFields = {
  source: require('@/assets/gallery/porsche-992-01.jpg') as number,
  thumbhash: '0CgGBQLEqFZmmEcHmYfqVgWBKQSo',
  focal: { x: 0.5, y: 0.54 },
};

/** The sample event's photo: the same fallback, badged "Beispiel" with the rest of the card. */
export const SAMPLE_COVER: PhotoFields = FALLBACK_COVER;

type EventMedia = NonNullable<EventCard['cover']>;

/** A media object as the API sends it (id and variants), for fields the generated types do not know yet. */
function isMedia(value: unknown): value is EventMedia {
  if (typeof value !== 'object' || value === null) return false;
  const media = value as { id?: unknown; variants?: unknown };
  return typeof media.id === 'string' && Array.isArray(media.variants);
}

/**
 * The organiser's main-vehicle photo, read defensively: `main_vehicle_cover` is on the conversation and notification members already
 * and may reach the organiser summary later. Null while the API does not send it.
 */
export function organiserVehicleCover(organiser: EventCard['organiser']): EventMedia | null {
  const value: unknown = (organiser as { main_vehicle_cover?: unknown }).main_vehicle_cover;
  return isMedia(value) ? value : null;
}

/** EVT-02's hero (DQ-1111): the event's cover, else the organiser's car with its credit, else the fallback as a "Symbolbild". */
export type EventHero = {
  photo: PhotoFields;
  source: 'own' | 'organiserCar' | 'fallback';
  alt: string | null;
};

export function eventHero(event: Pick<EventCard, 'cover' | 'organiser'>, width: number): EventHero {
  if (event.cover) return { photo: photoFields(event.cover, width), source: 'own', alt: event.cover.alt };
  const car = organiserVehicleCover(event.organiser);
  if (car) return { photo: photoFields(car, width), source: 'organiserCar', alt: car.alt };
  return { photo: FALLBACK_COVER, source: 'fallback', alt: null };
}

/** The next Saturday after `now`, 18:00 in Berlin: the sample event's start, so the preview is never in the past. */
export function nextSaturdayEvening(now: Date): Date {
  const p = berlinParts(now);
  const ahead = (6 - p.weekday + 7) % 7 || 7;
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + ahead));
  return berlinToDate({
    year: day.getUTCFullYear(),
    month: day.getUTCMonth() + 1,
    day: day.getUTCDate(),
    hour: 18,
    minute: 0,
  });
}

/**
 * The empty states' sample event (09 §7.10 EVT-01 empty, §8.19): an obviously fictional name, a real city, no counts, always
 * badged "Beispiel". Never sent anywhere; the card takes no taps.
 */
export function sampleEvent(now: Date, t: TFunction): EventCard {
  const start = nextSaturdayEvening(now);
  const end = new Date(start.getTime() + 3 * 60 * MINUTE_MS);
  return {
    id: 'sample-event',
    slug: 'sample-event',
    title: t('events:sample.title'),
    type: 'meet',
    status: 'published',
    visibility: 'public',
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    timezone: ZONE,
    location: {
      visibility: 'public',
      exact: true,
      venue_name: t('events:sample.venue'),
      street: null,
      postcode: null,
      city: t('events:sample.city'),
      country: 'DE',
      lat: null,
      lng: null,
      area: { lat: null, lng: null },
    },
    cover: null,
    organiser: {
      username: 'speedclub.editorial',
      display_name: 'SPEED CLUB Editorial',
      city: null,
      avatar: null,
      is_sample: false,
      is_editorial: true,
      main_vehicle_cover: null,
      verified: false,
    }, // i18n-ignore
    counts: null,
    capacity: null,
    spots_left: null,
    distance_km: null,
    attendee_preview: [],
    my_rsvp: null,
    is_sample: true,
  };
}

/** `spots_left` is typed `unknown` by the generator: a count, or null. */
export function spotsLeft(event: Pick<EventCard, 'spots_left'>): number | null {
  return typeof event.spots_left === 'number' && Number.isFinite(event.spots_left) ? event.spots_left : null;
}

/** `waitlist_position` comes as a string or a number; 1 = next. */
export function waitlistPosition(event: Pick<EventDetail, 'waitlist_position'>): number | null {
  const value = Number(event.waitlist_position);
  return event.waitlist_position !== null && Number.isFinite(value) && value > 0 ? value : null;
}

export function eventPath(slug: string) {
  return { pathname: '/events/[slug]', params: { slug } } as const;
}

export function editorPath(id: string) {
  return { pathname: '/event-editor/[id]', params: { id } } as const;
}
