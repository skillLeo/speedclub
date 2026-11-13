// Visual registry entries of M4.13 Garage pro, app part (MNT-01…03, GAR-01 "Nächste Fälligkeiten"). Same fields as the entries in
// routes.mjs, which merges this list. One file per module, so parallel workstreams never edit the same registry file.
//
// Data: lukas.sc's R34 has no maintenance in the seed. The cells that need it name the stage fixture `maintenance`
// (support/maintenance.mjs): six items (HU/AU four months ahead as the hero, Ölwechsel by date and km, Bremsflüssigkeit overdue,
// Reifenwechsel, Kfz-Versicherung, Zahnriemen), two service entries with private costs and 48.200 km, made through the member API
// with fixed client ids and deleted again after those cells (the runner takes fixture cells last, one fixture at a time). Item and
// log ids are the fixture's: 01mntfx + the number padded to 26 characters.

/** Garage lists of the owner: every state, restricted = the notice of a restriction. */
const OWNER_LIST_STATES = ['default', 'loading', 'empty', 'error', 'offline', 'restricted'];
/** Forms and editors: nothing to be empty. */
const EDITOR_STATES = ['default', 'loading', 'error', 'offline', 'restricted'];

const fixtureId = (/** @type {number} */ n) => `01mntfx${String(n).padStart(19, '0')}`;

/**
 * `ready` for a screen with data (routes.mjs loadedOr).
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

export const routesM410Mnt = [
  {
    id: 'MNT-01',
    path: '/app/garage/{r34}/maintenance',
    phase: 3,
    auth: 'member',
    states: OWNER_LIST_STATES,
    ready: loadedOr('[data-testid="MNT-01.nextBlock"]', 'MNT-01.root'),
    capture: 'expanded',
    fixture: 'maintenance',
    notes:
      'Wartung of the R34 (09 §7.12): 16:9 photo band with the name in display.title and "Nur für dich sichtbar"; "Als Nächstes" = the HU/AU in about four months as the hero (ring 88, countdown numeral in hero.numeral.s, "Fällig im …"); Wartungspunkte with Bremsflüssigkeit overdue (accent countdown) first, Ölwechsel by date or 56.200 km, Reifenwechsel (season), Kfz-Versicherung (Stichtag), Zahnriemen; Kilometerstand 48.200 km with Aktualisieren; Kosten (private, hero.numeral.s total, per year); Verlauf with the oil change (Werkstatt am Ring, 189,50 €) and the Klimaservice. empty = the badged sample HU/AU card, one line and "HU/AU eintragen" (DQ-1033).',
  },
  {
    id: 'MNT-02',
    path: `/app/maintenance-editor/{r34}?kind=item&item=${fixtureId(2)}`,
    phase: 3,
    auth: 'member',
    states: EDITOR_STATES,
    ready: loadedOr('[data-testid="MNT-02.intervalMonths"]', 'MNT-02.root'),
    capture: 'expanded',
    fixture: 'maintenance',
    notes:
      'MNT-02 "Ölwechsel bearbeiten" (modal, close left): Intervall 12 Monate / 15000 km side by side, Zuletzt gemacht 14.06.2026 / 41200, Nächster Termin empty with the computed date as placeholder, Erinnern chips (14 Tage vorher selected, at most three), the reminder switch, Notizen, "Wartungspunkt löschen" (accent text); sticky "Speichern".',
  },
  {
    id: 'MNT-02-new',
    path: '/app/maintenance-editor/{r34}?kind=item',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="MNT-02.type"]',
    capture: 'expanded',
    notes: 'A new item without the fixture: the type chips (HU/AU first, chosen) with its helper "Monat auf der Plakette", the month field, the lead chips 30/14/1 from SET-23.',
  },
  {
    id: 'MNT-02-log',
    path: `/app/maintenance-editor/{r34}?kind=log&log=${fixtureId(11)}`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="MNT-02.cost"]',
    capture: 'expanded',
    fixture: 'maintenance',
    notes:
      'A service entry: "Was wurde gemacht?" chips with Ölwechsel chosen, Datum 14.06.2026 / 41200 km, Kosten in Euro 189,50 "Nur für dich sichtbar", Werkstatt, Notizen, Belege und Fotos (none yet, "Foto hinzufügen"), "Eintrag löschen".',
  },
  {
    id: 'MNT-03',
    path: '/app/settings/reminders',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'offline'],
    ready: loadedOr('[data-testid="SET-23.hu"]', 'SET-23.root'),
    notes:
      'SET-23 = MNT-03 Garage & Erinnerungen (09 §7.9): HU/AU lead chips (30/14/1 Tage vorher selected), switches Reifenwechsel (O bis O), Kfz-Versicherung (Stichtag 30. November), Service, Öl und Bremsflüssigkeit; the line to Benachrichtigungen › Fälligkeiten. Desktop: the settings pane beside it with "Garage & Erinnerungen" selected. The screen\'s test IDs are SET-23.*.',
  },
  {
    id: 'GAR-01-due',
    path: '/app/garage',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="GAR-01.due"]',
    capture: 'expanded',
    fixture: 'maintenance',
    notes: 'GAR-01 with "Nächste Fälligkeiten" under the stats line: Bremsflüssigkeit overdue (accent countdown) and what is due within 60 days, each with the R34 named and its ring; a row opens MNT-01.',
  },
];
