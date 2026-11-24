// Visual registry entries of M5.9 AI helpers and CF-6 share card options, app part (docs/10_CLIENT_ROUND_1.md §8, server contract
// docs/reports/phase-5/m5.9-contract.md; commit 40aef7b6). Same fields as the entries in routes.mjs, which merges this list.
//
// No provider runs locally (OA-18): every ai.* flag is off and app-config reports them off without a key (D-8), so each cell forces its
// flag with the non-production override `qaFlags` (mobile/src/lib/qa.ts: the flag counts as on and the surface skips the "KI-Vorschläge"
// opt-in) and stages the AI endpoint's answer (route-steps.mjs) with what the server's resources would say
// (web/app/Http/Resources/V1/Ai/SpecSuggestionResource.php, ProductMatchResource.php, ForumThreadResource `ai_summary`). Nothing reaches a
// provider: the staged answers are the harness's, and the server would answer 404 feature_disabled anyway.
//   GAR-03 / GAR-06 "Daten übernehmen?" (SpecsAssist): the ask row, the answer (several variants / one), the values taken over and marked
//     "Herstellerangabe (KI-Vorschlag)", loading (the request held in the page, never answered) and error (503 ai_unavailable).
//   GAR-10 product match (ProductMatchAssist) in the product sheet of a new Fahrwerk mod: "kw v3" matched to the seeded KW Variante 3,
//     and "tein flex z" with no catalogue product. parts_catalogue is off on the server (ADR-455), so the sheet's autocomplete is staged
//     empty (what the catalogue search answers for a text it has no product for).
//   FOR-03 "KI-Zusammenfassung" (ThreadSummary) over the seeded sample thread (routes-m58.mjs seededThread), collapsed and opened.
//   VEH-07 CF-6 customiser (ShareCardCustomiser) of lukas.sc's R34: story, square with the dark and the light band, and a custom story.
//     The cards are drawn by the server (sig.share_cards is on locally); no AI involved.
//   VEH-01 ★ / WEB-01 ★ with an AI-marked spec (DQ-P5-057): kenji.r34's R34, whose factory 280 PS / 392 Nm are the R34 suggestion's
//     figures, with power and torque standing as taken over: "Herstellerangabe (KI-Vorschlag)" under the SpecStrip numerals
//     (VehiclePresenter power()/torque() source_label). VEH-01 stages that label in the public answer; WEB-01 renders from the database,
//     so it runs inside the stage fixture `m59-ai-specs` (vehicle_specs.ai_fields set for the capture only).
// DQ-P5-057: the routes this module risks most also run in EN, Schwarz and at 200 % (`p4: { en, black }`, `fs2`; flagship routes
// have Schwarz and 200 % anyway). DQ-P5-061: every walk that clicks ends with the pointer parked (parkPointer), so no hover is captured.

import { m414Ids } from '../support/backend.mjs';
import { QA_NOW } from '../support/qa.mjs';
import { POSTS_PATH, THREAD, THREAD_PATH, seededThread } from './routes-m58.mjs';

const SPECS_SUGGEST = /\/api\/v1\/ai\/specs\/suggest(\?.*)?$/;
const PRODUCTS_MATCH = /\/api\/v1\/ai\/products\/match(\?.*)?$/;
/** GAR-10's autocomplete (`GET products?q=&category=&per_page=8`), never a product's own page. */
const PRODUCTS = /\/api\/v1\/products(\?.*)?$/;
/** The owner's vehicle (`GET vehicles/{id}`), never its sub-resources. */
const VEHICLE = /\/api\/v1\/vehicles\/[0-9a-z]{26}(\?.*)?$/;

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (/** @type {number} */ offset) => new Date(Date.parse(QA_NOW) + offset).toISOString();

/**
 * DQ-P5-061: the pointer leaves the controls once a walk has clicked, after the last layout change of the walk, so no hover fill or
 * hover border is in the picture (and none differs between runs). The top-left corner is where every other registry parks it.
 * @param {import('@playwright/test').Page} page
 */
const parkPointer = (page) => page.mouse.move(0, 0);

/** DQ-P5-057: EN and Schwarz cells (p4.mjs; flagship routes have Schwarz anyway) and the 200 % cells. */
const MORE_AXES = { p4: { en: true, black: true }, fs2: true };

const AI_NOTE = 'ai.* forced through qaFlags (no provider key, OA-18); the AI answer staged as the server resource would give it.';

