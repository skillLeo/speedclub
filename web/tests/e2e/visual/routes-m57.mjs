// Visual registry entries of M5.7 Engagement, app and member-web part (docs/10_CLIENT_ROUND_1.md §6, §16; server contract
// docs/reports/phase-5/m5.7-contract.md). Same fields as the entries in routes.mjs, which merges this list.
//
// INS-01 "Statistiken": the demo host has no counted views yet (counting starts with M5.7), so the data cells stage the contract's
// answer (§3.2) for lukas.sc and his R34; the staged numbers stand for a build with sticker scans and shares and are never shown outside
// these cells. The view-as cell is the server's own 403 `view_as_read_only`. The build goal and the SET-09 rows patch the server's own
// answers (`build_goal`, `notification_prefs.types.plan_due|weekly_recap`), since the notification part of the server comes last.

import { QA_NOW } from '../support/qa.mjs';

/** The cell's fixed clock (browser clock and qaNow are QA_NOW), never the machine's: the staged days must end on the app's today. */
const NOW_MS = Date.parse(QA_NOW);

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

const R34_SLUG = 'nissan-skyline-gt-r-r34-5tf974vj';
const ACCOUNT = /\/api\/v1\/me\/insights(\?.*)?$/;
const VEHICLE = /\/api\/v1\/vehicles\/[0-9a-z]{26}\/insights(\?.*)?$/;
const PUBLIC_R34 = new RegExp(`/api/v1/public/vehicles/${R34_SLUG}(\\?.*)?$`);
const SETTINGS = /\/api\/v1\/me\/settings(\?.*)?$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 30 Berlin days up to today, oldest first, from two lists of 30 counts. */
function days(/** @type {number[]} */ views, /** @type {number[]} */ scans) {
  return Array.from({ length: 30 }, (_, index) => ({
    date: new Date(NOW_MS - (29 - index) * DAY_MS).toISOString().slice(0, 10),
    views: views[index] ?? 0,
    scans: scans[index] ?? 0,
  }));
}

const pair = (/** @type {number} */ thisWeek, /** @type {number} */ lastWeek) => ({ this_week: thisWeek, last_week: lastWeek });
const sum = (/** @type {number[]} */ list) => list.reduce((total, n) => total + n, 0);

/**
 * DQ-P5-018: the staged numbers add up as the server's do (m5.7-contract §3.2, D-2): "this week" is the last 7 Berlin days incl. today,
 * "last week" the 7 before, the 30-day total the sum of `days`; the same for the scans. Throws when a list does not.
 * @param {number[]} views 30 days, oldest first
 * @param {number[]} scans 30 days, oldest first
 */
function series(views, scans) {
  if (views.length !== 30 || scans.length !== 30) throw new Error('series: 30 days each');
  return {
    days: days(views, scans),
    views: { this_week: sum(views.slice(23)), last_week: sum(views.slice(16, 23)), total_30_days: sum(views) },
    scans: { this_week: sum(scans.slice(23)), last_week: sum(scans.slice(16, 23)), total_30_days: sum(scans) },
  };
}

/** lukas.sc's account: a weekend meet in the 30 days (the peaks), 128 this week, 98 the week before, 402 in 30 days. */
const ACCOUNT_SERIES = series(
  [8, 9, 11, 10, 9, 9, 20, 10, 10, 9, 11, 10, 10, 9, 16, 15, 11, 10, 12, 13, 9, 14, 29, 16, 15, 17, 18, 20, 22, 20],
  [1, 2, 1, 1, 2, 1, 6, 2, 1, 1, 2, 1, 0, 1, 4, 2, 1, 1, 1, 1, 0, 1, 4, 2, 1, 2, 2, 3, 2, 2],
);

