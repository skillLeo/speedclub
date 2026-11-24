// Visual registry entries of M5.4 Sticker, app part (docs/10_CLIENT_ROUND_1.md §2, ADR-504, contract
// docs/reports/phase-5/m5.4-contract.md). Same fields as the entries in routes.mjs, which merges this list. They replace QR-01…04:
// QR-01 → STK-01 (the hub), QR-02 → STK-02 (the sticker's detail with its QR card), QR-03 → STK-03 (placement), QR-04 → STK-02-preview
// (the public page a scan opens; 10 §11 gives STK-04 to the scan statistics). New: STK-04 stats, STK-05 ★ designer, STK-06 order,
// STK-07 versions. The old app addresses /profile/qr and /qr/{id}… redirect in the app (and 301 on the server once switched on).
//
// `qaStickers=sample` (mobile/src/features/qr/qaStickers.ts, compiled out of production) answers the scan counts from a bundled,
// "Beispiel"-badged month, so STK-01/STK-04 show a sticker with scans on a host whose demo cars have none; designs, previews, the
// Scan-Test and the order link stay real. Since M5.10 (ShowcasePhase5, DemoShowcaseSeeder) lukas.sc's R34 has designs that passed the
// server Scan-Test (v1 Classic, v2 Vertical JDM, the current one), so the cells of the states "no passed Scan-Test" and "no version"
// no longer come from the seed (DQ-P5-206). They are staged on the R34, independent of what the seed gave it: STK-05-line and
// STK-06-notReady on the stage fixture `m54-sticker-draft` (an open Classic draft, which prints the custom line, above the current
// version; support/backend.php), STK-07-empty with the server's own versions answer emptied (prepare/patch).

/** The versions list of STK-07 (useStickerVersions), first page and later ones. */
const STICKER_VERSIONS = /\/api\/v1\/vehicles\/[^/]+\/sticker-design\/versions(\?.*)?$/;

const ALL_STATES = ['default', 'loading', 'empty', 'error', 'offline'];
const OWNER_STATES = [...ALL_STATES, 'restricted'];

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

const DESIGNER =
  'Full-screen editor, tab bar hidden: compact header (back, "Sticker gestalten" and the car with the autosave status, each up to two lines at the 1.3 cap, DQ-M54-02; undo · redo 44 icons), the segmented control Flach · Am Auto · 1:1 (capped at 1.3; accessible name "Originalgröße"), the large live preview on the black media stage, measured and clipped (DQ-M54-01) (the server\'s drawing of the unsaved state, crossfading on a template switch), then the non-modal dock (radius 20, grabber) with the template chips Classic · Minimal · Banner · Plate · Vertical JDM · Round and the Scan-Test line, and the sticky bar with ONE filled CTA "Scan-Test starten" (after a passed test: "Sticker bestellen" + "Herunterladen").';