/**
 * SpecSuggestionResource of the seeded E30 draft (catalogue generation 17, BMW M3 E30): typical factory variants. The draft has its
 * engine, drivetrain and gearbox already, power and torque empty, so "Übernehmen" fills those two.
 */
const E30_SUGGESTION = {
  cache_id: '01m59a1sp00000000000000001',
  label: 'KI-Vorschlag',
  provenance_label: 'Herstellerangabe (KI-Vorschlag)',
  subject: 'BMW M3 E30 (1986–1991)',
  variants: [
    {
      key: 'm3',
      label: 'M3 (S14B23, mit Kat)',
      fields: { engine_code: 'S14B23', displacement_cc: 2302, fuel: 'petrol', aspiration: 'naturally_aspirated', power_value: 195, power_unit: 'ps', torque_nm: 230, drivetrain: 'rear', gearbox: 'manual' },
    },
    {
      key: 'm3_evo2',
      label: 'M3 Evolution II (S14B23)',
      fields: { engine_code: 'S14B23', displacement_cc: 2302, fuel: 'petrol', aspiration: 'naturally_aspirated', power_value: 220, power_unit: 'ps', torque_nm: 245, drivetrain: 'rear', gearbox: 'manual' },
    },
    {
      key: 'm3_sport_evo',
      label: 'M3 Sport Evolution (S14B25)',
      fields: { engine_code: 'S14B25', displacement_cc: 2467, fuel: 'petrol', aspiration: 'naturally_aspirated', power_value: 238, power_unit: 'ps', torque_nm: 240, drivetrain: 'rear', gearbox: 'manual' },
    },
  ],
  cached: true,
  generated_at: '2026-11-03T18:20:00+01:00',
};

/** The R34 (generation 532): one typical variant, so the block shows its one-line preview instead of a choice. */
const R34_SUGGESTION = {
  cache_id: '01m59a1sp00000000000000003',
  label: 'KI-Vorschlag',
  provenance_label: 'Herstellerangabe (KI-Vorschlag)',
  subject: 'Nissan Skyline GT-R R34 (1999–2002)',
  variants: [
    {
      key: 'gt_r',
      label: 'Skyline GT-R (RB26DETT)',
      fields: { engine_code: 'RB26DETT', displacement_cc: 2568, fuel: 'petrol', aspiration: 'biturbo', power_value: 280, power_unit: 'ps', torque_nm: 392, drivetrain: 'all', gearbox: 'manual' },
    },
  ],
  cached: false,
  generated_at: '2026-11-17T10:00:00+01:00',
};

/** 503 ai_unavailable as AiFailed renders it (lang/de/errors.php). */
const AI_UNAVAILABLE = { message: 'Der KI-Vorschlag ist gerade nicht verfügbar. Versuch es gleich noch einmal.', code: 'ai_unavailable', errors: {} };

/**
 * DQ-P5-069: the server answers in the viewer's language, so an EN cell gets the EN labels and messages (lang/{de,en}/ai.php
 * ai.label.*, lang/{de,en}/errors.php ai_unavailable). The staged German content (subject, variants, summary lines) stays: it is
 * the member's own data or generated text, which the server never translates.
 */
const AI_TEXT = {
  de: { suggestion: 'KI-Vorschlag', summary: 'KI-Zusammenfassung', unavailable: AI_UNAVAILABLE.message },
  en: { suggestion: 'AI suggestion', summary: 'AI summary', unavailable: 'The AI suggestion is not available right now. Try again in a moment.' },
};
const aiText = (/** @type {{ locale?: string }} */ cell) => AI_TEXT[cell.locale === 'en' ? 'en' : 'de'];

/**
 * GAR-06 over a R34 whose owner entered only the engine so far: the stored displacement, power and torque cleared from the owner's
 * vehicle answer, so "Daten übernehmen?" has fields to fill (it asks only while one is empty, hasEmptySpecs).
 * @param {import('./route-steps.mjs').RouteStepContext['stage']} stage
 */
async function r34WithoutFigures(stage) {
  await stage(VEHICLE, {
    method: 'GET',
    patch: (/** @type {{ data: Record<string, any> }} */ body) => {
      const specs = body.data.specs ?? {};
      body.data.specs = { ...specs, displacement_cc: null, power_value: null, power_source: null, torque_nm: null, torque_source: null, ai_fields: [] };
      return body;
    },
  });
}

