#!/usr/bin/env node
// Visual matrix runner, docs/07_QA_AND_RELEASE.md section 3.
//   npm --prefix web run visual -- --tier=module --routes=HOME-01,DISC-01
//   npm --prefix web run visual -- --tier=phase --phase=1   (--phase=N: every route of phases 1..N, into phase-N/)
//   npm --prefix web run visual -- --tier=p4 --capture-only --states=default   (Phase 4 matrix, 09 §14.1; p4.mjs, p4-sets.mjs)
// A route's `{name}` path tokens are seeded ids read once per run (support/path-tokens.mjs), and `expectStatus` lets a
// page answer the 4xx it has by design (WEB-06).
// Options: --tier=module|phase|p4  --routes=ID,ID  --phase=N  --update-baselines  --resume
//          --workers=N  --fail-on=high|medium  --dry-run  --out=DIR  --baselines=DIR
//          --device-scale=2 or --scale=2 (device pixels for pictures outside the gate, e.g. the client preview; needs --out)
//          --plan (no browser: the planned cell count per device/theme/locale/fontScale/state of the tier and routes)
//          p4 only: --devices=iphone15pro,iphonese,pixel8,tablet,desktop1280,desktop1440  --themes=carbon,black,light
//          --locales=de,en  --states=default[,loading,…]  --font-scales=1[,2]  --capture-only (audit findings are reported in the summary, not failed on;
//          capture failures, picture-integrity findings (INTEGRITY_CHECKS), baseline mismatches and a changed export still fail). p4 writes into docs/reports/visual/p4/ (or --out)
//          and compares with tests/e2e/__screenshots__/p4/.
//          --routes-file=FILE.json (other registry, for the harness self-test)  --ready-timeout=MS
//          --limits-file=FILE.json ({routes, config} as artisan gives them, instead of asking artisan; for the harness self-test)
//          --cell-timeout=MS (watchdog of one attempt after its rate-limit room, default 120000)
//          --idle-timeout=MS (the whole run aborts when no cell finished for this long, default 600000)
// Failure guards (a hang must never stall a gate): an attempt that outlives --cell-timeout fails with the step it was in, and
// its browser is closed (killed if closing hangs) and started again; a run in which no cell finished for --idle-timeout aborts
// with every worker's cell and step. Progress goes out every 10 cells and as a heartbeat every minute.
// Exit code 0 only without capture failures, High violations, baseline mismatches and refused baselines.
//
// Throughput design (measured on the skeleton, 130 cells, while other work kept the CPU at 80-100 %):
//   one browser, fresh context per cell   73-150 screens/min
//   one browser per worker, kept page     215-235 screens/min (chosen; screenshots byte-identical)
// Creating a page costs more than everything else, and request interception disables the HTTP cache.
// So each worker keeps one browser and one page per locale + auth, third parties are blocked at the
// resolver instead of by interception, and isolation comes from clearing storage between cells.
// Stage fixtures (support/stage-fixtures.mjs): a route that names `fixture` shows data every viewer would see (a published announcement,
// a re-consent version, support tickets in the staff queue). Its cells run after all others, one fixture at a time, with the fixture in
// place only for them; it is removed after its stage, and on exit or interruption too.
// Rate limits: every request comes from one address, so the runner paces itself under the server's own limits
// (rate-budget.mjs) and takes the cells of all routes in turn. A cell that still gets a 429 fails: its screen would
// show an error state where data belongs (the Mac run of 2026-11-06 photographed SET-17's error 23 times as "clean").
import { availableParallelism } from 'node:os';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, webkit } from '@playwright/test';
import { runDomAudit } from '../support/dom-audit.mjs';
import { applyAuth, authLease } from '../support/auth.mjs';
import {
  BASE_URL,
  EXPORT_CHANGED_MESSAGE,
  QA_NOW,
  appFingerprint,
  checkQaContract,
  contextOptions,
  decodeImagesForCapture,
  qaUrl,
  trackNetwork,
  waitForStablePage,
} from '../support/qa.mjs';
import { tokens } from '../support/tokens.mjs';
import { MAX_DIFF_PIXEL_RATIO } from '../support/image-diff.mjs';
import { STATE_NOT_RENDERED, findUnrenderedStates } from './state-check.mjs';
import { handleBaseline } from './baseline.mjs';
import { buildContactSheet } from './contact-sheet.mjs';
import {
  MAX_EXPANDED_HEIGHT,
  interleaveByRoute,
  isExpectedStatus,
  isSpaRoute,
  isVolatileCell,
  pathTokens,
  planRoute,
  resolvePath,
  stagesOf,
  validateRoutes,
} from './matrix.mjs';
import { RateBudget, buildLimits, loadServerLimits } from './rate-budget.mjs';
import { missingTokens, tokenValues } from '../support/path-tokens.mjs';
import { ensureApprovalsFixture } from '../support/backend.mjs';
import { staffRun } from '../support/staff.mjs';
import { STAGE_FIXTURES } from '../support/stage-fixtures.mjs';
import { routes as registry } from './routes.mjs';
import { filterP4Cells, p4ContextOptions, P4_DEVICE_IDS, planLines, planP4Route, validateP4Filters } from './p4.mjs';
import { p4Device } from './p4-devices.mjs';
import { describeSets } from './p4-sets.mjs';

/**
 * The server whose host the baselines show. Routes with `hostDependent` (a QR code of APP_URL in the picture) are compared with
 * and written as baselines only on it; elsewhere (the isolated :8081 copy) their status is `host`.
 */
const BASELINE_ORIGIN = new URL(process.env.SPEEDCLUB_BASELINE_URL ?? 'http://localhost:8080').origin;

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_OUT = join(REPO_ROOT, 'docs', 'reports', 'visual');
const DEFAULT_BASELINES = fileURLToPath(new URL('../__screenshots__/', import.meta.url));
/** The p4 tier (09 §14.1): its own report folder and its own baselines, apart from the module and phase tiers. */
const DEFAULT_P4_OUT = join(DEFAULT_OUT, 'p4');
const DEFAULT_P4_BASELINES = join(DEFAULT_BASELINES, 'p4');
/** A p4 worker keeps at most this many browser contexts (device × locale × auth), the least recently used one is closed first. */
const P4_MAX_SLOTS = 6;
/**
 * WebKit has no host resolver rules: third parties go to a proxy on the discard port, which refuses them, so nothing but our own
 * host is reached, again without request interception (which would disable the HTTP cache). They still count as third-party requests.
 */
const BLOCKING_PROXY = 'http://127.0.0.1:9';
const ACTION_TIMEOUT_MS = 30_000;
/** How long closing a browser may take before the session goes on without it. */
const CLOSE_TIMEOUT_MS = 10_000;
const RECYCLE_PAGE_AFTER = 250;

/** @typedef {import('./matrix.mjs').RouteDef} RouteDef */
/** @typedef {import('./matrix.mjs').Cell} Cell */

