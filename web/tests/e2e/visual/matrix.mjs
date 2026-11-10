// Pure planning logic of the screenshot matrix, docs/07_QA_AND_RELEASE.md section 3.
import { AUTH_KINDS } from '../support/auth.mjs';
import { STAGE_FIXTURE_NAMES } from '../support/stage-fixtures.mjs';
import { THEMES } from '../support/tokens.mjs';

export const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
export const ADMIN_THEMES = ['carbon', 'light'];
const ADMIN_WIDTHS = [1280, 1440];
/** ADR-212: the 200 % cell renders the 1280×800 window at half its CSS size, the browser-zoom equivalent of WCAG 1.4.4. */
export const ADMIN_ZOOM = 2;
const ADMIN_ZOOM_WIDTH = 1280;
const PRIMARY_WIDTH = 390;
/** The tallest picture of an expanded capture (the runner's ceiling, and the upper bound of a route's `maxHeight`). */
export const MAX_EXPANDED_HEIGHT = 12000;

/**
 * @typedef {object} RouteDef
 * @property {string} id
 * @property {string} path
 * @property {number} phase
 * @property {string} auth one of AUTH_KINDS (support/auth.mjs)
 * @property {string[]} states
 * @property {string} [ready]
 * @property {string} [notes]
 * @property {number[]} [viewports]
 * @property {'viewport'|'page'|'expanded'} [capture]
 * @property {number} [maxHeight] with capture 'expanded': the picture's height at most (CSS px), for an endless list
 * @property {'planned'} [status]
 * @property {boolean} [qaContract]
 * @property {number} [expectStatus] HTTP status the page answers by design (WEB-06: 410, 404); without it, 400 and up fail
 * @property {boolean} [hostDependent] the picture shows the server's host (a QR code of APP_URL): baselines only on the baseline host
 * @property {boolean} [volatile] ADR-223: the picture is the platform's live activity (ADM-06, ADM-08, ADM-44): audited, never pixel-compared
 * @property {boolean} [liveChrome] ADR-257, only beside `volatile`: the forced states still show the live page around them (the list
 *   behind a dialog, the record header and activity, the run time of the last health run), so they are volatile too
 * @property {string} [fixture] a stage fixture (support/stage-fixtures.mjs): in place only while this route's cells run, after all others
 */

/** ADR-223: forced states that render a fixture instead of live data, so a volatile route's cells in them are still compared. */
export const FIXTURE_STATES = ['loading', 'error', 'empty'];

/**
 * Whether a cell of a route is volatile (ADR-223): the route is, and the cell does not show one of the fixture states, or the route's
 * forced states still show live data around them (`liveChrome`, ADR-257).
 * @param {{volatile?: boolean, liveChrome?: boolean}} route
 * @param {{state?: string}} cell
 */
export const isVolatileCell = (route, cell) =>
  route.volatile === true && (route.liveChrome === true || !FIXTURE_STATES.includes(cell.state ?? 'default'));

/** `{name}` in a route path: a seeded id that is new after every seed, filled in per run (support/garage.mjs demoIds). */
const PATH_TOKEN = /\{([a-zA-Z0-9]+)\}/g;

/** @param {string} path */
export const pathTokens = (path) => [...path.matchAll(PATH_TOKEN)].map((m) => /** @type {string} */ (m[1]));

/**
 * Fills the `{name}` tokens of a path. An unknown or empty value throws: the route would photograph a not-found page.
 * @param {string} path
 * @param {Record<string, string|undefined>} values
 */
export function resolvePath(path, values) {
  return path.replace(PATH_TOKEN, (_, name) => {
    const value = values[name];
    if (!value) throw new Error(`No value for {${name}} in ${path}`);
    return encodeURIComponent(value);
  });
}

/**
 * Whether the answer of a page is the one the route expects: its `expectStatus`, or below 400.
 * @param {RouteDef} route
 * @param {number} status
 */
export const isExpectedStatus = (route, status) => (route.expectStatus === undefined ? status < 400 : status === route.expectStatus);

/**
 * @typedef {object} Cell
 * @property {string} routeId
 * @property {string} name file name without extension
 * @property {{width:number,height:number}} viewport
 * @property {string} theme
 * @property {'de'|'en'} locale
 * @property {number} fontScale
 * @property {string} state
 * @property {number} [zoom] browser zoom of an admin cell (ADR-212): `viewport` is then the CSS viewport, the name keeps the window
 */

/** @param {number} width */
const viewportOf = (width) => {
  const v = VIEWPORTS.find((x) => x.width === width);
  if (!v) throw new Error(`Unknown viewport width ${width}`);
  return v;
};

/** @param {RouteDef} route */
export const isAdminRoute = (route) => route.path === '/admin' || route.path.startsWith('/admin/');
/** @param {RouteDef} route */
export const isSpaRoute = (route) => route.path === '/app' || route.path.startsWith('/app/');

