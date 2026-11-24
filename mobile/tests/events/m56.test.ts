import { canCheckin, checkinOf, groupCheckinCode, normaliseCheckinCode, refreshDelay } from '@/api/queries/eventCheckin';
import { canAddPhotos, canModeratePhotos, flattenPhotos, galleryOf, type EventPhoto } from '@/api/queries/eventGallery';
import {
  afterWeek,
  DEFAULT_FILTERS,
  listQuery,
  startsBefore,
  weekWindowEnd,
  type EventCard,
  type EventDetail,
} from '@/api/queries/events';
import i18n from '@/i18n';
import '@/features/events/i18n';
import { checkinOffer, checkinSchema } from '@/features/events/checkin';
import { WHEN_CHIPS } from '@/features/events/components/EventFilters';
import { dayHeader, groupByDayHeaders, headerIndices } from '@/features/events/model';
import { nextEvents } from '@/features/home/model';
import { nearbyEventsPatch, nearbyEventsValue } from '@/features/settings/screens/NotificationSettingsScreen';
import type { NotificationPrefs } from '@/api/queries/settings';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const de = i18n.getFixedT('de');
const en = i18n.getFixedT('en');

function card(id: string, starts_at: string | null, extra: Partial<EventCard> = {}): EventCard {
  return {
    id,
    slug: `${id}-x1`,
    title: 'Cars & Coffee am Hafen',
    type: 'meet',
    status: 'published',
    visibility: 'public',
    starts_at,
    ends_at: starts_at ? new Date(Date.parse(starts_at) + 3 * 3600 * 1000).toISOString() : null,
    timezone: 'Europe/Berlin',
    location: {
      visibility: 'public',
      exact: false,
      venue_name: null,
      street: null,
      postcode: null,
      city: 'Hamburg',
      country: 'DE',
      lat: null,
      lng: null,
      area: { lat: 53.55, lng: 10 },
    },
    cover: null,
    organiser: {
      username: 'lukas.sc',
      display_name: 'Lukas',
      city: null,
      avatar: null,
      is_sample: false,
      is_editorial: false,
      main_vehicle_cover: null,
      verified: false,
    },
    counts: { going: 3, interested: 0 },
    capacity: null,
    spots_left: null,
    distance_km: null,
    attendee_preview: [],
    my_rsvp: null,
    is_sample: false,
    ...extra,
  } as EventCard;
}

describe('M5.6 "Diese Woche": the next seven Berlin days', () => {
  it('is the default view, first of the time chips, and asked as `week` (m5.6-contract §1)', () => {
    expect(DEFAULT_FILTERS.when).toBe('week');
    expect(WHEN_CHIPS).toEqual(['week', 'today', 'weekend', 'month']);
    expect(listQuery({ when: 'week', type: null, near: null })).toEqual({ when: 'week' });
    expect(listQuery({ when: 'weekend', type: null, near: null })).toEqual({ when: 'weekend' });
  });

  it('ends at midnight in Berlin after the seventh day, across a change of the clocks', () => {
    // Wednesday 18 November 2026, 11:00 in Berlin (winter time): up to Tuesday 24 November inclusive.
    expect(weekWindowEnd(new Date('2026-11-18T10:00:00Z')).toISOString()).toBe('2026-11-24T23:00:00.000Z');
    // Saturday 24 October 2026 (summer time); the clocks go back on the 25th, so the end is in winter time.
    expect(weekWindowEnd(new Date('2026-10-24T10:00:00Z')).toISOString()).toBe('2026-10-30T23:00:00.000Z');
    // 00:30 on a Monday in Berlin is still that Monday (23:30 UTC the evening before).
    expect(weekWindowEnd(new Date('2026-11-15T23:30:00Z')).toISOString()).toBe('2026-11-22T23:00:00.000Z');
  });

  it('on a Saturday keeps next Friday 23:30 and leaves next Saturday 00:10 out', () => {
    const end = weekWindowEnd(new Date('2026-11-21T09:00:00Z'));
    expect(startsBefore({ starts_at: '2026-11-27T22:30:00Z' }, end)).toBe(true);
    expect(startsBefore({ starts_at: '2026-11-27T23:10:00Z' }, end)).toBe(false);
    expect(startsBefore({ starts_at: null }, end)).toBe(false);
  });

  it('knows from the first page of `upcoming` whether meets follow the week, and which comes first', () => {
    const end = weekWindowEnd(new Date('2026-11-18T10:00:00Z'));
    const inside = [card('a', '2026-11-19T17:00:00Z'), card('b', '2026-11-22T17:00:00Z')];
    const beyond = card('c', '2026-11-28T17:00:00Z');
    expect(afterWeek([...inside, beyond], false, end)).toEqual({ next: beyond, exists: true });
    expect(afterWeek(inside, false, end)).toEqual({ next: null, exists: false });
    // A full first page of this week's meets with more pages: later ones exist, the first is not read yet.
    expect(afterWeek(inside, true, end)).toEqual({ next: null, exists: true });
    expect(afterWeek([], false, end)).toEqual({ next: null, exists: false });
  });
});

