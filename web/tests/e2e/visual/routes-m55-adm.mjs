// Visual registry entries of M5.5 admin: ADM-66 Shop-Produkte (list + editor) and ADM-67 Shop-Banner under Marke & Inhalte (10 §3,
// m5.5-contract §5). Same fields as routes.mjs, which merges this list. Data: ShopSampleSeeder (local/staging, part of DatabaseSeeder):
// three badged sticker samples ("Car-Sticker – dein Design" through the designer with S/M/L and six photos, "Schriftzug-Banner" and "Round
// Badge" without a shop address) and one active hero banner (Tokyo at night, link → Sticker). No store domain on a local host, so the
// pages show the OA-44 notice and "Bald im Shop". Product ids are new after every seed and the edit route takes the ULID only, so the
// record cells open the list and follow the product's own link (walk), keeping the cell's query (theme, locale, dialog).
// Writes are not photographed here (they would change the seeded rows); the forms' error and success states are covered by Pest
// (tests/Feature/Admin/Shop) and the page's own client checks.

/**
 * Opens the editor of the seeded product whose list row contains `title`, with the cell's query string.
 * @param {string} title
 * @returns {(ctx: import('./route-steps.mjs').RouteStepContext) => Promise<void>}
 */
function openProduct(title) {
  return async ({ page }) => {
    const link = page.locator('[data-testid="ADM-66.open"]', { hasText: title }).first();
    await link.waitFor({ state: 'attached' });
    const href = await link.getAttribute('href');
    if (!href) throw new Error(`ADM-66: no editor link for "${title}"`);
    const target = new URL(href, page.url());
    target.search = new URL(page.url()).search;
    await page.goto(target.toString());
  };
}