/**
 * Holds every request to `pattern` in this document for ever (the page's own fetch, wrapped): the mutation stays pending and its
 * button shows its loading state, while no request is in flight for the runner's network-quiet wait. The next cell loads a new
 * document, so the wrapper never outlives the cell.
 * @param {import('@playwright/test').Page} page
 * @param {string} source a RegExp source
 */
async function holdRequests(page, source) {
  await page.evaluate((pattern) => {
    const matcher = new RegExp(pattern);
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return matcher.test(url) ? new Promise(() => {}) : original(input, init);
    };
  }, source);
}

/**
 * The "Daten übernehmen?" block of a route: asks, then (optionally) picks a variant and takes it over.
 * @param {string} route GAR-03 or GAR-06
 * @param {{ variant?: string, take?: boolean, hold?: boolean }} options
 */
const specsWalk =
  (route, { variant, take = false, hold = false } = {}) =>
  async (/** @type {import('./route-steps.mjs').RouteStepContext} */ { page }) => {
    const block = `${route}.specsSuggestion`;
    await page.getByTestId(`${block}.ask`).waitFor({ state: 'visible' });
    if (hold) await holdRequests(page, SPECS_SUGGEST.source);
    await page.getByTestId(`${block}.ask`).click();
    if (variant) {
      await page.getByTestId(`${block}.variant.${variant}`).first().click();
    }
    if (take) {
      await page.getByTestId(`${block}.take`).click();
      // The toast pauses its timer while the pointer is over it (ToastHost onMouseEnter); on a short phone it lands where the
      // pointer clicked "Übernehmen", so the pointer leaves first.
      await page.mouse.move(0, 0);
      // The toast "Herstellerangaben eingesetzt …" with "Rückgängig" stays 5 s (SM20); the cell shows the marked fields once it went, so
      // no picture depends on how long the capture took.
      const toast = page.getByTestId(`${route}.specsSuggestion.toast`);
      await toast.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
      await toast.waitFor({ state: 'detached', timeout: 20_000 });
    }
    // Again at the end: the take removes the block and the fields move up under where the pointer clicked (DQ-P5-061).
    await parkPointer(page);
  };

const stageSpecs = (/** @type {Record<string, unknown>} */ suggestion) => async (/** @type {import('./route-steps.mjs').RouteStepContext} */ { stage, cell }) => {
  const locale = cell.locale === 'en' ? 'en' : 'de';
  await stage(SPECS_SUGGEST, {
    method: 'POST',
    body: { data: { ...suggestion, label: aiText(cell).suggestion, provenance_label: FACTORY_SUGGESTION[locale] } },
  });
};

const stageSpecsError = async (/** @type {import('./route-steps.mjs').RouteStepContext} */ { stage, cell }) => {
  await stage(SPECS_SUGGEST, { method: 'POST', status: 503, body: { ...AI_UNAVAILABLE, message: aiText(cell).unavailable } });
};

/** Phones only, for the small inline states (the wide layouts show the same block in the same form column). */
const PHONES = [390];

// -- GAR-10 product match

/** ProductRowResource of the seeded KW Variante 3 (ids change with every seed: read from the database, support/backend.php m414-ids). */
async function kwVariante3() {
  const { kwProduct } = await m414Ids();
  if (!kwProduct) throw new Error('GAR-10 match: no seeded KW Variante 3 (run the catalogue seeder)');
  return {
    id: kwProduct,
    slug: 'variante-3',
    name: 'Variante 3',
    full_name: 'KW Variante 3',
    line: 'Gewindefahrwerke',
    brand: { slug: 'kw', name: 'KW' },
    category: { key: 'suspension', name: 'Fahrwerk', icon: 'coilover' },
    builds: null,
    thumbnail: null,
    status: 'active',
  };
}

/**
 * The product sheet of a new Fahrwerk mod: `text` typed, the catalogue search empty for it (staged: parts_catalogue is off on the
 * server), then "Im Katalog suchen · KI-Vorschlag" tapped.
 * @param {string} text
 */
const matchWalk =
  (text) =>
  async (/** @type {import('./route-steps.mjs').RouteStepContext} */ { page }) => {
    await page.getByTestId('GAR-10.product').first().click();
    const search = page.locator('input[data-testid="GAR-10.productSheet.search"], [data-testid="GAR-10.productSheet.search"] input').first();
    await search.waitFor({ state: 'visible' });
    await search.fill(text);
    const action = page.getByTestId('GAR-10.productSheet.match.action');
    await action.waitFor({ state: 'visible' });
    await action.click();
    await parkPointer(page);
  };

