// Visual registry entries of M5.6 Events page polish, app part (docs/10_CLIENT_ROUND_1.md §4, server contract
// docs/reports/phase-5/m5.6-contract.md). Same fields as the entries in routes.mjs, which merges this list. EVT-01 itself (routes-m412-evt.mjs)
// is now the "Diese Woche" view; these cells add the week's empty state, every coming meet, the gallery, the check-in (EVT-02, EVT-06,
// EVT-07), SET-09 "Neue Treffen in deiner Nähe" and PROF-01 "War dabei".
//
// EVT-02's gallery is the seed's own (DQ-P5-012): max.e46's past "Saugmotor-Abend" with its approved gallery, read from the server while
// the stage fixture m56-gallery has events.gallery on. The check-in cells and EVT-06's organiser tools switch their flags on for the cell
// through `qaFlags` (never in production) and stage the contract's answers on top of the server's own event detail (`patch`) or answer
// the routes outright (the server's flags stay off); the check-in QR is a real code rendered once by the server's QrRenderer
// (fixtures/m56-checkin-qr.svg).

import { readFileSync } from 'node:fs';

import { QA_NOW } from '../support/qa.mjs';

const QR_SVG = readFileSync(new URL('./fixtures/m56-checkin-qr.svg', import.meta.url), 'utf8');