/** INS-01-drop: a quiet week after the meet, 40 this week, 98 the week before, 310 in 30 days. */
const DROP_SERIES = series(
  [8, 9, 11, 10, 9, 9, 16, 10, 10, 9, 11, 10, 10, 9, 16, 15, 11, 10, 12, 13, 9, 14, 29, 6, 5, 7, 5, 6, 5, 6],
  [1, 2, 1, 1, 2, 1, 6, 2, 1, 1, 2, 1, 0, 1, 4, 2, 1, 1, 1, 1, 0, 1, 4, 1, 0, 1, 0, 1, 0, 1],
);

/** INS-01-vehicle: the R34 counted for 11 days (counting_since), 88 this week, 71 in the four counted days before. */
const VEHICLE_SERIES = series(
  [...Array(19).fill(0), 15, 18, 20, 18, 10, 12, 11, 13, 14, 12, 16],
  [...Array(19).fill(0), 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3],
);

const SOURCE_LABELS = {
  de: { sticker_scan: 'Sticker-Scan', app: 'App', web: 'Web', shared_link: 'Geteilter Link' },
  en: { sticker_scan: 'Sticker scan', app: 'App', web: 'Web', shared_link: 'Shared link' },
};
const REACTION_LABELS = {
  de: { strong: 'Stark', clean: 'Sauber', low: 'Tief', loud: 'Laut' },
  en: { strong: 'Strong', clean: 'Clean', low: 'Low', loud: 'Loud' },
};

/**
 * "Woher die Aufrufe kommen" as the server answers it: the four sources' views sum to the scope's 30-day total, their percents (largest
 * remainder) to 100; null percents when nothing was counted.
 * @param {[number, number, number, number]} views sticker scan, app, web, shared link
 * @param {'de'|'en'} [locale]
 */
function sourcesOf(views, locale = 'de') {
  const keys = /** @type {const} */ (['sticker_scan', 'app', 'web', 'shared_link']);
  const total = sum(views);
  const exact = views.map((n) => (total === 0 ? 0 : (n * 100) / total));
  const percents = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ rest: value - Math.floor(value), index })).sort((a, b) => b.rest - a.rest);
  for (let left = total === 0 ? 0 : 100 - sum(percents), k = 0; left > 0; left--, k++) percents[order[k].index] += 1;
  return keys.map((source, index) => ({ source, label: SOURCE_LABELS[locale][source], views: views[index], percent: total === 0 ? null : percents[index] }));
}

/** The contract's account answer for lukas.sc: a weekend meet in the 30 days, the sticker doing most of the work. */
function account(/** @type {Record<string, unknown>} */ extra = {}) {
  return {
    scope: 'account',
    vehicle: null,
    as_of: new Date(NOW_MS).toISOString(),
    counting_since: new Date(NOW_MS - 60 * DAY_MS).toISOString().slice(0, 10),
    headline: 'Deine Garage wurde diese Woche 128-mal angesehen – 31 % mehr als letzte Woche.',
    views: { ...ACCOUNT_SERIES.views, delta_percent: 31, trend: 'up' },
    days: ACCOUNT_SERIES.days,
    sources: sourcesOf([180, 120, 70, 32]),
    sticker_scans: { ...ACCOUNT_SERIES.scans, total: 640 },
    spots: pair(6, 2),
    follows: { profile: pair(3, 1), vehicles: pair(2, 0) },
    saves: pair(4, 3),
    reactions: {
      this_week: 21,
      last_week: 17,
      by_type: [
        { type: 'strong', label: 'Stark', count: 9 },
        { type: 'clean', label: 'Sauber', count: 6 },
        { type: 'low', label: 'Tief', count: 4 },
        { type: 'loud', label: 'Laut', count: 2 },
      ],
    },
    breakdown: [{ subject: 'profile', vehicle: null, views_this_week: 40 }],
    ...extra,
  };
}

/**
 * The account answer with lukas.sc's own cars from his garage (their real ids, titles and covers) in the breakdown.
 * @param {import('./route-steps.mjs').RouteStepContext} ctx
 * @param {Record<string, unknown>} [extra]
 */