/**
 * @param {(() => Promise<unknown[]>)} products
 * @param {string} normalized
 */
const stageMatch =
  (products, normalized) =>
  async (/** @type {import('./route-steps.mjs').RouteStepContext} */ { stage, cell }) => {
    await stage(PRODUCTS, {
      method: 'GET',
      body: { data: [], links: {}, meta: { next_cursor: null, prev_cursor: null, per_page: 8, path: null } },
    });
    await stage(PRODUCTS_MATCH, { method: 'POST', body: { data: { label: aiText(cell).suggestion, normalized, products: await products() } } });
  };

// -- FOR-03 summary

/**
 * The summary the background job would store for the seeded thread "Gewindefahrwerk im Alltag: wie hart ist zu hart?" (ForumSummaries:
 * three lines ≤ 140 characters, no names, no links, only numbers of the posts). The seed has no thread past 20 replies (the threshold),
 * so the thread's count is staged at 24; the replies listed are the seeded ones.
 */
const SUMMARY = {
  label: 'KI-Zusammenfassung',
  lines: [
    'Für den Alltag raten die Antworten zu einem Gewindefahrwerk mit einstellbarer Zugstufe, das sich nach dem Einbau weicher stellen lässt.',
    'Die Domlager gleich mit tauschen: Nach 20 Jahren sind die alten meist durch.',
    'Nach dem Einbau vermessen lassen; auf einer weichen Dämpferstufe bleibt der Wagen im Alltag ruhig und komfortabel.',
  ],
  based_on_replies: 22,
  generated_at: iso(-3 * HOUR),
};

const summaryThread = async (/** @type {import('./route-steps.mjs').RouteStepContext} */ { page, stage, baseUrl, cell }) => {
  const { thread, posts } = await seededThread(page, baseUrl);
  const data = { ...thread.data, replies_count: 24, ai_summary: { ...SUMMARY, label: aiText(cell).summary } };
  await stage(POSTS_PATH, { body: posts });
  await stage(THREAD_PATH, { body: { ...thread, data } });
};

// -- VEH-07 share card

/**
 * VEH-07 shows the customiser only when the build's page is in the query cache ("a cold link has no page in the cache to read the
 * choices from: it shares the default card", ShareCardScreen): a member reaches it from the page. So the cells open lukas.sc's R34 page
 * (VEH-01) and take "Mehr" → "Karte teilen" the way the owner does, then make their choices.
 */
const SHARE = '/app/v/nissan-skyline-gt-r-r34-5tf974vj?qaFlags=sig.share_cards';

/** From the build's page to its share card. */
async function openShareCard(/** @type {import('@playwright/test').Page} */ page) {
  await page.locator('[data-testid="VEH-01.moreActions"]:visible').first().click();
  await page.locator('[data-testid="VEH-01.moreSheet.shareCard"]:visible').first().click();
  await page.locator('[data-testid="VEH-07.customise"]:visible').first().waitFor({ state: 'visible' });
  await parkPointer(page);
}
/** The preview of the card the options ask for, once drawn (the segment and the image change in the same render). */
const cardReady = (/** @type {string[]} */ ...checked) =>
  `[data-testid="VEH-07.root"]${checked.map((c) => `:has(${c})`).join('')} [data-testid="VEH-07.preview.image"]`;
const isOn = (/** @type {string} */ testId) => `[data-testid="${testId}"]:is([aria-checked="true"], [aria-selected="true"])`;

// -- VEH-01 / WEB-01 with an AI-marked spec

/** kenji.r34's R34 (DemoSeeder): 280 PS and 392 Nm entered as "Herstellerangabe", the figures R34_SUGGESTION gives. */
const AI_R34 = 'nissan-skyline-gt-r-r34-xmeypf41';
const PUBLIC_AI_R34 = new RegExp(`/api/v1/public/vehicles/${AI_R34}(\\?.*)?$`);
/** ai.label.factory_suggestion (web/lang/de/ai.php, web/lang/en/ai.php): what VehiclePresenter puts in source_label for a marked value. */
const FACTORY_SUGGESTION = { de: 'Herstellerangabe (KI-\u2060Vorschlag)', en: 'Manufacturer figure (AI\u00A0suggestion)' };

