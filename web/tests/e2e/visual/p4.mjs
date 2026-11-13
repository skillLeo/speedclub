// Planning of the Phase 4 visual tier, `--tier=p4` (docs/09_PREMIUM_2_0.md §14.1). The module and phase tiers (matrix.mjs planRoute)
// are not touched by anything here.
//
// Per route, by kind (member = `/app…`, admin = `/admin…`, public = every other page):
//   devices   member and public: iphone15pro, pixel8, desktop1280, desktop1440; + iphonese for flagship screens and forms;
//             + tablet for the TABLET list. Admin (ADR-212): desktop1280 and desktop1440 only.
//   themes    Carbon and Hell on every cell, + Schwarz on flagship screens. Admin: Carbon and Hell (no black theme, ADR-212).
//   locale    DE on every cell; EN (Carbon) only for EN12, at iphone15pro and desktop1440.
//   200 %     `qaFontScale=2` (the harness's font-scale override) at iphone15pro and desktop1440, Carbon DE, for flagship screens and
//             forms. Admin: the zoom cell of ADR-212 instead (the 1280×800 window at a 640×400 CSS viewport), Carbon DE, as the phase
//             tier takes it today.
//   specimen  SPECIMEN gallery routes (DQ-909): + iphone15pro Carbon DE at 200 % and + iphone15pro Schwarz DE.
//   states    the forced states the route lists, once, at the primary cell: iphone15pro Carbon DE (admin: desktop1280 Carbon DE).
//             When the route's `viewports` exclude that device, the first device it allows takes them (desktop1280 for a
//             desktop-only member route), so a state is never dropped.
// A route's `viewports` (widths of the module/phase matrix) keeps a desktop device whose width it lists, the phones when it lists a
// width below 600 and the tablet when it lists one from 600 to 1199.
// Every p4 cell is captured with reducedMotion 'reduce' (run.mjs emulates it on every cell) and `qaMotion=off`.
import { devices as playwrightDevices } from '@playwright/test';
import { THEMES } from '../support/tokens.mjs';
import { ADMIN_THEMES, ADMIN_ZOOM, cellName, isAdminRoute, isSpaRoute } from './matrix.mjs';
import { P4_DEVICES, P4_DEVICE_IDS, p4Device } from './p4-devices.mjs';
import { isEn12, isFlagship, isForm, isSpecimen, isTablet } from './p4-sets.mjs';

/** @typedef {import('./matrix.mjs').RouteDef} RouteDef */
/** @typedef {import('./matrix.mjs').Cell} Cell */
/** @typedef {import('./p4-devices.mjs').P4Device} P4Device */

/** Carbon and Hell on every cell. */
export const P4_THEMES = ['carbon', 'light'];
/** Schwarz, in addition, on flagship screens. */
export const P4_FLAGSHIP_THEME = 'black';
/** The cell of a member or public route that takes its forced states. */
export const P4_PRIMARY_DEVICE = 'iphone15pro';
/** The cell of an admin route that takes its forced states (and its zoom cell): its narrowest window, as in the phase tier. */
export const P4_ADMIN_PRIMARY_DEVICE = 'desktop1280';
/** The device of a SPECIMEN route's extra cells (200 % Carbon and Schwarz). */
export const P4_SPECIMEN_DEVICE = 'iphone15pro';
/** Where EN and 200 % text are taken. */
export const P4_EN_DEVICES = ['iphone15pro', 'desktop1440'];
export const P4_FONT_SCALE_DEVICES = ['iphone15pro', 'desktop1440'];
export const P4_LOCALES = ['de', 'en'];

/** @param {RouteDef} route @returns {'member'|'admin'|'public'} */
export const routeKind = (route) => (isAdminRoute(route) ? 'admin' : isSpaRoute(route) ? 'member' : 'public');

/**
 * @param {RouteDef} route
 * @param {P4Device} device
 */
function deviceAllowed(route, device) {
  const widths = route.viewports;
  if (!widths) return true;
  if (device.kind === 'desktop') return widths.includes(device.viewport.width);
  if (device.kind === 'phone') return widths.some((w) => w < 600);
  return widths.some((w) => w >= 600 && w < 1200);
}

/**
 * The device whose Carbon DE cell takes a route's forced states: iphone15pro (admin: desktop1280), or, when the route's
 * `viewports` exclude it, the first device in run order the route allows.
 * @param {RouteDef} route
 * @returns {string|null} null when the route allows no device at all
 */
export function p4PrimaryDeviceOf(route) {
  const allowed = p4DevicesOf(route).filter((id) => deviceAllowed(route, p4Device(id)));
  const preferred = routeKind(route) === 'admin' ? P4_ADMIN_PRIMARY_DEVICE : P4_PRIMARY_DEVICE;
  return allowed.includes(preferred) ? preferred : (allowed[0] ?? null);
}

