// Visual registry entries of M5.9e admin (Season Wrapped, gift admin batch part 2): the ADM-10 tab "Wrapped" and the ADM-37 release rows.
// Same fields as routes.mjs, which merges this list. Data: the showcase member @sebastian.demo (a sample account) with his generated
// `2026-saison` and `2026-jahr` Wrapped (the M5.9e generator; the M5.9f demo seeder makes them richer); no stage fixture. The record's
// activity column and the "Erzeugt"/"Angesehen" times follow the data, and opening the tab audits a view, so the cells are volatile.

const RECORD = '/admin/members/sebastian.demo';

export const routesM59eAdm = [
  {
    id: 'ADM-10-wrapped',
    volatile: true,
    liveChrome: true,
    path: `${RECORD}?tab=wrapped&season=2026-saison`,
    phase: 3,
    auth: 'staff-support',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-qa-state="ready"] [data-testid="ADM-10.wrapped"], [data-qa-state]:not([data-qa-state="ready"])[data-testid="ADM-10-page"]',
    notes: 'Member record of @sebastian.demo as support, tab Wrapped: Saison picker + "Vorschau erzeugen" (secondary) with its hint; Erzeugte Saisons (Saison 2026 and Jahr 2026 with Beispiel badge, Erzeugt, Angesehen, Geteilt right-aligned, Freigabe); Vorschau: Saison 2026 with Zeitraum · Erzeugt · Karten and the visibility pill (a sample without a release outside production: "Außerhalb der Produktion sichtbar" next to the Beispiel badge, DQ-P5G-50), then each card: 9:16 PNG thumbnail (opens the 1080 × 1920 card), "Karte n" + kind, the fields in words (photos only as Vorhanden/Keins; the share card shows "Link im QR-Code" `/v/…`, never the QR markup). empty = qaState: no seasons, "Noch kein Wrapped für diese Saison"; loading = record skeleton; error = record error block.',
  },
  {
    id: 'ADM-10-wrapped-none',
    volatile: true,
    liveChrome: true,
    path: `${RECORD}?tab=wrapped&season=2025-saison`,
    phase: 3,
    auth: 'staff-support',
    states: ['default'],
    ready: '[data-testid="ADM-10.wrapped"] [data-testid="ADM-10.wrapped.empty"]',
    notes: 'A season without a Wrapped (Saison 2025): the seasons table stays, the preview says "Noch kein Wrapped für diese Saison" with the generate hint.',
  },
  {
    id: 'ADM-10-wrapped-view-only',
    volatile: true,
    liveChrome: true,
    path: `${RECORD}?tab=wrapped&season=2026-saison`,
    phase: 3,
    auth: 'staff-moderator',
    states: ['default'],
    ready: '[data-testid="ADM-10.wrapped"] [data-testid="ADM-10.wrapped.view-only"]',
    notes: 'View only (support.view without support.reply): no "Vorschau erzeugen", the lock line instead; the cards as for support.',
  },
  {
    id: 'ADM-37-wrapped',
    path: '/admin/config/remote?dialog=wrapped',
    phase: 3,
    auth: 'staff-admin',
    states: ['default'],
    ready: '[data-testid="ADM-37"] [data-testid="ADM-37.wrapped.rows"]',
    notes: 'Season Wrapped: Freigaben below maintenance. With the demo seeder the live config carries the releases (Jahr 2026 on 28.12.2026 10:00, Saison 2026 on 05.11.2026 10:00; the page reads its fixed qa clock, so both pills say Geplant); without releases ?dialog=wrapped puts two unsaved sample rows in the form (Saison 2026 on 01.11.2026 10:00, Saison 2027 without a day, placeholder TT.MM.JJJJ / HH:MM). Each row: Saison select, Tag and Uhrzeit as typed token fields in the admin locale (DE TT.MM.JJJJ and 24 h HH:MM, never the browser format 10:00 AM, DQ-P5G-35), status pill, remove button, below it Winterzeit (UTC+01:00) or Sommerzeit (UTC+02:00); then Freigabe hinzufügen and the one zone line Deutsche Zeit (Sommer-/Winterzeit wird berücksichtigt) (DQ-P5G-46). The plain ADM-37 cell shows the same section without the qa rows.',
  },
];