function parseCli() {
  const { values } = parseArgs({
    options: {
      tier: { type: 'string', default: 'module' },
      routes: { type: 'string' },
      phase: { type: 'string' },
      'update-baselines': { type: 'boolean', default: false },
      resume: { type: 'boolean', default: false },
      workers: { type: 'string' },
      'fail-on': { type: 'string', default: 'medium' },
      'dry-run': { type: 'boolean', default: false },
      out: { type: 'string' },
      baselines: { type: 'string' },
      'routes-file': { type: 'string' },
      'limits-file': { type: 'string' },
      'ready-timeout': { type: 'string', default: '30000' },
      'device-scale': { type: 'string' },
      scale: { type: 'string' },
      'cell-timeout': { type: 'string', default: '120000' },
      'idle-timeout': { type: 'string', default: '600000' },
      plan: { type: 'boolean', default: false },
      'capture-only': { type: 'boolean', default: false },
      devices: { type: 'string' },
      themes: { type: 'string' },
      locales: { type: 'string' },
      states: { type: 'string' },
      'font-scales': { type: 'string' },
    },
  });
  if (values.tier !== 'module' && values.tier !== 'phase' && values.tier !== 'p4') throw new Error('--tier must be module, phase or p4');
  if (values['fail-on'] !== 'high' && values['fail-on'] !== 'medium') throw new Error('--fail-on must be high or medium');
  if (values.tier === 'phase' && !values.phase) throw new Error('--tier=phase needs --phase=N');
  const p4 = values.tier === 'p4';
  // The gate tiers have none of these: a filtered or audit-blind module or phase run could pass for a gate run.
  if (!p4) {
    const used = [values['capture-only'] ? 'capture-only' : null, ...['devices', 'themes', 'locales', 'states', 'font-scales'].filter((o) => values[/** @type {'devices'} */ (o)] !== undefined)];
    for (const option of used) if (option) throw new Error(`--${option} is an option of --tier=p4 only`);
  }
  // Device pixels for pictures outside the gate (the client preview's Retina shots). The gate and its baselines stay at 1.
  if (values.scale !== undefined && values['device-scale'] !== undefined && values.scale !== values['device-scale']) {
    throw new Error('--scale and --device-scale name the same thing: give one');
  }
  const deviceScale = Number(values.scale ?? values['device-scale'] ?? '1');
  if (![1, 2, 3].includes(deviceScale)) throw new Error('--device-scale (--scale) must be 1, 2 or 3');
  if (deviceScale !== 1 && (values['update-baselines'] || !values.out)) {
    throw new Error('--device-scale (--scale) above 1 needs --out and never updates baselines: its pictures are not the gate');
  }
  const list = (/** @type {string|undefined} */ v) =>
    v === undefined
      ? null
      : v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
  const defaultOut = p4 ? DEFAULT_P4_OUT : DEFAULT_OUT;
  return {
    tier: /** @type {'module'|'phase'|'p4'} */ (values.tier),
    routeIds: values.routes
      ? values.routes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null,
    phase: values.phase ? Number(values.phase) : null,
    updateBaselines: values['update-baselines'],
    resume: values.resume,
    workers: values.workers ? Number(values.workers) : Math.min(6, Math.max(2, Math.floor(availableParallelism() / 2))),
    failOn: values['fail-on'],
    dryRun: values['dry-run'],
    plan: values.plan,
    outRoot: values.out ?? defaultOut,
    // Pictures at another scale are compared with baselines of their own (none exist, so every cell is new).
    baselines:
      values.baselines ??
      (deviceScale === 1 ? (p4 ? DEFAULT_P4_BASELINES : DEFAULT_BASELINES) : join(values.out ?? defaultOut, `baselines-x${deviceScale}`)),
    routesFile: values['routes-file'] ?? null,
    limitsFile: values['limits-file'] ?? null,
    readyTimeout: Number(values['ready-timeout']),
    cellTimeout: Number(values['cell-timeout']),
    idleTimeout: Number(values['idle-timeout']),
    deviceScale,
    captureOnly: values['capture-only'],
    /** @type {import('./p4.mjs').P4Filters} */
    filters: {
      devices: list(values.devices),
      themes: list(values.themes),
      locales: list(values.locales),
      states: list(values.states),
      fontScales: list(values['font-scales']),
    },
  };
}

/** @param {ReturnType<typeof parseCli>} cli */
function selectRoutes(cli, /** @type {RouteDef[]} */ all) {
  if (cli.routeIds) {
    const unknown = cli.routeIds.filter((id) => !all.some((r) => r.id === id));
    if (unknown.length) throw new Error(`Unknown route id(s): ${unknown.join(', ')}. Add them to tests/e2e/visual/routes.mjs`);
    // A planned route named on purpose is still not captured (it would only time out on its ready element): it is listed with its
    // reason like every other planned route (DQ-937).
    const named = all.filter((r) => cli.routeIds?.includes(r.id));
    return { selected: named.filter((r) => r.status !== 'planned'), notRun: named.filter((r) => r.status === 'planned') };
  }
  // A phase gate photographs everything shipped so far: `--phase=2` takes the routes of phases 1 and 2 (into phase-2/), since a
  // Phase 2 module can change a Phase 1 screen (SET-01, MSG-01, the shell) and the gate must see it.
  const inPhase = (/** @type {RouteDef} */ r) => cli.phase === null || r.phase <= cli.phase;
  return {
    selected: all.filter((r) => r.status !== 'planned' && inPhase(r)),
    notRun: all.filter((r) => r.status === 'planned' && inPhase(r)),
  };
}

/**
 * One worker: its own browser process, and one kept page per locale + auth.
 */