/**
 * VEH-01-aiSpecs: the public answer of kenji.r34's R34 as the server gives it while vehicle_specs.ai_fields marks power and torque
 * (VehiclePresenter power()/torque(): the source stays "factory", source_label becomes ai.label.factory_suggestion in the viewer's
 * language; the spec groups carry the same rows, and the SpecStrip takes its provenance from them, specStripItems). The server marks
 * only factory figures (SpecProvenance::fields), so a seed that no longer has them fails the cell instead of staging a state the
 * server never sends.
 * @param {import('./route-steps.mjs').RouteStepContext} ctx
 */
async function aiMarkedR34({ stage, cell }) {
  const label = FACTORY_SUGGESTION[cell.locale === 'en' ? 'en' : 'de'];
  await stage(PUBLIC_AI_R34, {
    method: 'GET',
    patch: (/** @type {{ data: Record<string, any> }} */ body) => {
      const data = body.data;
      for (const key of ['power', 'torque']) {
        if (data[key]?.source !== 'factory') throw new Error(`VEH-01-aiSpecs: the R34's ${key} is not a factory figure (${String(data[key]?.source)})`);
        data[key] = { ...data[key], source_label: label };
      }
      let rows = 0;
      for (const group of data.spec_groups ?? []) {
        for (const row of group.rows ?? []) {
          if (row.key !== 'power' && row.key !== 'torque') continue;
          row.source_label = label;
          rows++;
        }
      }
      if (rows !== 2) throw new Error(`VEH-01-aiSpecs: expected the power and torque rows in spec_groups, found ${rows}`);
      return body;
    },
  });
}

