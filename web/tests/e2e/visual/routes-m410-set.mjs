// Visual registry entries of M4.10 settings and system (Phase 4, 09 §7.9, §7.14). Same fields as the entries in routes.mjs, which
// merges this list. One file per lane part, so parallel workstreams never edit the same registry file.
//
// SET-01-search opens the settings search with `?q=` (web only; the field starts with the query). SET-22 is native only and behind
// `app_icons` (09 §7.15: hidden on the web), so its web cell is the "nur in der App" page a deep link lands on. SET-25 needs no
// account. SET-10-member shows the groups a member gets under the theme cards (Haptik & Bewegung; App-Icon is native only).

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

export const routesM410Set = [
  {
    id: 'SET-01-search',
    path: '/app/settings?q=reifen',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-01.search.results"]',
    capture: 'expanded',
    notes: 'SET-26 settings search (09 §7.9) for "reifen": "1 Treffer" over Garage & Erinnerungen (synonym Reifenwechsel, flag maintenance), each match with where it lives and a chevron; the list of settings is hidden while the field holds a query.',
  },
  {
    id: 'SET-01-search-empty',
    path: '/app/settings?q=vergaser',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-01.search.empty"]',
    notes: 'The search without a match: "Nichts zu „vergaser“ gefunden." and one line naming words that work ("Passwort", "Einheiten", "Ruhezeiten").',
  },
  {
    id: 'SET-10-member',
    path: '/app/settings/appearance',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'offline'],
    ready: '[data-testid="SET-10.feedbackGroup"], [data-qa-state]:not([data-qa-state="default"]) [data-testid="SET-10.root"]',
    capture: 'expanded',
    notes: 'Darstellung for lukas.sc: the four ThemePreviewCards (SM14 reveal from the tapped card, flag theme_reveal), the synced note, Haptik & Bewegung with "Bewegung reduzieren: Wie im System · Immer" (no haptics switch on the web; App-Icon is native only).',
  },
  {
    id: 'SET-22',
    path: '/app/settings/appearance/icon',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-22.unavailable"]',
    notes: 'App-Icon on the web: "App-Icons gibt es nur in der App." (09 §7.15 platform-only). Native (Android capture): the AppIconPicker Schwarz · Weiß · Carbon with "kommt mit dem nächsten App-Update" until the alternate-icon module is installed.',
  },
  {
    id: 'SET-25',
    path: '/app/settings/about/whats-new',
    phase: 3,
    auth: 'guest',
    states: ['default', 'loading'],
    ready: '[data-testid="SET-25.timeline"], [data-qa-state]:not([data-qa-state="default"]) [data-testid="SET-25.root"]',
    capture: 'expanded',
    notes: 'Was ist neu: "Auf diesem Gerät: Version x (Build n)", then the releases newest first on the Timeline (month, "Version 2.0.0", one line per change).',
  },
  {
    id: 'SET-11-units',
    path: '/app/settings/language',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'offline'],
    ready: loadedOr('[data-testid="SET-11.exampleUnits"]', 'SET-11.root'),
    capture: 'expanded',
    notes: 'Sprache & Einheiten (09 §7.9, M4.13 API): Sprache, Leistung, Drehmoment (Nm · lb-ft), Entfernung (km · mi), Gewicht (kg · lb), and the preview "510 PS (375 kW)" over "650 Nm · 1.725 kg · 12.400 km".',
  },
];
