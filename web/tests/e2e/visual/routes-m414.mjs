// Visual registry entries of M4.14 Parts, brands and businesses, app part (BRD-01/02, BIZ-01…04, the Teile and Betriebe scopes of
// DISC-01, VEH-02's "Builds mit {Produkt}", GAR-10's Katalog and "Eingebaut von"). Same fields as the entries in routes.mjs, which
// merges this list. One file per module, so parallel workstreams never edit the same registry file.
//
// Flags: parts_catalogue and businesses are off on every environment until this module's design QA passed (ADR-455), and their API
// answers 404 feature_disabled while off. The cells therefore run inside the stage fixture `m414-flags` (support/stage-fixtures.mjs,
// support/backend.php m414FlagsFixture): both flags on for the capture and off right after, plus a verified stage business of lukas.sc,
// "Werkstatt am Kanal" (test data, its Impressum says so), with kenji.r34 as staff, one confirmed build in its portfolio, one request
// and one proposal waiting, and 30 days of profile views. The paths also name both flags in qaFlags (mobile/src/lib/qa.ts), so the app
// side never waits on a cached app-config. The *-off cells run without the fixture: what a reader sees while the flags are off.
// Path tokens {kwProduct}, {productMod}, {productModVehicle}: the seeded KW Variante 3 and a public build's mod linking it
// (support/backend.php m414-ids).

const FLAGS = 'qaFlags=parts_catalogue,businesses';
const FIXTURE = 'm414-flags';
const STAGE_BUSINESS = 'werkstatt-am-kanal-m414';
const FLAG_NOTE = 'Inside the stage fixture m414-flags (parts_catalogue and businesses on for the capture, ADR-455) and forced through qaFlags.';

/** Pages of one brand, product or business: nothing to be empty except a missing one. */
const DETAIL_STATES = ['default', 'loading', 'empty', 'error', 'offline'];
/** Lists of the member's own business. */
const LIST_STATES = ['default', 'loading', 'empty', 'error', 'offline', 'restricted'];
/** Forms: nothing to be empty. */
const EDITOR_STATES = ['default', 'loading', 'error', 'offline', 'restricted'];

