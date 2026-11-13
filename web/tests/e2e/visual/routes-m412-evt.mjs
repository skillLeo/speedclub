// Visual registry entries of M4.12 Events and meets, app part (EVT-01…06, the HOME-01 and DISC-01 modules). Same fields as the
// entries in routes.mjs, which merges this list. One file per module, so parallel workstreams never edit the same registry file.
//
// Data: the public cells read the eight seeded sample events of the SPEED CLUB Editorial account (ShowcaseEvents, ADR-437; titles and places without "Beispiel" since DQ-1112; slugs are
// the same on every seed, `php artisan db:seed --class=DemoShowcaseSeeder` or ShowcaseEvents::seed()), badged "Beispiel", with no
// counts (09 §8.19). The organiser cells use lukas.sc's own events {pendingEvent} (in review, frozen, ADR-439) and {draftEvent}
// (draft, place after RSVP), made through the member API on first use by support/events.mjs and seen by nobody else. The runner
// blocks third parties, and maps load third-party tiles only after a tap ("Karte anzeigen", or the Karte segment): every map
// cell shows that gate (and the member web needs CSP sources for the map, see the module report).

/** Lists and pages with data. */
const LIST_STATES = ['default', 'loading', 'empty', 'error', 'offline', 'restricted'];
/** A page of one event: nothing to be empty except a missing event. */
const DETAIL_STATES = ['default', 'loading', 'empty', 'error', 'offline'];
/** Forms: nothing to be empty. */
const EDITOR_STATES = ['default', 'loading', 'error', 'offline', 'restricted'];

const HAFEN = 'abendtreffen-am-hafen-klahfh';
const PRIVATE = 'abendtreffen-im-sueden-m5ovqb';
// DQ-1110: lane B's published demo meet of jann.ptrs that members can answer (ShowcaseEvents member_events, 10 days ahead, rolls).
// The cells EVT-02-member / -going resolve it through the path token {memberEvent} (support/events.mjs), so a reseed never breaks them.
export const MEMBER_EVENT = 'feierabendtreffen-am-elbdeich-jlfgqt';

