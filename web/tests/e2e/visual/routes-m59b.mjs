// Visual registry entries of M5.9b STREET DEX, app part 1 (10 §16.2, contract docs/reports/phase-5/m5.9b-contract.md §8), lane A.
// Same fields as the entries in routes.mjs, which merges this list. DEX-02 on the member web is the "only in the app" state (no
// camera, ADR-508). DEX-03 needs a spot the server cannot make yet (lane B builds the spots API next), so its cells open the bundled
// sample spot `/dex/spot/sample` through the non-production override `qaDex` (mobile/src/lib/qa.ts): new, duplicate, first (First
// Spotter foil), ghost (Ghost frame), young (account < 24 h). Nothing is sent from them.
// Part 2: DEX-01, -04, -05, -06, the VEH-01 owner line, the PROF-01 row, SET-09 "Spots" and the EVT-01 spot layer answer from the
// bundled QA set under `qaDex=sample` (mobile/src/features/dex/qaDex.ts: four seed-photo cars, four sets, one owner month, twelve
// cities), until lane B serves the Dex reads.

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

const REVEAL_STATES = ['default', 'loading', 'error', 'empty', 'offline', 'restricted'];
const REVEAL_READY = loadedOr('[data-testid="DEX-03.card"]', 'DEX-03.root');

/** @param {string} variant @param {string} notes */
const reveal = (variant, notes) => ({
  id: variant === 'new' ? 'DEX-03' : `DEX-03-${variant}`,
  path: `/app/dex/spot/sample?qaDex=${variant}`,
  phase: 3,
  auth: 'member',
  states: variant === 'new' ? REVEAL_STATES : ['default'],
  ready: REVEAL_READY,
  capture: 'expanded',
  ...(variant === 'new' ? { p4: { en: true, black: true }, fs2: true } : {}),
  notes,
});