/**
 * `ready` for a screen with data (routes.mjs loadedOr).
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

export const routesM414 = [
  {
    id: 'BRD-01',
    path: `/app/brands/kw?${FLAGS}`,
    phase: 3,
    auth: 'member',
    states: DETAIL_STATES,
    ready: loadedOr('[data-testid="BRD-01.title"]', 'BRD-01.root'),
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Marke (09 §7.11, DQ-1141/1142): "KW" as a text wordmark in display.title on a full-width surface-1 band (0 radius, text on the gutter) with the real counts ("… Builds · 5 Produkte", tnum; samples never count, DQ-1140), the catalogue's about line and the website (S secondary); the products grouped by product line as ProductRows with a build thumbnail and without the repeated brand ("Fahrwerk · In 30 Builds"); from 1280 the products in 8 of 12 columns beside about, website and Produktlinien; "Builds mit KW", the photo wall (2 px, 0 radius, edge to edge on phones) and "Weitere Builds". empty = not found with the badged sample wall.`,
  },
  {
    id: 'BRD-01-off',
    path: '/app/brands/kw',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="BRD-01.unavailable"]',
    notes: 'parts_catalogue off (every environment today, ADR-455): the calm "Teile sind gerade nicht verfügbar" state, nothing asked of the API.',
  },
  {
    id: 'BRD-02',
    path: `/app/products/{kwProduct}?${FLAGS}`,
    phase: 3,
    auth: 'member',
    states: DETAIL_STATES,
    ready: loadedOr('[data-testid="BRD-02.title"]', 'BRD-02.root'),
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Produkt (09 §7.11): the brand "KW" as its wordmark (a link to BRD-01), "Variante 3" in title.1, the category glyph with "Fahrwerk", "Variante · In 30 Builds" (tnum), Eckdaten (the catalogue's attributes), "Herstellerseite" (secondary); no affiliate link (affiliate_links off; when on it is labelled "Anzeige"); "Builds mit KW Variante 3" as the photo wall.`,
  },
  {
    id: 'BIZ-01',
    path: `/app/b/${STAGE_BUSINESS}?${FLAGS}`,
    phase: 3,
    auth: 'member-empty',
    states: DETAIL_STATES,
    ready: loadedOr('[data-testid="BIZ-01.title"]', 'BIZ-01.root'),
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Betriebsprofil ★ as nina.neu: header pattern (b) over the 16:9 cover (full-bleed on phones), logo square 56 with the initial, "Werkstatt am Kanal" in title.1, "Werkstatt · Hamburg", Verifiziert, "Nachricht" (the one filled CTA), service chips, about; Öffnungszeiten with today highlighted (Heute pill, bold) and Samstag/Sonntag; Adresse with the map gate ("Karte anzeigen"), the address and "Route", Anrufen; "Builds aus unserer Werkstatt" with the real count and the confirmed build; Impressum (§ 5 DDG) with Firma, Rechtsform, Anschrift, Vertreten durch, E-Mail, Telefon, Registereintrag. Desktop ≥ 1280: full-width stage with the name on the scrim, 8/4 grid with the sticky contact card.`,
  },
  {
    id: 'BIZ-01-sample',
    path: `/app/b/beispiel-werkstatt-nord?${FLAGS}`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="BIZ-01.title"]',
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} The editors' sample business (09 §8.19) as a guest: Beispiel badge, no counts ("Beispielbetriebe zeigen keine Builds."), its Impressum marked "Beispieldaten".`,
  },
  {
    id: 'BIZ-02',
    path: `/app/settings/business/apply?${FLAGS}`,
    phase: 3,
    auth: 'member-empty',
    states: EDITOR_STATES,
    ready: loadedOr('[data-testid="BIZ-02.name"]', 'BIZ-02.root'),
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Bewerbung as nina.neu (no business): step 1 of 5 (Betrieb) with the wizard progress, Name des Betriebs, Art des Betriebs chips (Werkstatt chosen), Leistungen with "Hinzufügen", Über den Betrieb; sticky "Weiter". Steps 2–5: Impressum (legal form sheet, register entry only for forms that have one, USt-IdNr.), Adresse & Kontakt, Öffnungszeiten (a switch per day, Mittagspause), Bilder & Abschluss (logo, cover, Nachweise, the declaration).`,
  },
  {
    id: 'BIZ-02-edit',
    path: `/app/settings/business/apply?edit=1&${FLAGS}`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="BIZ-02.lockedNote"]',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Profil bearbeiten of the verified stage business (lukas.sc): the note that name, legal form, representative, address and register entry change through support (ADR-455), the locked name field with its helper, the rest editable; "Weiter".`,
  },
  {
    id: 'BIZ-03',
    path: `/app/business?${FLAGS}`,
    phase: 3,
    auth: 'member',
    states: LIST_STATES,
    ready: loadedOr('[data-testid="BIZ-03.views"]', 'BIZ-03.root'),
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Betriebs-Dashboard of lukas.sc: "Werkstatt am Kanal", Verifiziert pill, the private 30-day profile views as a hero.numeral.s (tnum) with "Nur für euer Team sichtbar", Profil ansehen · Profil bearbeiten · Anfragen "1 offen"; the portfolio wall with "Build vorschlagen"; Team with the owner and kenji.r34 (Entfernen) and "Mitglied hinzufügen". empty = a member without a business: the badged sample BusinessCard, "Zeig deinen Betrieb in SPEED CLUB" and "Betrieb anmelden".`,
  },
  {
    id: 'BIZ-04',
    path: `/app/business/requests?${FLAGS}`,
    phase: 3,
    auth: 'member',
    states: LIST_STATES,
    ready: loadedOr('[data-testid^="BIZ-04.tag."]', 'BIZ-04.root'),
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Anfragen: the double-confirmation line, Anfragen · Vorschläge · Portfolio, max.e46's request as a row (car photo 56 radius 8, the mod as a link, the build, "@max.e46 · date", Bestätigen · Ablehnen). A decision leaves the list with an undo toast (SM20). empty = the badged sample request, "Keine offenen Anfragen", "Zum Dashboard".`,
  },
  {
    id: 'DISC-01-parts',
    path: `/app/discover?scope=parts&${FLAGS}`,
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error'],
    ready: loadedOr('[data-testid="DISC-01.partsScope"]', 'DISC-01.root'),
    capture: 'expanded',
    maxHeight: 3200,
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Entdecken › Teile (09 §7.5, ADR-457, DQ-1138): the scope chips in one sideways-scrolling row (DQ-1152); the lead photo of the most-used product on a real build (4:5 edge to edge on phones, 16:9 from 768, "In n Builds" tnum); Marken as BrandTiles with real counts (six across from 1280); "Beliebt in Builds", a rail of build photos (3:4); Produkte sorted by real build count as ProductRows with a 1:1 build thumbnail (two columns from 768), the first 8 and "Alle Teile"; the search field narrows tiles and products in place. empty = the badged sample ProductRow and "Zur Garage".`,
  },
  {
    id: 'DISC-01-businesses',
    path: `/app/discover?scope=businesses&${FLAGS}`,
    phase: 3,
    auth: 'member-empty',
    states: ['default', 'loading', 'empty', 'error'],
    ready: loadedOr('[data-testid="DISC-01.businessesScope.list"]', 'DISC-01.root'),
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Entdecken › Betriebe (ADR-457, DQ-1139): the kind chips (Alle · Werkstatt · Tuner · …), BusinessCards led by the 16:9 cover (own cover, else the newest portfolio build, else the brand-stage photo captioned "Symbolbild"; the logo 56 overlapping it), name, "Werkstatt · Hamburg" with Verifiziert or Beispiel after it (never both), up to two service tags; one per row on phones, 2 from 768, 3 from 1280; and "Du hast einen Betrieb? Hier eintragen". empty = the badged sample card.`,
  },
  {
    id: 'VEH-02-product',
    path: `/app/v/{productModVehicle}/mods/{productMod}?${FLAGS}`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="VEH-02.product"]',
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Mod-Detail of a part linked to KW Variante 3: the Produkt row (BRD-02) and "Mehr von dieser Marke" (BRD-01) under the title, and at the end the rail "Builds mit KW Variante 3" (DQ-1070), the other public builds that run it.`,
  },
  {
    id: 'GAR-10-parts',
    path: `/app/garage/{r34}/mods/{r34Mod}?${FLAGS}`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="GAR-10.group.product"]',
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Mod-Editor of the R34 wheels with M4.14: the Katalog group with "Produkt suchen (optional)" (a sheet with the category's catalogue products as the member types), and in Einbau "Eingebaut von" with "Betrieb wählen (optional)": a request to a verified business, which confirms it in BIZ-04.`,
  },

  // DQ-1150: the affiliate state, test data only (stage fixture m414-affiliate: affiliate_links on, a shop.speedclub.test URL).
  {
    id: 'BRD-02-affiliate',
    path: `/app/products/{kwProduct}?${FLAGS}`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="BRD-02.affiliate.label"]',
    capture: 'expanded',
    fixture: 'm414-affiliate',
    notes: `${FLAG_NOTE} BRD-02 with affiliate_links on and a test affiliate URL on KW Variante 3: "Herstellerseite" (secondary) and "Beim Händler ansehen" with the "Anzeige" label beside it (09 §8.9, UWG).`,
  },
  // DQ-1151: BIZ-02's later steps (qaStep opens the wizard there) and the status screen of an application in review and a declined one.
  ...[2, 3, 4, 5].map((step) => ({
    id: `BIZ-02-step${step}`,
    path: `/app/settings/business/apply?qaStep=${step}&${FLAGS}`,
    phase: 3,
    auth: 'member-empty',
    states: ['default'],
    ready: '[data-testid="BIZ-02.progress"]',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Bewerbung step ${step} of 5 as nina.neu, opened through qaStep: ${
      { 2: 'Impressum (Rechtsform sheet row, Name laut Register, Vertreten durch, Registergericht/-nummer, USt-IdNr.)', 3: 'Adresse & Kontakt', 4: 'Öffnungszeiten (a switch per day, Mittagspause)', 5: 'Bilder & Abschluss (Logo, Titelbild, Nachweise, the declaration) and "Bewerbung senden"' }[step]
    }; "Zurück" beside the sticky CTA.`,
  })),
  {
    id: 'BIZ-02-status-applied',
    path: `/app/settings/business/apply?${FLAGS}`,
    phase: 3,
    auth: 'member-blocker',
    states: ['default'],
    ready: '[data-testid="BIZ-02.status"]',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} paul.roadster's application "Roadster Garage" (test data in the fixture): the status pill "In Prüfung", what happens next, and "Angaben ändern".`,
  },
  {
    id: 'BIZ-02-status-rejected',
    path: `/app/settings/business/apply?${FLAGS}`,
    phase: 3,
    auth: 'member-affected',
    states: ['default'],
    ready: '[data-testid="BIZ-02.status"]',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} tobi.quattro's declined application "Quattro Tuning" (test data): "Abgelehnt", the staff's reason (missing register entry) and "Korrigieren und neu senden" as the one filled CTA.`,
  },
  // SEC-414-01: BIZ-05 Einladungen, the member's side of a team invitation (the fixture's stage business invited nina.neu).
  {
    id: 'BIZ-05',
    path: `/app/business/invites?${FLAGS}`,
    phase: 3,
    auth: 'member-empty',
    states: LIST_STATES,
    ready: loadedOr('[data-testid^="BIZ-05.invite."]', 'BIZ-05.root'),
    capture: 'expanded',
    fixture: FIXTURE,
    notes: `${FLAG_NOTE} Einladungen as nina.neu: "Werkstatt am Kanal" invited her to its team (BusinessCard with its cover, who invited, when), Annehmen (filled) and Ablehnen; she joins only once she accepts (ADR-461 a). empty = the badged sample and what an invitation is.`,
  },
];
