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
    notes: `${FLAG_NOTE} Marke (09 §7.11): "KW" as a text wordmark in display.title on a surface-1 band with the real counts ("… Builds · 5 Produkte", tnum), the catalogue's about line and the website (S secondary); Produktlinien with their counts; the products as ProductRows (wordmark, product, "Fahrwerk · In 30 Builds"); "Builds mit KW", the photo wall (2 px, 0 radius, edge to edge on phones) and "Weitere Builds". empty = not found with the badged sample wall.`,
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
    notes: `${FLAG_NOTE} Entdecken › Teile (09 §7.5): the scope chips with Treffen · Betriebe · Teile, Marken as BrandTiles with real counts (each opens BRD-01), Produkte as ProductRows "In 30 Builds" (each opens BRD-02) and "Weitere Produkte"; the search field narrows both in place. empty = the badged sample ProductRow and "Zur Garage".`,
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
    notes: `${FLAG_NOTE} Entdecken › Betriebe: the kind chips (Alle · Werkstatt · Tuner · …), BusinessCards (logo 56 radius 12, name, "Werkstatt · Hamburg", Verifiziert, up to three service tags; the sample one badged Beispiel), and "Du hast einen Betrieb? Hier anmelden". empty = the badged sample card.`,
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
];
