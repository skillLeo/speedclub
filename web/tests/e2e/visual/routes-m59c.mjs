// Visual registry entries of M5.9c Build Journey + Build Score, app part (10 §16.3, contract docs/reports/phase-5/m5.9c-contract.md §5),
// lane A. Same fields as the entries in routes.mjs, which merges this list. Lane B serves the score reads after M5.9a/b, so the cells
// answer them from the bundled QA set through the non-production override `qaScore` (mobile/src/lib/qa.ts,
// mobile/src/features/score/qaScore.ts): `sample` = a stage 4 build (642, "+25", #4 von 61 R34 in Deutschland, #2 in NRW, the owner's
// "Nächstes Upgrade"), a number = that total, `pending` = "wird berechnet", `error` = the section's error. Nothing is sent from them.

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

const R34 = '/app/v/nissan-skyline-gt-r-r34-5tf974vj';

export const routesM59c = [
  {
    id: 'VEH-01-score',
    path: `${R34}?qaScore=sample`,
    phase: 3,
    auth: 'member',
    states: ['default', 'loading'],
    ready: loadedOr('[data-testid="VEH-01.score.gauge"]', 'VEH-01.root'),
    capture: 'expanded',
    p4: { en: true, black: true },
    fs2: true,
    notes:
      'M5.9c ★ VEH-01 Übersicht for the owner lukas.sc (qaScore=sample): "Build Score" header, the tachometer gauge 0–1000 (ticks every 100, longer at the stage starts; the filled arc in the primary text tone; the floating needle with the only accent at its tip), "+25" chip, 642 in hero.numeral (tnum), "von 1.000", "Stufe 4"; the rank lines "#4 von 61 R34 in Deutschland" and "#2 in NRW"; "So entsteht dein Build Score" (tertiary) and "Journey teilen" (secondary); "Nächstes Upgrade" grouped list sorted by points: 4 Fotos mehr +80 · Beschreibung ab 200 Zeichen +50 · Geplante Mods dokumentieren +25 · Vorher/Nachher posten +15 (no community items), with "Alles freiwillig – so wächst dein Build Score." From 2× the column width the ranks and actions sit beside the gauge. loading = the page skeleton with the gauge circle.',
  },
  {
    id: 'VEH-01-score-visitor',
    path: `${R34}?qaScore=sample`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="VEH-01.score.gauge"]',
    capture: 'expanded',
    p4: { en: true },
    notes: 'M5.9c VEH-01 for a guest: the gauge, stage and both rank lines, "So entsteht der Build Score"; no "Nächstes Upgrade", no "Journey teilen".',
  },
  {
    id: 'VEH-01-score-pending',
    path: `${R34}?qaScore=pending`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="VEH-01.score.pending"]',
    capture: 'viewport',
    walk: async ({ page }) => {
      await page.getByTestId('VEH-01.score').scrollIntoViewIfNeeded();
    },
    notes: 'M5.9c no score yet: the empty track, "Dein Build Score wird berechnet …", "Nach einer Änderung dauert das meist unter einer Minute.", "So entsteht dein Build Score" centred under the centred track (DQ-P5G-15).',
  },
  {
    id: 'VEH-01-score-error',
    path: `${R34}?qaScore=error`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="VEH-01.score.error"]',
    capture: 'viewport',
    walk: async ({ page }) => {
      await page.getByTestId('VEH-01.score.retry').waitFor();
      await page.getByTestId('VEH-01.score').scrollIntoViewIfNeeded();
    },
    notes: 'M5.9c the section after a failed read, inline and flush left (DQ-P5G-21): "Build Score nicht geladen", the cause line "Prüf deine Verbindung und versuch es noch einmal." and "Erneut versuchen" (secondary); the rest of the page as usual.',
  },
  {
    id: 'VEH-01-score-formula',
    path: `${R34}?qaScore=sample`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await page.getByTestId('VEH-01.score.how').click();
    },
    ready: '[data-testid="VEH-01.score.formula.never"]',
    capture: 'viewport',
    p4: { en: true },
    notes:
      'M5.9c "So entsteht dein Build Score" sheet: the intro (0 bis 1.000, counts what you show and tell), "Nie Punkte für PS, Tempo, Sound oder Geld." (body.strong), the four parts with their caps (Vollständigkeit bis 300 · Dokumentation bis 300 · Community bis 250 · Journey bis 150), each rule in plain German with its cap ("20 pro Foto, für bis zu 6 Fotos" … "bis 120"), the each-person-once line under Community, the stages 1–5 with their ranges; "Schließen" (secondary).',
  },
  {
    id: 'VEH-01-journey',
    path: `${R34}?qaScore=sample`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await page.getByTestId('VEH-01.score.journey').click();
    },
    ready: '[data-testid="VEH-01.score.journeySheet.card"]',
    capture: 'viewport',
    notes:
      'M5.9c "Journey teilen" sheet on the member web: the hint, the whole 9:16 Journey card above the sticky footer, scaled to fit (DQ-P5G-23), on the dark stage (wordmark, the newest before/after side by side or the cover, the name in display.title, the gauge at rest in the on-photo tones, "n Einträge im Verlauf"), "Story herunterladen" (primary) and "Quadrat herunterladen" (secondary) for the server card, icon inline and one line each; where the full words would wrap (fs2) "Story" / "Quadrat" with the full words as the accessible name, and the preview sized from the room above that footer (DQ-P5G-23). The gauge digits are not clipped at rest (DQ-P5G-61). The phone shows one "Teilen" (view-shot).',
  },
  {
    id: 'GAR-01-score',
    path: '/app/garage?qaScore=sample',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading'],
    ready: loadedOr('[data-testid^="GAR-01.score."]', 'GAR-01.root'),
    capture: 'expanded',
    p4: { en: true },
    notes: 'M5.9c GAR-01 as lukas.sc: under each card the compact Build Score as its only progress (DQ-P5G-24: no completeness line) — the arc filled to the score (40), the number in hero.numeral.s (tnum), BUILD SCORE (label.caps) over "Stufe n". loading = its arc circle and two lines in the card skeleton, no completeness lines.',
  },
  {
    id: 'UPD-01-beforeAfter',
    path: '/app/post-update?vehicleId={r34}&kind=before_after',
    phase: 3,
    auth: 'member',
    states: ['default', 'offline', 'restricted'],
    ready: loadedOr('[data-testid="UPD-01.beforeAfter.before"]', 'UPD-01.root'),
    capture: 'expanded',
    p4: { en: true },
    notes: 'M5.9c UPD-01 opened from "Nächstes Upgrade": the segmented control Update · Vorher/Nachher (Vorher/Nachher selected), "Zwei Fotos vom selben Blickwinkel …", the two 4:5 slots side by side ("Vorher-Foto wählen", "Nachher-Foto wählen"), text, details, audience, "Zu welchem Mod?" (Kein Mod + the R34\'s mods as radios), sticky "Posten".',
  },
  {
    id: 'UPD-01-beforeAfter-invalid',
    path: '/app/post-update?vehicleId={r34}&kind=before_after',
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await page.getByTestId('UPD-01.beforeAfter.before').waitFor();
      await page.getByTestId('UPD-01.cta.primary').click();
    },
    ready: '[data-testid="UPD-01.beforeAfter.error.before"]',
    capture: 'viewport',
    notes: 'M5.9c "Posten" without photos: both empty slots framed in the accent text tone, "Wähle ein Vorher-Foto." and "Wähle ein Nachher-Foto." under them; nothing is sent.',
  },
];
