// Visual registry entries of M5.9e Season Wrapped, app part (10 §16.5, contract docs/reports/phase-5/m5.9e-contract.md §6), lane A.
// Same fields as the entries in routes.mjs, which merges this list. Until lane B serves `/me/wrapped*`, the cells answer from the
// bundled, "Beispiel"-badged season of the non-production override `qaWrapped` (mobile/src/features/wrapped/qaWrapped.ts): `sample`
// a released 2026 season (DQ-P5G-29: one sample season everywhere, released 5 Nov 2026) with all nine cards, `countdown` a season three days before its release (relative to qaNow), `empty` none for this member. `card=n`
// opens WRP-01 on card n and holds it (paused), so each cell captures one card. Nothing is sent from them.

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

const PLAYER = '/app/wrapped/2026-saison?qaWrapped=sample';

/** One cell per card: [card kind, position, what the card shows]. */
const CARDS = [
  ['intro', 1, 'the brand moment: "Saison 2026" in label.caps, the brush logo with its katakana (white), the member\'s own R34 full-bleed to the card\'s edges (DQ-P5G-58: radius 0, taking the room the words leave, cropped on its focal point, no text on it), "Deine Saison 2026" in display.title, its line, "1. März bis 31. Oktober 2026" and "Die Saison von Lukas" on the dark card below the photo'],
  ['spots', 2, '"GESPOTTET", 47 in hero.numeral with "Spots", "31 verschiedene Autos", "Unterwegs in Düsseldorf, Köln, Essen, Duisburg und Neuss.", a hairline, then the rarest find in a white 2-wide frame: "Dein seltenster Fund", the Legend tag, "Nr. 0412" (hero.numeral.s), Honda NSX NA1 in display.title'],
  ['scans', 3, '"DEIN STICKER", 128 "Scans", "So oft wurde der QR-Code an deinem Auto gescannt.", a hairline, 1.940 (hero.numeral.s) "Aufrufe deines Profils und deiner Autos", "Die meisten Scans kamen aus Düsseldorf."'],
  ['score', 4, '"BUILD SCORE", the R34\'s engine bay (ADR-516 a, DQ-P5G-58: a different photo from intro and share; inset, radius 8), Nissan Skyline GT-R R34 in display.title, the smaller gauge at rest at 642 with "+230" and "Stufe 4" (on-photo tones), "Von 412 auf 642 Punkte in dieser Saison.", "Aufgestiegen von Stufe 3 auf Stufe 4"'],
  ['top_mod', 5, '"DEIN TOP-MOD", "Work Meister S1 3P" in title.2, "An deinem Nissan Skyline GT-R R34", the Work wheel alone with its "Nachher" badge (radius 8; DQ-P5G-31: the seed set has no same-angle pair, so no mismatched Vorher)'],
  ['treffen', 6, '"TREFFEN", 6 "Treffen", "Treffen mit Check-in in dieser Saison.", three public meet titles between hairlines'],
  ['build_spirit', 7, '"DEIN BUILD SPIRIT", a stance close-up (bronze Work wheel, Toyo tyre, low fender; ADR-516 a, DQ-P5G-58: its own photo, inset, radius 8), "Shakotan Artist" in display.title, the one-line reason, "Ermittelt nach festen Regeln aus deinen dokumentierten Mods." (caption)'],
  ['percentile', 8, '"BUILD SCORE IN NRW", "Top 12 %" in hero.numeral, "Mit deinem Build Score gehörst du zu den Top 12 % in NRW." and the comparison line'],
  ['share', 9, 'the share card: "Saison 2026", the brush logo, the R34 photo (blurred plates, radius 8), its name in display.title, then pinned to the card\'s foot "Nr. 0034", "Build Score 642 · Stufe 4", "joinspeedclub.com/v/nissan-skyline-gt-r-r34-5tf974vj" and the QR of that page on white (qr tokens; ADR-514). fs2: the card\'s type stops at 1.3×, the photo gives way, the QR is always whole'],
];

const COMMON =
  'The dark brand stage in every theme (as ONB/Welcome and DEX-03): the segmented bars (white fill up to the current card) and close on top, the 9:16 card centred (phone: full width; desktop 1440: centred with ‹ › beside it), below: previous · pause/play · next (44, onPhoto) and "Teilen" (app) / "Bild speichern" (web, the server PNG). The card is held (qaWrapped + card=n), so the play glyph shows. fs2 (DQ-P5G-04): the card is a fixed 9:16 picture, so its text stops growing at 1.3× (nothing cut); the share control becomes the 44 icon alone with its label as the accessible name.';