class CaptureSession {
  #readyTimeout;
  #budget;
  #deviceScale;
  #cellTimeout;
  /** What the session is doing, for the watchdog and the idle guard: `<cell> · <step>`, or null between cells. */
  doing = /** @type {string|null} */ (null);
  #cellName = '';
  /** @param {string} step */
  #at(step) {
    this.doing = `${this.#cellName} · ${step}`;
  }
  /** @type {{routeId:string, counts:Map<string, number>}|null} the reservation of the cell being captured */
  #cell = null;
  /** @type {import('../support/auth.mjs').AuthLease|null} the credentials the cell being captured holds (released after it) */
  #lease = null;
  /** Contexts a worker keeps at most (p4: P4_MAX_SLOTS; the module and phase tiers keep every one, as before). */
  #maxSlots;
  #slotClock = 0;
  constructor(
    /** @type {number} */ readyTimeout,
    /** @type {RateBudget} */ budget,
    /** @type {number} */ deviceScale = 1,
    /** @type {number} */ cellTimeout = 120_000,
    /** @type {number} */ maxSlots = Infinity,
  ) {
    this.#readyTimeout = readyTimeout;
    this.#budget = budget;
    this.#deviceScale = deviceScale;
    this.#cellTimeout = cellTimeout;
    this.#maxSlots = maxSlots;
  }

  /** One browser per engine: Chromium for the module and phase tiers and the p4 Chromium devices, WebKit for the p4 Apple devices. */
  /** @type {Map<'chromium'|'webkit', import('@playwright/test').Browser>} */
  #browsers = new Map();
  /** @type {Map<string, {context:import('@playwright/test').BrowserContext,page:import('@playwright/test').Page,network:ReturnType<typeof trackNetwork>,log:{pageErrors:string[],consoleErrors:string[],thirdParty:string[],rateLimited:string[],serverErrors:string[]},uses:number,epoch:string|null,lastUsed:number}>} */
  #slots = new Map();

  /** @param {'chromium'|'webkit'} engine */
  async #browserFor(engine) {
    let browser = this.#browsers.get(engine);
    if (!browser) {
      const host = new URL(BASE_URL).hostname;
      browser =
        engine === 'chromium'
          ? // Nothing but our own host resolves. Interception would disable the HTTP cache.
            await chromium.launch({ args: [`--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE ${host}`] })
          : await webkit.launch({ proxy: { server: BLOCKING_PROXY, bypass: host } });
      this.#browsers.set(engine, browser);
    }
    return browser;
  }

  async #open(
    /** @type {'de'|'en'} */ locale,
    /** @type {string} */ auth,
    /** @type {import('../support/auth.mjs').AuthLease} */ lease,
    /** @type {string|undefined} */ deviceId,
  ) {
    const browser = await this.#browserFor(deviceId === undefined ? 'chromium' : p4Device(deviceId).engine);
    const context = await browser.newContext(
      deviceId === undefined
        ? { ...contextOptions({ locale }), deviceScaleFactor: this.#deviceScale }
        : { ...contextOptions({ locale }), ...p4ContextOptions(deviceId), deviceScaleFactor: this.#deviceScale },
    );
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    await context.clock.setFixedTime(new Date(QA_NOW));
    await applyAuth(context, auth, lease);
    const page = await context.newPage();
    const log = {
      pageErrors: /** @type {string[]} */ ([]),
      consoleErrors: /** @type {string[]} */ ([]),
      thirdParty: /** @type {string[]} */ ([]),
      rateLimited: /** @type {string[]} */ ([]),
      serverErrors: /** @type {string[]} */ ([]),
    };
    const origin = new URL(BASE_URL).origin;
    page.on('pageerror', (e) => log.pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('net::ERR_NAME_NOT_RESOLVED')) log.consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (/^https?:$/.test(url.protocol) && url.origin !== origin) log.thirdParty.push(r.url());
      else if (url.origin === origin) this.#budget.record(this.#cell, r.method(), url.pathname);
    });
    page.on('response', (r) => {
      const url = new URL(r.url());
      if (url.origin !== origin) return;
      const status = r.status();
      this.#budget.observe(r.request().method(), url.pathname, status, r.headers());
      if (status === 429) log.rateLimited.push(`${url.pathname}${url.search}`);
      else if (status >= 500) log.serverErrors.push(`HTTP ${status} ${r.request().method()} ${url.pathname}${url.search}`);
    });
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).hostname !== new URL(origin).hostname) log.thirdParty.push(ws.url());
    });
    return { context, page, network: trackNetwork(page), log, uses: 0, epoch: lease.epoch, lastUsed: 0 };
  }

  async #slot(/** @type {'de'|'en'} */ locale, /** @type {string} */ auth, /** @type {string|undefined} */ deviceId) {
    // p4: one context per device (the desktop widths share one, the module/phase context), locale and auth.
    const key =
      deviceId === undefined ? `${locale}|${auth}` : `${p4Device(deviceId).descriptor === null ? 'desktop' : deviceId}|${locale}|${auth}`;
    // The cell's credentials (a view-as, a staff session) renewed when they are about to run out, and held until the cell is done
    // (capture() releases the lease): a kept context opened with older ones is opened anew (support/auth.mjs authLease).
    this.#at('renewing the session');
    const lease = await authLease(auth);
    this.#lease = lease;
    let slot = this.#slots.get(key);
    if (slot && (slot.uses >= RECYCLE_PAGE_AFTER || slot.epoch !== lease.epoch)) {
      await slot.context.close();
      this.#slots.delete(key);
      slot = undefined;
    }
    if (!slot) {
      // Bounded (p4): the least recently used context goes first.
      while (this.#slots.size >= this.#maxSlots) {
        const [oldKey, old] = [...this.#slots.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0] ?? [];
        if (oldKey === undefined || !old) break;
        this.#slots.delete(oldKey);
        await old.context.close().catch(() => {});
      }
      this.#at('opening the page');
      slot = await this.#open(locale, auth, lease, deviceId);
      this.#slots.set(key, slot);
    }
    slot.uses++;
    slot.lastUsed = ++this.#slotClock;
    return slot;
  }

  /** Closes everything, so that a retry starts from a clean browser; one that does not close in time is left behind, not awaited. */
  async reset() {
    const browsers = [...this.#browsers.values()];
    const slots = [...this.#slots.values()];
    this.#slots.clear();
    this.#browsers.clear();
    const close = (async () => {
      for (const slot of slots) await slot.context.close().catch(() => {});
      for (const browser of browsers) await browser.close().catch(() => {});
    })();
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    await Promise.race([close, new Promise((resolve) => (timer = setTimeout(resolve, CLOSE_TIMEOUT_MS)))]);
    clearTimeout(timer);
  }

  /**
   * @param {RouteDef} route
   * @param {Cell} cell
   * @param {string} pngPath
   */
  async capture(route, cell, pngPath) {
    this.#cellName = cell.name;
    this.#at('waiting for rate-limit room');
    const reservation = await this.#budget.acquire(route.id);
    this.#cell = reservation;
    let completed = false;
    let timedOut = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let watchdog;
    try {
      this.#at('opening the page');
      const attempt = this.#capture(route, cell, pngPath);
      // The attempt goes on after the watchdog until reset() closes its browser; its failure then has nobody to tell.
      attempt.catch(() => {});
      const expired = new Promise((_, reject) => {
        watchdog = setTimeout(
          () => reject(new Error(`Watchdog: the attempt took over ${Math.round(this.#cellTimeout / 1000)} s, stuck at "${this.doing}"`)),
          this.#cellTimeout,
        );
      });
      const result = await Promise.race([attempt, expired]);
      completed = true;
      return result;
    } catch (error) {
      timedOut = String(error).includes('Watchdog:');
      throw error;
    } finally {
      clearTimeout(watchdog);
      // Before the room goes back: a page left on its route keeps calling the server (MSG polls conversations and unread counts
      // every few seconds), on the member's limiters the next cells wait for. Verify of 2026-11-08, run 2: five pages left on
      // MSG and SET routes kept `browse` full for 2 h 45 min while every worker waited for room on it, and their hits leaving the
      // window counted as progress, so the budget never gave up. A timed-out attempt's browser is closed by reset() instead.
      if (!timedOut) await this.#park();
      this.#lease?.release();
      this.#lease = null;
      this.#cell = null;
      this.doing = null;
      this.#budget.release(reservation, { completed });
    }
  }

  /** Every page of this session on about:blank, its stored state cleared first: nothing calls the server between cells. */
  async #park() {
    this.#at('parking the page');
    for (const slot of this.#slots.values()) {
      // Bounded: page.evaluate has no timeout of its own.
      await Promise.race([clearStoredState(slot.page).catch(() => {}), new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS).unref())]);
      await slot.page.goto('about:blank', { timeout: CLOSE_TIMEOUT_MS }).catch(() => {});
    }
  }

  /**
   * @param {RouteDef} route
   * @param {Cell} cell
   * @param {string} pngPath
   */
  async #capture(route, cell, pngPath) {
    const { page, network, log } = await this.#slot(cell.locale, route.auth, cell.device);
    this.#at('clearing stored state');
    log.pageErrors.length = 0;
    log.consoleErrors.length = 0;
    log.thirdParty.length = 0;
    log.rateLimited.length = 0;
    log.serverErrors.length = 0;

    // Isolation between cells on a kept page (also done when the page is parked after a cell).
    await clearStoredState(page);
    // The cell's viewport on a blank document, then the cell's own: a document keeps the larger srcset candidates it has loaded
    // (Blink reuses them for every later selection in that document), so the route's document must never see the viewport of
    // the cell before. Verify of 2026-11-08: WEB-02 at 430 showed the 1440 variants of its cover and garage card.
    this.#at('about:blank');
    await page.goto('about:blank');
    this.#at('viewport');
    await page.setViewportSize(cell.viewport);
    await page.emulateMedia({ colorScheme: tokens.themes[cell.theme].colorScheme, reducedMotion: 'reduce' });

    const url = qaUrl(route.path, { theme: cell.theme, locale: cell.locale, fontScale: cell.fontScale, state: cell.state });
    this.#at('loading the route');
    const response = await page.goto(`${BASE_URL}${url}`, { waitUntil: 'load' });
    if (!response) throw new Error(`No response for ${url}`);
    if (!isExpectedStatus(route, response.status())) {
      throw new Error(`HTTP ${response.status()} for ${url}${route.expectStatus === undefined ? '' : ` (expected ${route.expectStatus})`}`);
    }
    // A 429 means the screen shows an error state instead of the route; checked again right before the picture, as expanding an
    // inner scroller can load more.
    const refuseRateLimited = () => {
      if (log.rateLimited.length) {
        throw new Error(`Rate limited by the server (429), the screen is not the route's: ${[...new Set(log.rateLimited)].join(', ')}`);
      }
    };
    if (route.ready) {
      this.#at('waiting for the ready element');
      try {
        await page.locator(`${route.ready}:visible`).first().waitFor({ state: 'visible', timeout: this.#readyTimeout });
      } catch (error) {
        // A ready element that never came because a request was refused is a 429, not a slow screen: say so.
        refuseRateLimited();
        throw error;
      }
    }
    this.#at('waiting for a stable page');
    const stable = await waitForStablePage(page, { network });
    refuseRateLimited();

    this.#at('qa contract');
    const contractIssues = await checkQaContract(page, {
      theme: cell.theme,
      locale: cell.locale,
      fontScale: cell.fontScale,
      state: cell.state,
    });
    this.#at('DOM audit');
    const audit = await runDomAudit(page, { theme: cell.theme, fontScale: cell.fontScale });

    const mode = route.capture ?? (isSpaRoute(route) ? 'viewport' : 'page');
    if (mode === 'expanded') {
      this.#at('expanding the inner scroller');
      const grown = await expandToInnerScroller(page, cell.viewport, route.maxHeight ?? MAX_EXPANDED_HEIGHT);
      await waitForStablePage(page, { network });
      // DQ-446: a virtualised list estimates the rows it has not drawn yet; drawn at the grown height they can be shorter, and an
      // inverted list (MSG-02) then sits at the bottom under an empty band of a size that changes from run to run.
      if (grown && (await trimEmptyBand(page, cell.viewport))) await waitForStablePage(page, { network });
    }
    // DQ-910: lazy photos below the fold (a full-page capture) or revealed by the expansion are loaded and decoded, bounded by the
    // ready timeout; nothing waits when every image is decoded already.
    this.#at('decoding images');
    const images = await decodeImagesForCapture(page, this.#readyTimeout);
    refuseRateLimited();
    this.#at('screenshot');
    await page.screenshot({
      path: pngPath,
      animations: 'disabled',
      caret: 'hide',
      scale: this.#deviceScale === 1 ? 'css' : 'device',
      fullPage: mode === 'page',
    });
    // A 429 the screen already shows can reach this listener only during the screenshot. The retry overwrites the picture, and
    // when it fails too no picture of the error stays on disk for the contact sheet or the client preview.
    if (log.rateLimited.length) await rm(pngPath, { force: true });
    refuseRateLimited();
    return {
      url,
      audit,
      stable,
      images,
      contractIssues,
      pageErrors: [...log.pageErrors],
      consoleErrors: [...log.consoleErrors],
      thirdParty: [...log.thirdParty],
      serverErrors: [...log.serverErrors],
    };
  }
}

/**
 * Isolation between cells on a kept page. Cookies stay: they are the auth of this slot, and the member token is an httpOnly
 * cookie on web. The app's own stored state must go. Only a page of the server has any (about:blank has none to clear).
 * @param {import('@playwright/test').Page} page
 */
async function clearStoredState(page) {
  await page.evaluate(async () => {
    if (!/^https?:$/.test(location.protocol)) return;
    localStorage.clear();
    sessionStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(/** @type {string} */ (db.name));
            request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
          }),
      ),
    );
  });
}