/** @type {import('./matrix.mjs').RouteDef[]} */
export const routesM54 = [
  {
    id: 'STK-01',
    path: '/app/stickers',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: OWNER_STATES,
    ready: loadedOr('[data-testid$=".art"]', 'STK-01.root'),
    capture: 'expanded',
    fs2: true,
    p4: { en: true, tablet: true, black: true },
    notes:
      'M5.4 STK-01 "Meine Sticker" (10 §2.2) as lukas.sc: large title, one card per car (R34 first): the live sticker on the car\'s own cover photo, blurred and dimmed (DQ-M54-08, the STK-02 treatment), the car in display.wordmark, StatusPill "Aktiv", the design line, the week\'s scans as hero.numeral.s (tnum) only when there are any, else "Noch keine Scans diese Woche", with a 16 caret (link to STK-04, 44 high), Gestalten · Bestellen (secondary M) and on its own line Herunterladen (tertiary, on the text gutter) with the caption why. No filled CTA. From 1280 two cards per row. empty = the badged sample sticker + "Dein erster Sticker wartet" + "Fahrzeug hinzufügen"; restricted = the suspended notice; loading = two cards in their full geometry (DQ-M54-09).',
  },
  {
    id: 'STK-01-sample',
    path: '/app/stickers?qaStickers=sample',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-01.sampleCounts"]',
    capture: 'expanded',
    notes: 'STK-01 with the bundled sample scan counts (qaStickers=sample): the "Beispiel" badge above the cards, the week\'s scans per card in Archivo Condensed.',
  },
  {
    id: 'STK-02',
    path: '/app/stickers/{r34}',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: OWNER_STATES,
    ready: loadedOr('[data-testid="STK-02.art"]', 'STK-02.root'),
    capture: 'expanded',
    p4: { en: true, tablet: true },
    notes:
      'The sticker of the R34 (DQ-M54-10): title "Sticker" + the car, the sticker drawing on the blurred cover stage (16:9, full bleed on a phone, radius 20 from 768), ONE filled "Sticker gestalten" ("Sticker bestellen" once a design passed its Scan-Test, then "Sticker gestalten" moves to a row) and "Sticker-PDF" (secondary), rows QR-Code (value "8TR0 Q3MC", opens the sheet with the white QR card and the formats) · Teilen · Öffentliche Seite ansehen · Sticker-Platzierung · Scan-Statistik ("n Scans in 30 Tagen", behind sig.qr_stats), "QR-Code ersetzen" on its own. restricted = the notice and no designer/order action.',
  },
  {
    id: 'STK-02-preview',
    path: '/app/stickers/{r34}/preview',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ALL_STATES,
    ready: loadedOr('[data-testid="STK-02-preview.card"]', 'STK-02-preview.root'),
    capture: 'expanded',
    notes: 'Public page preview (was QR-04): cover, name and /v URL, what a scan shows, the link that opens the real page.',
  },
  {
    id: 'STK-03',
    path: '/app/stickers/{r34}/placement',
    phase: 3,
    auth: 'member',
    states: ['default', 'offline'],
    ready: '[data-testid="STK-03.root"]',
    capture: 'expanded',
    notes: 'Placement guide (was QR-03): the numbered top-down car, the five rules and the footer of 08_LEGAL §7 word for word, the print guidance. Subtitle "Wo dein Sticker hingehört".',
  },
  {
    id: 'STK-04',
    path: '/app/stickers/{r34}/stats',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'offline', 'empty'],
    // DQ-M54R2-06: the zero state renders STK-04.zeroTitle instead of the totals.
    ready: loadedOr('[data-testid="STK-04.total"], [data-testid="STK-04.zeroTitle"]', 'STK-04.root'),
    capture: 'expanded',
    fs2: true,
    notes:
      'M5.4 STK-04 Scan-Statistik (owner only, counts only) with the real counts of the R34. With scans: "SCANS INSGESAMT" + hero.numeral, Diese Woche / Letzte Woche, "Letzte 30 Tage · n Scans", the 30-day line; the group Sticker-Scans · Geteilte Links "Noch nicht erfasst" (null until M5.7) · Erster Scan · Meilensteine; from 1280 numerals + line 8 / group 4. Without scans (this host) DQ-M54-12: "Noch hat niemand deinen Sticker gescannt." (title.2), one sentence, the ghost line, "Gestalten" (secondary, inside the gutter), then Erster Scan "Noch keiner" · Meilensteine. empty = "Sticker nicht verfügbar".',
  },
  {
    id: 'STK-04-data',
    path: '/app/stickers/{r34}/stats',
    phase: 3,
    auth: 'member',
    states: ['default'],
    fixture: 'm54-stickers',
    ready: '[data-testid="STK-04.total"]',
    capture: 'expanded',
    fs2: true,
    notes: 'DQ-M54R2-06: STK-04 with real counts from the m54-stickers fixture (scan rows on the R34\'s code for the last 30 days, weekend peaks): "SCANS INSGESAMT" + hero.numeral, Diese Woche / Letzte Woche, "Letzte 30 Tage · n Scans", the line with its end dot, the group Sticker-Scans · Geteilte Links "Noch nicht erfasst" · Erster Scan · Meilensteine; from 1280 8/4.',
  },
  {
    id: 'STK-04-sample',
    path: '/app/stickers/{r34}/stats?qaStickers=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-04.sample"]',
    capture: 'expanded',
    p4: { en: true },
    notes: 'STK-04 with the bundled sample month (qaStickers=sample, "Beispiel" badge): 412 total, weekend peaks in the line, first scan 2. März 2026, milestones 10 · 50 · 100.',
  },
  {
    id: 'STK-05',
    path: '/app/stickers/{r34}/design',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default', 'loading', 'error', 'offline', 'restricted', 'empty'],
    ready: loadedOr('[data-testid="STK-05.preview.art"]', 'STK-05.root'),
    capture: 'viewport',
    fs2: true,
    p4: { en: true, tablet: true, black: true },
    notes: `M5.4 STK-05 ★ Sticker designer (10 §2.3), Flach. ${DESIGNER} From 900 px the preview and the controls stand side by side (controls column 400 with every option, no dock). restricted = the suspended notice, controls disabled; offline = the banner "deine Änderungen werden gespeichert, sobald du wieder online bist"; empty = "Sticker nicht verfügbar"; loading = header, mode switch, the stage with a sticker block and the dock's chip row.`,
  },
  {
    id: 'STK-05-car',
    path: '/app/stickers/{r34}/design?mode=car',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-05.preview.car.art"]',
    capture: 'viewport',
    p4: { en: true },
    notes: `STK-05 "Am Auto": the sticker (film only: transparent film disappears, a mirrored print reads right from outside) at its real size on a licensed photo (design/seed-photos/CREDITS.md: RS3 8Y rear window by day, A 45 S rear window in the evening, 350Z light rear panel for black print), 4:5 frame radius 12 from full-resolution crops (DQ-M54-05), a 3× loupe of the sticker bottom-right in the frame, chips Tag · Abend · Heller Lack and the caption "Beispielfoto · echte Größe". Tilt parallax on devices only, off with reduced motion. ${DESIGNER}`,
  },
  {
    id: 'STK-05-ruler',
    path: '/app/stickers/{r34}/design?mode=ruler',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-05.preview.ruler.art"]',
    capture: 'viewport',
    notes: `STK-05 "Originalgröße": the sticker at about its real size (CSS px ≈ 1/163 in on phones), the ruler in a column under its left edge (DQ-M54-03): 5 mm ticks, longer each cm, longest each 5 cm, a label at every cm and "Zentimeter", scrolling sideways when wider than the screen, and "Ungefähr in Originalgröße – genau 156 × 65 mm …". ${DESIGNER}`,
  },
  {
    id: 'STK-05-expanded',
    path: '/app/stickers/{r34}/design?qaDesigner=expanded',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-05.qr"]',
    capture: 'viewport',
    fs2: true,
    viewports: [390, 1440],
    notes: `DQ-M54-07 (qaDesigner=expanded, a preview that saves nothing, compiled out of production): the dock at its expanded detent: Inhalt (QR-Code, Benutzername, Fahrzeugname, Eigene Zeile with "0 von 24 Zeichen"), Druck (Druckfarbe radio rows with hints, Folie chips, Spiegelverkehrt), Größe S · M · L with the millimetres and the QR size, Frühere Versionen · Sticker-Platzierung; the preview scaled into the strip above. ${DESIGNER}`,
  },
  {
    id: 'STK-05-qroff',
    path: '/app/stickers/{r34}/design?qaDesigner=qroff',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-05.qrOff"]',
    capture: 'viewport',
    viewports: [390, 1440],
    notes: `DQ-M54-07 (qaDesigner=qroff, a preview that saves nothing, compiled out of production): QR-Code off: the warning "Ohne QR-Code kann niemand deinen Build scannen." (error notice) under the switch, the preview without a code, the Scan-Test line "Ohne QR-Code ist kein Scan-Test nötig" once saved (here a preview: nothing is saved). ${DESIGNER}`,
  },
  {
    id: 'STK-05-line',
    path: '/app/stickers/{r34}/design?qaDesigner=line',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    fixture: 'm54-sticker-draft',
    ready: '[data-testid="STK-05.customLine"]',
    capture: 'viewport',
    viewports: [390, 1440],
    notes: `DQ-M54-07 (qaDesigner=line, a preview that saves nothing, compiled out of production) on the m54-sticker-draft fixture (a Classic draft: the seeded Vertical JDM prints no custom line, so its dock has no field): a custom line "Built not bought" with its counter "16 von 24 Zeichen" in the expanded dock, the line drawn under the logo. ${DESIGNER}`,
  },
  {
    id: 'STK-05-minimal',
    path: '/app/stickers/{r34}/design?qaDesigner=minimal',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-05.preview.art"]',
    capture: 'viewport',
    viewports: [390, 1440],
    notes: `DQ-M54-07 (qaDesigner=minimal, a preview that saves nothing, compiled out of production): the Minimal template (QR on top, small wordmark) in the stage, chip "Minimal" selected. ${DESIGNER}`,
  },
  {
    id: 'STK-05-banner',
    path: '/app/stickers/{r34}/design?qaDesigner=banner',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-05.preview.art"]',
    capture: 'viewport',
    fs2: true,
    viewports: [390, 1440],
    notes: `DQ-M54-07 (qaDesigner=banner, a preview that saves nothing, compiled out of production): the Banner template (windscreen strip, 390 × 65 mm) filling the stage width. ${DESIGNER}`,
  },
  {
    id: 'STK-05-plate',
    path: '/app/stickers/{r34}/design?qaDesigner=plate',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-05.preview.art"]',
    capture: 'viewport',
    viewports: [390, 1440],
    notes: `DQ-M54-07 (qaDesigner=plate, a preview that saves nothing, compiled out of production): the Plate template (licence-plate proportions, @username large, never a real plate layout). ${DESIGNER}`,
  },
  {
    id: 'STK-05-vertical',
    path: '/app/stickers/{r34}/design?qaDesigner=vertical',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-05.preview.art"]',
    capture: 'viewport',
    viewports: [390, 1440],
    notes: `DQ-M54-07 (qaDesigner=vertical, a preview that saves nothing, compiled out of production): the Vertical JDM template (the logo as a column, QR at the foot) filling the stage height. ${DESIGNER}`,
  },
  {
    id: 'STK-05-round',
    path: '/app/stickers/{r34}/design?qaDesigner=round',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="STK-05.preview.art"]',
    capture: 'viewport',
    viewports: [390, 1440],
    notes: `DQ-M54-07 (qaDesigner=round, a preview that saves nothing, compiled out of production): the Round template (circle, QR in the centre). ${DESIGNER}`,
  },
  {
    id: 'STK-05-passed',
    path: '/app/stickers/{r34}/design',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    fixture: 'm54-stickers',
    ready: '[data-testid="STK-05.download"]',
    capture: 'viewport',
    fs2: true,
    p4: { en: true },
    notes: `DQ-M54-07 on the m54-stickers fixture: a design that passed the server Scan-Test: "Scan-Test bestanden" (check-circle in state.success) in the dock, the header "… · Gespeichert", the sticky bar with ONE filled "Sticker bestellen" and "Herunterladen". ${DESIGNER}`,
  },
  {
    id: 'STK-06',
    path: '/app/stickers/{r34}/order',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default', 'loading', 'error', 'offline', 'restricted', 'empty'],
    fixture: 'm54-stickers',
    ready: loadedOr('[data-testid="STK-06.reference"]', 'STK-06.root'),
    capture: 'expanded',
    p4: { en: true },
    notes:
      'M5.4 STK-06 Sticker bestellen (ADR-502) on the m54-stickers fixture (a Classic white + Signal-Red with "Built not bought" that passed the server Scan-Test): the drawing on the blurred R34 stage, the group Design-ID (SD…) · Vorlage · Größe · Druckfarbe · Folie · "Scan-Test bestanden", ONE filled "Im Shop bestellen" (external link glyph) and the Shopify sentence. On a host without a Shopify store (OA-44, this one) the notice "Bestellung bald verfügbar" and the button disabled. From 1280 the action column stands beside the summary (8/4).',
  },
  {
    id: 'STK-06-notReady',
    path: '/app/stickers/{r34}/order',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default', 'restricted'],
    fixture: 'm54-sticker-draft',
    ready: loadedOr('[data-testid="STK-06.notReady"]', 'STK-06.root'),
    capture: 'expanded',
    notes:
      'DQ-M54-15 on the m54-sticker-draft fixture (the R34\'s current version an open Classic draft): no passed Scan-Test yet: the member\'s current drawing on the blurred car stage, "Erst der Scan-Test" (title.2), one sentence and the hint, left-aligned, and the filled "Scan-Test starten" (opens STK-05 and runs it). restricted = the suspension notice and no action.',
  },
  {
    id: 'STK-07',
    path: '/app/stickers/{r34}/history',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'offline'],
    fixture: 'm54-stickers',
    ready: loadedOr('[data-testid="STK-07.list"] [data-testid^="STK-07.version."]', 'STK-07.root'),
    capture: 'expanded',
    notes:
      'M5.4 STK-07 Frühere Versionen on the m54-stickers fixture: three passed versions newest first, each with its drawing (black thumb), "Version n", template · size · mm, "Geprüft am …" (the newest "aktuell"), "Zurückholen" (secondary S) on the older two. Desktop: the list keeps 8 of 12 columns.',
  },
  {
    id: 'STK-07-empty',
    path: '/app/stickers/{r34}/history',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-206: the R34 has versions since M5.10; the server's own answer, emptied, is the car that has none yet.
    prepare: async ({ stage }) => {
      await stage(STICKER_VERSIONS, {
        method: 'GET',
        patch: (/** @type {{ data: unknown[], meta: Record<string, unknown> }} */ body) => ({ ...body, data: [], meta: { ...body.meta, next_cursor: null } }),
      });
    },
    ready: '[data-testid="STK-07.empty"]',
    capture: 'expanded',
    notes: 'DQ-M54-16 (staged: the versions answer emptied): no versions yet: a badged "Beispiel" version row (the car\'s own default drawing, "Version 1 · Classic · M · 156 × 65 mm", "Geprüft am 2. März 2026"), "Noch keine Versionen" (title.2), one sentence, "Gestalten" (secondary), left-aligned.',
  },
];
