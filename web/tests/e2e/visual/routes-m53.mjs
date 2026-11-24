// Visual registry entries of M5.3 Vehicle profile one scroll, app and member-web part (docs/10_CLIENT_ROUND_1.md §5, ADR-505;
// contract docs/reports/phase-5/m5.3-contract.md). Same fields as the entries in routes.mjs, which merges this list. VEH-01's base
// entries (VEH-01, VEH-01-owner, VEH-01-similar, …) stay in routes.mjs; the 2.0 tab entries there now open their section
// (`?section=`). The section index is pinned over the list, so `viewport` captures show it in place; `expanded` grows the viewport to
// the whole page, which also draws every virtualised row.

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
/** DQ-M53-04: every row of the one scroll measured (VehicleProfile under a QA override), so heights are the page's own. */
const SETTLED = '[data-testid="VEH-01.body.settled"]';

/**
 * DQ-M53R2-05: a walk starts on the settled page, after a deep link's jump has landed (its section marked current).
 * @param {import('@playwright/test').Page} page
 * @param {string} [section] the section the URL names
 */
async function settled(page, section) {
  const current = section ? ` [data-testid="VEH-01.sections.${section}"][aria-current="location"]` : '';
  await page.locator(`${SETTLED}${current}`).first().waitFor({ timeout: 30_000 });
}

const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

const R34 = '/app/v/nissan-skyline-gt-r-r34-5tf974vj';
/** A demo build with four built mods in one system, so Mods shows "+ 1 weitere" (the R34 has at most three per system). */
const GOLF = '/app/v/volkswagen-golf-gti-vii-5g-gqpeaxx3';
/** GAR-10 as VEH-01's "Plan anlegen" opens it, with the system already chosen (Fahrwerk). */
const NEW_PLAN = '/app/garage/{r34}/mods/new?status=planned&category=suspension';

/**
 * Fills GAR-10's Plan group as an owner would: Zielmonat März of next year, Priorität Hoch, Budget 2.400 €.
 * @param {import('@playwright/test').Page} page
 */
async function fillPlan(page) {
  const nextYear = new Date().getFullYear() + 1;
  await page.locator('[data-testid="GAR-10.field.brand"]:visible').fill('KW');
  await page.locator('[data-testid="GAR-10.field.model"]:visible').fill('V3 Clubsport');
  await page.locator('[data-testid="GAR-10.targetMonth"]:visible').click();
  await page.locator('[data-testid="GAR-10.targetMonthSheet.option.3"]:visible').click();
  await page.locator('[data-testid="GAR-10.targetYear"]:visible').click();
  await page.locator(`[data-testid="GAR-10.targetYearSheet.option.${nextYear}"]:visible`).click();
  await page.locator('[data-testid="GAR-10.priority.high"]:visible').click();
  await page.locator('[data-testid="GAR-10.budget"]:visible').fill('2.400');
}