/**
 * Grows the viewport so that the content of an inner scroller is on the picture. The audit has
 * already run at the real viewport. `maxHeight` bounds the picture of an endless list (a route's `maxHeight`): the content is
 * measured once, so pages the list loads after the viewport has grown add nothing to the picture.
 * @param {import('@playwright/test').Page} page
 * @param {{width:number,height:number}} viewport
 * @param {number} maxHeight
 */
async function expandToInnerScroller(page, viewport, maxHeight) {
  const extra = await page.evaluate(() => {
    let max = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.checkVisibility()) {
        max = Math.max(max, el.scrollHeight - el.clientHeight);
      }
    }
    return max;
  });
  if (extra > 0) await page.setViewportSize({ width: viewport.width, height: Math.min(viewport.height + extra, maxHeight) });
  return extra > 0;
}

/** Room an expanded picture keeps between the edge of the scroller and its content, for list paddings. */
const BAND_KEEP = 24;

/**
 * After the viewport grew: when the main inner scroller no longer overflows and its drawn content leaves an empty band at its top
 * or bottom, the viewport shrinks by that band (never below the cell's own height). Only shrinks, so `maxHeight` keeps its bound.
 * @param {import('@playwright/test').Page} page
 * @param {{width:number,height:number}} viewport
 * @returns {Promise<boolean>} whether the viewport changed
 */
async function trimEmptyBand(page, viewport) {
  const band = await page.evaluate((keep) => {
    /** @type {HTMLElement|null} */
    let main = null;
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.checkVisibility() && (!main || el.clientHeight > main.clientHeight)) main = el;
    }
    if (!main || main.scrollHeight > main.clientHeight + 1) return 0;
    const box = main.getBoundingClientRect();
    let top = Infinity;
    let bottom = -Infinity;
    for (const el of main.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || !el.checkVisibility()) continue;
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
    if (!Number.isFinite(top)) return 0;
    const gap = Math.max(top - box.top, box.bottom - bottom) - keep;
    return gap > 2 * keep ? Math.floor(gap) : 0;
  }, BAND_KEEP);
  if (band <= 0) return false;
  const current = page.viewportSize() ?? viewport;
  const height = Math.max(viewport.height, current.height - band);
  if (height === current.height) return false;
  await page.setViewportSize({ width: viewport.width, height });
  return true;
}

/**
 * Findings that make a picture untrustworthy rather than report a design defect: the page did not apply the requested theme,
 * locale, font scale or state (`qa-override`, `state-not-rendered`), it shows a server error or an image that failed, or it threw.
 * `--capture-only` relaxes the DOM audit and the other runtime checks, never these: such a cell is no valid "before" picture.
 */