/** A screen with data: the loaded element in the default state, the root in a forced one (routes.mjs loadedOr). */
const loadedOr = (/** @type {string} */ loaded, /** @type {string} */ root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
// Relative to the cell's fixed clock (the browser's clock and qaNow are QA_NOW), never to the machine's: a staged "now" must be the
// app's now, or a meet "running now" lies days ahead of the app's clock.
const iso = (/** @type {number} */ offset) => new Date(Date.parse(QA_NOW) + offset).toISOString();

/** The event detail (`GET events/{slug}`), never its sub-resources. */
const DETAIL = /\/api\/v1\/events\/[A-Za-z0-9-]{3,140}(\?.*)?$/;
const LIST = /\/api\/v1\/events(\?.*)?$/;
const GALLERY = /\/api\/v1\/events\/[A-Za-z0-9-]{3,140}\/gallery(\?.*)?$/;

/**
 * The covers of the seeded sample events (public list, guests too), as gallery media. Empty when the list cannot be read: the cell then
 * shows the event's own cover only.
 * @returns {Promise<any[]>}
 */
async function sampleCovers(/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ baseUrl) {
  try {
    const answer = await page.request.get(`${baseUrl}/api/v1/events?when=upcoming&per_page=20`);
    if (!answer.ok()) return [];
    const body = await answer.json();
    return (body.data ?? []).map((/** @type {any} */ event) => event.cover).filter(Boolean);
  } catch {
    return [];
  }
}

/** Contract §4.3 photos from media, uploaded by the sample organiser and the demo members. */
function photosOf(/** @type {any[]} */ media, /** @type {string} */ status = 'approved') {
  const uploaders = ['jann.ptrs', 'nina.r34', 'speedclub.editorial', 'kenji.r34'];
  return media.map((item, index) => ({
    id: `p${index + 1}`,
    media: item,
    source: index % 3 === 2 ? 'organiser' : 'attendee',
    status,
    uploader: { username: uploaders[index % uploaders.length], display_name: null, city: null, avatar: null, is_sample: true, is_editorial: false },
    reject_reason: null,
    created_at: iso(-DAY),
    reviewed_at: status === 'approved' ? iso(-DAY / 2) : null,
    is_sample: true,
    can: { delete: false, report: true, moderate: status === 'pending' },
  }));
}

/** At least `count` media: the sample covers, then repeated in their order (a real gallery has many photos of one place). */
function enough(/** @type {any[]} */ covers, /** @type {any} */ own, /** @type {number} */ count) {
  const pool = covers.length > 0 ? covers : own ? [own] : [];
  return pool.length === 0 ? [] : Array.from({ length: count }, (_, index) => pool[index % pool.length]);
}

/**
 * The meet running now with its check-in window open (contract §5.2); `mine` checked in or not.
 * @param {{ mine?: boolean }} options
 */
const checkinNow =
  ({ mine = false } = {}) =>
  async (/** @type {import('./route-steps.mjs').RouteStepContext} */ { stage }) => {
    await stage(DETAIL, {
      patch: (/** @type {{ data: Record<string, any> }} */ body) => {
        body.data.starts_at = iso(-HOUR);
        body.data.ends_at = iso(2 * HOUR);
        body.data.checkin = {
          opens_at: iso(-2 * HOUR),
          closes_at: iso(4 * HOUR),
          open: true,
          mine: mine ? { checked_in_at: iso(-20 * 60 * 1000), profile_visible: true } : null,
          count: null,
        };
        body.data.can = { ...body.data.can, checkin: !mine };
        return body;
      },
    });
  };

/**
 * lukas.sc's own meet as a published one tonight, with the code row and three photos to approve (contract §4.5, §5.3).
 * @param {import('./route-steps.mjs').RouteStepContext} ctx
 */
async function organiserTools({ page, stage, baseUrl }) {
  const covers = await sampleCovers(page, baseUrl);
  await stage(/\/api\/v1\/events\/[A-Za-z0-9-]{3,140}\/checkin-code(\?.*)?$/, {
    body: {
      data: {
        code: 'K7M2QP',
        url: `${baseUrl}/app/events/checkin?code=K7M2QP`,
        svg: QR_SVG,
        expires_at: iso(5 * 60 * 1000),
        refresh_at: iso(4.5 * 60 * 1000),
        checked_in: 12,
      },
    },
  });
  // Answered outright: the server's own answer is the `events.gallery` flag-off refusal (the flag stays off for these cells).
  await stage(GALLERY, {
    body: { data: photosOf(enough(covers, null, 3), 'pending'), links: {}, meta: { next_cursor: null, prev_cursor: null, per_page: 30, path: null } },
  });
  await stage(DETAIL, {
    patch: (/** @type {{ data: Record<string, any> }} */ body) => {
      body.data.status = 'published';
      body.data.review = null;
      body.data.starts_at = iso(-HOUR);
      body.data.ends_at = iso(2 * HOUR);
      body.data.checkin = { opens_at: iso(-2 * HOUR), closes_at: iso(4 * HOUR), open: true, mine: null, count: 12 };
      // DQ-P5-013: the answers agree with the check-ins (12 of 18 who said yes are in), never "0 Teilnehmende" beside "12 eingecheckt".
      // No capacity, so no "Plätze frei" line follows from them.
      body.data.counts = { going: 18, interested: 4 };
      body.data.capacity = null;
      body.data.spots_left = null;
      body.data.gallery = { open: true, opens_at: iso(-HOUR), closes_at: iso(16 * DAY), count: 0, pending: 3, mine_pending: 0, preview: [] };
      body.data.can = { ...body.data.can, edit: true, cancel: true, post_update: true, view_updates: true, view_attendees: true, show_checkin_code: true, moderate_photos: true };
      return body;
    },
  });
}

/** @type {import('./matrix.mjs').RouteDef[]} */
export const routesM56 = [
  {
    id: 'EVT-01-weekEmpty',
    path: '/app/events',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { en: true, tablet: true, black: true, small: true },
    ready: '[data-testid="EVT-01.weekEmpty"]',
    prepare: async ({ stage }) => {
      // Every seeded meet moved past the week: the week is empty, later meets exist.
      await stage(LIST, {
        patch: (/** @type {{ data: Record<string, any>[] }} */ body) => {
          body.data = body.data.map((event, index) => ({ ...event, starts_at: iso((9 + index) * DAY), ends_at: iso((9 + index) * DAY + 3 * HOUR) }));
          return body;
        },
      });
      // Since M5.6's server the app asks for the week itself (`when=week`) instead of cutting `upcoming`: that answer is the empty week.
      // Registered last, so it runs before LIST for the week's request (Playwright runs the newest matching route first).
      await stage(/\/api\/v1\/events\?(.*&)?when=week(&.*)?$/, {
        patch: (/** @type {{ data: unknown[], meta: Record<string, unknown> }} */ body) => ({ ...body, data: [], meta: { ...body.meta, next_cursor: null } }),
      });
    },
    notes:
      'M5.6 EVT-01 "Diese Woche" with nothing this week but later meets (staged dates): the chip row Diese Woche (selected) · Heute · Wochenende · Monat · Entfernung · Art, then "Diese Woche steht noch kein Treffen an.", "Als Nächstes:", the next real meet as an EventCard with its cover (no sample card: there is real content later) and "Alle kommenden Treffen" (secondary M).',
  },
  {
    id: 'EVT-01-upcoming',
    path: '/app/events?when=upcoming',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { en: true, tablet: true, black: true, small: true },
    ready: '[data-testid^="EVT-01.event."]',
    capture: 'expanded',
    maxHeight: 2400,
    notes:
      'M5.6 every coming meet (the chosen time chip tapped again, or "Alle kommenden Treffen"): no time chip selected, the spans of time as before (Heute · Morgen · Dieses Wochenende · Nächste Woche · Dezember), each header sticking while its cards scroll.',
  },
  {
    id: 'EVT-02-gallery',
    // DQ-P5-012: the seeded gallery, read from the server (stage fixture m56-gallery switches events.gallery on for these cells).
    path: '/app/events/{pastMemberEvent}',
    fixture: 'm56-gallery',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="EVT-02.gallery.grid"]',
    capture: 'expanded',
    p4: { en: true },
    notes:
      'M5.6 EVT-02 after the meet, from the seed (DQ-P5-012): max.e46\'s "Saugmotor-Abend" (München, over) with its approved gallery (contract §4), nine night photos at a car park and on the street by the organiser and attendees, none of them an event cover, each badged as a sample: "Fotos vom Treffen" leads the sections, the six newest as square tiles 2 apart, the group rounded 12 once, "9 Fotos" (caption, tnum) and "Alle Fotos", the approval and plate line. lukas.sc did not attend, so no "Fotos hinzufügen". The answer bar says the meet is over.',
  },
  {
    id: 'EVT-02-gallery-all',
    path: '/app/events/{pastMemberEvent}',
    fixture: 'm56-gallery',
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await page.getByTestId('EVT-02.gallery.all').click();
    },
    ready: '[data-testid="EVT-02.gallery.more"], [data-testid^="EVT-02.gallery.photo."]:nth-child(7)',
    capture: 'expanded',
    notes: 'The gallery opened in place by "Alle Fotos": all nine approved photos of the seeded gallery in rows of three.',
  },
  {
    id: 'EVT-02-checkin',
    path: '/app/events/{memberEvent}?qaFlags=events.checkin',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="EVT-02.checkin.open"]',
    capture: 'expanded',
    fs2: true,
    prepare: checkinNow(),
    notes:
      'M5.6 EVT-02 during the meet (staged now) with the check-in window open (contract §5): "Einchecken" (secondary M, qr-code glyph) under the identity, above the place card; lukas.sc is going, so the answer bar keeps "Zugesagt". One filled CTA at most (none here).',
  },
  {
    id: 'EVT-02-checkin-sheet',
    path: '/app/events/{memberEvent}?qaFlags=events.checkin',
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: checkinNow(),
    walk: async ({ page }) => {
      await page.getByTestId('EVT-02.checkin.open').click();
    },
    ready: '[data-testid="EVT-02.checkin.code"]',
    capture: 'viewport',
    fs2: true,
    notes:
      'The check-in sheet: "Beim Treffen einchecken", the line about scanning the organiser\'s QR or typing the code, the field "Check-in-Code" (z. B. K7M 2QP, helper "Sechs Zeichen, ohne Leerzeichen."), the switch row "Auf meinem Profil zeigen" (on) with "Erst wenn das Treffen vorbei ist, mit Name und Datum, nie mit Uhrzeit oder Ort.", and "Einchecken" (primary, full width) sticky at the sheet\'s foot.',
  },
  {
    id: 'EVT-02-wasThere',
    path: '/app/events/{memberEvent}?qaFlags=events.checkin',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="EVT-02.checkin.wasThere"]',
    capture: 'expanded',
    prepare: checkinNow({ mine: true }),
    notes:
      'Checked in: check-circle glyph, "War dabei" (headline), "Eingecheckt um … Uhr" (caption, tnum), the switch row "Auf meinem Profil zeigen" with "Steht nach dem Treffen auf deinem Profil.", "Check-in entfernen" (destructive text S).',
  },
  {
    id: 'EVT-06-m56',
    path: '/app/events/{pendingEvent}/manage?qaFlags=events.checkin,events.gallery',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    ready: '[data-testid="EVT-06.galleryReview.list"]',
    capture: 'expanded',
    prepare: organiserTools,
    p4: { en: true, black: true },
    notes:
      'M5.6 EVT-06 for lukas.sc (his meet staged as published and running): after Bearbeiten · Teilnehmende the row "Check-in-Code zeigen" (qr-code glyph, "12 eingecheckt" as its value, the rotating-code helper), then "Fotos freigeben" with "3 warten", the approval line and three rows (square thumb 56, "von @…", "Freigeben" secondary S, "Ablehnen" tertiary S), then the update composer.',
  },
  {
    id: 'EVT-06-code',
    path: '/app/events/{pendingEvent}/manage?qaFlags=events.checkin,events.gallery',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { black: true },
    prepare: organiserTools,
    walk: async ({ page }) => {
      await page.getByTestId('EVT-06.checkinCode.row').click();
    },
    ready: '[data-testid="EVT-06.checkinCode.qr"]',
    capture: 'viewport',
    notes:
      'The code sheet on the organiser\'s phone: the QR on its white card (the same card as 2FA and stickers, every theme) with "K7M 2QP" under it, "12 eingecheckt" (headline, tnum), "Teilnehmende scannen den Code … Ein neuer Code kommt von selbst." The QR is a real code (fixtures/m56-checkin-qr.svg).',
  },
  {
    id: 'EVT-07',
    path: '/app/events/{memberEvent}/checkin?code=K7M2QP&qaFlags=events.checkin',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'offline'],
    ready: loadedOr('[data-testid="EVT-07.title"]', 'EVT-07.root'),
    capture: 'expanded',
    fs2: true,
    p4: { en: true },
    prepare: checkinNow(),
    notes:
      'M5.6 EVT-07 Check-in, the page the organiser\'s QR opens: header "Check-in" with back, "Bei Feierabendtreffen am Elbdeich einchecken?" (title.2), the line about "War dabei", the EventCard (no answer button), the code field filled with "K7M 2QP", the profile switch row, and "Einchecken" (sticky primary on phones, inline L from 768). empty = "Dieses Treffen gibt es nicht mehr"; loading = title, card and two lines in their geometry; error/offline + retry.',
  },
  {
    id: 'EVT-07-success',
    path: '/app/events/{memberEvent}/checkin?code=K7M2QP&qaFlags=events.checkin',
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: async (ctx) => {
      await checkinNow()(ctx);
      await ctx.stage(/\/api\/v1\/events\/[A-Za-z0-9-]{3,140}\/checkin$/, {
        method: 'POST',
        status: 201,
        body: { data: { checked_in_at: iso(0), profile_visible: true, event: { id: 'staged' } } },
      });
    },
    walk: async ({ page }) => {
      await page.locator('[data-testid="EVT-07.cta.primary"]').first().click();
    },
    ready: '[data-testid="EVT-07.success"]',
    capture: 'viewport',
    notes: 'After "Einchecken" (staged 201): check-circle glyph, "Du bist eingecheckt" (title.2), "Nach dem Treffen steht es auf deinem Profil.", "Zum Treffen" (secondary M). Success haptic on native.',
  },
  {
    id: 'SET-09-nearby',
    path: '/app/settings/notifications',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    p4: { black: true },
    ready: '[data-testid="SET-09.push.event_nearby"]',
    capture: 'expanded',
    prepare: async ({ stage }) => {
      await stage(/\/api\/v1\/me\/settings(\?.*)?$/, {
        method: 'GET',
        patch: (/** @type {{ data: Record<string, any> }} */ body) => {
          body.data.notification_prefs.types.event_nearby = { push: false, email: false, web_push: false };
          return body;
        },
      });
    },
    notes:
      'M5.6 SET-09 Treffen with the weekly opt-in (contract §6, staged type): after "Erinnerungen an Treffen" (+ E-Mail) and "Änderungen an Treffen" the rows "Neue Treffen in deiner Nähe" (off, "Einmal pro Woche am Donnerstag, …") and "… per E-Mail" (off); without a SET-11 region the helper asks for one and "Region festlegen" (map-pin, link to SET-11) closes the group.',
  },
  {
    id: 'PROF-01-checkins',
    path: '/app/profile?tab=events&qaFlags=events.checkin',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="PROF-01.checkins"]',
    capture: 'expanded',
    maxHeight: 3200,
    prepare: async ({ page, stage, baseUrl }) => {
      let cards = [];
      try {
        const answer = await page.request.get(`${baseUrl}/api/v1/events?when=upcoming&per_page=3`);
        cards = answer.ok() ? (await answer.json()).data ?? [] : [];
      } catch {
        cards = [];
      }
      await stage(/\/api\/v1\/me\/checkins(\?.*)?$/, {
        body: {
          data: cards.slice(0, 2).map((/** @type {Record<string, any>} */ card, /** @type {number} */ index) => ({
            ...card,
            starts_at: iso(-(index + 1) * 7 * DAY),
            ends_at: iso(-(index + 1) * 7 * DAY + 3 * HOUR),
            my_rsvp: null,
            checked_in_at: iso(-(index + 1) * 7 * DAY + HOUR),
            profile_visible: index === 0,
          })),
          links: {},
          meta: { next_cursor: null, prev_cursor: null, per_page: 20, path: null },
        },
      });
    },
    notes:
      'M5.6 PROF-01 Treffen with "War dabei" (contract §5.3 me/checkins, staged from two sample meets moved into the past): after the member\'s own meets the section header "War dabei", two EventCards (muted, ended) each with "Eingecheckt am …" and, for the hidden one, "· Nur für dich sichtbar".',
  },
];
