// Visual registry entries of M5.4 admin ADM-65 Sticker-Designs (10 §2.3, m5.4-contract §8). Same fields as routes.mjs, which merges this
// list. Data: no seeder writes sticker designs and no stage fixture exists yet, so on a fresh local database the list is honestly empty;
// designs that e2e members left behind (flows/a5-sticker-designs.spec.ts) show up as real rows, so the default cell is volatile. The drawer
// on real rows (sketch, facts, the two print-file buttons) is photographed by that flow (A5_STICKER_SHOTS=<dir>), not by a cell here.

export const routesM54Adm = [
  {
    id: 'ADM-65',
    volatile: true,
    path: '/admin/stickers/designs',
    phase: 3,
    auth: 'staff-admin',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-testid="ADM-65"] [data-testid="ADM-65.table"]',
    notes: 'Sticker-Designs as admin (stickers.print) under Katalog after the Sticker-Register: intro (downloads land in the audit log), filters Suche (SD…, Code oder @username) · Stand · Vorlage, presets Bestellung geöffnet / Geprüft / Entwürfe; rows newest order first: Design-ID (opens the drawer), Version, Stand pill (+ "Bestellung geöffnet" badge), Vorlage, Größe "M · 156 × 65 mm", Druck (+ Gespiegelt badge), Scan-Test, Code, Fahrzeug, Besitzer, Geprüft, Bestellung, Druckdateien PDF/SVG or a lock "–" with the reason. A fresh database has no design: empty = "Noch keine Sticker-Designs" with "Sticker-Register öffnen".',
  },
  {
    id: 'ADM-65-no-results',
    path: '/admin/stickers/designs?filter[q]=SDZZZZZZZZ',
    phase: 3,
    auth: 'staff-admin',
    states: ['default'],
    ready: '[data-testid="ADM-65"] [data-testid="ADM-65.table.no-results"]',
    notes: 'A design id nobody has: the filter bar keeps "SDZZZZZZZZ", the table says "no results" with the reset; no rows.',
  },
];