/**
 * `<ROUTE-ID>__<w>x<h>__<theme>__<locale>[__fs2][__zoom2][__<state>]`; with a zoom, `<w>x<h>` is the window, not the CSS viewport.
 * @param {string} routeId
 * @param {{viewport:{width:number,height:number},theme:string,locale:string,fontScale?:number,state?:string,zoom?:number}} c
 */
export function cellName(routeId, { viewport, theme, locale, fontScale = 1, state = 'default', zoom = 1 }) {
  let name = `${routeId}__${viewport.width * zoom}x${viewport.height * zoom}__${theme}__${locale}`;
  if (fontScale !== 1) name += `__fs${fontScale}`;
  if (zoom !== 1) name += `__zoom${zoom}`;
  if (state !== 'default') name += `__${state}`;
  return name;
}

/**
 * @param {RouteDef} route
 * @param {'module'|'phase'} tier
 * @returns {Cell[]}
 */
export function planRoute(route, tier) {
  /** @type {Map<string, Cell>} */
  const cells = new Map();
  const add = (
    /** @type {number} */ width,
    /** @type {string} */ theme,
    /** @type {'de'|'en'} */ locale,
    /** @type {number} */ fontScale = 1,
    /** @type {string} */ state = 'default',
  ) => {
    if (route.viewports && !route.viewports.includes(width)) return;
    const viewport = viewportOf(width);
    const name = cellName(route.id, { viewport, theme, locale, fontScale, state });
    cells.set(name, { routeId: route.id, name, viewport, theme, locale, fontScale, state });
  };

  if (isAdminRoute(route)) {
    // ADR-212: a desktop pointer tool, Carbon and Hell only, no phone widths and no font-scale cell (the zoom cell takes its place).
    if (tier === 'phase') {
      for (const width of ADMIN_WIDTHS) for (const theme of ADMIN_THEMES) add(width, theme, 'de');
      add(1440, 'carbon', 'en');
      const zoomWindow = viewportOf(ADMIN_ZOOM_WIDTH);
      if (!route.viewports || route.viewports.includes(ADMIN_ZOOM_WIDTH)) {
        const viewport = { width: zoomWindow.width / ADMIN_ZOOM, height: zoomWindow.height / ADMIN_ZOOM };
        const name = cellName(route.id, { viewport, theme: 'carbon', locale: 'de', zoom: ADMIN_ZOOM });
        cells.set(name, { routeId: route.id, name, viewport, theme: 'carbon', locale: 'de', fontScale: 1, state: 'default', zoom: ADMIN_ZOOM });
      }
    } else {
      add(1280, 'carbon', 'de');
      add(1440, 'light', 'de');
      add(1440, 'carbon', 'en');
    }
    // The states a route lists (qaState), at 1280 Carbon de in both tiers: the admin has few routes, and design QA reviews a module's
    // states with the module, not only at the gate.
    for (const state of route.states) add(1280, 'carbon', 'de', 1, state);
  } else if (tier === 'module') {
    add(390, 'carbon', 'de');
    add(360, 'light', 'de');
    add(430, 'black', 'en');
    add(1280, 'carbon', 'de');
  } else {
    for (const { width } of VIEWPORTS) for (const theme of THEMES) add(width, theme, 'de');
    for (const theme of THEMES) add(PRIMARY_WIDTH, theme, 'en');
    add(PRIMARY_WIDTH, 'carbon', 'de', 2);
    for (const state of route.states) add(PRIMARY_WIDTH, 'carbon', 'de', 1, state);
  }
  if (cells.size === 0) {
    throw new Error(`Route ${route.id}: viewports ${String(route.viewports)} leave nothing to capture in tier ${tier}`);
  }
  return [...cells.values()];
}

/**
 * Takes the items of every group in turn (round robin), each group in its own order: A1 B1 C1 A2 B2 A3.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} groupOf
 * @returns {T[]}
 */
export function interleaveByRoute(items, groupOf) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const item of items) {
    const key = groupOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const queues = [...groups.values()];
  /** @type {T[]} */
  const out = [];
  for (let i = 0; out.length < items.length; i++) for (const q of queues) if (i < q.length) out.push(/** @type {T} */ (q[i]));
  return out;
}

/**
 * The order of a run: first every job without a stage fixture, then one stage per fixture in the order the jobs first name it, each
 * keeping the jobs' order. A stage fixture is in place only while its own stage runs (run.mjs).
 * @template T
 * @param {T[]} jobs
 * @param {(job: T) => string|undefined} fixtureOf
 * @returns {{fixture: string|null, jobs: T[]}[]} without empty stages
 */
export function stagesOf(jobs, fixtureOf) {
  /** @type {Map<string|null, T[]>} */
  const stages = new Map([[null, []]]);
  for (const job of jobs) {
    const fixture = fixtureOf(job) ?? null;
    const stage = stages.get(fixture) ?? [];
    stage.push(job);
    stages.set(fixture, stage);
  }
  return [...stages.entries()].filter(([, stage]) => stage.length > 0).map(([fixture, stage]) => ({ fixture, jobs: stage }));
}

