#!/usr/bin/env node
/**
 * Admin browser timings for docs/09_PREMIUM_2_0.md §12 "Admin: first load ≤ 2 s at 1440; table filter ≤ 400 ms server" (M4.0
 * baseline, reused by M4.18). Chromium at 1440×900, deviceScaleFactor 1.
 *
 *   node scripts/dev/qa-run.mjs node web/tests/perf/admin-timing.mjs [--samples=3] [--out=<file.json>] [--shots=<dir>]
 *
 * Signs in as the staff owner fixture of the E2E harness (support/staff.mjs: real /admin/login and TOTP challenge over HTTP; the
 * fixtures exist for this process only and are removed when it exits). Per sample, a fresh browser context (empty cache, the session's
 * cookies only):
 *   first load  GET /admin (ADM-06): Navigation Timing (TTFB = responseStart, DOMContentLoaded, load) and "ready", the moment the
 *               dashboard's queues are visible (performance.now() after the selector appeared; Playwright polls, so a few ms late),
 *               and "settled", the end of the last request once the network is idle (the deferred KPI cards included).
 *   filter      one members-table filter as the table sends it: an Inertia visit GET /admin/members?filter[q]=<text> (X-Inertia,
 *               the page's asset version). Server time = responseStart − requestStart of its Resource Timing entry (TTFB on
 *               localhost, i.e. the server's processing); total = duration.
 * Median of the samples. SPEEDCLUB_BASE_URL sets the server (default http://localhost:8080, the dev server as it runs).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { BASE_URL, QA_USER_AGENT } from '../e2e/support/qa.mjs';
import { staffRun, staffSignIn } from '../e2e/support/staff.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${arg}`);
    return [match[1], match[2] ?? 'true'];
  }),
);
const samples = Number(args.samples ?? 3);
const filterText = args.q ?? 'lukas';
const READY = '[data-testid="ADM-06"] [data-testid="ADM-06.queues"]';

const median = (/** @type {number[]} */ values) => {
  const list = [...values].sort((a, b) => a - b);
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};
const round = (/** @type {number} */ n) => Math.round(n * 10) / 10;

const run = await staffRun();
const cookies = await staffSignIn(run, 'owner');
const browser = await chromium.launch();
/** @type {any[]} */
const results = [];

try {
  for (let i = 0; i < samples; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: QA_USER_AGENT, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    await context.addCookies(cookies);
    const page = await context.newPage();
    const response = await page.goto(`${BASE_URL}/admin`, { waitUntil: 'load' });
    if (response?.status() !== 200 || !new URL(page.url()).pathname.startsWith('/admin')) throw new Error(`GET /admin answered ${response?.status()} at ${page.url()}`);
    await page.locator(READY).first().waitFor({ state: 'visible', timeout: 30_000 });
    const ready = await page.evaluate(() => performance.now());
    // The KPI cards are deferred props: settled = the end of the last request once the network is idle.
    await page.waitForLoadState('networkidle');
    const settled = await page.evaluate(() =>
      Math.max(...performance.getEntriesByType('resource').map((r) => /** @type {PerformanceResourceTiming} */ (r).responseEnd), 0),
    );
    const nav = await page.evaluate(() => {
      const entry = /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0]);
      const resources = performance.getEntriesByType('resource');
      return {
        ttfb: entry.responseStart,
        dcl: entry.domContentLoadedEventEnd,
        load: entry.loadEventEnd,
        document_bytes: entry.transferSize,
        resources: resources.length,
        resource_bytes: resources.reduce((total, r) => total + (/** @type {PerformanceResourceTiming} */ (r).transferSize || 0), 0),
      };
    });
    if (args.shots && i === 0) {
      mkdirSync(resolve(args.shots), { recursive: true });
      await page.screenshot({ path: join(resolve(args.shots), 'admin-timing-ADM-06.png') });
    }

    const filter = await page.evaluate(async (q) => {
      // Inertia v3 writes the page object into <script data-page="app" type="application/json">.
      const data = document.querySelector('script[data-page]')?.textContent ?? document.querySelector('#app')?.getAttribute('data-page');
      const version = data ? JSON.parse(data).version : null;
      const url = `/admin/members?filter%5Bq%5D=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { 'X-Inertia': 'true', ...(version ? { 'X-Inertia-Version': String(version) } : {}), 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html, application/xhtml+xml' },
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => null);
      const entry = /** @type {PerformanceResourceTiming|undefined} */ (performance.getEntriesByType('resource').filter((e) => e.name.includes('/admin/members?')).at(-1));
      return {
        status: res.status,
        component: body?.component ?? null,
        server_ms: entry ? entry.responseStart - entry.requestStart : null,
        total_ms: entry ? entry.duration : null,
      };
    }, filterText);
    if (filter.status !== 200 || filter.component !== 'Members/Index') throw new Error(`The filter request answered ${filter.status} (${filter.component})`);

    results.push({ sample: i + 1, first_load: { ...nav, ready, settled }, filter });
    console.log(
      `sample ${i + 1}: /admin TTFB ${round(nav.ttfb)} ms, DCL ${round(nav.dcl)} ms, load ${round(nav.load)} ms, ready ${round(ready)} ms, settled ${round(settled)} ms; filter server ${round(filter.server_ms ?? NaN)} ms, total ${round(filter.total_ms ?? NaN)} ms`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}

const pick = (/** @type {(r: any) => number} */ f) => round(median(results.map(f)));
const report = {
  tool: 'web/tests/perf/admin-timing.mjs',
  measured_at: new Date().toISOString(),
  base: BASE_URL,
  viewport: '1440x900@1',
  staff: 'owner fixture (support/staff.mjs)',
  filter: `GET /admin/members?filter[q]=${filterText} as an Inertia visit`,
  machine: { platform: `${os.platform()} ${os.release()}`, arch: os.arch(), cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, load_average: os.loadavg().map((n) => round(n)) },
  samples: results.length,
  median: {
    first_load_ttfb_ms: pick((r) => r.first_load.ttfb),
    first_load_dcl_ms: pick((r) => r.first_load.dcl),
    first_load_load_ms: pick((r) => r.first_load.load),
    first_load_ready_ms: pick((r) => r.first_load.ready),
    first_load_settled_ms: pick((r) => r.first_load.settled),
    filter_server_ms: pick((r) => r.filter.server_ms),
    filter_total_ms: pick((r) => r.filter.total_ms),
  },
  each: results,
};
console.log(JSON.stringify(report.median));
if (args.out) {
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`admin-timing: wrote ${out}`);
}
