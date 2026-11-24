// Visual registry entries of M5.8 admin: ADM-68 Forum-Moderation (09 §10.2 SplitQueue, 10 §7.3, m5.8-contract §6) and ADM-69
// Forum-Kategorien (10 §7.1). Same fields as routes.mjs, which merges this list. Data: ForumSampleSeeder (local/staging, part of
// DatabaseSeeder): 25 published sample threads ("Beispiel") by the showcase members with replies, some "Gelöst"; ForumCategorySeeder:
// the editorial tree + one category per active make and per Bundesland. The seed holds no pending post and no forum case, so the
// Vormoderation and Gemeldet cells show their empty states (the A5 flow a5-forum.spec.ts makes and decides pending posts). Thread ids are
// new after every seed, so the pane cells open the Themen list and follow the row of a known sample thread (walk), keeping the cell's
// query (theme, locale, dialog). Writes are not photographed (they would change the seed); Pest (tests/Feature/Admin/Forum) and the
// A5 flow cover them.

const SAMPLE = 'Gewindefahrwerk im Alltag';

/**
 * Opens the Themen row whose title contains `title` in the SplitQueue pane, with the cell's query string (theme, locale, dialog).
 * @param {string} title
 * @returns {(ctx: import('./route-steps.mjs').RouteStepContext) => Promise<void>}
 */
function openThread(title) {
  return async ({ page }) => {
    const link = page.locator('[data-testid="ADM-68.open"]', { hasText: title }).first();
    await link.waitFor({ state: 'attached' });
    const href = await link.getAttribute('href');
    if (!href) throw new Error(`ADM-68: no row link for "${title}"`);
    const target = new URL(href, page.url());
    for (const [key, value] of new URL(page.url()).searchParams) if (!target.searchParams.has(key)) target.searchParams.set(key, value);
    await page.goto(target.toString());
  };
}