describe('M5.6 day headers (sticky, Heute · Morgen · weekday with its date)', () => {
  const now = new Date('2026-11-16T10:00:00Z'); // Monday 16 November 2026

  it('names today and tomorrow with their date, later days by weekday and date', () => {
    expect(dayHeader(new Date('2026-11-16T18:00:00Z'), now, 'de', de)).toMatchObject({ label: 'Heute', date: 'Montag, 16. November' });
    expect(dayHeader(new Date('2026-11-17T18:00:00Z'), now, 'de', de)).toMatchObject({ label: 'Morgen', date: 'Dienstag, 17. November' });
    expect(dayHeader(new Date('2026-11-18T18:00:00Z'), now, 'de', de)).toMatchObject({
      label: 'Mittwoch',
      date: '18. November',
      accessibilityLabel: 'Mittwoch, 18. November',
    });
    expect(dayHeader(new Date('2026-11-18T18:00:00Z'), now, 'en', en)).toMatchObject({ label: 'Wednesday', date: '18 November' });
    expect(dayHeader(new Date('2027-01-08T18:00:00Z'), now, 'de', de).date).toContain('2027');
  });

  it('puts a meet that is already running under today', () => {
    expect(dayHeader(new Date('2026-11-15T20:00:00Z'), now, 'de', de)).toMatchObject({ label: 'Heute', key: '2026-11-16' });
  });

  it('groups the cards under one header per Berlin day and lists the header rows for the sticky list', () => {
    const rows = groupByDayHeaders(
      [
        card('a', '2026-11-16T17:00:00Z'),
        card('b', '2026-11-16T19:00:00Z'),
        // 00:30 on Wednesday in Berlin: a day of its own, though it is still Tuesday in UTC.
        card('c', '2026-11-17T23:30:00Z'),
        card('d', null),
      ],
      now,
      'de',
      de,
    );
    expect(rows.map((row) => (row.kind === 'day' ? row.label : row.event.id))).toEqual(['Heute', 'a', 'b', 'Mittwoch', 'c', 'Ohne Termin', 'd']);
    expect(headerIndices(rows)).toEqual([0, 3, 5]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
});

describe('M5.6 HOME-01 "Nächste Treffen"', () => {
  const now = new Date('2026-11-16T10:00:00Z');

  it('shows two coming meets, never a cancelled or an ended one', () => {
    const events = [
      card('over', '2026-11-15T10:00:00Z'),
      card('cancelled', '2026-11-17T17:00:00Z', { status: 'cancelled' }),
      card('a', '2026-11-18T17:00:00Z'),
      card('b', '2026-11-20T17:00:00Z'),
      card('c', '2026-11-21T17:00:00Z'),
    ];
    expect(nextEvents(events, now).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('is empty when nothing is coming (the module is then not shown)', () => {
    expect(nextEvents([card('over', '2026-11-15T10:00:00Z')], now)).toEqual([]);
    expect(nextEvents([], now)).toEqual([]);
  });
});

function detail(extra: Record<string, unknown> = {}, can: Record<string, unknown> = {}): EventDetail {
  return { ...card('e1', '2026-11-16T17:00:00Z'), can: { rsvp: true, ...can }, ...extra } as unknown as EventDetail;
}

describe('M5.6 check-in (m5.6-contract §5)', () => {
  it('forgives spaces, dashes and small letters, and refuses what cannot be a code', () => {
    expect(normaliseCheckinCode('k7m 2qp')).toBe('K7M2QP');
    expect(normaliseCheckinCode('K7M-2QP')).toBe('K7M2QP');
    // 0, O, 1, I and L are not in the alphabet; five or seven characters are not a code.
    expect(normaliseCheckinCode('K7M2Q0')).toBeNull();
    expect(normaliseCheckinCode('K7M2Q')).toBeNull();
    expect(normaliseCheckinCode('K7M2QPX')).toBeNull();
    expect(normaliseCheckinCode(null)).toBeNull();
    expect(groupCheckinCode('K7M2QP')).toBe('K7M 2QP');
  });

  it('checks the form: required, then the format', () => {
    const schema = checkinSchema(de);
    expect(schema.safeParse({ code: '', profileVisible: true }).error?.issues[0]?.message).toBe('Gib den Code ein, den der Organisator zeigt.');
    expect(schema.safeParse({ code: 'ABC', profileVisible: true }).error?.issues[0]?.message).toBe('Der Code hat sechs Buchstaben und Ziffern.');
    expect(schema.safeParse({ code: 'k7m 2qp', profileVisible: false }).success).toBe(true);
  });

  it('reads the detail field and is invisible without it; a check-in without its time counts as none', () => {
    expect(checkinOf(detail())).toBeNull();
    const info = checkinOf(detail({ checkin: { open: true, opens_at: null, closes_at: null, mine: null, count: 4 } }));
    expect(info).toMatchObject({ open: true, mine: null, count: 4 });
    expect(checkinOf(detail({ checkin: { open: true, opens_at: null, closes_at: null, mine: { checked_in_at: null, profile_visible: true }, count: null } }))?.mine).toBeNull();
    expect(canCheckin(detail({}, { checkin: true }))).toBe(true);
    expect(canCheckin(detail())).toBe(false);
  });

  it('offers "Einchecken" in the window, "War dabei" after, the opening time to members going, nothing to the organiser or with the flag off', () => {
    const now = new Date('2026-11-16T10:00:00Z');
    const open = detail({ checkin: { open: true, opens_at: '2026-11-16T09:00:00Z', closes_at: '2026-11-16T22:00:00Z', mine: null, count: null } }, { checkin: true });
    expect(checkinOffer(open, { enabled: true, organiser: false, now }).kind).toBe('open');
    expect(checkinOffer(open, { enabled: false, organiser: false, now }).kind).toBe('none');
    expect(checkinOffer(open, { enabled: true, organiser: true, now }).kind).toBe('none');
    const done = detail({ checkin: { open: true, opens_at: null, closes_at: null, mine: { checked_in_at: '2026-11-16T09:30:00Z', profile_visible: false }, count: null } });
    expect(checkinOffer(done, { enabled: true, organiser: false, now })).toMatchObject({ kind: 'done', info: { mine: { profile_visible: false } } });
    const later = { open: false, opens_at: '2026-11-16T16:00:00Z', closes_at: '2026-11-16T22:00:00Z', mine: null, count: null };
    expect(checkinOffer(detail({ checkin: later, my_rsvp: 'going' }), { enabled: true, organiser: false, now }).kind).toBe('later');
    expect(checkinOffer(detail({ checkin: later, my_rsvp: null }), { enabled: true, organiser: false, now }).kind).toBe('none');
  });

  it('asks the organiser’s code again shortly before it rotates, within 5 to 60 seconds', () => {
    const now = Date.parse('2026-11-16T10:00:00Z');
    expect(refreshDelay({ refresh_at: '2026-11-16T10:00:20Z' }, now)).toBe(20_000);
    expect(refreshDelay({ refresh_at: '2026-11-16T09:59:00Z' }, now)).toBe(5_000);
    expect(refreshDelay({ refresh_at: '2026-11-16T10:30:00Z' }, now)).toBe(60_000);
    expect(refreshDelay(undefined, now)).toBe(60_000);
  });
});

function photo(id: string): EventPhoto {
  return {
    id,
    media: { id: `m-${id}`, status: 'ready', category: 'other', width: 1080, height: 1080, blurhash: null, thumbhash: null, focal_x: null, focal_y: null, alt: null, sort: 0, variants: [], created_at: null },
    source: 'attendee',
    status: 'approved',
    uploader: { username: 'nina.r34', display_name: null, city: null, avatar: null, is_sample: false, is_editorial: false },
    reject_reason: null,
    created_at: null,
    reviewed_at: null,
    is_sample: false,
    can: { delete: false, report: true, moderate: false },
  } as EventPhoto;
}

describe('M5.6 gallery (m5.6-contract §4)', () => {
  it('reads the detail field and the rights from `can`', () => {
    expect(galleryOf(detail())).toBeNull();
    const gallery = { open: false, opens_at: null, closes_at: null, count: 3, pending: null, mine_pending: null, preview: [photo('a')] };
    expect(galleryOf(detail({ gallery }))).toEqual(gallery);
    expect(canAddPhotos(detail({}, { add_photos: true }))).toBe(true);
    expect(canAddPhotos(detail())).toBe(false);
    expect(canModeratePhotos(detail({}, { moderate_photos: true }))).toBe(true);
  });

  it('flattens cursor pages without repeating a photo', () => {
    expect(flattenPhotos([{ data: [photo('a'), photo('b')], meta: { next_cursor: 'x' } }, { data: [photo('b'), photo('c')], meta: { next_cursor: null } }]).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('M5.6 SET-09 "Neue Treffen in deiner Nähe" (m5.6-contract §6)', () => {
  const prefs = (types: Record<string, unknown>) => ({ types, quiet_hours: { enabled: false, from: '22:00', to: '07:00' }, message_previews: false, digest_frequency: 'weekly' }) as unknown as NotificationPrefs;

  it('reads each channel of the type', () => {
    expect(nearbyEventsValue(prefs({ event_nearby: { push: false, email: true, web_push: false } }), 'email')).toBe(true);
    expect(nearbyEventsValue(prefs({ event_nearby: { push: true, email: false, web_push: false } }), 'push')).toBe(true);
    expect(nearbyEventsValue(prefs({ event_nearby: { push: true, email: false, web_push: false } }), 'web_push')).toBe(false);
  });

  it('patches one channel of the type', () => {
    expect(nearbyEventsPatch('email', true)).toEqual({ notification_prefs: { types: { event_nearby: { email: true } } } });
  });
});