/**
 * The devices a route is captured on in the p4 tier, in run order.
 * @param {RouteDef} route
 */
export function p4DevicesOf(route) {
  if (routeKind(route) === 'admin') return ['desktop1280', 'desktop1440'];
  const small = isFlagship(route) || isForm(route);
  return P4_DEVICE_IDS.filter((id) => {
    if (id === 'iphonese') return small;
    if (id === 'tablet') return isTablet(route);
    return true;
  });
}

/**
 * Every p4 cell of a route (before the run's filters).
 * @param {RouteDef} route
 * @returns {Cell[]}
 */
export function planP4Route(route) {
  const kind = routeKind(route);
  const flagship = kind !== 'admin' && isFlagship(route);
  const large = kind !== 'admin' && (flagship || isForm(route));
  const deviceIds = p4DevicesOf(route);
  const wanted = kind === 'admin' ? ADMIN_THEMES : flagship ? [...P4_THEMES, P4_FLAGSHIP_THEME] : P4_THEMES;
  const themes = THEMES.filter((t) => wanted.includes(t));

  /** @type {Map<string, Cell>} */
  const cells = new Map();
  const add = (
    /** @type {string} */ deviceId,
    /** @type {string} */ theme,
    /** @type {'de'|'en'} */ locale,
    /** @type {number} */ fontScale = 1,
    /** @type {string} */ state = 'default',
    /** @type {number} */ zoom = 1,
  ) => {
    const device = p4Device(deviceId);
    if (!deviceIds.includes(deviceId) || !deviceAllowed(route, device)) return;
    const viewport = zoom === 1 ? device.viewport : { width: device.viewport.width / zoom, height: device.viewport.height / zoom };
    const name = cellName(route.id, { viewport, theme, locale, fontScale, state, zoom, device: deviceId });
    cells.set(name, { routeId: route.id, name, viewport, theme, locale, fontScale, state, device: deviceId, ...(zoom === 1 ? {} : { zoom }) });
  };

  for (const deviceId of deviceIds) for (const theme of themes) add(deviceId, theme, 'de');
  if (kind !== 'admin' && isEn12(route)) for (const deviceId of P4_EN_DEVICES) add(deviceId, 'carbon', 'en');
  if (large || (kind !== 'admin' && route.fs2 === true)) for (const deviceId of P4_FONT_SCALE_DEVICES) add(deviceId, 'carbon', 'de', 2);
  if (kind !== 'admin' && isSpecimen(route)) {
    add(P4_SPECIMEN_DEVICE, 'carbon', 'de', 2);
    add(P4_SPECIMEN_DEVICE, P4_FLAGSHIP_THEME, 'de');
  }
  if (kind === 'admin') {
    // ADR-212: the admin 200 % zoom cell sits on the 1280 window. Like the forced states (SF-2), a route that excludes 1280
    // gets it on the first desktop window it allows; it is never dropped, and a route without any desktop window is refused.
    const zoomDevice = [P4_ADMIN_PRIMARY_DEVICE, 'desktop1440'].find((id) => deviceAllowed(route, p4Device(id)));
    if (zoomDevice === undefined) {
      throw new Error(`Route ${route.id}: tier p4 has no desktop window for the admin 200 % zoom cell (ADR-212); viewports ${String(route.viewports)}`);
    }
    add(zoomDevice, 'carbon', 'de', 1, 'default', ADMIN_ZOOM);
  }
  const primary = p4PrimaryDeviceOf(route);
  if (primary !== null) for (const state of route.states) add(primary, 'carbon', 'de', 1, state);

  if (cells.size === 0) throw new Error(`Route ${route.id}: viewports ${String(route.viewports)} leave nothing to capture in tier p4`);
  return [...cells.values()];
}

/**
 * @typedef {object} P4Filters
 * @property {string[]|null} devices
 * @property {string[]|null} themes
 * @property {string[]|null} locales
 * @property {string[]|null} states `default` = the cells without a forced state (1×, 200 %, EN and zoom cells alike)
 * @property {string[]|null} [fontScales] `1`, `2`: the text scale (an admin zoom cell has scale 1)
 */

/**
 * The cells a run keeps under `--devices`, `--themes`, `--locales` and `--states`; a filter that is null keeps everything.
 * @param {Cell[]} cells
 * @param {P4Filters} filters
 */
export function filterP4Cells(cells, { devices, themes, locales, states, fontScales = null }) {
  return cells.filter(
    (c) =>
      (!devices || devices.includes(/** @type {string} */ (c.device))) &&
      (!themes || themes.includes(c.theme)) &&
      (!locales || locales.includes(c.locale)) &&
      (!states || states.includes(c.state)) &&
      (!fontScales || fontScales.includes(String(c.fontScale))),
  );
}

/**
 * Checks the values of the p4 filters. Unknown values are an error, never a filter that silently keeps nothing.
 * @param {P4Filters} filters
 * @param {RouteDef[]} registry
 * @returns {string[]} problems
 */
