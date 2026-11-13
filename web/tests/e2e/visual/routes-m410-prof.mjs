// Visual registry entries of module M4.10 (Phase 4), profiles and collections (09 §7.7). Same fields as the entries in routes.mjs,
// which merges this list. One file per area, so parallel workstreams never edit the same registry file.
//
// Data: lukas.sc (the `member` session) has the R34 and the S15 published; his "Gespeichert" collection (`{savedCollection}`,
// support/garage.mjs demoIds) holds what the DemoSeeder saved, or nothing — then COL-02 shows its empty wall with the sample preview.
// nina.neu (`member-empty`) has no vehicle and nothing saved. Tabs other than Garage are opened through `?tab=` for the pictures.

/**
 * `ready` for a screen with data (routes.mjs loadedOr): the loaded element in the default state, the root in a forced one.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

export const routesM410Prof = [
  {
    id: 'PROF-01-updates',
    path: '/app/profile?tab=updates',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error'],
    ready: loadedOr('[data-testid="PROF-01.updates"]', 'PROF-01.root'),
    capture: 'expanded',
    notes: 'PROF-01 Updates tab (09 §7.7): the newest build updates of lukas.sc\'s builds as Home rows (thumb, "Fahrwerk geändert", diff, "Nissan Skyline GT-R R34 · vor 2 Tagen"); empty = two sample rows badged "Beispiel" + "Update posten".',
  },
  {
    id: 'PROF-01-events',
    path: '/app/profile?tab=events',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error'],
    ready: loadedOr('[data-testid="PROF-01.events"]', 'PROF-01.root'),
    capture: 'expanded',
    notes: 'PROF-01 Treffen tab (flag events): the events lukas.sc said yes to, date block (hero.numeral.s day + label.caps month), title, place · time. Not links until EVT-02 (M4.12). Empty = a sample row badged "Beispiel".',
  },
  {
    id: 'PROF-01-saved',
    path: '/app/profile?tab=saved',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error'],
    ready: loadedOr('[data-testid="PROF-01.savedTab"]', 'PROF-01.root'),
    capture: 'expanded',
    notes: 'PROF-01 Gespeichert tab (own only, flag collections): "Alle gespeicherten Builds" (PROF-05), the collections as 2 × 2 mosaics with lock + count, "Neue Sammlung", "Alle Sammlungen".',
  },
  {
    id: 'COL-01',
    path: '/app/profile/collections',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'offline'],
    ready: '[data-testid="COL-01.root"] [data-testid="COL-01.title"]',
    capture: 'expanded',
    notes: 'COL-01 Sammlungen (09 §7.7): large title, "Sammlungen sind privat.", mosaic tiles (2/3/4 a row), each with its menu (Umbenennen, Löschen — not on "Gespeichert"), "Neue Sammlung" last and "+" in the bar. empty = two sample mosaics badged "Beispiel" + "Builds entdecken".',
  },
  {
    id: 'COL-01-empty',
    path: '/app/profile/collections',
    phase: 3,
    auth: 'member-empty',
    states: ['default'],
    ready: '[data-testid="COL-01.empty"]',
    notes: 'COL-01 for nina.neu, who saved nothing: the EmptyState with two sample mosaics badged "Beispiel", title.2, one line, "Builds entdecken".',
  },
  {
    id: 'COL-01-guest',
    path: '/app/profile/collections',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="COL-01.guest"]',
    notes: 'COL-01 as a guest: sample mosaics + "Anmelden".',
  },
  {
    id: 'COL-02',
    path: '/app/profile/collections/{savedCollection}',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'offline'],
    ready: '[data-testid="COL-02.root"] [data-testid="COL-02.title"]',
    capture: 'expanded',
    notes: 'COL-02 "Gespeichert" of lukas.sc: lock + "Privat · n Einträge", the wall (2/3/4 columns, 2 px gaps, 0 radius, edge to edge on phones), each tile with its menu (An den Anfang, Nach vorn, Nach hinten, Aus Sammlung entfernen); the bar menu renames. empty = two sample wall tiles + "Builds entdecken".',
  },
  {
    id: 'PROF-02-updates',
    path: '/app/u/jann.ptrs?tab=updates',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading'],
    ready: loadedOr('[data-testid="PROF-02.updates"]', 'PROF-02.root'),
    capture: 'expanded',
    notes: 'PROF-02 Updates tab of jann.ptrs: his builds\' newest updates. Members see Garage and Updates only (no API for another member\'s events).',
  },
];