const INTEGRITY_CHECKS = ['qa-override', STATE_NOT_RENDERED, 'server-error', 'runtime-error', 'broken-image', 'image-not-decoded'];

/**
 * The cells of a run with picture-integrity findings, each with those findings.
 * @param {any[]} results
 * @returns {{name: string, findings: {check: string, message: string}[]}[]}
 */
function integrityFindingsOf(results) {
  return results
    .map((r) => ({ name: r.name, findings: (r.violations ?? []).filter((/** @type {any} */ v) => INTEGRITY_CHECKS.includes(v.check)) }))
    .filter((r) => r.findings.length > 0);
}

/**
 * Failures of the page itself count like audit rows: a page that throws or calls third parties is High.
 * @param {RouteDef} route
 * @param {Awaited<ReturnType<CaptureSession['capture']>>} c
 */
function mergeRuntimeFindings(route, c) {
  const { audit } = c;
  const add = (/** @type {string} */ check, /** @type {'High'|'Medium'} */ severity, /** @type {string} */ message) => {
    audit.counts[severity]++;
    audit.violations.push({ check, severity, message, element: 'page', rect: null });
  };
  for (const e of c.pageErrors) add('runtime-error', 'High', e);
  for (const u of c.thirdParty) add('third-party-request', 'High', u);
  for (const u of c.serverErrors) add('server-error', 'High', u);
  for (const u of [...c.stable.imagesFailed, ...c.images.failed]) add('broken-image', 'High', u);
  // DQ-910: the picture shows a placeholder or a black box where this photo belongs.
  for (const u of c.images.undecoded) add('image-not-decoded', 'High', `not decoded before the screenshot: ${u}`);
  if (route.qaContract !== false) for (const issue of c.contractIssues) add('qa-override', 'High', issue);
  return audit;
}

const pad = (/** @type {number} */ n, w = 6) => String(n).padStart(w);

/**
 * What a p4 summary adds: the sets, the filters, the scale, and with --capture-only every audit finding of the run, cell by cell,
 * so the "before" state is documented, not only counted, and apart from it the cells whose picture cannot be trusted.
 * @param {any[]} results
 * @param {{cli: ReturnType<typeof parseCli>, sets: ReturnType<typeof describeSets>|null, filteredOut: string[], auditFailing: boolean, integrity: ReturnType<typeof integrityFindingsOf>}} o
 */
function p4Summary(results, { cli, sets, filteredOut, auditFailing, integrity }) {
  /** @type {Record<string, {High: number, Medium: number}>} */
  const byCheck = {};
  /** @type {{cell: string, check: string, severity: string, element: string, message: string}[]} */
  const findings = [];
  for (const r of results) {
    for (const v of r.violations ?? []) {
      const entry = (byCheck[v.check] ??= { High: 0, Medium: 0 });
      if (v.severity === 'High' || v.severity === 'Medium') entry[/** @type {'High'|'Medium'} */ (v.severity)]++;
      findings.push({ cell: r.name, check: v.check, severity: v.severity, element: v.element, message: v.message });
    }
  }
  return {
    scale: cli.deviceScale,
    captureOnly: cli.captureOnly,
    // What the audits found would have failed this run without --capture-only.
    auditWouldFail: auditFailing,
    // Cells whose picture cannot be trusted (INTEGRITY_CHECKS): they fail the run with or without --capture-only.
    integrityFailures: integrity.map((r) => ({ cell: r.name, findings: r.findings.map((v) => ({ check: v.check, message: v.message })) })),
    filters: cli.filters,
    noCellUnderFilters: filteredOut,
    sets,
    findingsByCheck: byCheck,
    findings,
  };
}

/**
 * @param {string} title
 * @param {any[]} results
 */
function printTable(title, results) {
  const byRoute = new Map();
  for (const r of results) {
    const row = byRoute.get(r.routeId) ?? {
      shots: 0,
      failed: 0,
      high: 0,
      medium: 0,
      base: { match: 0, new: 0, mismatch: 0, updated: 0, refused: 0, host: 0, volatile: 0 },
    };
    row.shots++;
    if (r.failed) row.failed++;
    row.high += r.high ?? 0;
    row.medium += r.medium ?? 0;
    if (r.baseline?.status) row.base[r.baseline.status]++;
    byRoute.set(r.routeId, row);
  }
  console.log(`\n${title}`);
  console.log('Route           Shots Failed   High Medium  Match    New   Diff Updated Refused Volatile');
  for (const [id, row] of byRoute) {
    console.log(
      `${id.padEnd(15)}${pad(row.shots)} ${pad(row.failed)} ${pad(row.high)} ${pad(row.medium)} ${pad(row.base.match)} ${pad(row.base.new)} ${pad(row.base.mismatch)} ${pad(row.base.updated, 7)} ${pad(row.base.refused, 7)} ${pad(row.base.volatile, 8)}`,
    );
  }
}

