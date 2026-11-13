import {
  bboxParam,
  flattenEvents,
  guessCounts,
  listQuery,
  type EventCard,
  type EventDetail,
} from '@/api/queries/events';
import i18n from '@/i18n';
import '@/features/events/i18n';
import {
  berlinParts,
  berlinToDate,
  cardCaption,
  countsLine,
  dateBlock,
  cardCounts,
  dayGroupLabel,
  eventHero,
  FALLBACK_COVER,
  groupByDay,
  groupByWeek,
  weekGroupLabel,
  hasEnded,
  mapPoint,
  nextSaturdayEvening,
  placeText,
  reviewNotice,
  routeUrl,
  sampleEvent,
  spotsLeft,
  timeRange,
  waitlistPosition,
} from '@/features/events/model';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const t = i18n.getFixedT('de');
const en = i18n.getFixedT('en');

const LOCATION: EventCard['location'] = {
  visibility: 'public',
  exact: true,
  venue_name: 'Parkplatz am Kai',
  street: 'Hafenstraße 1',
  postcode: '20457',
  city: 'Hamburg',
  country: 'DE',
  lat: 53.5413,
  lng: 9.9845,
  area: { lat: 53.55, lng: 10 },
};

function card(extra: Partial<EventCard> = {}): EventCard {
  return {
    id: 'e1',
    slug: 'cars-coffee-hafen-x1',
    title: 'Cars & Coffee Hafen',
    type: 'meet',
    status: 'published',
    visibility: 'public',
    starts_at: '2026-06-13T16:00:00Z',
    ends_at: '2026-06-13T19:00:00Z',
    timezone: 'Europe/Berlin',
    location: LOCATION,
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
    counts: { going: 38, interested: 12 },
    capacity: null,
    spots_left: null,
    distance_km: null,
    attendee_preview: [],
    my_rsvp: null,
    is_sample: false,
    ...extra,
  };
}