async function stageAccount({ page, stage, baseUrl }, extra = {}, { profile = 40, split = [88, 0, 0] } = {}) {
  // DQ-P5-018: "Nach Seite" lists the member's real cars. The member's session is Sanctum's cookie session, which the API honours only
  // for a request from the app's own origin: without Origin/Referer the cookie is ignored (401) and the list came back empty, so the
  // cell showed the profile alone. A failure now fails the cell instead of staging a garage without cars.
  const answer = await page.request.get(`${baseUrl}/api/v1/me/vehicles`, {
    headers: { Accept: 'application/json', Origin: baseUrl, Referer: `${baseUrl}/app/insights` },
  });
  if (!answer.ok()) throw new Error(`stageAccount: GET me/vehicles answered ${answer.status()}`);
  /** @type {any[]} */
  const cars = ((await answer.json()).data ?? []).filter((/** @type {any} */ car) => car.status === 'published').slice(0, split.length);
  if (cars.length === 0) throw new Error('stageAccount: the member has no published car for "Nach Seite"');
  const breakdown = [
    { subject: 'profile', vehicle: null, views_this_week: profile },
    ...cars.map((car, index) => ({
      subject: 'vehicle',
      vehicle: { id: car.id, slug: car.slug, full_title: car.full_title, cover: car.cover ?? null, is_sample: false },
      views_this_week: split[index] ?? 0,
    })),
  ];
  await stage(ACCOUNT, { method: 'GET', body: { data: account({ breakdown, ...extra }) } });
}

const english = (/** @type {import('./matrix.mjs').Cell} */ cell) => cell.locale === 'en';