/** @param {any[]} results */
function topFindings(results, limit = 12) {
  const tally = new Map();
  for (const r of results) {
    for (const v of r.violations ?? []) {
      const key = `${v.severity} ${v.check}: ${v.element}: ${v.message}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

async function main() {
  const cli = parseCli();
  const allRoutes = /** @type {RouteDef[]} */ (cli.routesFile ? JSON.parse(await readFile(cli.routesFile, 'utf8')) : registry);
  const problems = validateRoutes(allRoutes);
  if (problems.length) throw new Error(`Invalid route registry:\n  ${problems.join('\n  ')}`);

  const p4 = cli.tier === 'p4';
  if (p4) {
    const filterProblems = validateP4Filters(cli.filters, allRoutes);
    if (filterProblems.length) throw new Error(`Wrong p4 filter:\n  ${filterProblems.join('\n  ')}`);
  }
  const chosen = selectRoutes(cli, allRoutes);
  const { notRun } = chosen;
  // DQ-937: what is planned but not captured, and why, before anything else (also before --plan and --dry-run).
  const printNotRun = () => {
    if (!notRun.length) return;
    console.log(`Planned, not run: ${notRun.map((r) => r.id).join(', ')}`);
    for (const r of notRun) console.log(`  ${r.id}: not capturable yet: ${r.plannedReason ?? 'no reason given'}`);
  };
  if (chosen.selected.length === 0) {
    printNotRun();
    throw new Error('No routes selected.');
  }
  // Seeded ids that change with every seed (`{r34}` and the like), read once per run as the demo member.
  const names = [...new Set(chosen.selected.flatMap((r) => pathTokens(r.path)))];
  const tokens = names.length > 0 && !cli.dryRun && !cli.plan ? await tokenValues(names) : null;
  // A route whose seeded token has no value (a seed another lane has not run yet) is skipped with its reason; the others still run.
  const skippedForSeed = chosen.selected.filter((r) => pathTokens(r.path).some((name) => name in missingTokens));
  for (const route of skippedForSeed) {
    const reasons = pathTokens(route.path).filter((name) => name in missingTokens).map((name) => `{${name}}: ${missingTokens[name]}`);
    console.log(`SKIPPED ${route.id}: ${reasons.join('; ')}`);
  }
  const selected = chosen.selected
    .filter((r) => !skippedForSeed.includes(r))
    .map((r) => (tokens && pathTokens(r.path).length > 0 ? { ...r, path: resolvePath(r.path, tokens) } : r));

  // The output folder of a group of results: `phase-N/` of the module and phase tiers, the p4 folder itself for the p4 tier.
  const dirOf = (/** @type {number|'p4'} */ group) => (group === 'p4' ? cli.outRoot : join(cli.outRoot, `phase-${group}`));
  /** @type {{route:RouteDef,cell:Cell,dir:string,phase:number|'p4'}[]} */
  const jobs = [];
  /** @type {string[]} p4: routes the filters leave without a cell */
  const filteredOut = [];
  for (const route of selected) {
    const phase = p4 ? 'p4' : (cli.phase ?? route.phase);
    const dir = dirOf(phase);
    const cells = cli.tier === 'p4' ? filterP4Cells(planP4Route(route), cli.filters) : planRoute(route, cli.tier);
    if (cells.length === 0) filteredOut.push(route.id);
    for (const cell of cells) jobs.push({ route, cell, dir, phase });
  }
  if (p4) {
    // One device after the other (a worker then needs the contexts of one device at a time), all routes in turn within each.
    const ordered = P4_DEVICE_IDS.flatMap((id) => interleaveByRoute(jobs.filter((j) => j.cell.device === id), (j) => j.route.id));
    jobs.splice(0, jobs.length, ...ordered);
  } else {
    // All routes in turn: the cells of one route use the same limiters, and back to back they would wait on them.
    jobs.splice(0, jobs.length, ...interleaveByRoute(jobs, (j) => j.route.id));
  }
  // The cells of a stage fixture last, one fixture at a time (stagesOf keeps the interleaved order inside each stage).
  const stages = stagesOf(jobs, (j) => j.route.fixture);
  jobs.splice(0, jobs.length, ...stages.flatMap((s) => s.jobs));
  if (p4 && jobs.length === 0) throw new Error('No cells selected: the p4 filters leave nothing of the selected routes.');
  console.log(`Tier ${cli.tier}: ${selected.length} route(s), ${jobs.length} screenshot(s), ${cli.workers} workers, ${BASE_URL}`);
  printNotRun();
  /** @type {ReturnType<typeof describeSets>|null} */
  const sets = p4 ? describeSets(allRoutes) : null;
  if (sets) {
    console.log(
      `p4 sets: FLAGSHIP ${sets.flagship.length} route(s), FORMS ${sets.forms.length}, EN12 ${sets.en12.length}, TABLET ${sets.tablet.length}, SPECIMEN ${sets.specimen.length}` +
        ` · scale ${cli.deviceScale} · ${cli.captureOnly ? 'capture only (audit findings reported, not failed on)' : 'audits fail the run'}`,
    );
    console.log(`Not built yet: ${sets.notBuiltYet.length ? sets.notBuiltYet.join(', ') : 'none'}`);
    const active = Object.entries(cli.filters).filter(([, v]) => v !== null);
    if (active.length) console.log(`Filters: ${active.map(([k, v]) => `--${k === 'fontScales' ? 'font-scales' : k}=${/** @type {string[]} */ (v).join(',')}`).join(' ')}`);
    if (filteredOut.length) console.log(`No cell under the filters: ${filteredOut.join(', ')}`);
  }
  for (const s of stages) if (s.fixture) console.log(`Stage fixture ${s.fixture}: ${s.jobs.length} screenshot(s) after the others`);
  if (cli.plan) {
    for (const line of planLines(jobs.map((j) => j.cell))) console.log(line);
    return 0;
  }
  if (cli.dryRun) {
    for (const s of stages) {
      if (s.fixture) console.log(`  [stage fixture ${s.fixture}]`);
      for (const j of s.jobs) console.log(`  ${j.cell.name}`);
    }
    return 0;
  }

  const dirs = [...new Set(jobs.map((j) => j.dir))];
  for (const dir of dirs) await mkdir(join(dir, 'contact'), { recursive: true });
  // Remove the routes' earlier results: a contact sheet must never show a stale screenshot.
  if (!cli.resume) {
    for (const dir of dirs) {
      for (const file of await readdir(dir)) {
        if (selected.some((r) => file.startsWith(`${r.id}__`))) await rm(join(dir, file));
      }
      await rm(join(dir, 'diff'), { recursive: true, force: true });
    }
  }

  // DQ-528: ADM-43's queue as the admin fixture sees it, seeded once after the staff fixtures exist (ensure-staff removes every
  // fixture's requests, so the order matters). Never in the Playwright global setup: the flows must not meet these requests.
  if (selected.some((r) => r.id.startsWith('ADM-43'))) {
    await staffRun();
    const seeded = await ensureApprovalsFixture();
    console.log(`Approvals fixture: ${seeded.created} requests over ${seeded.members} demo members.`);
  }

  const limits = cli.limitsFile ? JSON.parse(await readFile(cli.limitsFile, 'utf8')) : null;
  const budget = new RateBudget(limits ? buildLimits(limits.routes, limits.config) : await loadServerLimits(REPO_ROOT));
  const exportBefore = await appFingerprint();
  const started = Date.now();
  /** @type {any[]} */
  const results = [];
  /** The jobs of the stage that runs now. */
  let queue = jobs;
  let next = 0;
  let done = 0;
  let lastFinished = Date.now();
  let lastPrinted = Date.now();
  /** @type {CaptureSession[]} */
  const sessions = [];
  const inFlight = () => sessions.map((s, i) => `worker ${i + 1}: ${s.doing ?? 'idle'}`).join('; ');
  // Heartbeat and idle guard: a hang must never stall a gate. Nothing finished for --idle-timeout: abort with what every worker
  // was doing (the summary of a run that never ended would be a lie), after closing the browsers.
  const guard = setInterval(() => {
    const now = Date.now();
    if (now - lastFinished > cli.idleTimeout) {
      clearInterval(guard);
      console.error(
        `\nABORTED: no cell finished for ${Math.round((now - lastFinished) / 60000)} min (${done}/${jobs.length} done). In flight: ${inFlight()}`,
      );
      Promise.race([Promise.all(sessions.map((s) => s.reset())), new Promise((resolve) => setTimeout(resolve, 2 * CLOSE_TIMEOUT_MS))]).finally(() =>
        process.exit(2),
      );
      return;
    }
    if (now - lastPrinted >= 60_000) {
      lastPrinted = now;
      console.log(`  … ${done}/${jobs.length}, ${Math.round((now - lastFinished) / 1000)} s since a cell finished. ${inFlight()}`);
    }
  }, 5_000);
  guard.unref();

  const worker = async () => {
    const session = new CaptureSession(cli.readyTimeout, budget, cli.deviceScale, cli.cellTimeout, p4 ? P4_MAX_SLOTS : Infinity);
    sessions.push(session);
    for (;;) {
      const job = queue[next++];
      if (!job) break;
      const { route, cell, dir, phase } = job;
      const pngPath = join(dir, `${cell.name}.png`);
      const jsonPath = join(dir, `${cell.name}.audit.json`);
      /** @type {any} */
      let result;
      if (cli.resume && existsSync(pngPath) && existsSync(jsonPath)) {
        result = JSON.parse(await readFile(jsonPath, 'utf8'));
        result.resumed = !result.failed;
      }
      if (!result || result.failed) {
        const t0 = Date.now();
        /** @type {Error|null} */
        let error = null;
        /** @type {string|null} why the first attempt failed, kept when the retry succeeds */
        let retryReason = null;
        let attempts = 0;
        // One retry from a clean browser for infrastructure hiccups; attempts is in the result.
        while (attempts < 2) {
          attempts++;
          try {
            const c = await session.capture(route, cell, pngPath);
            const audit = mergeRuntimeFindings(route, c);
            const baseline = await handleBaseline(await readFile(pngPath), cell.name, {
              baselines: cli.baselines,
              updateBaselines: cli.updateBaselines,
              high: audit.counts.High,
              diffDir: join(dir, 'diff'),
              hostLocked: route.hostDependent === true && new URL(BASE_URL).origin !== BASELINE_ORIGIN,
              volatile: isVolatileCell(route, cell),
            });
            result = {
              routeId: route.id,
              name: cell.name,
              file: `${cell.name}.png`,
              url: c.url,
              viewport: cell.viewport,
              theme: cell.theme,
              locale: cell.locale,
              fontScale: cell.fontScale,
              state: cell.state,
              high: audit.counts.High,
              medium: audit.counts.Medium,
              violations: audit.violations,
              droppedViolations: audit.droppedViolations,
              exemptions: audit.exemptions,
              scanned: audit.scanned,
              runtime: {
                consoleErrors: c.consoleErrors,
                domQuiet: c.stable.domQuiet,
                fontsLoaded: c.stable.fontsLoaded,
                imagesMadeEager: c.images.eager,
                qaContract: { enforced: route.qaContract !== false, issues: c.contractIssues },
              },
              baseline,
              attempts,
              retryReason,
              ms: Date.now() - t0,
              failed: false,
            };
            error = null;
            break;
          } catch (e) {
            error = /** @type {Error} */ (e);
            retryReason ??= error.message.split('\n').slice(0, 3).join(' ');
            console.log(`  attempt ${attempts} of ${cell.name} failed: ${error.message.split('\n')[0]}`);
            await session.reset();
          }
        }
        if (error) {
          // No picture for a failed cell: an earlier attempt's would pass for its evidence, on the contact sheet too.
          await rm(pngPath, { force: true });
          console.log(`  FAILED ${cell.name}: ${error.message.split('\n')[0]}`);
          result = {
            routeId: route.id,
            name: cell.name,
            url: route.path,
            failed: true,
            error: error.message.split('\n').slice(0, 3).join(' '),
            attempts,
            ms: Date.now() - t0,
          };
        }
        await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
      }
      result.phase = phase;
      results.push(result);
      done++;
      lastFinished = Date.now();
      if (done % 10 === 0 || done === jobs.length) {
        const minutes = (Date.now() - started) / 60000;
        lastPrinted = Date.now();
        console.log(`  ${done}/${jobs.length}  ${(done / minutes).toFixed(0)} screens/min`);
      }
    }
    await session.reset();
  };
  /**
   * A job that never got its picture because its stage fixture could not be set up: failed, with the reason, like a failed capture.
   * @param {{route:RouteDef,cell:Cell,dir:string,phase:number|'p4'}} job
   * @param {string} message
   */
  const failWithoutCapture = async ({ route, cell, dir, phase }, message) => {
    await rm(join(dir, `${cell.name}.png`), { force: true });
    const result = { routeId: route.id, name: cell.name, url: route.path, failed: true, error: message, attempts: 0, ms: 0 };
    await writeFile(join(dir, `${cell.name}.audit.json`), `${JSON.stringify(result, null, 2)}\n`);
    results.push({ ...result, phase });
    done++;
    lastFinished = Date.now();
    console.log(`  FAILED ${cell.name}: ${message}`);
  };
  for (const stage of stages) {
    queue = stage.jobs;
    next = 0;
    const fixture = stage.fixture === null ? null : STAGE_FIXTURES[stage.fixture];
    if (!fixture) {
      await Promise.all(Array.from({ length: cli.workers }, worker));
      continue;
    }
    console.log(`\nStage fixture ${stage.fixture}: ${fixture.what}, for ${queue.length} screenshot(s)`);
    // Removed on exit and on an interruption too: a fixture left behind would show on every other route's pictures.
    const onExit = () => void fixture.teardownSync();
    const onSignal = (/** @type {NodeJS.Signals} */ signal) => {
      fixture.teardownSync();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    process.once('exit', onExit);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    /** @type {string|null} */
    let refused = null;
    try {
      await fixture.setup();
    } catch (error) {
      refused = `stage fixture ${stage.fixture} could not be set up: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`;
    }
    try {
      if (refused) for (const job of queue) await failWithoutCapture(job, refused);
      else await Promise.all(Array.from({ length: Math.min(cli.workers, queue.length) }, worker));
    } finally {
      try {
        await fixture.teardown();
        process.off('exit', onExit);
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        console.log(`Stage fixture ${stage.fixture}: removed`);
      } catch (error) {
        // The exit handler tries once more; the run must not go on to another stage with this fixture in place.
        console.error(`Stage fixture ${stage.fixture}: removal failed (${error instanceof Error ? error.message : error}); trying again on exit`);
        throw error;
      }
    }
  }
  clearInterval(guard);

  // DQ-501: a state cell that is the default's picture did not render its state (state-check.mjs). High, so it fails the run.
  for (const dir of dirs) {
    const inDir = results.filter((r) => dirOf(r.phase) === dir);
    for (const finding of await findUnrenderedStates(inDir, dir)) {
      const r = inDir.find((x) => x.name === finding.name);
      if (!r || (r.violations ?? []).some((/** @type {any} */ v) => v.check === STATE_NOT_RENDERED)) continue;
      r.violations = [
        ...(r.violations ?? []),
        {
          check: STATE_NOT_RENDERED,
          severity: 'High',
          message: `state "${r.state}" looks like ${finding.defaultName} (diff ratio ${finding.ratio.toFixed(4)} ≤ ${MAX_DIFF_PIXEL_RATIO}): the page did not render it`,
          element: 'page',
          rect: null,
        },
      ];
      r.high = (r.high ?? 0) + 1;
      const { phase: _phase, ...stored } = r;
      await writeFile(join(dir, `${r.name}.audit.json`), `${JSON.stringify(stored, null, 2)}\n`);
    }
  }

  const durationMs = Date.now() - started;
  // The server may be gone by now. The cells are captured all the same, so the summary is still written, and the run is invalid
  // because nobody can say the export stayed the same.
  const exportAfter = await appFingerprint().catch(() => null);
  const exportChanged = exportAfter !== exportBefore;
  const capturedHere = results.filter((r) => !r.resumed).length;
  const perMinute = capturedHere ? Math.round((capturedHere / durationMs) * 60000) : 0;

  let exitCode = 0;
  for (const phase of [...new Set(results.map((r) => r.phase))]) {
    const phaseResults = results.filter((r) => r.phase === phase).sort((a, b) => a.name.localeCompare(b.name));
    const dir = dirOf(phase);
    /** @type {Record<string,{high:number,medium:number,baseline?:string,failed?:boolean}>} */
    const info = {};
    for (const r of phaseResults) info[r.name] = { high: r.high, medium: r.medium, baseline: r.baseline?.status, failed: r.failed };
    for (const route of selected) await buildContactSheet({ dir, routeId: route.id, info, notes: route.notes });

    const count = (/** @type {(r:any)=>boolean} */ f) => phaseResults.filter(f).length;
    const totals = {
      planned: phaseResults.length,
      captured: count((r) => !r.failed),
      failed: count((r) => r.failed),
      high: phaseResults.reduce((n, r) => n + (r.high ?? 0), 0),
      medium: phaseResults.reduce((n, r) => n + (r.medium ?? 0), 0),
      baselineMatch: count((r) => r.baseline?.status === 'match'),
      baselineNew: count((r) => r.baseline?.status === 'new'),
      baselineMismatch: count((r) => r.baseline?.status === 'mismatch'),
      baselineUpdated: count((r) => r.baseline?.status === 'updated'),
      baselineRefused: count((r) => r.baseline?.status === 'refused'),
      // Host-dependent pictures (QR of APP_URL) taken away from the baseline host: neither compared nor written.
      baselineHostSkipped: count((r) => r.baseline?.status === 'host'),
      // ADR-223: live activity (ADM-06, ADM-08, ADM-44), audited but never compared.
      baselineVolatile: count((r) => r.baseline?.status === 'volatile'),
      qaContractNotEnforced: count((r) => r.runtime && !r.runtime.qaContract.enforced && r.runtime.qaContract.issues.length > 0),
      retried: count((r) => (r.attempts ?? 1) > 1),
    };
    // --capture-only (p4): the audits run and are reported in full, but their findings do not fail the run; everything else does,
    // the picture-integrity findings among them (INTEGRITY_CHECKS are High, so without --capture-only they fail through auditFailing).
    const auditFailing = totals.high > 0 || (cli.failOn === 'medium' && totals.medium > 0);
    const integrity = integrityFindingsOf(phaseResults);
    const failing =
      exportChanged ||
      totals.failed > 0 ||
      (auditFailing && !cli.captureOnly) ||
      (cli.captureOnly && integrity.length > 0) ||
      totals.baselineMismatch > 0 ||
      totals.baselineRefused > 0;
    if (failing) exitCode = 1;

    const summary = {
      tier: cli.tier,
      phase: phase === 'p4' ? cli.phase : phase,
      routes: selected.map((r) => r.id),
      plannedNotRun: notRun.map((r) => r.id),
      plannedNotRunReasons: Object.fromEntries(notRun.map((r) => [r.id, r.plannedReason ?? ''])),
      baseUrl: BASE_URL,
      workers: cli.workers,
      durationMs,
      screensPerMinute: perMinute,
      rateLimitWaitMs: budget.waitedMs,
      failOn: cli.failOn,
      passed: !failing,
      exportChangedDuringRun: exportChanged,
      totals,
      topFindings: topFindings(phaseResults, 50).map(([finding, n]) => ({ finding, screenshots: n })),
      failures: phaseResults.filter((r) => r.failed).map((r) => ({ name: r.name, error: r.error })),
      retries: phaseResults.filter((r) => !r.failed && r.retryReason).map((r) => ({ name: r.name, firstError: r.retryReason })),
      shots: phaseResults.map((r) => ({
        name: r.name,
        failed: r.failed,
        high: r.high,
        medium: r.medium,
        baseline: r.baseline?.status,
        diffRatio: r.baseline?.ratio ?? null,
        ms: r.ms,
      })),
      ...(phase === 'p4' ? p4Summary(phaseResults, { cli, sets, filteredOut, auditFailing, integrity }) : {}),
    };
    await writeFile(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

    printTable(phase === 'p4' ? 'Tier p4' : `Phase ${phase}, tier ${cli.tier}`, phaseResults);
    const top = topFindings(phaseResults);
    if (top.length) {
      console.log('\nMost frequent findings (screenshots affected):');
      for (const [finding, n] of top) console.log(`  ${pad(n, 4)}x ${finding}`);
    }
    for (const f of summary.failures.slice(0, 10)) console.log(`\nCAPTURE FAILED ${f.name}: ${f.error}`);
    for (const f of summary.retries.slice(0, 10)) console.log(`\nRETRIED ${f.name}, first attempt: ${f.firstError}`);
    if (phase === 'p4') {
      if (totals.baselineNew) console.log(`\nNo p4 baseline yet for ${totals.baselineNew} cell(s) (baseline "new"): reported, not a failure.`);
      const secondsPerCell = totals.captured ? durationMs / 1000 / Math.max(1, capturedHere) : 0;
      console.log(`Seconds per cell (wall clock, ${cli.workers} workers): ${secondsPerCell.toFixed(2)}`);
      if (cli.captureOnly && auditFailing) {
        console.log(
          `\nCAPTURE ONLY: ${totals.high} High and ${totals.medium} Medium audit finding(s) are in summary.json (findings), not failed on.`,
        );
      }
      if (integrity.length) {
        console.log(`\nPICTURE INTEGRITY: ${integrity.length} cell(s) cannot be trusted as a picture of their cell (failed on, also with --capture-only):`);
        for (const r of integrity.slice(0, 20)) {
          console.log(`  ${r.name}: ${r.findings.map((v) => `${v.check}: ${String(v.message).slice(0, 160)}`).join(' | ')}`);
        }
        if (integrity.length > 20) console.log(`  … ${integrity.length - 20} more in summary.json (integrityFailures)`);
      }
    }
    if (totals.qaContractNotEnforced) {
      console.log(
        `\nWARNING: ${totals.qaContractNotEnforced} screenshot(s) come from routes that do not honour qa* overrides yet (qaContract: false).`,
      );
    }
    console.log(`\nSummary:  ${join(dir, 'summary.json')}`);
    console.log(`Contact:  ${join(dir, 'contact')}`);
  }
  if (exportAfter === null) console.log('\nINVALID RUN: the server did not answer the export check at the end of the run.');
  else if (exportChanged) console.log(`\nINVALID RUN: ${EXPORT_CHANGED_MESSAGE}`);
  console.log(
    `\n${capturedHere} captured in ${(durationMs / 1000).toFixed(1)} s = ${perMinute} screens/min ` +
      `(${(budget.waitedMs / 1000).toFixed(1)} s of worker time waiting for rate-limit room). Result: ${exitCode === 0 ? 'PASS' : 'FAIL'}`,
  );
  return exitCode;
}

/**
 * Ends the process with `code` once stdout and stderr are flushed (a pipe is asynchronous on macOS: process.exit alone can cut the
 * summary). Bounded, so a stuck stream cannot hold the exit either.
 * @param {number} code
 */
async function exitWith(code) {
  const flushed = (/** @type {NodeJS.WriteStream} */ stream) => new Promise((resolve) => stream.write('', () => resolve(null)));
  await Promise.race([Promise.all([flushed(process.stdout), flushed(process.stderr)]), new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS).unref())]);
  process.exit(code);
}

// An explicit exit, not process.exitCode: a browser that CaptureSession.reset() had to leave behind (it did not close within
// CLOSE_TIMEOUT_MS) keeps a handle open, and Node then never ended (H1: a runner held the qa-run lock for over 30 minutes after its
// summary). Playwright's exit handler kills the browsers it launched when the process exits.
main().then(
  (code) => exitWith(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    return exitWith(2);
  },
);