export function validateP4Filters(filters, registry) {
  const problems = [];
  const known = {
    devices: P4_DEVICE_IDS,
    themes: THEMES,
    locales: P4_LOCALES,
    states: [...new Set(['default', ...registry.flatMap((r) => r.states ?? [])])],
    fontScales: ['1', '2'],
  };
  for (const [key, values] of Object.entries(filters)) {
    if (values === null || values === undefined) continue;
    const allowed = known[/** @type {keyof typeof known} */ (key)];
    const option = key === 'fontScales' ? 'font-scales' : key;
    if (values.length === 0) problems.push(`--${option} is empty`);
    for (const v of values) if (!allowed.includes(v)) problems.push(`--${option}: unknown "${v}" (known: ${allowed.join(', ')})`);
  }
  return problems;
}

/**
 * Browser context options of a p4 device, beside the harness's own (support/qa.mjs contextOptions): the descriptor's user agent,
 * isMobile and hasTouch with this device's viewport (and screen). Desktop devices add nothing: they are the module/phase context.
 * A descriptor the installed Playwright no longer has is an error, never a silent fallback to another device.
 * @param {string} deviceId
 * @param {Record<string, any>} [descriptors] Playwright's `devices`
 */
export function p4ContextOptions(deviceId, descriptors = playwrightDevices) {
  const device = p4Device(deviceId);
  if (device.descriptor === null) return {};
  const descriptor = descriptors[device.descriptor];
  if (!descriptor) throw new Error(`Playwright has no device descriptor "${device.descriptor}" for p4 device ${device.id}`);
  if (descriptor.defaultBrowserType !== device.engine) {
    throw new Error(`Descriptor "${device.descriptor}" is for ${descriptor.defaultBrowserType}, p4 device ${device.id} runs on ${device.engine}`);
  }
  return {
    userAgent: /** @type {string} */ (descriptor.userAgent),
    isMobile: /** @type {boolean} */ (descriptor.isMobile),
    hasTouch: /** @type {boolean} */ (descriptor.hasTouch),
    viewport: { ...device.viewport },
    screen: { ...device.viewport },
  };
}

/**
 * The cell's planning dimensions, for `--plan` and the run summary.
 * @param {Cell} cell
 */
export function cellDimensions(cell) {
  const device = cell.device ?? `${cell.viewport.width * (cell.zoom ?? 1)}x${cell.viewport.height * (cell.zoom ?? 1)}`;
  return {
    device,
    theme: cell.theme,
    locale: cell.locale,
    fontScale: cell.zoom ? `zoom${cell.zoom}` : `fs${cell.fontScale}`,
    state: cell.state,
  };
}

/**
 * Text of `--plan`: the cell count per dimension and per combination.
 * @param {Cell[]} cells
 * @returns {string[]} lines
 */
export function planLines(cells) {
  const dims = cells.map(cellDimensions);
  const order = (/** @type {string} */ key, /** @type {string} */ value) => {
    if (key === 'device') {
      const i = P4_DEVICE_IDS.indexOf(value);
      return i >= 0 ? String(i).padStart(4, '0') : `9${value.padStart(12, '0')}`;
    }
    if (key === 'theme') return String(THEMES.indexOf(value));
    if (key === 'state') return value === 'default' ? '' : value;
    return value;
  };
  const lines = [];
  for (const key of /** @type {const} */ (['device', 'theme', 'locale', 'fontScale', 'state'])) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const d of dims) counts.set(d[key], (counts.get(d[key]) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => order(key, a[0]).localeCompare(order(key, b[0])));
    lines.push(`  per ${key.padEnd(9)} ${sorted.map(([v, n]) => `${v} ${n}`).join(' · ')}`);
  }
  /** @type {Map<string, {d: ReturnType<typeof cellDimensions>, n: number}>} */
  const combos = new Map();
  for (const d of dims) {
    const key = [d.device, d.theme, d.locale, d.fontScale, d.state].join('|');
    const entry = combos.get(key) ?? { d, n: 0 };
    entry.n++;
    combos.set(key, entry);
  }
  const sortKey = (/** @type {ReturnType<typeof cellDimensions>} */ d) =>
    [order('device', d.device), order('state', d.state), d.locale, d.fontScale, order('theme', d.theme)].join('|');
  lines.push('  device        theme   locale fontScale state        cells');
  for (const { d, n } of [...combos.values()].sort((a, b) => sortKey(a.d).localeCompare(sortKey(b.d)))) {
    lines.push(`  ${d.device.padEnd(13)} ${d.theme.padEnd(7)} ${d.locale.padEnd(6)} ${d.fontScale.padEnd(9)} ${d.state.padEnd(12)} ${String(n).padStart(5)}`);
  }
  lines.push(`  total ${cells.length}`);
  return lines;
}

export { P4_DEVICES, P4_DEVICE_IDS };
