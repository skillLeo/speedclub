// Visual registry entries of M5.9a "Kennzeichen unkenntlich machen" (10 §16.1, ADR-509), app part (lane A). Same fields as the
// entries in routes.mjs, which merges this list. The runner cannot pick files or tap, so both cells open their surface through the
// non-production override `qaOpen` (mobile/src/lib/qa.ts): GAR-01-plateCheck opens "Kennzeichen prüfen" once the card shows (it shows
// while lukas.sc has photos in the state `unchecked`, contract §4); GAR-07-plateBlur opens the upload editor on the R34's first photo
// (nothing is uploaded from it).

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

export const routesM59a = [
  {
    id: 'GAR-01-plateCheck',
    path: '/app/garage?qaOpen=plateCheck',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'offline', 'restricted'],
    ready: '[data-testid="GAR-01.plateCheck.list"], [data-testid="GAR-01.plateCheck.skeleton"], [data-testid="GAR-01.plateCheck.error"], [data-testid="GAR-01.plateCheck.done"]',
    capture: 'expanded',
    notes:
      'M5.9a "Kennzeichen prüfen" over GAR-01 as lukas.sc: the card under the carousel (eye-slash, "Wir haben eine neue Funktion: …", up to three of the photos, "Fotos ansehen" · "Später"), then the sheet forced by qaOpen=plateCheck: the intro line ("Diese Fotos hast du vor der neuen Funktion hochgeladen. …", DQ-P5G-33), each unchecked photo at its own ratio (3:4 to 16:9) with the car\'s name, "Unkenntlich machen" (secondary) over "Kein Kennzeichen sichtbar" (tertiary, flush left, DQ-P5G-15). loading = the row skeleton in skeleton.raised, visible on the sheet (DQ-P5G-03), error = retry, offline = banner and both decisions off, restricted = the notice and both off.',
  },
  {
    id: 'GAR-07-plateBlur',
    path: '/app/garage/{r34}/photos?qaOpen=plateBlur',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="GAR-07.plateBlur.stage"]',
    capture: 'expanded',
    notes:
      'M5.9a upload editor (the step between the picker and the queue) on the R34\'s first photo: the switch "Kennzeichen unkenntlich machen" on, the photo at its real ratio with the suggested rectangle (x 0.32, y 0.70, w 0.36, h 0.12) blurred inside, its × and corner handle, the on-photo hint "Rechteck verschieben", "1 von 8 Rechtecken", "Rechteck hinzufügen", the note "Später ändern geht nur mit neuem Upload.", and "Hochladen" in the sheet footer.',
  },
];