/**
 * @param {RouteDef[]} routes
 * @returns {string[]} problems; empty when the registry is valid
 */
export function validateRoutes(routes) {
  const problems = [];
  const seen = new Set();
  for (const r of routes) {
    // ADM-DEV: the admin gallery has no register number (M3.1 brief), like DEV-01 of the app. VIEWAS-<screen>: the view-as tab of
    // m3.2-contract §3, whose testIDs carry `VIEWAS.` as their route ID; it has no register number either, only named cells.
    // CONSENT: the re-consent sheet (m3.5-contract §3), an overlay over any route with its own testIDs (`CONSENT.`), no register number.
    // ADM-F<n>: the flagged memberships scaffold (04_SCREEN_REGISTER §5 numbers them F1, F2).
    if (!/^(?:(?:[A-Z]+-(?:\d+|F\d+|DEV(?=-|$))|VIEWAS-[A-Z0-9]+)[A-Za-z0-9-]*|CONSENT)$/.test(r.id ?? '')) problems.push(`Invalid route id "${r.id}"`);
    if (seen.has(r.id)) problems.push(`Duplicate route id ${r.id}`);
    seen.add(r.id);
    if (!r.path?.startsWith('/')) problems.push(`${r.id}: path must start with /`);
    if (![1, 2, 3].includes(r.phase)) problems.push(`${r.id}: phase must be 1, 2 or 3`);
    if (!AUTH_KINDS.includes(r.auth)) problems.push(`${r.id}: unknown auth "${r.auth}"`);
    if (!Array.isArray(r.states) || !r.states.includes('default')) problems.push(`${r.id}: states must include "default"`);
    if (!r.ready) problems.push(`${r.id}: needs a "ready" selector`);
    if (r.status !== undefined && r.status !== 'planned') problems.push(`${r.id}: unknown status "${r.status}"`);
    if (r.hostDependent !== undefined && typeof r.hostDependent !== 'boolean') problems.push(`${r.id}: hostDependent must be true or false`);
    if (r.volatile !== undefined && typeof r.volatile !== 'boolean') problems.push(`${r.id}: volatile must be true or false`);
    if (r.liveChrome !== undefined && (r.liveChrome !== true || r.volatile !== true)) problems.push(`${r.id}: liveChrome is only true, and only beside volatile`);
    if (r.fixture !== undefined && !STAGE_FIXTURE_NAMES.includes(r.fixture)) problems.push(`${r.id}: unknown stage fixture "${r.fixture}"`);
    if (r.expectStatus !== undefined && !(Number.isInteger(r.expectStatus) && r.expectStatus >= 100 && r.expectStatus <= 599)) {
      problems.push(`${r.id}: expectStatus must be an HTTP status code`);
    }
    // DQ-676: an expanded capture grows the viewport until the drawer no longer scrolls, so a qaScroll=end cell would be its
    // default cell again (ADM-40-roles-end was pixel-identical). The end of a drawer is only on a picture of the real viewport.
    if (/[?&]qaScroll=end\b/.test(String(r.path)) && r.capture === 'expanded') {
      problems.push(`${r.id}: qaScroll=end needs capture 'viewport' (an expanded capture never scrolls)`);
    }
    if (r.maxHeight !== undefined) {
      if (r.capture !== 'expanded') problems.push(`${r.id}: maxHeight needs capture 'expanded'`);
      if (!(Number.isInteger(r.maxHeight) && r.maxHeight >= 1000 && r.maxHeight <= MAX_EXPANDED_HEIGHT)) {
        problems.push(`${r.id}: maxHeight must be a whole number from 1000 to ${MAX_EXPANDED_HEIGHT}`);
      }
    }
  }
  return problems;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} display order of cell names for contact sheets
 */
export function compareCellNames(a, b) {
  const parse = (/** @type {string} */ n) => {
    const [, size = '', theme = '', locale = '', ...rest] = n.split('__');
    const fs = rest.some((p) => /^(fs|zoom)\d/.test(p)) ? 1 : 0;
    const state = rest.find((p) => !/^(fs|zoom)\d/.test(p)) ?? '';
    return [parseInt(size, 10), THEMES.indexOf(theme), locale, fs, state];
  };
  const pa = parse(a);
  const pb = parse(b);
  // Basics first: de before en, 1x before fs2, default before the state variants.
  const rank = (/** @type {(string|number)[]} */ p) => (p[2] === 'en' ? 1 : 0) + Number(p[3]) * 2 + (p[4] ? 4 : 0);
  return rank(pa) - rank(pb) || Number(pa[0]) - Number(pb[0]) || Number(pa[1]) - Number(pb[1]) || String(pa[4]).localeCompare(String(pb[4]));
}