export const routesM55Adm = [
  {
    id: 'ADM-66',
    path: '/admin/shop/products',
    phase: 3,
    auth: 'staff-content',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-testid="ADM-66"] [data-testid="ADM-66.table"]',
    notes: 'Shop-Produkte as the content editor (shop.manage): Banner (ghost), Reihenfolge ändern (secondary), Neues Produkt (primary); the OA-44 notice (no store address on the server); filters Suche · Kategorie · Sichtbarkeit · Beispiel · Gelöschte, presets Ausgeblendet / Im Shop / Gelöscht; rows in shop order: 4:5 thumb, title + slug + Beispiel badge, Kategorie, Preis "14,90 €" right-aligned, Sichtbarkeit pill, Kauf pill (Sticker-Designer / Bald im Shop), Fotos, Geändert (+ editor), row actions: the eye (Anzeigen/Ausblenden) and the menu (Bearbeiten, Löschen); Position and Varianten in the column chooser. empty = "Noch keine Produkte im Shop" with "Neues Produkt".',
  },
  {
    id: 'ADM-66-no-results',
    path: '/admin/shop/products?filter[q]=zzzzzz',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-66"] [data-testid="ADM-66.table.no-results"]',
    notes: 'A search nobody matches: the filter bar keeps "zzzzzz", the table says "no results" with the reset; no rows.',
  },
  {
    id: 'ADM-66-reorder',
    path: '/admin/shop/products?dialog=reorder',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-66.reorder-panel"] [data-testid="ADM-66.reorder.list"]',
    notes: 'Reihenfolge ändern: the three samples in shop order with position, thumb, title, Kategorie · Preis, "Ausgeblendet" where hidden; per row the drag handle (focusable, Space picks up) and nach vorn / nach hinten; Abbrechen + Reihenfolge speichern (disabled until moved); the keyboard help line.',
  },
  {
    id: 'ADM-66-delete',
    path: '/admin/shop/products?dialog=delete',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-66.delete-dialog"]',
    notes: 'Löschen of the first product: what happens (gone from the shop, banner shows nothing, 30 days to restore, password asked once more), Abbrechen + Produkt löschen (danger).',
  },
  {
    id: 'ADM-66-new',
    path: '/admin/shop/products/new',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-66R.form"]',
    capture: 'expanded',
    notes: 'Neues Produkt: Produkt (Titel, Adresse optional "Leer lassen …", Kategorie Sticker, Beschreibung), Preis (Preis in Euro, EUR · inkl. MwSt., the PAngV intro), Varianten (Art der Auswahl Größe, none yet, Variante hinzufügen 0 von 24), Kauf (Online-Shop / Sticker-Designer radios, Produktadresse disabled with the OA-44 hint), Produkt anlegen (primary); "Fotos lädst du hoch, sobald das Produkt angelegt ist"; the preview column says the preview appears with the first photo.',
  },
  {
    id: 'ADM-66-record',
    path: '/admin/shop/products',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    walk: openProduct('Car-Sticker'),
    ready: '[data-qa-state="ready"] [data-testid="ADM-66R.form"]',
    capture: 'expanded',
    notes: 'Car-Sticker – dein Design (sample, through the Sticker-Designer): status pill + Beispiel badge, slug · Geändert, Löschen; the form filled (14,90, Größe S · M · L with their mm, Kaufweg Sticker-Designer, no Shopify fields), Speichern disabled until changed; Fotos 6 von 8 as a 4:5 grid with Kachel on the first, handles and arrows, edit/remove per photo, the upload zone with the rules; Sichtbarkeit switch; right column: the member preview on the Carbon stage (Produktseite: photo 1/6, Sticker, title, 14,90 € inkl. MwSt., chips, "Sticker gestalten" + designer note, Beschreibung) and the activity timeline.',
  },
  {
    id: 'ADM-66-record-incomplete',
    path: '/admin/shop/products',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    walk: openProduct('Schriftzug-Banner'),
    ready: '[data-qa-state="ready"] [data-testid="ADM-66R.form"]',
    capture: 'expanded',
    notes: 'Schriftzug-Banner (sample, Online-Shop without address): Produktadresse disabled with the OA-44 hint and "Ohne Produktadresse zeigt die App „Bald im Shop erhältlich“"; the preview button reads "Bald im Shop erhältlich" greyed.',
  },
  {
    id: 'ADM-66-photo',
    path: '/admin/shop/products?dialog=photo',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    walk: openProduct('Car-Sticker'),
    ready: '[data-testid="ADM-66R.photo-dialog"]',
    notes: 'Foto 1 bearbeiten: the original as a frame with the 4:5 crop window and the focal crosshair (a slider: arrows move it), "Ausschnitt in der App" beside it, Bildbeschreibung; Abbrechen + Foto speichern (disabled until changed).',
  },
  {
    id: 'ADM-66-record-delete',
    path: '/admin/shop/products?dialog=delete',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    walk: openProduct('Round Badge'),
    ready: '[data-testid="ADM-66R.delete-dialog"]',
    notes: 'Löschen from the editor (Round Badge): the same confirmation as from the list.',
  },
  {
    id: 'ADM-67',
    path: '/admin/shop/banners',
    phase: 3,
    auth: 'staff-content',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-testid="ADM-67"] [data-testid="ADM-67.list"], [data-qa-state]:not([data-qa-state="ready"])[data-testid="ADM-67"]',
    notes: 'Shop-Banner: Produkte (ghost) + Neues Banner (primary); the summary "In der App oben im Shop: „Dein Build. Dein Sticker.“"; one row: 16:9 thumb from the focal point, title, Aktiv pill, Beispiel badge, subtitle, "Führt zur Kategorie Sticker · date", Ausschalten / Bearbeiten / Löschen. empty = "Noch kein Banner" with Neues Banner as the one action.',
  },
  {
    id: 'ADM-67-new',
    path: '/admin/shop/banners?dialog=new',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-67.drawer"] [data-testid="ADM-67.form"]',
    notes: 'Neues Banner drawer: no photo yet, the file rules (≥ 1600 px, 4:5 … 21:9, 15 MB), Bildbeschreibung, Titel, Untertitel, Ziel Kategorie / Produkt radios with Kategorie Sticker; footer "Ein neues Banner startet ausgeschaltet", Abbrechen + Banner anlegen.',
  },
  {
    id: 'ADM-67-edit',
    path: '/admin/shop/banners?dialog=edit',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-67.drawer"] [data-testid="ADM-67.focal"]',
    notes: 'Bearbeiten of the sample hero: the photo with the focal crosshair, the 16:9 crop beside it, Anderes Foto, the texts and Ziel Kategorie Sticker; Speichern disabled until changed.',
  },
  {
    id: 'ADM-67-delete',
    path: '/admin/shop/banners?dialog=delete',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-67.delete-dialog"]',
    notes: 'Löschen of the banner: final (photo files removed), the typed confirm word, password asked once more.',
  },
];
