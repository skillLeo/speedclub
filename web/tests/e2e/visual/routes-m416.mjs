// Visual registry entries of M4.16 Public web 2.0 (09 §9): the new public Blade pages of events, businesses and part brands. Same
// fields as the entries in routes.mjs, which merges this list. WEB-01, WEB-02 and WEB-03 keep their entries in routes.mjs (redesigned
// in place, same paths and ready selectors).
//
// IDs: 09 §9 numbers the event, business and brand pages WEB-09, WEB-10 and WEB-11, while docs/04_SCREEN_REGISTER.md already uses
// WEB-09 (Melden) and WEB-10 (Kontakt), whose registry entries stay as they are. Until the lead renumbers one side, these entries
// carry the 09 number and the page's kind (WEB-09-event, WEB-10-business, WEB-11-brand); the pages' test IDs are WEB-09.*, WEB-10.*
// and WEB-11.* as M4.14 already did for the business and brand pages.
//
// Data: the seeded sample events of the SPEED CLUB Editorial account (ShowcaseEvents, stable slugs, badged "Beispiel", no counts)
// and the answerable demo meet of jann.ptrs ({memberEvent}, real counts). The business and brand pages are behind the flags
// businesses and parts_catalogue, off everywhere (ADR-455): their cells run inside the stage fixture m414-flags (both flags on for
// the capture, plus the verified stage business "Werkstatt am Kanal" of lukas.sc). Public Blade pages have no loading or offline
// state; `error` renders the shared failure page (WEB-STATE) with status 200. A page a guest may not see answers 404 by design
// (expectStatus). No cell makes a third-party request: the map and the route open openstreetmap.org only on a tap.

const HAFEN = 'abendtreffen-am-hafen-klahfh';
const PRIVATE = 'abendtreffen-im-sueden-m5ovqb';
const PAST = 'saugmotor-abend-pkvmaw';
const STAGE_BUSINESS = 'werkstatt-am-kanal-m414';
const FIXTURE = 'm414-flags';

/**
 * `ready` of a public page: its root, or the shared failure page in the error state.
 * @param {string} root test ID
 */
const pageOr = (root) => `[data-testid="${root}"], [data-qa-state="error"] [data-testid="WEB-STATE.root"]`;

export const routesM416 = [
  {
    id: 'WEB-09-event',
    path: `/e/${HAFEN}`,
    phase: 3,
    auth: 'guest',
    states: ['default', 'error'],
    ready: pageOr('WEB-09.root'),
    notes:
      'Treffen as a public page (EVT-02 ★ on the web): the sample cover 16:9 full-bleed with the Beispiel badge, the date block (hero.numeral.s day + label.caps month), "Treffen · Samstag" with the glyph, the time range (tnum), title.1, "Organisiert von @speedclub.editorial"; Ort with "Kaiplatz", the address, "Karte anzeigen" and "Route" (tertiary links to openstreetmap.org, nothing loads before the tap); Worum es geht, Regeln (Nur legal first), Wer kommt "Bei Beispiel-Treffen zeigen wir keine Zahlen."; the sticky bar "In der App zusagen" (the one filled CTA) + "In Kalender". From 1280 the 8/4 grid with the sticky card (date, time, place, the two actions, "Noch kein Konto? Kostenlos beitreten").',
  },
  {
    id: 'WEB-09-event-private',
    path: `/e/${PRIVATE}`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="WEB-09.root"]',
    notes:
      'A place after RSVP (09 §8.7, ADR-437 c): the lock glyph, "München" and "Den genauen Ort siehst du nach deiner Zusage in der App.", "Gegend auf der Karte" (the area point at zoom 12) and no "Route"; no venue, street or point anywhere in the page, its JSON-LD or its card.',
  },
  {
    id: 'WEB-09-event-member',
    path: '/e/{memberEvent}',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="WEB-09.root"]',
    notes: 'A member-organised demo meet (not a sample): real counts in Wer kommt ("2 Zusagen · 1 interessiert", tnum) and the places left when it has a capacity; indexable.',
  },
  {
    id: 'WEB-09-event-past',
    path: `/e/${PAST}`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="WEB-09.root"][data-state="past"]',
    notes: 'A meet that is over: "Dieses Treffen ist vorbei." under the header, no "In Kalender"; the filled CTA reads "In der App öffnen".',
  },
  {
    id: 'WEB-09-event-missing',
    path: '/e/gibt-es-nicht',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    expectStatus: 404,
    ready: '[data-testid="WEB-STATE.root"][data-state="event_unavailable"]',
    notes: 'A meet a guest may not see (missing, draft, in review, removed, followers only) answers the same 404 page: "Treffen nicht verfügbar".',
  },
  {
    id: 'WEB-10-business',
    path: `/b/${STAGE_BUSINESS}`,
    phase: 3,
    auth: 'guest',
    states: ['default', 'error'],
    ready: pageOr('WEB-10.root'),
    fixture: FIXTURE,
    notes:
      'Betriebsseite (BIZ-01 ★ on the web, M4.14) inside the stage fixture m414-flags: the cover, logo, name, "Werkstatt · Hamburg", Verifiziert, services, actions, opening hours with today, the address and "Route", the portfolio with the confirmed build, and the Impressum (§ 5 DDG). M4.16 adds the drawn OG card (cover, name, kind and city, confirmed builds).',
  },
  {
    id: 'WEB-10-business-off',
    path: `/b/${STAGE_BUSINESS}`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    expectStatus: 404,
    ready: '[data-testid="WEB-STATE.root"][data-state="business_unavailable"]',
    notes: 'businesses off (every environment today, ADR-455): the 404 page "Betrieb nicht verfügbar".',
  },
  {
    id: 'WEB-11-brand',
    path: '/brands/kw',
    phase: 3,
    auth: 'guest',
    states: ['default', 'error'],
    ready: pageOr('WEB-11.root'),
    fixture: FIXTURE,
    notes: 'Markenseite (BRD-01 on the web, M4.14) inside the stage fixture m414-flags: "KW" as the wordmark on the surface band with the real counts, product lines, parts, "Builds mit KW". M4.16 adds the drawn OG card (the wordmark, builds and parts).',
  },
];