/** @type {import('./matrix.mjs').RouteDef[]} */
export const routesM59Ai = [
  // GAR-03 step 2 Technik of the seeded E30 draft (generation 17): engine, drivetrain and gearbox entered, power and torque empty.
  {
    id: 'GAR-03-specsAi',
    path: '/app/add-vehicle/{draft}/specs?qaFlags=ai.vehicle_specs',
    phase: 3,
    auth: 'member',
    states: ['default'],
    viewports: PHONES,
    ready: '[data-testid="GAR-03.specsSuggestion.ask"]',
    capture: 'expanded',
    notes: `${AI_NOTE} M5.9 GAR-03 step 2 before the tap: above the fields the quiet surface block "Daten übernehmen?" (bodyStrong) with the "KI-Vorschlag" label text (no icon, 10 §8), "Typische Herstellerangaben zu deinem Modell. Du prüfst sie, bevor du speicherst.", "Ja, zeigen" (secondary M) and "Nein danke" (tertiary).`,
  },
  {
    id: 'GAR-03-specsAi-variants',
    path: '/app/add-vehicle/{draft}/specs?qaFlags=ai.vehicle_specs',
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: stageSpecs(E30_SUGGESTION),
    walk: specsWalk('GAR-03', { variant: 'm3' }),
    ready: '[data-testid="GAR-03.specsSuggestion.variants"]',
    capture: 'expanded',
    notes: `${AI_NOTE} The answer for the E30 (staged SpecSuggestionResource, three variants): "Typische Herstellerangaben für BMW M3 E30 (1986–1991)", the radio group "Ausführung wählen" with M3 (S14B23, mit Kat) chosen, M3 Evolution II and M3 Sport Evolution, each with its caption "195 PS · 230 Nm · 2302 ccm · Benzin · Heck · Schaltgetriebe"; "Füllt nur leere Felder. Gespeichert wird erst mit „Weiter“."; "Übernehmen" (secondary M) and "Nein danke".`,
  },
  {
    id: 'GAR-03-specsAi-taken',
    path: '/app/add-vehicle/{draft}/specs?qaFlags=ai.vehicle_specs',
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: stageSpecs(E30_SUGGESTION),
    walk: specsWalk('GAR-03', { variant: 'm3', take: true }),
    // Flagship and form: Schwarz and 200 % already; EN added (DQ-P5-057).
    ...MORE_AXES,
    ready: '[data-testid="GAR-03.torque.helper"]',
    capture: 'expanded',
    notes: `${AI_NOTE} After "Übernehmen" (and once its toast "Herstellerangaben eingesetzt. Prüf sie vor dem Speichern." with "Rückgängig" went): the block is gone, LEISTUNG 195 PS with "≈ 143 kW · Herstellerangabe (KI-Vorschlag)" and the source chip Herstellerangabe, DREHMOMENT 230 Nm with "Herstellerangabe (KI-Vorschlag)"; the fields the member had (engine, drivetrain, gearbox) unchanged and unmarked. Nothing saved before "Weiter".`,
  },
  {
    id: 'GAR-03-specsAi-loading',
    path: '/app/add-vehicle/{draft}/specs?qaFlags=ai.vehicle_specs',
    phase: 3,
    auth: 'member',
    states: ['default'],
    viewports: PHONES,
    walk: specsWalk('GAR-03', { hold: true }),
    ready: '[data-testid="GAR-03.specsSuggestion.ask"][aria-busy="true"]',
    capture: 'viewport',
    notes: `${AI_NOTE} While the suggestion loads (the request held in the page): "Ja, zeigen" keeps its width with the button spinner, "Nein danke" beside it; nothing else moves.`,
  },
  {
    id: 'GAR-03-specsAi-error',
    path: '/app/add-vehicle/{draft}/specs?qaFlags=ai.vehicle_specs',
    phase: 3,
    auth: 'member',
    states: ['default'],
    viewports: PHONES,
    prepare: stageSpecsError,
    walk: specsWalk('GAR-03'),
    ready: '[data-testid="GAR-03.specsSuggestion.note"]',
    capture: 'viewport',
    notes: `${AI_NOTE} 503 ai_unavailable (staged): the quiet note "Gerade nicht verfügbar" (status) under the intro and "Erneut versuchen" (secondary M) in place of "Ja, zeigen", "Nein danke" beside it.`,
  },

  // GAR-06 Technische Daten of the R34 (generation 532) with displacement, power and torque cleared from the owner's answer.
  {
    id: 'GAR-06-specsAi',
    path: '/app/garage/{r34}/specs?qaFlags=ai.vehicle_specs',
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: async (ctx) => {
      await r34WithoutFigures(ctx.stage);
      await stageSpecs(R34_SUGGESTION)(ctx);
    },
    walk: specsWalk('GAR-06'),
    ...MORE_AXES,
    ready: '[data-testid="GAR-06.specsSuggestion.preview"]',
    capture: 'expanded',
    notes: `${AI_NOTE} GAR-06 with one typical variant (staged): "Daten übernehmen?" · KI-Vorschlag, "Typische Herstellerangaben für Nissan Skyline GT-R R34 (1999–2002)", the one-line preview "Skyline GT-R (RB26DETT) · 280 PS · 392 Nm · 2568 ccm · Benzin · Allrad · Schaltgetriebe", the hint naming "Speichern", "Übernehmen" and "Nein danke"; the empty Hubraum, Leistung and Drehmoment fields below.`,
  },
  {
    id: 'GAR-06-specsAi-taken',
    path: '/app/garage/{r34}/specs?qaFlags=ai.vehicle_specs',
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: async (ctx) => {
      await r34WithoutFigures(ctx.stage);
      await stageSpecs(R34_SUGGESTION)(ctx);
    },
    walk: specsWalk('GAR-06', { take: true }),
    ...MORE_AXES,
    ready: '[data-testid="GAR-06.torque.helper"]',
    capture: 'expanded',
    notes: `${AI_NOTE} After "Übernehmen": Hubraum 2568, Leistung 280 PS (≈ 206 kW) and Drehmoment 392 Nm, each with "Herstellerangabe (KI-Vorschlag)" under it, the source chips on Herstellerangabe; RB26DETT, Biturbo, Allrad and Schaltgetriebe as the owner entered them (unmarked); "Speichern" enabled (the form is dirty).`,
  },
  {
    id: 'GAR-06-specsAi-loading',
    path: '/app/garage/{r34}/specs?qaFlags=ai.vehicle_specs',
    phase: 3,
    auth: 'member',
    states: ['default'],
    viewports: PHONES,
    prepare: async ({ stage }) => r34WithoutFigures(stage),
    walk: specsWalk('GAR-06', { hold: true }),
    ready: '[data-testid="GAR-06.specsSuggestion.ask"][aria-busy="true"]',
    capture: 'viewport',
    notes: `${AI_NOTE} GAR-06 while the suggestion loads: "Ja, zeigen" with its spinner at the same width.`,
  },
  {
    id: 'GAR-06-specsAi-error',
    path: '/app/garage/{r34}/specs?qaFlags=ai.vehicle_specs',
    phase: 3,
    auth: 'member',
    states: ['default'],
    viewports: PHONES,
    prepare: async (ctx) => {
      await r34WithoutFigures(ctx.stage);
      await stageSpecsError(ctx);
    },
    walk: specsWalk('GAR-06'),
    ready: '[data-testid="GAR-06.specsSuggestion.note"]',
    capture: 'viewport',
    notes: `${AI_NOTE} GAR-06 after 503 ai_unavailable: "Gerade nicht verfügbar" and "Erneut versuchen".`,
  },

  // GAR-10 product sheet of a new Fahrwerk mod on the R34.
  {
    id: 'GAR-10-match',
    path: '/app/garage/{r34}/mods/new?category=suspension&qaFlags=parts_catalogue,ai.product_match',
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: stageMatch(async () => [await kwVariante3()], 'KW Variante 3'),
    walk: matchWalk('kw v3'),
    ...MORE_AXES,
    ready: '[data-testid^="GAR-10.productSheet.match.product."]',
    capture: 'viewport',
    notes: `${AI_NOTE} The product sheet "Produkt" with "kw v3" typed: the catalogue search found nothing ("Kein Produkt zu „kw v3“ in dieser Kategorie.", staged), "Im Katalog suchen · KI-Vorschlag" tapped, then "Meintest du KW Variante 3?" with the KI-Vorschlag label and the one catalogue product as a ProductRow (KW · Variante 3 · Gewindefahrwerke, the coilover glyph); a tap links it as any product.`,
  },
  {
    id: 'GAR-10-match-none',
    path: '/app/garage/{r34}/mods/new?category=suspension&qaFlags=parts_catalogue,ai.product_match',
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: stageMatch(async () => [], 'Tein Flex Z'),
    walk: matchWalk('tein flex z'),
    ready: '[data-testid="GAR-10.productSheet.match.note"]',
    capture: 'viewport',
    notes: `${AI_NOTE} "tein flex z": the AI made "Tein Flex Z" of it, but the catalogue has no such product (empty \`products\`, a valid answer): under "Kein Produkt zu „tein flex z“ in dieser Kategorie." the quiet note "Kein Vorschlag gefunden.", no list and no further action.`,
  },

  // FOR-03 ★ KI-Zusammenfassung.
  {
    id: 'FOR-03-summary',
    path: `/app/forum/${THREAD}?qaFlags=ai.forum_summary`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: summaryThread,
    ready: '[data-testid="FOR-03.summary.toggle"]',
    capture: 'expanded',
    notes: `${AI_NOTE} FOR-03 ★ of the seeded "Gewindefahrwerk im Alltag: wie hart ist zu hart?" with 24 replies (staged; the seed has no thread past the 20-reply threshold) and its summary: after the solution card the collapsed surface row "KI-Zusammenfassung · aus 22 Antworten" (caption, tnum) with the caret and "×" (Zusammenfassung ausblenden), right above "24 Antworten"; no icon of its own (10 §8).`,
  },
  {
    id: 'FOR-03-summary-open',
    path: `/app/forum/${THREAD}?qaFlags=ai.forum_summary`,
    phase: 3,
    auth: 'member',
    states: ['default'],
    prepare: summaryThread,
    walk: async ({ page }) => {
      await page.getByTestId('FOR-03.summary.toggle').click();
      await parkPointer(page);
    },
    ready: '[data-testid="FOR-03.summary.body"]',
    // Flagship: Schwarz and 200 % already; EN added (DQ-P5-057).
    ...MORE_AXES,
    capture: 'expanded',
    notes: `${AI_NOTE} The summary opened: three callout lines (Zugstufe einstellbar, Domlager mit tauschen, vermessen lassen) and "Automatisch erstellt und vielleicht ungenau. Maßgeblich sind die Antworten." (caption, tertiary); the caret turned.`,
  },

  // VEH-07 CF-6 share card options (lukas.sc's R34; the server draws every card).
  {
    id: 'VEH-07-customise',
    path: SHARE,
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => openShareCard(page),
    ready: cardReady(isOn('VEH-07.format.story')),
    capture: 'expanded',
    notes: 'CF-6 VEH-07 story (the stored card): the 9:16 preview, Story · Quadrat, then the customiser: "Foto" with the build\'s ready photos as 1:1 thumbs (the cover ringed), "Auf der Karte" with the element chips the build has (Build Score, Dex-Nr., Daten, @lukas.sc, QR-Code; all selected), no band switch (story only), no "Standard wiederherstellen" (nothing changed); Teilen (primary) and Speichern.',
  },
  {
    id: 'VEH-07-square',
    path: SHARE,
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await openShareCard(page);
      await page.getByTestId('VEH-07.format.square').click();
      await parkPointer(page);
    },
    ready: cardReady(isOn('VEH-07.format.square')),
    // DQ-P5-057/-055: the square card's edge against the Schwarz canvas, the option groups at 200 % and in EN.
    ...MORE_AXES,
    capture: 'expanded',
    notes: 'CF-6 the square card (1:1, the car kept clear of the band) with the dark band (the default): the customiser adds the segmented Dunkel · Hell (Dunkel chosen; "Band" is its accessible name, no visible heading); still the stored card, so no "Standard wiederherstellen".',
  },
  {
    id: 'VEH-07-square-light',
    path: SHARE,
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await openShareCard(page);
      await page.getByTestId('VEH-07.format.square').click();
      await page.getByTestId('VEH-07.theme.light').click();
      await parkPointer(page);
    },
    ready: cardReady(isOn('VEH-07.format.square'), isOn('VEH-07.theme.light')),
    capture: 'expanded',
    notes: 'CF-6 the square card with the light band, drawn by the server for this viewer (`share-card.png?format=square&theme=light`): Hell chosen, "Standard wiederherstellen" (tertiary) appears to go back to the stored card.',
  },
  {
    id: 'VEH-07-custom',
    path: SHARE,
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await openShareCard(page);
      const thumbs = page.locator('[data-testid^="VEH-07.photo."]');
      await thumbs.first().waitFor({ state: 'visible' });
      if ((await thumbs.count()) > 1) await thumbs.nth(1).click();
      for (const element of ['score', 'dex']) {
        const chip = page.getByTestId(`VEH-07.element.${element}`);
        if (await chip.count()) await chip.click();
      }
      // DQ-P5-061: "Dex-Nr." kept its hover fill in the Hell desktop cell.
      await parkPointer(page);
    },
    ready: cardReady('[data-testid="VEH-07.reset"]'),
    capture: 'expanded',
    notes: 'CF-6 a custom story: the second photo ringed, Build Score and Dex-Nr. switched off (only the chips the build has), the server\'s card drawn with these options; "Standard wiederherstellen" under the options.',
  },

  // VEH-01 ★ / WEB-01 ★ with an AI-marked spec (DQ-P5-057 b): the provenance twice the old length under the 4-up strip's numerals.
  {
    id: 'VEH-01-aiSpecs',
    path: `/app/v/${AI_R34}`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    // Flagship: every p4 device incl. 375, Schwarz and 200 % already; EN added.
    p4: { en: true },
    prepare: aiMarkedR34,
    ready: '[data-testid="VEH-01.body.settled"] [data-testid="VEH-01.title"]',
    capture: 'expanded',
    notes: 'M5.9 VEH-01 ★ of kenji.r34\'s R34 (RB26DETT, 280 PS / 392 Nm as factory figures) as a guest, with power and torque standing as taken over from "Daten übernehmen?" (the public answer staged as VehiclePresenter gives it with vehicle_specs.ai_fields): the SpecStrip reads LEISTUNG 280 PS and DREHMOMENT 392 Nm, each with "Herstellerangabe (KI-Vorschlag)" (EN "Manufacturer figure (AI suggestion)") as its provenance caption instead of "Herstellerangabe", then BAUJAHR 2001 and ANTRIEB; the strip keeps its fit rule (one row, else 2 × 2, else one column; ADR-422) and no caption breaks inside a word. Text only, no icon (10 §8).',
  },
  {
    id: 'WEB-01-aiSpecs',
    path: `/v/${AI_R34}`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    // Flagship: every p4 device incl. 375, Schwarz and 200 % already; EN added.
    p4: { en: true },
    fixture: 'm59-ai-specs',
    ready: '[data-testid="WEB-01.root"]',
    notes: 'Inside the stage fixture m59-ai-specs (vehicle_specs.ai_fields of the R34 set for the capture only). M5.9 WEB-01 ★, the public Blade page of kenji.r34\'s R34 with power and torque marked as taken over from the AI suggestion: the spec strip (x-public.spec-strip, SpecStripLayout::entries) shows "Herstellerangabe (KI-Vorschlag)" (EN "Manufacturer figure (AI suggestion)") under 280 PS and 392 Nm, in the same order and wording as VEH-01-aiSpecs (parity); the Leistung and Drehmoment rows of the spec tables show no caption (x-public.spec-row captions only non-factory sources, and a marked value stays "factory"). Text only, no icon (10 §8).',
  },
];