export const routesM58Adm = [
  {
    id: 'ADM-68',
    path: '/admin/forum',
    phase: 3,
    auth: 'staff-moderator',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-68"] [data-testid="ADM-68.table"]',
    notes: 'Forum-Moderation "Vormoderation" as moderator: the tabs with counts (Vormoderation, Gemeldet), Kategorien (secondary) in the header; the seed has no pending post, so the table shows "Nichts in der Vormoderation" with what lands here (accounts younger than three days or without a confirmed address). loading = the row skeleton, error = the retry block (empty: ADM-68-threads, since the seeded Vormoderation is empty already).',
  },
  {
    id: 'ADM-68-threads',
    path: '/admin/forum?tab=threads',
    phase: 3,
    auth: 'staff-moderator',
    states: ['default', 'empty'],
    ready: '[data-testid="ADM-68"] [data-testid="ADM-68.table"]',
    notes: 'Themen: the 25 samples by last activity, title with Kategorie · Beispiel, Verfasser, Markierungen (Gelöst, Beispiel; pin/lock where set), Status pill, Antworten right-aligned tnum, Letzte Aktivität; filters Suche · Kategorie (searchable, "Parent › Child") · Status · Angeheftet · Geschlossen. empty = "Noch keine Themen".',
  },
  {
    id: 'ADM-68-pane',
    path: '/admin/forum?tab=threads',
    phase: 3,
    auth: 'staff-moderator',
    walk: openThread(SAMPLE),
    states: ['default'],
    ready: '[data-testid="ADM-68"] [data-testid="ADM-68.pane.thread"]',
    capture: 'expanded',
    notes: 'SplitQueue from 1280: narrow list (Thema, Antworten) + the pane of "Gewindefahrwerk im Alltag": status Veröffentlicht, Kategorie, Gelöst + Beispiel badges, tags; the author row (@name, Dabei seit, E-Mail bestätigt) with Forum-Sperre (destructive outline, no fill); tools Anheften · Schließen · Mehr (Verschieben, Zusammenführen, Lösung entfernen); the opening post and the replies with "Hilfreich n" (tnum), the solution badge and each post\'s menu (Als Lösung markieren, Ausblenden).',
  },
  {
    id: 'ADM-68-hide',
    path: '/admin/forum?tab=threads&dialog=hide',
    phase: 3,
    auth: 'staff-moderator',
    walk: openThread(SAMPLE),
    states: ['default'],
    ready: '[data-testid="ADM-68.pane.hide-dialog"]',
    capture: 'expanded',
    notes: 'Ausblenden of the first reply: what the member gets (push + e-mail, appeal), the statement of reasons (Vorlage, Sachverhalt, Grundlage, Steht in, Abschnitt; the "no automated means" note), the audit reason, Abbrechen + Ausblenden (red fill: the one destructive action of the dialog).',
  },
  {
    id: 'ADM-68-ban',
    path: '/admin/forum?tab=threads&dialog=ban',
    phase: 3,
    auth: 'staff-moderator',
    walk: openThread(SAMPLE),
    states: ['default'],
    ready: '[data-testid="ADM-68.pane.ban-dialog"]',
    capture: 'expanded',
    notes: 'Forum-Sperre for the author: Dauer (1/7/30 Tage, bis zu einem Datum, ohne Ende), the statement of reasons with the forum-post templates, the audit reason, Forum-Sperre verhängen (red fill).',
  },
  {
    id: 'ADM-68-merge',
    path: '/admin/forum?tab=threads&dialog=merge',
    phase: 3,
    auth: 'staff-moderator',
    walk: openThread(SAMPLE),
    states: ['default'],
    ready: '[data-testid="ADM-68.pane.tool-dialog"]',
    notes: 'Zusammenführen: what happens (all posts move, cannot be undone), the target from the list (searchable) or a pasted link/ID, the reason (required), Zusammenführen (primary).',
  },
  {
    id: 'ADM-68-analyst',
    path: '/admin/forum?tab=threads',
    phase: 3,
    auth: 'staff-analyst',
    walk: openThread(SAMPLE),
    states: ['default'],
    ready: '[data-testid="ADM-68"] [data-testid="ADM-68.pane.thread"]',
    notes: 'View-only (moderation.view without moderation.decide, members.restrict): the lock line under the tabs, the pane without tools, post menus and Forum-Sperre; no Kategorien button (no moderation.rules).',
  },
  {
    id: 'ADM-68-reported',
    path: '/admin/forum?tab=reported',
    phase: 3,
    auth: 'staff-moderator',
    states: ['default'],
    ready: '[data-testid="ADM-68"] [data-testid="ADM-68.table"]',
    notes: 'Gemeldet: the note that reported posts are decided in the case (ADM-21); the seed has no forum case, so "Keine offenen Meldungen im Forum".',
  },
  {
    id: 'ADM-69',
    path: '/admin/forum/categories',
    phase: 3,
    auth: 'staff-moderator',
    states: ['default', 'loading', 'empty', 'error'],
    // The tree table renders only in the ready state; loading, empty and error show their own blocks inside ADM-69.
    ready: '[data-testid="ADM-69"][data-qa-state]',
    capture: 'expanded',
    notes: 'Forum-Kategorien: Marken abgleichen (ghost), Reihenfolge ändern (secondary), Neue Kategorie (primary); the summary line; the tree as a 40-px table: main categories with EN name + slug, Art, Themen (tnum, right), Aktiv pill, Bearbeiten + menu; Technik & Tuning open with its six children; Marken & Modelle and Treffen & Regionen folded ("n automatische Unterkategorien", caret); the read-only note. empty = "Noch keine Kategorien" with Neue Kategorie.',
  },
  {
    id: 'ADM-69-edit',
    path: '/admin/forum/categories?dialog=edit',
    phase: 3,
    auth: 'staff-moderator',
    states: ['default'],
    ready: '[data-testid="ADM-69.form"]',
    capture: 'expanded',
    notes: 'Bearbeiten of the first main category in the drawer: Name DE/EN, Adresse with its rule, Beschreibung DE/EN with counters, Hauptkategorie (locked: it has sub-categories), Symbol, Für Mitglieder sichtbar, optional audit note; Speichern disabled until changed.',
  },
  {
    id: 'ADM-69-reorder',
    path: '/admin/forum/categories?dialog=reorder',
    phase: 3,
    auth: 'staff-moderator',
    states: ['default'],
    ready: '[data-testid="ADM-69.reorder-dialog"] [data-testid="ADM-69.reorder.list"]',
    notes: 'Reihenfolge der Hauptkategorien: the seven main categories with slug, drag handle (Space picks up) and earlier/later buttons, the keyboard help; Reihenfolge speichern disabled until moved.',
  },
];
