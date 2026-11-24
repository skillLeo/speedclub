// Visual registry entries of M5.9b admin ADM-62 Spots (m5.9b contract §7, gift admin batch part 1). Same fields as routes.mjs, which
// merges this list. Data: the stage fixture `m59b-spots` (support/stage-fixtures.mjs, backend ensure-spots-fixture): @nico.spotter with a
// burst of twelve spots in Köln 30 hours ago and a hop to München 35 minutes later, @lea.dex with four ordinary spots (one at night), all
// on demo cars; the record cells open the first burst spot by its fixed id. The times follow the server clock, so the cells are volatile.

const SPOT = '01m59b5p0t0000000000000001';

export const routesM59bAdm = [
  {
    id: 'ADM-62',
    volatile: true,
    path: '/admin/moderation/spots',
    phase: 3,
    auth: 'staff-moderator',
    states: ['default', 'loading', 'empty', 'error'],
    fixture: 'm59b-spots',
    ready: '[data-testid="ADM-62"] [data-testid="ADM-62.table"]',
    notes: 'Spots as moderator, newest first: Gespottet, @Spotter, car thumb + name with "Dex #n", Stadt, Gezählt, Nacht (moon), Auffälligkeiten (Serie/Städtesprung outline badges, detail in the tooltip), the row trash button; above the table the three rules (Gleiches Gerät says it is not detected yet); filters Zeitraum · Stadt · Auto · Spotter · Auffälligkeiten · Status. empty = "Noch keine Spots".',
  },
  {
    id: 'ADM-62-signals',
    volatile: true,
    path: '/admin/moderation/spots?filter[signal]=any',
    phase: 3,
    auth: 'staff-moderator',
    states: ['default'],
    fixture: 'm59b-spots',
    ready: '[data-testid="ADM-62"] [data-testid="ADM-62.table"]',
    notes: '"Nur Auffälligkeiten": only @nico.spotter\'s thirteen spots, each with Serie and the Köln ones with Städtesprung; @lea.dex\'s ordinary spots are filtered out.',
  },
  {
    id: 'ADM-62-record',
    volatile: true,
    path: `/admin/moderation/spots/${SPOT}`,
    phase: 3,
    auth: 'staff-moderator',
    states: ['default', 'loading', 'error'],
    fixture: 'm59b-spots',
    ready: '[data-qa-state="ready"] [data-testid="ADM-62R.detail"], [data-qa-state]:not([data-qa-state="ready"])[data-testid="ADM-62R-page"]',
    notes: 'Spot record: "Spot vom …" with status Aktiv, @nico.spotter · car · Köln, Spot entfernen (outlined destructive); Überblick with the car cover, car + Dex number, owner, spotter with counts, time, Köln · NW, counted, night, First Spotter, source and the signals Serie (12 Spots in 10 Min.) and Städtesprung (München, 456 km in 35 Min.); tabs Spotter-Verlauf · Entfernungen; the activity column.',
  },
  {
    id: 'ADM-62-remove',
    volatile: true,
    path: `/admin/moderation/spots/${SPOT}?dialog=remove`,
    phase: 3,
    auth: 'staff-moderator',
    states: ['default'],
    fixture: 'm59b-spots',
    ready: '[data-testid="ADM-62R.remove-dialog"]',
    notes: 'Spot entfernen: what happens (Dex, its XP taken back, counts, Build Score and set progress recomputed; a set no longer complete without the spot loses its completion and its XP; badges stay), Vorlage (select), Begründung (10–1000, not sent to the spotter), Abbrechen + the red confirm, disabled until the reason is long enough.',
  },
  {
    id: 'ADM-62-analyst',
    volatile: true,
    path: '/admin/moderation/spots',
    phase: 3,
    auth: 'staff-analyst',
    states: ['default'],
    fixture: 'm59b-spots',
    ready: '[data-testid="ADM-62"] [data-testid="ADM-62.view-only"]',
    notes: 'View-only (moderation.view without moderation.decide): the lock line, no selection column, no row trash button.',
  },
];