export const routesM59b = [
  {
    id: 'DEX-02',
    path: '/app/scan',
    phase: 3,
    auth: 'member',
    states: ['default', 'offline'],
    ready: '[data-testid="DEX-02.web.state"]',
    capture: 'expanded',
    p4: { en: true },
    notes:
      'M5.9b DEX-02 on the member web (ADR-508: no camera, no location): close in the header, "Spotten geht nur in der App", the line that a browser scan only counts as a page view, "So sieht ein Spot in der App aus:" and the sample R34 card (badged Beispiel, Rare, its top mods on the dark stage), "Zur Startseite" (secondary). offline = the banner. The native scanner (camera, corner frame, torch, panels, location sheet) is covered by Jest and the emulator check.',
  },
  reveal(
    'new',
    'M5.9b DEX-03 ★ as lukas.sc on the sample spot (qaDex=new): the dark stage in every theme, close top left, "NEU" (the one red mark) with "Neu in deinem Dex", the card turned over on spring.slow (qaMotion=off: at rest): the R34 cover at 4:5 into the stage, only the tags on the top scrim ("Rare"), on the stage below "Nr. 0034" in hero.numeral.s (DQ-P5G-01: never on the sky), the name in display.title, KW Variant 3 · Volk Racing TE37 SL · HKS Hi-Power Spec-L II, then "Zum Dex" full width (secondary: the sample has no page, so Folgen and Reaktion senden are not offered; the live reveal is DEX-03-live) and "So entsteht die Rarität" flush left. loading = status line, card and button skeleton; error = retry; empty = "Diesen Spot gibt es nicht mehr" + Zum Dex (DQ-P5G-02: wins over the sample); offline = banner; restricted = the notice under the card and only Zum Dex.',
  ),
  reveal('duplicate', 'M5.9b DEX-03 qaDex=duplicate: "Schon in deinem Dex", no NEU mark, the same card.'),
  reveal('first', 'M5.9b DEX-03 qaDex=first: NEU, "Du bist unter den ersten drei, die dieses Auto gespottet haben.", the First Spotter tag in the card\'s top row beside the rarity and the permanent foil at rest: a 1-wide light rule inside the card (DQ-P5G-14; the sweep plays once with full motion, the matrix runs without motion).'),
  reveal('ghost', 'M5.9b DEX-03 qaDex=ghost: the Ghost frame (2-wide outline and an inner hairline frame, concentric) and the label "Ghost" in place of the rarity.'),
  reveal('young', 'M5.9b DEX-03 qaDex=young: "Dein Konto ist noch neu – Spots zählen ab morgen." in place of NEU, the card as usual.'),
  {
    // DQ-P5G-13: the live reveal's actions on a real car. lukas.sc cannot open another member's spot and the registry has no sign-in
    // for a seeded spotter, so `qaDex=live` reads the public M4 G82 of jann.ptrs (its page and its Dex card, as lukas.sc) and shows it
    // as a reveal; only the "NEU" line is the QA part. Nothing is sent.
    id: 'DEX-03-live',
    path: '/app/dex/spot/bmw-m4-g82-f3pqxpjb?qaDex=live',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="DEX-03.follow"]',
    capture: 'expanded',
    notes:
      'M5.9b DEX-03 live reveal (DQ-P5G-13) of jann.ptrs\'s BMW M4 G82 as lukas.sc: the real card (cover, rarity, top mods, owner), then the actions full width and flush left: "Folgen" (the one filled CTA, or "Du folgst" when lukas.sc already follows), the row Reaktion senden (only while the car has a build update and reactions are on) · "Zum Dex": two tertiary buttons of one weight, glyph and label one target, both flush left (DQ-P5G-60), then "So entsteht die Rarität".',
  },
  {
    id: 'DEX-01',
    path: '/app/dex?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'empty', 'offline', 'restricted'],
    ready: loadedOr('[data-testid="DEX-01.progress"]', 'DEX-01.root'),
    capture: 'expanded',
    p4: { en: true, black: true },
    fs2: true,
    notes:
      'M5.9b DEX-01 Mein Dex ★ as lukas.sc on the QA set: large title, "?" (So entsteht die Rarität) and the scan action; DEX in label.caps over "4 / 1.240" in hero.numeral.s (tnum) and its bar; the chips Alle (inverted) · Rarität · Marke · Sets; the cards 2/3/4 columns: R34 (Nr. 0034, Rare frame, First Spotter), 992 (Legend, white frame), RS 3 (Street, no frame), E46 (Ghost double frame) — every frame drawn inside the tile\'s dark rim, so Legend reads on Hell too (DQ-P5G-11); then "Noch offen in deinen Sets" with "Alle Sets" and one row of compact "???" slots (a 4:3 band, the make as a caption over the generation, the set name; DQ-P5G-08). loading = the progress and the chip row at the loaded head\'s offset, and tiles as one framed block of a card\'s height with the make, wordmark and tag bars inside (DQ-P5G-12: same row pitch as the loaded grid). empty = a new spotter: the badged sample card beside a "???" slot, "Dein Dex ist noch leer", "Sticker scannen" (the one filled CTA); restricted = the notice above the progress.',
  },
  {
    id: 'DEX-01-rarity',
    path: '/app/dex?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await page.getByTestId('DEX-01.rarityHelp').click();
    },
    ready: '[data-testid="DEX-01.raritySheet.rules"]',
    capture: 'viewport',
    p4: { en: true },
    notes: 'M5.9b "So entsteht die Rarität" sheet from DEX-01: the intro, then Street · Tuned · Rare · Legend · Ghost as inverted tags, each with its rule in plain German and the config numbers (Build Score ab 500, höchstens 5 öffentliche Autos derselben Generation, Build Score ab 850); "Schließen" (secondary).',
  },
  {
    id: 'DEX-01-guest',
    path: '/app/dex',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="DEX-01.guest"]',
    capture: 'expanded',
    notes: 'M5.9b DEX-01 for a guest: the badged sample card and a "???" slot, "Melde dich an für deinen Dex", "Anmelden"; nothing is requested.',
  },
  {
    id: 'DEX-04',
    path: '/app/dex/car/sample-r34?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'empty', 'offline'],
    ready: loadedOr('[data-testid="DEX-04.card"]', 'DEX-04.root'),
    capture: 'expanded',
    p4: { en: true },
    notes: 'M5.9b DEX-04 Karte: the R34 card (4:5 photo into the stage with Rare and First Spotter in the top row and the foil rule, "Nr. 0034" in hero.numeral.s on the stage above the name in display.title, KW Variant 3 · Volk Racing TE37 SL · HKS Hi-Power Spec-L II), "Gespottet am 28. Oktober 2026" (before qaNow), "So entsteht die Rarität" (tertiary, flush left). The QA car has no page, so "Zur Fahrzeugseite" is not offered. empty = "Diese Karte gibt es nicht" + Zum Dex.',
  },
  {
    id: 'DEX-04-preview',
    path: '/app/dex/car/sample-preview?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="DEX-04.notSpotted"]',
    capture: 'expanded',
    notes: 'M5.9b DEX-04 for a public car not spotted yet: the card with "Noch nicht gespottet" in place of the rarity (DQ-P5G-39: no rarity tag beside it), no number of spots, no First Spotter, no date; the line what a scan adds; on the member web the line that scanning works in the app (no scan button).',
  },
  {
    id: 'DEX-04-ghost',
    path: '/app/dex/car/sample-e46?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="DEX-04.card.ghostFrame"]',
    capture: 'expanded',
    notes: 'M5.9b DEX-04 of a Ghost car found in person: the double Ghost frame and "Ghost".',
  },
  {
    // DQ-P5G-13: a real card from the API, not the QA sample — the showcase member's own spot of another member's public car
    // ({showcaseSpotVehicle}: support/backend.php p5-showcase-ids, the car he saw in the most cities).
    id: 'DEX-04-live',
    path: '/app/dex/car/{showcaseSpotVehicle}',
    phase: 3,
    auth: 'member-showcase',
    states: ['default'],
    ready: '[data-testid="DEX-04.toVehicle"]',
    capture: 'expanded',
    notes:
      'M5.9b DEX-04 of a real spot (sebastian.demo, GiftDemoSeeder): the car\'s own cover 4:5 into the stage with its rarity frame (Rare or Legend by the real rule), First Spotter where he was among the first three, the Dex number on the stage above the name, its top mods, "Gespottet am …" (the day of his first spot), "Zur Fahrzeugseite" (secondary, flush left) and "So entsteht die Rarität". No coordinates, no other spotter.',
  },
  {
    id: 'DEX-05',
    path: '/app/dex/sets?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'empty', 'offline'],
    ready: loadedOr('[data-testid="DEX-05.set.jdm-legends"]', 'DEX-05.root'),
    capture: 'expanded',
    p4: { en: true },
    notes: 'M5.9b DEX-05 Sets: binder pages divided by hairlines, slots 3 to a phone row (DQ-P5G-09), each found card with its rarity as a tag under the name besides the frame (DQ-P5G-68) — JDM Legends (JDM, 1 von 6, the R34 card and five compact "???" slots with Honda / EK9, Mazda / FD, Toyota / A80 …), Porsche · 5 Autos (Marke: the 992 and one "+4 offen"), Saison 2026 (Saison, "1.5. bis 31.10.", two cards and "+8 offen"), Saisonstart 2026 ("Komplett" inverted, "Komplett seit 12. April 2026", "Läuft wieder ab 1.3."); slots 3/4/6 columns; the last tile ends above the tab bar with the list inset (DQ-P5G-10: rows of one type share one height). empty = the badged sample and "Zum Dex".',
  },
  {
    id: 'DEX-06',
    path: '/app/vehicles/{r34}/spots?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'empty', 'offline', 'restricted'],
    ready: loadedOr('[data-testid="DEX-06.kpis"]', 'DEX-06.root'),
    capture: 'expanded',
    p4: { en: true },
    notes: 'M5.9b DEX-06 for lukas.sc on his R34 (QA month): the car\'s identity first (DQ-P5G-06): its cover 16:9 full-bleed into the dark stage and "Nissan Skyline GT-R R34" in display.title (from 768 inset at radius 20); 37 Spots · 29 Leute · 6 Städte in hero.numeral.s with label.caps; "Street Famous 10" and the next step at 50; "Letzte 30 Tage" bars (neutrals, today in the accent) with "Vor 30 Tagen … Heute"; Städte Köln 14 · Düsseldorf 9 …, the night rule caption; "Zuletzt gespottet von" Mara, "jemand · Name verborgen" (a 40 avatar slot with the person glyph, same text edge and separator inset as the named rows, DQ-P5G-57), @tim.e30; "Spot-Einstellungen". From 1280 an 8/4 grid: numbers, chart and Städte left, spotters and settings right (DQ-P5G-20). empty = the badged sample month at the column\'s width (DQ-P5G-19) + "QR-Sticker ansehen"; restricted = "Nur der Besitzer sieht die Spots eines Autos." loading = KPIs, the Street Famous title and body lines, "Letzte 30 Tage" over the chart and its labels, the cities and the night line, each at its loaded y (DQ-P5G-44).',
  },
  {
    id: 'VEH-01-spots',
    path: '/app/v/nissan-skyline-gt-r-r34-5tf974vj?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="VEH-01.spotLine"]',
    capture: 'expanded',
    notes: 'M5.9b VEH-01 for the owner: the row "Gespottet von 29 Leuten in 6 Städten" (sticker glyph, chevron) first in Übersicht, opening DEX-06.',
  },
  {
    id: 'GAR-12-spots',
    path: '/app/garage/{r34}/visibility',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading'],
    ready: loadedOr('[data-testid="GAR-12.spots.ghost.switch"]', 'GAR-12.root'),
    capture: 'expanded',
    notes: 'M5.9b GAR-12 group "Spots": Ghost-Modus ("Dein Auto taucht nicht mehr in Suche, Entdecken und Listen auf. Nur wer es vor Ort scannt, findet es."), Spotten pausieren, Städte verbergen, each saved at once, which the caption "Wird sofort gespeichert." says (DQ-P5G-56); "Spots ansehen". loading = the group in the page skeleton.',
  },
  {
    id: 'PROF-01-dex',
    path: '/app/profile?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading'],
    ready: loadedOr('[data-testid="PROF-01.dex"]', 'PROF-01.root'),
    capture: 'expanded',
    notes: 'M5.9b PROF-01: the row "Mein Dex · 4 / 1.240" (tnum, chevron) under the actions, to DEX-01, in one group with "Mein Wrapped" once a season is released (DQ-P5G-66); loading = its row in the skeleton.',
  },
  {
    id: 'SET-07-spots',
    path: '/app/settings/privacy',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-07.showMySpots.switch"]',
    capture: 'expanded',
    notes: 'M5.9b SET-07 group "Spots": "Meine Spots zeigen" (on) with "Wenn du ein Auto spottest, sieht der Besitzer deinen Namen. Ist das aus, sehen Besitzer nur „jemand“."',
  },
  {
    id: 'SET-09-spots',
    path: '/app/settings/notifications?qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-09.spots"]',
    capture: 'expanded',
    notes: 'M5.9b SET-09 category "Spots": "Dein Auto wurde gespottet" with "Höchstens einmal am Tag und gesammelt …". The server lists `spot_alert` once lane B adds it; `qaDex` shows the row before that.',
  },
  {
    id: 'EVT-01-spots',
    path: '/app/events?view=map&qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // Opened by link, like EVT-01-map: a link never loads third-party tiles, a tap on Karte does (mapConsent.ts). No walk, so the cell
    // makes no request to OpenFreeMap; `qaDex` turns the layer on for when the map would load.
    ready: '[data-testid="EVT-01.map.consent"]',
    capture: 'viewport',
    notes:
      'M5.9b Entdecken › Treffen › Karte by link with `qaDex` (the "Spots" layer on): the segmented control on Karte, the chips and the map frame with its gate ("Die Karte lädt Daten von OpenFreeMap und OpenStreetMap. Sie lädt erst, wenn du tippst." + "Karte anzeigen"). The layer chip "Spots" and its caption appear only once the map has loaded, so this cell shows the map entry with the gate, not the circles. The drawn city circles (one per city, sized by count, labelled with the city name, no per-car pin) and the chip and caption are covered by flows/f18-spot-layer.spec.ts with a stubbed tile style, and on a device.',
  },
];
