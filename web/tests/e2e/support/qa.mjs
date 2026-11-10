// QA overrides, deterministic browser contexts and the "page is stable" wait.
// Used by Playwright specs and by the standalone visual runner, hence plain ESM with JSDoc types.
import http from 'node:http';
import https from 'node:https';
import { DEFAULT_THEME, tokens } from './tokens.mjs';

export const BASE_URL = (process.env.SPEEDCLUB_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');

/** Fixed clock of every QA run. DemoSeeder dates are relative to this instant. */
export const QA_NOW = '2026-11-02T10:00:00.000Z';
/** Must match `config('speedclub.qa.user_agent')`, whose known-device fingerprint DemoSeeder stores for every demo member. */
export const QA_USER_AGENT = 'SpeedClubQA/1.0 (Playwright)';
export const QA_TIMEZONE = 'Europe/Berlin';
export const QA_LOCALES = /** @type {const} */ ({ de: 'de-DE', en: 'en-GB' });

/**
 * @typedef {object} QaOptions
 * @property {string} [theme] carbon | black | light
 * @property {'de'|'en'} [locale]
 * @property {number} [fontScale] 1 or 2
 * @property {string} [state] default | loading | empty | error | offline | route-specific
 * @property {'off'|'on'} [motion]
 * @property {string} [now] ISO timestamp
 */

/**
 * Adds the qa* overrides to a path. Absolute URLs and existing query strings are preserved.
 * @param {string} path
 * @param {QaOptions} [opts]
 * @returns {string} path + query, or an absolute URL if one was given
 */
export function qaUrl(path, opts = {}) {
  const { theme, locale, fontScale, state, motion = 'off', now = QA_NOW } = opts;
  const url = new URL(path, 'http://qa.invalid');
  const q = url.searchParams;
  if (theme) q.set('qaTheme', theme);
  if (locale) q.set('qaLocale', locale);
  if (fontScale && fontScale !== 1) q.set('qaFontScale', String(fontScale));
  if (state && state !== 'default') q.set('qaState', state);
  if (motion === 'off') q.set('qaMotion', 'off');
  if (now) q.set('qaNow', now);
  const relative = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === 'http://qa.invalid' ? relative : `${url.origin}${relative}`;
}

/**
 * Identifies the deployed Expo export: its HTML names the content-hashed bundles. Re-exporting during
 * a run deletes chunks the pages still ask for, so results of such a run mean nothing.
 * @param {string} [baseUrl]
 * @returns {Promise<string>}
 */
export async function appFingerprint(baseUrl = BASE_URL) {
  // Not fetch(): its pooled handles were still closing when Playwright exits, which crashes Node 24
  // on Windows with a libuv assertion and exit code 127, even after a green run.
  const html = await new Promise((resolve, reject) => {
    const client = baseUrl.startsWith('https:') ? https : http;
    const request = client.get(`${baseUrl}/app/`, { agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => {
        if (response.statusCode === 200) resolve(body);
        else reject(new Error(`HTTP ${response.statusCode}`));
      });
    });
    request.on('error', reject);
  });
  const bundles = /** @type {string} */ (html).match(/_expo\/static\/js\/web\/[^"']+\.js/g) ?? [];
  return bundles.sort().join('|');
}

export const EXPORT_CHANGED_MESSAGE =
  'web/public/app was re-exported during this run, so its results are invalid. Run it again without a concurrent export.';

/**
 * Browser context options for one matrix cell. Device scale 1 so design QA can open images at 1x.
 * @param {{theme?:string,locale?:'de'|'en',viewport?:{width:number,height:number}}} [opts]
 */
export function contextOptions({ theme = DEFAULT_THEME, locale = 'de', viewport = { width: 390, height: 844 } } = {}) {
  return {
    baseURL: BASE_URL,
    viewport,
    deviceScaleFactor: 1,
    locale: QA_LOCALES[locale],
    timezoneId: QA_TIMEZONE,
    colorScheme: /** @type {'dark'|'light'} */ (tokens.themes[theme].colorScheme),
    reducedMotion: /** @type {const} */ ('reduce'),
    serviceWorkers: /** @type {const} */ ('block'),
  };
}

/**
 * Fixed clock and no third-party network. Date is frozen; timers keep running, so the app behaves
 * normally while everything it renders from the clock stays the same on every run.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{now?:string,baseUrl?:string,onBlocked?:(url:string)=>void}} [opts]
 */
export async function makeContextDeterministic(context, opts = {}) {
  const { now = QA_NOW, baseUrl = BASE_URL, onBlocked } = opts;
  const origin = new URL(baseUrl).origin;
  const isThirdParty = (/** @type {URL} */ url) =>
    /^(https?|wss?):$/.test(url.protocol) && url.origin.replace(/^ws/, 'http') !== origin;
  await context.clock.setFixedTime(new Date(now));
  await context.route(isThirdParty, async (route) => {
    onBlocked?.(route.request().url());
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket(isThirdParty, (ws) => {
    onBlocked?.(ws.url());
    void ws.close();
  });
}

/**
 * Counts in-flight requests. Replaces `networkidle` in the matrix, whose fixed 500 ms grace period
 * costs more than a whole screenshot.
 * @param {import('@playwright/test').Page} page
 */
export function trackNetwork(page) {
  let inflight = 0;
  let lastChange = Date.now();
  const touch = (/** @type {number} */ d) => {
    inflight += d;
    lastChange = Date.now();
  };
  page.on('request', () => touch(1));
  page.on('requestfinished', () => touch(-1));
  page.on('requestfailed', () => touch(-1));
  return {
    /** @param {{quietMs?:number,timeoutMs?:number}} [o] */
    async waitForQuiet({ quietMs = 120, timeoutMs = 15000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (inflight <= 0 && Date.now() - lastChange >= quietMs) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`Network not quiet after ${timeoutMs} ms (${inflight} requests in flight)`);
    },
  };
}

/**
 * Waits for what makes a screenshot reproducible: network quiet, fonts loaded, images decoded,
 * DOM no longer mutating, two painted frames.
 * @param {import('@playwright/test').Page} page
 * @param {{network?:{waitForQuiet:(o?:{timeoutMs?:number})=>Promise<void>},timeoutMs?:number}} [opts]
 * @returns {Promise<{fontsLoaded:number,imagesFailed:string[],domQuiet:boolean}>}
 */
export async function waitForStablePage(page, { network, timeoutMs = 15000 } = {}) {
  if (network) await network.waitForQuiet({ timeoutMs });
  else await page.waitForLoadState('networkidle', { timeout: timeoutMs });
  return page.evaluate(async (maxWait) => {
    await document.fonts.ready;
    // Only images that are rendered: a lazy image under a hidden screen of a stack never starts loading, and its decode()
    // would wait for ever. Nothing hidden is on the screenshot. The same holds for a lazy image outside the window that has
    // not started, such as the next photos of a pager (WEB-01's hero): the browser loads it only when it comes close.
    const inWindow = (/** @type {HTMLImageElement} */ img) => {
      const r = img.getBoundingClientRect();
      return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    };
    const pending = (/** @type {HTMLImageElement} */ img) => img.loading === 'lazy' && !img.complete && !inWindow(img);
    const failures = await Promise.all(
      [...document.images].filter((img) => img.checkVisibility() && !pending(img)).map((img) =>
        img.decode().then(
          () => null,
          () => (img.getAttribute('src') ? img.currentSrc || img.src : null),
        ),
      ),
    );
    const domQuiet = await new Promise((resolve) => {
      /** @type {ReturnType<typeof setTimeout>} */
      let timer;
      const finish = (/** @type {boolean} */ quiet) => {
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(hardStop);
        resolve(quiet);
      };
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(finish, 100, true);
      });
      const hardStop = setTimeout(finish, maxWait, false);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      timer = setTimeout(finish, 100, true);
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));
    return {
      fontsLoaded: [...document.fonts].filter((f) => f.status === 'loaded').length,
      imagesFailed: /** @type {string[]} */ (failures.filter(Boolean)),
      domQuiet: /** @type {boolean} */ (domQuiet),
    };
  }, Math.min(timeoutMs, 5000));
}

/**
 * The contract between harness and app shell: while an override is active, the root element states
 * what was actually applied. Without this the matrix could screenshot the wrong theme forever
 * and nobody would notice.
 * @param {import('@playwright/test').Page} page
 * @param {{theme?:string,locale?:string,fontScale?:number,state?:string}} expected
 * @returns {Promise<string[]>} human-readable issues; empty when honoured
 */
export async function checkQaContract(page, expected) {
  const applied = await page.evaluate(() => {
    const d = document.documentElement.dataset;
    return { theme: d.qaTheme, locale: d.qaLocale, fontScale: d.qaFontScale, state: d.qaState, motion: d.qaMotion };
  });
  const want = {
    theme: expected.theme,
    locale: expected.locale,
    fontScale: expected.fontScale === undefined ? undefined : String(expected.fontScale),
    state: expected.state ?? 'default',
    motion: 'off',
  };
  const issues = [];
  for (const [key, value] of Object.entries(want)) {
    if (value === undefined) continue;
    const got = applied[/** @type {keyof typeof applied} */ (key)];
    if (got !== value) {
      issues.push(`qa override not honoured: ${key} requested "${value}", app reports "${got ?? 'nothing'}"`);
    }
  }
  return issues;
}