export const routesM57 = [
  {
    id: 'INS-01',
    path: '/app/insights',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'offline', 'restricted'],
    ready: loadedOr('[data-testid="INS-01.thisWeek"]', 'INS-01.root'),
    capture: 'expanded',
    p4: { en: true, black: true, tablet: true },
    fs2: true,
    prepare: async (ctx) =>
      stageAccount(
        ctx,
        english(ctx.cell)
          ? {
              headline: 'Your garage was viewed 128 times this week – 31% more than last week.',
              sources: sourcesOf([180, 120, 70, 32], 'en'),
              reactions: { ...account().reactions, by_type: account().reactions.by_type.map((row) => ({ ...row, label: REACTION_LABELS.en[row.type] })) },
            }
          : {},
      ),
    notes:
      'M5.7 INS-01 from Profil (staged contract answer whose numbers add up, DQ-P5-018): the server sentence on top (the only place the comparison is put in words: "… 128-mal angesehen – 31 % mehr als letzte Woche."), then one row of three numbers: "AUFRUFE DIESE WOCHE" 128 (hero numeral, tnum), "LETZTE WOCHE" 98 (INS-01.delta, smaller numeral), "AUFRUFE 30 TAGE" 402; "Letzte 30 Tage" as one accent line (views, today dotted; its last 7 days sum to 128, the 7 before to 98, all 30 to 402) over a neutral line (sticker scans: 14 · 9 · 51) with the legend; then "Woher die Aufrufe kommen" (Sticker-Scan 180 · 45 %, App 120 · 30 %, Web 70 · 17 %, Geteilter Link 32 · 8 %: 402, 100 %), "Diese Woche" (Sticker-Scans, Spots im STREET DEX, Neue Follower, Neue Follower am Build, Gemerkt, Reaktionen with "Stark 9 · Sauber 6 · Tief 4 · Laut 2", each "Letzte Woche: n"), "Nach Seite" (Dein Profil 40 and lukas.sc\'s real cars with their covers, the R34 88: 128 together) and the privacy line. Desktop: numbers left, lists right. empty = the quiet state (as INS-01-zero); restricted = "Nur für den Besitzer".',
  },
  {
    id: 'INS-01-drop',
    path: '/app/insights',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    ready: '[data-testid="INS-01.delta"]',
    capture: 'viewport',
    p4: { en: true },
    prepare: async (ctx) =>
      stageAccount(
        ctx,
        {
          headline: english(ctx.cell)
            ? 'Your garage was viewed 40 times this week. Last week it was 98.'
            : 'Deine Garage wurde diese Woche 40-mal angesehen. Letzte Woche waren es 98.',
          views: { ...DROP_SERIES.views, delta_percent: -59, trend: 'down' },
          days: DROP_SERIES.days,
          sources: sourcesOf([140, 93, 54, 23], english(ctx.cell) ? 'en' : 'de'),
          sticker_scans: { ...DROP_SERIES.scans, total: 640 },
        },
        { profile: 12, split: [28, 0, 0] },
      ),
    notes:
      'M5.7 a quieter week (10 §16, contract hard rule 3), its numbers adding up as in INS-01: the server\'s neutral sentence ("… 40-mal angesehen. Letzte Woche waren es 98."), then the row of three numbers "AUFRUFE DIESE WOCHE" 40, "LETZTE WOCHE" 98 (INS-01.delta), "AUFRUFE 30 TAGE" 310. No percentage, no "weniger"/"gesunken", no red, no arrow down.',
  },
  {
    id: 'INS-01-zero',
    path: '/app/insights',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    ready: '[data-testid="INS-01.quiet"]',
    capture: 'viewport',
    prepare: async ({ stage }) => {
      const zero = pair(0, 0);
      await stage(ACCOUNT, {
        method: 'GET',
        body: {
          data: account({
            headline: 'Diese Woche noch keine Aufrufe. Teil deinen Build, damit ihn mehr Leute sehen.',
            counting_since: new Date(NOW_MS).toISOString().slice(0, 10),
            views: { this_week: 0, last_week: 0, delta_percent: null, trend: 'same', total_30_days: 0 },
            days: days([], []),
            sources: sourcesOf([0, 0, 0, 0]),
            sticker_scans: null,
            spots: zero,
            follows: { profile: zero, vehicles: zero },
            saves: zero,
            reactions: { ...zero, by_type: [] },
            breakdown: [{ subject: 'profile', vehicle: null, views_this_week: 0 }],
          }),
        },
      });
    },
    notes:
      'M5.7 nothing counted yet (DQ-P5-019): the app\'s own title "Diese Woche noch keine Aufrufe." (title.2), the line about what will show here, then a sample of the chart: "Letzte 30 Tage" with the "Beispiel" badge over a neutral sample curve (no real number, no date axis of zeros), "Profil teilen" (secondary M, share glyph) and the privacy line. Never a grid of zeros.',
  },
  {
    id: 'INS-01-vehicle',
    path: '/app/vehicles/{r34}/insights',
    phase: 3,
    auth: 'member',
    states: ['default', 'error'],
    ready: loadedOr('[data-testid="INS-01.thisWeek"]', 'INS-01.root'),
    capture: 'expanded',
    p4: { en: true },
    prepare: async ({ stage, cell }) => {
      await stage(VEHICLE, {
        method: 'GET',
        // The server's own answer names the car (its id, title and cover); the numbers are the staged ones.
        patch: (/** @type {{ data: Record<string, any> }} */ body) => ({
          data: account({
            scope: 'vehicle',
            vehicle: body.data?.vehicle ?? { id: '', slug: R34_SLUG, full_title: 'Nissan Skyline GT-R R34', cover: null, is_sample: false },
            counting_since: new Date(NOW_MS - 11 * DAY_MS).toISOString().slice(0, 10),
            headline:
              cell.locale === 'en'
                ? 'Your R34 was viewed 88 times this week – 24% more than last week.'
                : 'Dein R34 wurde diese Woche 88-mal angesehen – 24 % mehr als letzte Woche.',
            views: { ...VEHICLE_SERIES.views, delta_percent: 24, trend: 'up' },
            days: VEHICLE_SERIES.days,
            // DQ-P5-018: the car's own sources (they summed to the account's 402 under this car's total).
            sources: sourcesOf([70, 46, 28, 15], cell.locale === 'en' ? 'en' : 'de'),
            sticker_scans: { ...VEHICLE_SERIES.scans, total: VEHICLE_SERIES.scans.total_30_days },
            reactions: { ...account().reactions, by_type: account().reactions.by_type.map((row) => ({ ...row, label: REACTION_LABELS[cell.locale === 'en' ? 'en' : 'de'][row.type] })) },
            follows: { profile: null, vehicles: pair(2, 0) },
            breakdown: [],
          }),
        }),
      });
    },
    notes:
      'M5.7 INS-01 from the owner\'s R34 (`vehicles/{id}/insights`): the car\'s name as the sub-line, the row of three numbers 88 · "LETZTE WOCHE" 71 · "AUFRUFE 30 TAGE" 159 (counting began 11 days ago, so the 30 days are the 11 counted: 88 + 71), "Gezählt wird seit dem …" under the chart (the line starts there), "Woher die Aufrufe kommen" summing to 159 (Sticker-Scan 70 · 44 %, App 46 · 29 %, Web 28 · 18 %, Geteilter Link 15 · 9 %), sticker scans 15 · 8 · 23, no "Neue Follower" of the profile, no "Nach Seite".',
  },
  {
    id: 'INS-01-viewas',
    path: '/app/insights',
    phase: 3,
    auth: 'viewas',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    ready: '[data-testid="INS-01.restricted"]',
    capture: 'viewport',
    notes: 'M5.7 staff in view-as (D-4, ADR-441): the server\'s 403 view_as_read_only as "Nur für den Besitzer", lock glyph, under the view-as banner. No number reaches the page.',
  },
  {
    id: 'PROF-01-insights',
    path: '/app/profile',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="PROF-01.insights"]',
    capture: 'viewport',
    walk: async ({ page }) => {
      await page.getByTestId('PROF-01.shortcuts').scrollIntoViewIfNeeded();
    },
    notes: 'M5.7 PROF-01: "Statistiken" (chart-bar glyph, "Aufrufe, Scans und neue Follower") leads the one group with "Mein Dex" and "Mein Wrapped". No number on the profile.',
  },
  {
    id: 'VEH-01-goal',
    path: `/app/v/${R34_SLUG}?section=overview`,
    phase: 3,
    auth: 'member-kenji',
    states: ['default'],
    ready: '[data-testid="VEH-01.goal"]',
    capture: 'viewport',
    prepare: async ({ stage }) => {
      await stage(PUBLIC_R34, {
        method: 'GET',
        patch: (/** @type {{ data: Record<string, any> }} */ body) => {
          // The season after the app's year (the cell's fixed clock), not the machine's.
          const season = new Date(NOW_MS).getUTCFullYear() + 1;
          body.data.build_goal = { season, label: `Ziel: Saison ${season}`, passed: false };
          return body;
        },
      });
    },
    walk: async ({ page }) => {
      // DQ-P5-021: scrollIntoViewIfNeeded on the FlashList row stopped with the line at the window's foot, under the floating tab bar
      // and owner capsule (phones) or below the fold (desktop), so no cell showed it. Start on the settled page (the deep link's jump to
      // Überblick has landed, as routes-m53.mjs `settled`), then put the line in the middle of the window and wait until it is there.
      // The deep link holds Überblick and lands on it again whenever the geometry changes (useSectionScroll: the index pinning as the
      // page moves), until the reader takes over with a wheel, touch or key on the list: so a wheel on the scroller first, as a reader's.
      await page.locator('[data-testid="VEH-01.body.settled"] [data-testid="VEH-01.sections.overview"][aria-current="location"]').first().waitFor({ timeout: 30_000 });
      const goal = page.locator('[data-testid="VEH-01.goal"]:visible').first();
      await goal.evaluate((element) => {
        let scroller = element.parentElement;
        while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
        (scroller ?? document.scrollingElement)?.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true }));
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      });
      await goal.evaluate(
        (element) =>
          new Promise((resolve, reject) => {
            // Counted in frames: the cell's clock is fixed (context.clock), so time read in the page does not move.
            let frames = 0;
            const check = () => {
              const box = element.getBoundingClientRect();
              if (box.top >= window.innerHeight * 0.2 && box.bottom <= window.innerHeight * 0.8) resolve(undefined);
              else if (++frames > 300) reject(new Error(`VEH-01.goal not in the middle of the window: ${Math.round(box.top)}–${Math.round(box.bottom)} of ${window.innerHeight}`));
              else requestAnimationFrame(check);
            };
            check();
          }),
      );
      await page.mouse.move(0, 0);
    },
    notes: 'M5.7 a visitor (kenji.r34) on lukas.sc\'s R34: "Ziel: Saison 2027" (flag-checkered, callout, text.secondary) under Build-Fortschritt. No countdown, no owner rows, no numbers.',
  },
  {
    id: 'GAR-02-goal',
    path: '/app/garage/{r34}?section=overview',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    ready: '[data-testid="GAR-02.ownerRows"]',
    capture: 'viewport',
    p4: { en: true, black: true },
    prepare: async ({ stage }) => {
      await stage(PUBLIC_R34, {
        method: 'GET',
        patch: (/** @type {{ data: Record<string, any> }} */ body) => {
          const season = new Date().getFullYear() + 1;
          body.data.build_goal = { season, label: `Ziel: Saison ${season}`, passed: false };
          return body;
        },
      });
      await stage(VEHICLE, { method: 'GET', body: { data: account({ scope: 'vehicle', breakdown: [], views: { this_week: 88, last_week: 71, delta_percent: 24, trend: 'up', total_30_days: 190 } }) } });
    },
    walk: async ({ page }) => {
      await page.getByTestId('GAR-02.ownerRows').scrollIntoViewIfNeeded();
    },
    notes: 'M5.7 the owner under Build-Fortschritt: one grouped list "Build-Ziel · Saison 2027 ›" and "Statistiken · 88 Aufrufe diese Woche ›" (to INS-01 of this car).',
  },
  {
    id: 'GAR-02-goalSheet',
    path: '/app/garage/{r34}?section=overview',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    ready: '[data-testid="GAR-02.goalSheet.save"]',
    capture: 'viewport',
    p4: { en: true, black: true },
    walk: async ({ page }) => {
      await page.getByTestId('GAR-02.goal').scrollIntoViewIfNeeded();
      await page.getByTestId('GAR-02.goal').click();
    },
    notes: 'M5.7 "Build-Ziel" sheet: the intro (no reminder, no countdown), the seasons from this year to ten years ahead and "Kein Ziel" as radio rows, "Speichern" (primary, disabled until a choice changes) in the sticky footer. Nothing is saved by the cell.',
  },
  {
    id: 'SET-09-engagement',
    path: '/app/settings/notifications',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    fs2: true,
    ready: '[data-testid="SET-09.push.weekly_recap"]',
    capture: 'expanded',
    p4: { en: true, black: true },
    prepare: async ({ stage }) => {
      await stage(SETTINGS, {
        method: 'GET',
        patch: (/** @type {{ data: Record<string, any> }} */ body) => {
          body.data.notification_prefs.types.plan_due ??= { push: true, web_push: true };
          body.data.notification_prefs.types.weekly_recap ??= { push: true, web_push: true, email: true };
          return body;
        },
      });
    },
    notes:
      'M5.7 SET-09 with the server\'s notification part (types staged until it lists them): "Build-Erinnerungen" (Zielmonat einer Mod, at most once a week) and "Wochenrückblick" (push + "per E-Mail", Sundays 18 Uhr, skipped when nothing happened), each its own switch, on by default. Without the types the groups are absent.',
  },
];