describe('Berlin time', () => {
  it('turns a Berlin wall clock into the right instant in summer and winter', () => {
    expect(berlinToDate({ year: 2026, month: 6, day: 13, hour: 18, minute: 0 }).toISOString()).toBe(
      '2026-06-13T16:00:00.000Z',
    );
    expect(berlinToDate({ year: 2026, month: 12, day: 5, hour: 18, minute: 30 }).toISOString()).toBe(
      '2026-12-05T17:30:00.000Z',
    );
    // The night the clocks go forward (29 March 2026): 03:30 exists only in summer time.
    expect(berlinToDate({ year: 2026, month: 3, day: 29, hour: 3, minute: 30 }).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('reads the wall clock back', () => {
    expect(berlinParts(new Date('2026-06-13T16:00:00Z'))).toMatchObject({
      year: 2026,
      month: 6,
      day: 13,
      hour: 18,
      minute: 0,
      weekday: 6,
    });
  });

  it('gives the date block and the time range in German and English', () => {
    const start = new Date('2026-06-13T16:00:00Z');
    const end = new Date('2026-06-13T19:00:00Z');
    expect(dateBlock(start, 'de')).toEqual({ day: '13', month: 'Jun', weekday: 'Sa' });
    expect(dateBlock(start, 'en').day).toBe('13');
    expect(timeRange(start, end, 'de', t)).toBe('18:00–21:00 Uhr');
    expect(timeRange(start, null, 'de', t)).toBe('ab 18:00 Uhr');
    expect(timeRange(start, end, 'en', en)).toBe('18:00–21:00');
    expect(timeRange(start, new Date('2026-06-14T14:00:00Z'), 'de', t)).toMatch(
      /^Sa\., 13\. Juni, 18:00 – So\., 14\. Juni, 16:00 Uhr$/,
    );
  });

  it('labels the date groups Heute, Morgen, then the weekday', () => {
    const now = new Date('2026-06-12T10:00:00Z');
    expect(dayGroupLabel(new Date('2026-06-12T18:00:00Z'), now, 'de', t)).toBe('Heute');
    expect(dayGroupLabel(new Date('2026-06-13T18:00:00Z'), now, 'de', t)).toBe('Morgen');
    expect(dayGroupLabel(new Date('2026-06-20T18:00:00Z'), now, 'de', t)).toBe('Samstag, 20. Juni');
    expect(dayGroupLabel(new Date('2027-01-09T18:00:00Z'), now, 'de', t)).toContain('2027');
  });

  it('groups cards under one header per Berlin day', () => {
    const rows = groupByDay(
      [
        card({ id: 'a' }),
        card({ id: 'b', starts_at: '2026-06-13T20:00:00Z' }),
        card({ id: 'c', starts_at: '2026-06-14T08:00:00Z' }),
      ],
      new Date('2026-06-12T10:00:00Z'),
      'de',
      t,
    );
    expect(rows.map((row) => (row.kind === 'day' ? row.label : row.event.id))).toEqual([
      'Morgen',
      'a',
      'b',
      expect.stringContaining('Sonntag'),
      'c',
    ]);
  });

  it('labels the list groups by spans of time (DQ-1113), so the date block is the only date', () => {
    // Wednesday 10 June 2026, noon in Berlin.
    const now = new Date('2026-06-10T10:00:00Z');
    expect(weekGroupLabel(new Date('2026-06-10T17:00:00Z'), now, 'de', t)).toBe('Heute');
    expect(weekGroupLabel(new Date('2026-06-11T17:00:00Z'), now, 'de', t)).toBe('Morgen');
    expect(weekGroupLabel(new Date('2026-06-12T17:00:00Z'), now, 'de', t)).toBe('Diese Woche');
    expect(weekGroupLabel(new Date('2026-06-13T16:00:00Z'), now, 'de', t)).toBe('Dieses Wochenende');
    expect(weekGroupLabel(new Date('2026-06-14T08:00:00Z'), now, 'de', t)).toBe('Dieses Wochenende');
    expect(weekGroupLabel(new Date('2026-06-15T17:00:00Z'), now, 'de', t)).toBe('Nächste Woche');
    expect(weekGroupLabel(new Date('2026-06-21T17:00:00Z'), now, 'de', t)).toBe('Nächste Woche');
    expect(weekGroupLabel(new Date('2026-06-24T17:00:00Z'), now, 'de', t)).toBe('Später im Juni');
    expect(weekGroupLabel(new Date('2026-07-04T17:00:00Z'), now, 'de', t)).toBe('Juli');
    expect(weekGroupLabel(new Date('2027-01-09T17:00:00Z'), now, 'de', t)).toBe('Januar 2027');
    expect(weekGroupLabel(new Date('2026-07-04T17:00:00Z'), now, 'en', en)).toBe('July');
  });

  it('puts one header before each span and keeps the cards in order', () => {
    const rows = groupByWeek(
      [
        card({ id: 'a', starts_at: '2026-06-13T16:00:00Z' }),
        card({ id: 'b', starts_at: '2026-06-14T08:00:00Z' }),
        card({ id: 'c', starts_at: '2026-06-16T17:00:00Z' }),
      ],
      new Date('2026-06-10T10:00:00Z'),
      'de',
      t,
    );
    expect(rows.map((row) => (row.kind === 'day' ? row.label : row.event.id))).toEqual([
      'Dieses Wochenende',
      'a',
      'b',
      'Nächste Woche',
      'c',
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it('starts the sample on the next Saturday evening, never in the past', () => {
    const friday = new Date('2026-06-12T10:00:00Z');
    expect(nextSaturdayEvening(friday).toISOString()).toBe('2026-06-13T16:00:00.000Z');
    const saturday = new Date('2026-06-13T20:00:00Z');
    expect(nextSaturdayEvening(saturday).toISOString()).toBe('2026-06-20T16:00:00.000Z');
  });
});

describe('the place as far as the reader may see it (ADR-437 c)', () => {
  it('shows venue and address of an exact place', () => {
    expect(placeText(LOCATION, t)).toEqual({
      title: 'Parkplatz am Kai',
      lines: ['Hafenstraße 1', '20457 Hamburg'],
      exact: true,
      hidden: false,
    });
  });

  it('shows only the city and the after-RSVP line of a private place, and offers no route', () => {
    const hidden = {
      ...LOCATION,
      visibility: 'after_rsvp' as const,
      exact: false,
      venue_name: null,
      street: null,
      postcode: null,
      lat: null,
      lng: null,
    };
    expect(placeText(hidden, t)).toEqual({
      title: 'Hamburg',
      lines: ['Ort wird nach deiner Zusage angezeigt'],
      exact: false,
      hidden: true,
    });
    expect(routeUrl(hidden, 'ios')).toBeNull();
    expect(mapPoint(hidden)).toEqual({ lat: 53.55, lng: 10, exact: false });
  });

  it('opens directions to the exact point on each platform', () => {
    expect(routeUrl(LOCATION, 'ios')).toBe('https://maps.apple.com/?daddr=53.5413%2C9.9845');
    expect(routeUrl(LOCATION, 'android')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=53.5413%2C9.9845',
    );
    expect(mapPoint(LOCATION)).toEqual({ lat: 53.5413, lng: 9.9845, exact: true });
  });
});

describe('answers and states', () => {
  it('writes real counts and none for a sample (09 §8.19)', () => {
    const format = (n: number) => new Intl.NumberFormat('de-DE').format(n);
    expect(countsLine({ going: 38, interested: 12 }, t, format)).toBe('38 Zusagen · 12 interessiert');
    expect(countsLine({ going: 1, interested: 0 }, t, format)).toBe('1 Zusage');
    expect(countsLine({ going: 1200, interested: 0 }, t, format)).toBe('1.200 Zusagen');
    expect(countsLine(null, t, format)).toBeNull();
  });

  it('puts the distance into the caption when the list was asked near a point', () => {
    expect(cardCaption(card({ distance_km: 12 }), 'de', t, (km) => `${km} km`)).toBe(
      'Hamburg · 12 km · 18:00–21:00 Uhr',
    );
  });

  it('names the organiser review state; a published event has none', () => {
    const detail = (status: EventDetail['status'], reason: string | null = null) =>
      ({
        status,
        review: { submitted_at: null, reviewed_at: null, reason },
        cancellation_reason: status === 'cancelled' ? 'Platz gesperrt' : null,
      }) as unknown as EventDetail;
    expect(reviewNotice(detail('pending_review'))).toEqual({ kind: 'pending', reason: null });
    expect(reviewNotice(detail('rejected', 'Kein Hinweis auf Genehmigung'))).toEqual({
      kind: 'rejected',
      reason: 'Kein Hinweis auf Genehmigung',
    });
    expect(reviewNotice(detail('cancelled'))).toEqual({ kind: 'cancelled', reason: 'Platz gesperrt' });
    expect(reviewNotice(detail('published'))).toBeNull();
  });

  it('reads spots and waitlist places of either type', () => {
    expect(spotsLeft({ spots_left: 0 })).toBe(0);
    expect(spotsLeft({ spots_left: null })).toBeNull();
    expect(waitlistPosition({ waitlist_position: 3 })).toBe(3);
    expect(waitlistPosition({ waitlist_position: null })).toBeNull();
  });

  it('knows an event is over by its end, or its start without one', () => {
    expect(hasEnded(card(), new Date('2026-06-13T20:00:00Z'))).toBe(true);
    expect(hasEnded(card(), new Date('2026-06-13T18:00:00Z'))).toBe(false);
    expect(hasEnded(card({ ends_at: null }), new Date('2026-06-13T16:30:00Z'))).toBe(true);
  });

  it('badges the sample and keeps its counts null', () => {
    const sample = sampleEvent(new Date('2026-06-12T10:00:00Z'), t);
    expect(sample.is_sample).toBe(true);
    expect(sample.counts).toBeNull();
    expect(sample.title).toBe('Cars & Coffee am Hafen');
  });
});

describe('the events API helpers', () => {
  it('asks for the filters it shows', () => {
    expect(
      listQuery(
        { when: 'weekend', type: 'cruise', near: { lat: 48.78, lng: 9.18, radiusKm: 50 } },
        { perPage: 3 },
      ),
    ).toEqual({
      when: 'weekend',
      type: 'cruise',
      lat: 48.78,
      lng: 9.18,
      radius_km: 50,
      per_page: 3,
    });
    expect(bboxParam([9.123456, 53.5, 10.2, 53.7])).toBe('9.1235,53.5,10.2,53.7');
  });

  it('guesses counts for the optimistic answer', () => {
    expect(guessCounts({ going: 3, interested: 2 }, 'interested', 'going')).toEqual({
      going: 4,
      interested: 1,
    });
    expect(guessCounts({ going: 3, interested: 2 }, 'going', null)).toEqual({ going: 2, interested: 2 });
    expect(guessCounts(null, null, 'going')).toBeNull();
  });

  it('drops a card a later page repeats', () => {
    const pages = [
      { data: [card({ id: 'a' }), card({ id: 'b' })], meta: { next_cursor: 'x' } },
      { data: [card({ id: 'b' }), card({ id: 'c' })], meta: { next_cursor: null } },
    ];
    expect(flattenEvents(pages).map((event) => event.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('answers on a card (DQ-1118)', () => {
  const format = (n: number) => String(n);

  it('shows nothing on samples and before publication', () => {
    expect(cardCounts(card({ is_sample: true }), t, format)).toBeNull();
    expect(
      cardCounts(card({ status: 'pending_review', counts: { going: 0, interested: 0 } }), t, format),
    ).toBeNull();
    expect(cardCounts(card({ status: 'draft', counts: { going: 0, interested: 0 } }), t, format)).toBeNull();
  });

  it('says "Noch keine Zusagen" instead of a zero, and the real counts otherwise', () => {
    expect(cardCounts(card({ counts: { going: 0, interested: 0 } }), t, format)).toBe('Noch keine Zusagen');
    expect(cardCounts(card(), t, format)).toBe('38 Zusagen · 12 interessiert');
    expect(
      cardCounts(card({ status: 'cancelled', counts: { going: 0, interested: 0 } }), t, format),
    ).toBeNull();
  });
});

describe('the hero of an event (DQ-1111)', () => {
  const media: NonNullable<EventCard['cover']> = {
    id: 'm1',
    status: 'ready',
    category: 'other',
    width: 1600,
    height: 900,
    blurhash: null,
    thumbhash: null,
    focal_x: 0.5,
    focal_y: 0.5,
    alt: 'Abendtreffen',
    sort: 0,
    variants: [{ width: 1600, height: 900, url: 'https://cdn.test/c.jpg' }],
    created_at: null,
  };

  it('uses the event cover first', () => {
    const hero = eventHero(card({ cover: media }), 800);
    expect(hero.source).toBe('own');
    expect(hero.photo.source).toBe('https://cdn.test/c.jpg');
  });

  it("falls back to the organiser's car when the API sends it, then to the fallback photo", () => {
    const organiser = {
      ...card().organiser,
      main_vehicle_cover: { ...media, id: 'm2' },
    } as EventCard['organiser'];
    expect(eventHero(card({ organiser }), 800).source).toBe('organiserCar');
    const fallback = eventHero(card(), 800);
    expect(fallback.source).toBe('fallback');
    expect(fallback.photo).toBe(FALLBACK_COVER);
  });
});