/**
 * `ready` for a screen with data (routes.mjs loadedOr).
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

export const routesM412Evt = [
  {
    id: 'EVT-01',
    path: '/app/events',
    phase: 3,
    auth: 'member',
    states: LIST_STATES,
    ready: loadedOr('[data-testid^="EVT-01.event."]', 'EVT-01.root'),
    capture: 'expanded',
    maxHeight: 2400,
    notes:
      'Treffen (09 §7.10): large title, Liste · Karte, chips Heute · Wochenende · Diesen Monat · Entfernung · Treffen · Ausfahrt · Trackday · Messe; the sample events by Berlin day ("Samstag, 21. November"), each with its own 16:9 seed cover, each a date block (hero.numeral.s day, label.caps month), headline title, "Hamburg · 18:00–21:00 Uhr" caption, Beispiel badge, no counts, "Zusagen" (S secondary); "+" in the header. empty = the badged sample card, "Gerade keine Treffen in deiner Nähe." and "Region ändern"; restricted = the notice that creating is off, browsing on.',
  },
  {
    id: 'EVT-01-map',
    path: '/app/events?view=map',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="EVT-01.map"]',
    notes:
      'Karte opened by link: the segmented control on Karte, the chips, and the map frame with its gate ("Die Karte lädt Daten von OpenFreeMap und OpenStreetMap. Erst wenn du tippst." + "Karte anzeigen"): a link never loads third-party tiles, a tap on Karte does. After the tap a device shows the clustered area pins with date labels and the selected card under the map.',
  },
  {
    id: 'EVT-02',
    path: `/app/events/${HAFEN}`,
    phase: 3,
    auth: 'member',
    states: DETAIL_STATES,
    ready: loadedOr('[data-testid="EVT-02.title"]', 'EVT-02.root'),
    capture: 'expanded',
    notes:
      'Treffen-Detail ★ of "Abendtreffen am Hafen": its own 16:9 seed cover full-bleed (every sample event has one, DQ-1111/1112), date block + "18:00–21:00 Uhr", title.1, Beispiel + Editorial badges, organiser row, the place card with the map gate ("Karte anzeigen"), "Kaiplatz", "Am Kai 1", address and "Route", Beschreibung, Regeln (Nur legal first), Teilnehmende "Beispiel-Treffen zeigen keine Zahlen.", the floating bar with "Beispiel-Treffen nehmen keine Zusagen an." empty = gone ("Dieses Treffen gibt es nicht mehr").',
  },
  {
    id: 'EVT-02-private',
    path: `/app/events/${PRIVATE}`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="EVT-02.title"]',
    capture: 'expanded',
    notes: 'A place after RSVP (ADR-437 c): the card shows "München" and "Ort wird nach deiner Zusage angezeigt", no address and no "Route"; the map gate would show the area ring, never the point.',
  },
  {
    id: 'EVT-02-organiser',
    path: '/app/events/{pendingEvent}',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="EVT-02.review"]',
    capture: 'expanded',
    notes: "lukas.sc's own event in review: status pill In Prüfung, the review block \"Wird geprüft\" (frozen, ADR-439), the exact place (the organiser sees it), the bar \"Du organisierst dieses Treffen.\" with Verwalten.",
  },
  {
    // DQ-1110: the flagship's main state, a published member event that can be answered ({memberEvent}, support/events.mjs).
    id: 'EVT-02-member',
    path: '/app/events/{memberEvent}',
    phase: 3,
    auth: 'member-empty',
    states: ['default', 'loading'],
    ready: loadedOr('[data-testid="EVT-02.rsvp.going"]', 'EVT-02.root'),
    capture: 'expanded',
    notes:
      '"Feierabendtreffen am Elbdeich" by @jann.ptrs as nina.neu, who has not answered: 16:9 cover full-bleed, date block + "19:00–22:00 Uhr", title.1, organiser row, the place card with the map gate, address and "Route", Beschreibung, Regeln (Community / Organisator sub-labels), Teilnehmende with up to five faces and "8 Zusagen · 3 interessiert", "Noch 32 Plätze frei", Neuigkeiten vom Organisator (one update), and the floating bar: "Zusagen" (the one filled CTA) + "Interessiert". Desktop ≥ 1280: full-width hero with the title on the scrim, 8/4 grid with the sticky date, place and answer card.',
  },
  {
    id: 'EVT-02-going',
    path: '/app/events/{memberEvent}',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="EVT-02.rsvp.state"]',
    capture: 'expanded',
    notes: 'The same meet as lukas.sc, who is going (seeded): the bar reads "Zugesagt" with "In Kalender", "Teilen" and "Absagen"; no filled CTA.',
  },
  {
    id: 'EVT-03-new',
    path: '/app/event-editor/new',
    phase: 3,
    auth: 'member',
    states: EDITOR_STATES,
    ready: loadedOr('[data-testid="EVT-03.title"]', 'EVT-03.root'),
    notes: 'Treffen erstellen, step 1 of 5 (Basis): the wizard progress and "Schritt 1 von 5: Basis", Titel, Art chips (Treffen chosen), Cover with its helper and "Cover wählen", Wer sieht das Treffen? (Alle) with its helper; sticky "Weiter".',
  },
  {
    id: 'EVT-03-draft',
    path: '/app/event-editor/{draftEvent}',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="EVT-03.title"]',
    notes: 'Editing the draft "Nachtausfahrt Schwarzwaldhochstraße": step 1 filled in (Ausfahrt, Follower).',
  },
  {
    id: 'EVT-03-frozen',
    path: '/app/event-editor/{pendingEvent}',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="EVT-03.frozen"]',
    notes: 'A pending event cannot be edited (409 event_in_review, ADR-439): "Gerade in Prüfung" with "Zum Treffen" instead of the form.',
  },
  {
    id: 'EVT-04',
    path: '/app/events/{pendingEvent}/attendees',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'offline'],
    ready: loadedOr('[data-testid="EVT-04.privacy"]', 'EVT-04.root'),
    notes: 'Teilnehmende of an event in review: members see the list only once it is published (the "nicht sichtbar" state); loading = six member rows in geometry.',
  },
  {
    id: 'EVT-04-member',
    path: '/app/events/{memberEvent}/attendees',
    phase: 3,
    auth: 'member',
    states: ['default', 'empty'],
    ready: loadedOr('[data-testid^="EVT-04.member."]', 'EVT-04.root'),
    notes:
      'Teilnehmende of the published demo meet (DQ-1110): the going members with their handle and city. empty (DQ-1116) = left-aligned, two badged sample rows ("@nachtschicht.e46 · fährt BMW M3 E46"), title.2 "Noch keine Zusagen" and one line; "Treffen teilen" only for the organiser.',
  },
  {
    id: 'EVT-05',
    path: '/app/profile/events?tab=organised',
    phase: 3,
    auth: 'member',
    states: LIST_STATES,
    ready: loadedOr('[data-testid^="EVT-05.event."]', 'EVT-05.root'),
    // M4.15: the tab row at 200 % (DQ-1115 / DQ-1089 shared fix), outside the flagship and form sets.
    fs2: true,
    notes: 'Meine Treffen, tab Organisiert: lukas.sc\'s two events with their pills (In Prüfung, Entwurf); tabs Zugesagt · Interessiert · Organisiert · Vergangen. empty = the badged sample and "Treffen erstellen".',
  },
  {
    id: 'EVT-06',
    path: '/app/events/{pendingEvent}/manage',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'offline', 'restricted'],
    ready: loadedOr('[data-testid="EVT-06.review"]', 'EVT-06.root'),
    capture: 'expanded',
    notes: 'Organisator-Tools while in review: the card with the In Prüfung pill, "Wird geprüft", the frozen line, Bearbeiten disabled, Teilnehmende, Gesendete Updates (none), "Treffen absagen" and "Treffen löschen" in accent text.',
  },
  {
    id: 'DISC-01-events',
    path: '/app/discover',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="DISC-01.events"], [data-testid="DISC-01.makes"]',
    capture: 'expanded',
    notes: 'Entdecken with "Treffen am Wochenende" (the sample events of the coming weekend, when there are any) and the scope chip "Treffen".',
  },
];