/** @type {import('./matrix.mjs').RouteDef[]} */
export const routesM59e = [
  ...CARDS.map(([kind, n, notes]) => ({
    id: n === 1 ? 'WRP-01' : `WRP-01-${kind.replace('_', '-')}`,
    path: `${PLAYER}&card=${n}`,
    phase: 3,
    auth: 'member',
    states: n === 1 ? ['default', 'loading', 'error', 'empty', 'offline', 'restricted'] : ['default'],
    ready: n === 1 ? loadedOr(`[data-testid="WRP-01.card.${kind}"]`, 'WRP-01.root') : `[data-testid="WRP-01.card.${kind}"]`,
    capture: 'viewport',
    ...(n === 1 || n === 9 ? { p4: { en: true, black: true }, fs2: true } : n === 4 ? { p4: { en: true }, fs2: true } : n === 2 ? { p4: { en: true } } : n === 7 ? { fs2: true } : {}),
    notes:
      `M5.9e WRP-01 ★ card ${n} of 9 as lukas.sc (qaWrapped=sample, "Beispiel" badge top right): ${notes}. ${COMMON}` +
      (n === 1
        ? ' loading = bars, the 9:16 frame and the controls as skeletons; error = "Dein Wrapped ließ sich nicht laden" + retry; empty = "Für diese Saison gibt es kein Wrapped" with the small sample share card (Saison 2026; WRP-01.card.share, scaled, DQ-P5G-62) and "Zur Garage"; offline = the banner over the player; restricted = the notice above the controls and no share button.'
        : ''),
  })),
  {
    id: 'WRP-01-notReleased',
    path: '/app/wrapped/2026-saison?qaWrapped=countdown',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="WRP-01.notReleased"]',
    capture: 'viewport',
    p4: { en: true },
    notes: 'M5.9e WRP-01 before the release (403): on the dark stage, close top right, the small badged sample share card of the same season ("Saison 2026"; DQ-P5G-62: the real card root WRP-01.card.share at its design size, scaled as a picture), "Dein Wrapped für Saison 2026 ist noch nicht da", "Es erscheint am 5. November 2026 um 10:00 Uhr." (no break before "Uhr"; the sample releases three days after the matrix qaNow, 2 Nov 2026), "Schließen" (secondary).',
  },
  {
    id: 'WRP-01-guest',
    path: '/app/wrapped/2026-saison',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="WRP-01.guest"]',
    capture: 'viewport',
    notes: 'M5.9e WRP-01 for a guest (DQ-P5G-30): the small badged sample share card on the stage (DQ-P5G-62: WRP-01.card.share, scaled), then left-aligned "Melde dich an, um dein Wrapped zu sehen" (title.2), one line, "Anmelden" (the one filled button; the sign-in sheet, back here after).',
  },
  {
    id: 'PROF-01-wrapped',
    path: '/app/profile?qaWrapped=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="PROF-01.wrapped"]',
    capture: 'expanded',
    p4: { en: true },
    notes: 'M5.9e PROF-01 own profile: "Mein Dex" and "Mein Wrapped" as one inset group of two rows with a hairline between (DQ-P5G-66); the Wrapped row (calendar glyph, "Saison 2026" under it — the year once, DQ-P5G-52 — "Neu" as the value, chevron) — opens WRP-01.',
  },
  {
    id: 'HOME-01-wrappedCountdown',
    path: '/app/?qaWrapped=countdown',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="HOME-01.wrappedCountdown"]',
    capture: 'viewport',
    p4: { en: true, black: true },
    notes: 'M5.9e HOME-01 countdown banner (flag wrapped.countdown, 7 days before a release): raised card radius 12 under the announcement slot, calendar glyph, "Dein Wrapped 2026 kommt in 3 Tagen", "Ab 5. November 2026, 10:00 Uhr: deine Saison in Karten, zum Durchtippen und Teilen.", the dismiss cross (44). No red, no badge. "3 Tagen" and "10:00 Uhr" never break apart (DQ-P5G-18).',
  },
];
