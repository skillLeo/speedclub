#!/usr/bin/env node
/**
 * Which files the member web app (/app) requests on its first load, for scripts/perf/bundle-report.mjs --requests (09_PREMIUM_2_0 §12,
 * "Member web JS"; M4.0 baseline, reused by M4.18). Chromium, 390×844 at deviceScaleFactor 1, a fresh context per scenario (empty cache).
 *
 *   node scripts/dev/qa-run.mjs node web/tests/perf/app-chunks.mjs --out=<requests.json> [--shots=<dir>]
 *
 * Scenarios:
 *   guest  /app/ without a session: the landing a guest sees, HOME-01 as guest (numbers.md uses the same label).
 *   home   /app/ signed in as the demo member lukas.sc (HOME-01, Für dich), through the harness's own sign-in (support/auth.mjs).
 * Each waits for its route's content, then for the network to be idle, so the chunks of the visible route are in. SPEEDCLUB_BASE_URL
 * sets the server (default http://localhost:8080). The password comes from web/.env through support/auth.mjs and is never printed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { DEMO_MEMBER, sessionOf, useSession } from '../e2e/support/auth.mjs';
import { BASE_URL, QA_USER_AGENT } from '../e2e/support/qa.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${arg}`);
    return [match[1], match[2] ?? 'true'];
  }),
);

const SCENARIOS = [
  { name: 'guest', path: '/app/', member: false, ready: '[data-testid^="AUTH-02."], [data-testid^="HOME-01."]' },
  { name: 'home', path: '/app/', member: true, ready: '[data-testid^="HOME-01.card."]' },
];

const browser = await chromium.launch();
/** @type {Record<string, string[]>} */
const scenarios = {};
/** @type {Record<string, string>} */
const urls = {};
/** @type {Record<string, {requests: number, transferred_bytes: number, js_requests: number}>} */
const summary = {};

try {
  for (const scenario of SCENARIOS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, userAgent: QA_USER_AGENT, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    if (scenario.member) await useSession(context, await sessionOf(DEMO_MEMBER));
    const page = await context.newPage();
    /** @type {string[]} */
    const requested = [];
    let transferred = 0;
    page.on('request', (request) => requested.push(request.url()));
    page.on('requestfinished', async (request) => {
      const sizes = await request.sizes().catch(() => null);
      if (sizes) transferred += sizes.responseBodySize + sizes.responseHeadersSize;
    });
    const url = `${BASE_URL}${scenario.path}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.locator(scenario.ready).first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    if (args.shots) {
      mkdirSync(resolve(args.shots), { recursive: true });
      await page.screenshot({ path: join(resolve(args.shots), `app-chunks-${scenario.name}.png`) });
    }
    scenarios[scenario.name] = requested;
    urls[scenario.name] = scenario.path;
    summary[scenario.name] = { requests: requested.length, transferred_bytes: transferred, js_requests: requested.filter((u) => /\.m?js(\?|$)/.test(u)).length };
    console.log(`${scenario.name}: ${requested.length} requests, ${summary[scenario.name].js_requests} JS, ${(transferred / 1024).toFixed(1)} KiB transferred`);
    await context.close();
  }
} finally {
  await browser.close();
}

const report = { tool: 'web/tests/perf/app-chunks.mjs', measured_at: new Date().toISOString(), base: BASE_URL, viewport: '390x844@1', urls, summary, scenarios };
if (args.out) {
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`app-chunks: wrote ${out}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
