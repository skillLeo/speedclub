// Visual registry entries for the M4.8 design QA round 2 "needs capture" list (docs/reports/design-qa/phase-4/2026-11-13-M4.8.md).
// Same fields as the entries in routes.mjs, which merges this list. One file per module, so parallel workstreams never edit the same
// registry file.
//
// - HOME-01-member already exists (Für dich as lukas.sc, 6000 px). These variants add what round 2 could not judge: the stream past
//   item 12 (Aktive Mitglieder, Beliebte Mods sit after it), the reaction trigger on a member's feed card, and the member's offline
//   state with "Offline – zuletzt aktualisiert …" (DQ-1044). The Folge ich skeleton (DQ-1083) is HOME-01-following's `loading` state.
// - DISC-01 with collections: CollectionSeeder seeds the curated `collections` (8 on a fresh local seed), shown to a guest and a member;
//   the ready selector waits for the section, so a database without them fails the cell instead of passing an empty picture.

/**
 * As routes.mjs: in the default state the element only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

export const routesM48R3 = [
  {
    id: 'HOME-01-member-long',
    path: '/app/',
    phase: 2,
    auth: 'member',
    states: ['default'],
    ready: loadedOr('[data-testid^="HOME-01.newBuilds.item."]', 'HOME-01.root'),
    capture: 'expanded',
    maxHeight: 12000,
    notes: 'Für dich as lukas.sc past item 12 (DQ round 2 "needs capture"): the stream with Aktive Mitglieder and Beliebte Mods diese Woche between the cards, and each feed card\'s action row with the reaction trigger (a member may react; DQ-1025). Bounded at 12000 px.',
  },
  {
    id: 'HOME-01-member-offline',
    path: '/app/',
    phase: 2,
    auth: 'member',
    states: ['default', 'offline'],
    ready: loadedOr('[data-testid^="HOME-01.newBuilds.item."]', 'HOME-01.root'),
    notes: 'Für dich as lukas.sc while offline: the cached page under the banner "Offline – zuletzt aktualisiert vor … ." (DQ-1044), no reaction or save that cannot be sent.',
  },
  {
    id: 'DISC-01-collections',
    path: '/app/discover',
    phase: 2,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="DISC-01.collections"]',
    capture: 'expanded',
    notes: 'Entdecken as lukas.sc with the seeded curated collections (CollectionSeeder): the Sammlungen section with its covers and counts (DQ round 2 "needs capture").',
  },
];