export const routesM53 = [
  {
    id: 'VEH-01-onescroll',
    path: R34,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: `${SETTLED} [data-testid="VEH-01.section.overview"]`,
    capture: 'expanded',
    fs2: true,
    p4: { en: true, black: true, tablet: true },
    notes:
      'M5.3 ★ VEH-01 as one scroll (10 §5): 4:5 hero (16:9 from 768) with the identity on the scrim, SpecStrip, the action row, then the section index chips Überblick · Daten · Mods · Pläne · Verlauf · Galerie (pills 32, border.default; none current above Überblick), and the sections one after the other, each with a title.2 heading: Überblick (Build Score, description, Build-Fortschritt card "92 %" with the 4 line and "12 von 13 Mods verbaut · 1 geplant"), Daten (6 key specs as a label.caps/body.strong grid, "Alle Daten anzeigen"), Mods 13 (BuildSheet by system, no plan in it), Pläne 1 (Tomei Expreme Ti), Verlauf 7 (the latest three entries, "Ganzen Verlauf anzeigen (7)"), Galerie 3 (3-up 1:1 wall, "Alle Fotos"), Ähnliche Builds, the guest line and "Melden". From 1280 the right sticky card (strip, owner, actions); from 1440 the index is a vertical list in the left 2 columns.',
  },
  {
    id: 'VEH-01-sections',
    path: `${R34}?section=mods`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: `${SETTLED} [data-testid="VEH-01.sections.mods"][aria-current="location"]`,
    capture: 'viewport',
    p4: { en: true },
    notes:
      'M5.3 the section index pinned (10 §5.5): opened at Mods (a deep link jumps without motion), the chip row stays under the photo header on a phone (under the bar from 768, the vertical list from 1440 at 24), "Mods" inverted (text.primary fill, canvas label) as the section in view, the Mods heading right under the row. The row is opaque canvas with a hairline under it; no glass on content.',
  },
  {
    id: 'VEH-01-specs-expanded',
    path: `${R34}?section=specs`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    walk: async ({ page }) => {
      await settled(page, 'specs');
      await page.locator('[data-testid="VEH-01.specs.toggle"]:visible').click();
      // DQ-M53-15: no hover or pressed fill left on the picture.
      await page.mouse.move(0, 0);
    },
    ready: '[data-testid="VEH-01.specs.all"]',
    capture: 'viewport',
    notes: 'M5.3 Daten opened in place (10 §5.7, spring.default): the six key specs, "Weniger Daten anzeigen", then every spec table (Fahrzeug, Motor, Leistung, Antrieb) with provenance under measured values, tnum right-aligned.',
  },
  {
    id: 'VEH-01-mods-expanded',
    path: `${GOLF}?section=mods`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    walk: async ({ page }) => {
      await settled(page, 'mods');
      // DQ-M53R2-06: one picture every run: the toggle is pressed where the jump left it (no auto-scroll, no hover), and the page stays
      // held at Mods (the Mods heading 16 under the index, the opened group below it).
      const toggle = page.locator('[data-testid^="VEH-01.mods."][data-testid$=".toggle"]:visible').first();
      const group = (await toggle.getAttribute('data-testid'))?.replace(/\.toggle$/, '') ?? '';
      await toggle.dispatchEvent('click');
      await page.locator(`[data-testid="${group}.rest"]`).waitFor();
      await page.mouse.move(0, 0);
    },
    ready: '[data-testid^="VEH-01.mods."][data-testid$=".rest"]',
    capture: 'viewport',
    notes: 'M5.3 Mods (10 §5.8): a system with four mods after "+ 1 weitere": the fourth row continues the same grouped card (hairline inset to the text), the toggle now "Weniger anzeigen"; counts in tabular figures in the heading.',
  },
  {
    id: 'VEH-01-plans-owner',
    path: `${R34}?section=plans`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: `${SETTLED} [data-testid="VEH-01.sections.plans"][aria-current="location"]`,
    capture: 'viewport',
    p4: { en: true },
    notes:
      'M5.3 Pläne for the owner lukas.sc (10 §5.9): the planned Tomei Expreme Ti as a ModRow (glyph tile, brand, the target month pill or "Geplant", the priority pill), "Als verbaut markieren" (tertiary S, check glyph) under it, "Budgets siehst nur du." (caption); the Build-Fortschritt card above in Überblick. The floating OwnerCapsule above the tab bar on phones. A single plan has no "Sortieren".',
  },
  {
    id: 'VEH-01-plans-install',
    path: `${R34}?section=plans`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await settled(page, 'plans');
      await page.locator('[data-testid^="VEH-01.plan."][data-testid$=".install"]:visible').first().click();
    },
    ready: '[data-testid="VEH-01.plans.installDialog.title"]',
    capture: 'viewport',
    notes: 'M5.3 "Als verbaut markieren" asks first: Dialog "Tomei Expreme Ti verbaut?", "Die Mod kommt mit November 2026 als Einbaudatum zu deinen Mods. …", Abbrechen (secondary) and "Als verbaut markieren" (primary). Confirming moves it to Mods with the success haptic (native only).',
  },
  {
    id: 'VEH-01-plans-empty-owner',
    // The deep link, as VEH-01-plans-owner: since the M5.3 client-feedback hero the phone's index row starts below the first window, and
    // a click on its chip scrolled it only as far as the window's foot, under the floating tab bar (which took the click).
    path: `${R34}?section=plans`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    // The owner without a plan: the page's plans and the plan rows answer empty (the seed's planned Tomei becomes a built mod).
    prepare: async ({ stage }) =>
      stage('**/api/v1/public/vehicles/nissan-skyline-gt-r-r34-5tf974vj', {
        patch: (body) => {
          const data = body.data;
          for (const group of data.mods.groups) group.items = group.items.filter((mod) => mod.status !== 'planned');
          data.mods.groups = data.mods.groups.filter((group) => group.items.length > 0);
          data.plans = { count: 0, items: [] };
          data.build_progress = data.build_progress ? { ...data.build_progress, planned: 0, total: data.build_progress.built, percent: 100 } : null;
          return body;
        },
      }),
    walk: async ({ page }) => {
      await settled(page, 'plans');
      await page.mouse.move(0, 0);
    },
    ready: '[data-testid="VEH-01.plans.sample"]',
    capture: 'viewport',
    notes: 'M5.3 the owner\'s empty Pläne (09 §4.9 "never empty"): a sample plan row "KW V3 Gewindefahrwerk · KW · Ziel März 2027 · Hoch" badged "Beispiel", the line "Plane dein nächstes Upgrade – …" and one action "Plan anlegen" (tertiary). Build-Fortschritt in Überblick shows the same invitation.',
  },
  {
    id: 'VEH-08',
    path: `${R34}/history`,
    phase: 3,
    auth: 'guest',
    states: ['default', 'loading', 'empty', 'error', 'offline', 'restricted'],
    ready: loadedOr('[data-testid="VEH-08.vehicle"]', 'VEH-08.root'),
    capture: 'expanded',
    fs2: true,
    p4: { en: true },
    notes:
      'M5.3 VEH-08 Verlauf (10 §5.10): back + "Verlauf", the car\'s name (headline) and "7 Einträge" (tnum), then the whole Timeline by month on one hairline spine (callout.strong month headings, headline titles, changes, mileage tnum, photos 3-up, before/after side by side), ending "Das ist der erste Eintrag dieses Builds." loading = month bar and four entries of the same geometry; empty = a sample entry "KW V3 verbaut · Fahrwerk · −35 mm" badged "Beispiel" over "Noch keine Einträge im Verlauf."; restricted = the calm unavailable state.',
  },
  {
    id: 'GAR-10-plan-pick',
    path: '/app/garage/{r34}/mods/new?status=planned',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="GAR-10.categories"]',
    capture: 'viewport',
    notes: 'M5.3 "Plan anlegen" from VEH-01 (Pläne, Build-Fortschritt): GAR-10 opens with the status Geplant preset and asks for the system first, the same sheet as GAR-09 ("Kategorie wählen", glyph tiles in two columns, one at 200 %) over the editor\'s skeleton; closing it goes back.',
  },
  {
    id: 'GAR-10-plan',
    path: NEW_PLAN,
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => fillPlan(page),
    ready: '[data-testid="GAR-10.priority.high"][aria-checked="true"]',
    capture: 'expanded',
    fs2: true,
    p4: { en: true },
    notes:
      'M5.3 GAR-10 as a plan (10 §5.9, contract §4.1): status Geplant (no Einbaumonat), the group PLAN with Zielmonat "März" and Jahr (next year) side by side (one under the other at 200 %), the helper "Ziel: März 2027", Priorität as chips Keine · Niedrig · Normal · Hoch with Hoch inverted, and Budget "2.400 €" with "Nur für dich sichtbar."; the private cost stays in EINBAU. Saving sends target_month, priority and budget_cents.',
  },
  {
    id: 'GAR-10-plan-leaving',
    path: NEW_PLAN,
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await fillPlan(page);
      await page.locator('[data-testid="GAR-10.status.installed"]:visible').click();
    },
    ready: '[data-testid="GAR-10.planLeaving"]',
    capture: 'viewport',
    notes: 'M5.3 a filled plan switched to Verbaut: the Plan group goes, Einbaumonat comes back, and under the status "Nicht mehr geplant: Zielmonat und Priorität entfallen beim Speichern. Das Budget bleibt." (callout, text.secondary, role status).',
  },
];
