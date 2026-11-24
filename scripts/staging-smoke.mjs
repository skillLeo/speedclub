#!/usr/bin/env node
// Staging smoke (client round 5, R5-1): real pages on the staging host, as a guest and as the demo member sebastian.demo, on WebKit
// iPhone 15 and Chromium 1440 × 900. Every page must answer, show its root, log no console error, fail no request and never scroll
// sideways. The member's password comes only from DEMO_MEMBER_PASSWORD in the environment: it is typed into the sign-in field and
// never printed, logged or written anywhere (screenshots are taken after the sign-in, never of the filled form).
//
//   DEMO_MEMBER_PASSWORD=… node scripts/staging-smoke.mjs [--only=guest|member] [--devices=iphone,desktop] [--out=<dir>] [--host=<url>]
//
// Without the variable the member pass is skipped (and reported as skipped, exit 1 unless --only=guest). One page every ~6 s: the
// host rate-limits rapid requests. Exit 0 only when every page passed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'web', 'package.json'));
const { chromium, webkit, devices } = require('@playwright/test');

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const HOST = (args.host ?? 'https://coral-okapi-906483.hostingersite.com').replace(/\/$/, '');
const EMAIL = args.email ?? 'sebastian.demo@speedclub.test';
const PASSWORD = process.env.DEMO_MEMBER_PASSWORD ?? '';
const ONLY = args.only ?? 'all';
const PAUSE_MS = Number(args.pause ?? 6000);
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const OUT = resolve(args.out ?? join(ROOT, 'docs', 'reports', 'round-5', 'staging-smoke', stamp));
mkdirSync(OUT, { recursive: true });

const DEVICES = {
  iphone: { engine: webkit, name: 'webkit-iphone15', context: { ...devices['iPhone 15'] } },
  desktop: { engine: chromium, name: 'chromium-1440', context: { viewport: { width: 1440, height: 900 } } },
};
const chosen = (args.devices ?? 'iphone,desktop').split(',').map((key) => DEVICES[key]).filter(Boolean);

// A guest's own-account reads answer 401 by design; nothing else may fail.
const GUEST_EXPECTED = /\/api\/v1\/(me|auth\/me|notifications\/unread-count)(\?|$|\/)/;
const results = [];
const pause = () => new Promise((done) => setTimeout(done, PAUSE_MS));
const redact = (text) => (PASSWORD ? text.split(PASSWORD).join('[redacted]') : text);

async function api(page, path) {
  // Referer: the cookie session counts only for requests from the app's own pages (Sanctum's stateful check).
  const response = await page.request.get(HOST + path, { headers: { Accept: 'application/json', Referer: `${HOST}/app/` } });
  return response.ok() ? response.json() : null;
}

/** One page: load (or run `open`), wait for its root, then check console, requests, overflow; a screenshot either way. */
async function visit(page, device, who, id, path, root, { open, expectText } = {}) {
  const errors = [];
  const failed = [];
  const onConsole = (message) => {
    if (message.type() === 'error') errors.push(redact(message.text()).slice(0, 200));
  };
  const onResponse = (response) => {
    const url = response.url();
    if (response.status() < 400 || !url.startsWith(HOST)) return;
    if (who === 'guest' && GUEST_EXPECTED.test(url.replace(HOST, ''))) return;
    failed.push(`${response.status()} ${response.request().method()} ${url.replace(HOST, '')}`.slice(0, 200));
  };
  page.on('console', onConsole);
  page.on('response', onResponse);
  let status = null;
  let rootVisible = false;
  let note = '';
  try {
    if (open) await open();
    else status = (await page.goto(HOST + path, { waitUntil: 'networkidle', timeout: 60000 }))?.status() ?? null;
    if (root) {
      rootVisible = await page
        .locator(`[data-testid="${root}"]`)
        .first()
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => true)
        .catch(() => false);
    } else rootVisible = true;
    await page.waitForTimeout(2000);
    if (expectText) {
      const text = await page.evaluate(() => document.body.innerText);
      if (!expectText.test(text)) note = `text ${expectText} missing`;
    }
  } catch (error) {
    note = redact(error.message.split('\n')[0]).slice(0, 200);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => -1);
  await page.screenshot({ path: join(OUT, `${who}-${device.name}-${id}.jpg`), type: 'jpeg', quality: 72 }).catch(() => {});
  page.off('console', onConsole);
  page.off('response', onResponse);
  const ok = (status === null || status < 400) && rootVisible && errors.length === 0 && failed.length === 0 && overflow <= 0 && note === '';
  const row = { who, device: device.name, id, path: path ?? '(in app)', ok, status, rootVisible, overflow, errors: errors.slice(0, 3), failed: failed.slice(0, 4), note };
  results.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${who} ${device.name} ${id} ${row.path}${ok ? '' : ' ' + JSON.stringify({ status, rootVisible, overflow, errors: row.errors, failed: row.failed, note })}`);
  await pause();
}

async function guestPass(device) {
  const browser = await device.engine.launch();
  const context = await browser.newContext({ ...device.context, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
  const page = await context.newPage();
  const builds = await api(page, '/api/v1/home/new-builds?per_page=3');
  const slug = builds?.data?.[0]?.slug ?? null;
  await visit(page, device, 'guest', 'WEB-03', '/', 'WEB-03.claim');
  await visit(page, device, 'guest', 'WEB-04', '/app-laden', null);
  await visit(page, device, 'guest', 'HOME-01', '/app/', 'HOME-01.root');
  if (slug) {
    await visit(page, device, 'guest', 'WEB-01', `/v/${slug}`, null);
    await visit(page, device, 'guest', 'VEH-01', `/app/v/${slug}`, 'VEH-01.root');
  }
  await visit(page, device, 'guest', 'DEX-01', '/app/dex', null);
  await visit(page, device, 'guest', 'SHOP-01', '/app/shop', 'SHOP-01.root');
  await visit(page, device, 'guest', 'CREW-00', '/app/crews', 'CREW-00.root');
  await visit(page, device, 'guest', 'FOR-01', '/app/forum', null, { expectText: /Forum/ });
  await browser.close();
}

async function memberPass(device) {
  const browser = await device.engine.launch();
  const context = await browser.newContext({ ...device.context, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
  const page = await context.newPage();
  // Sign in through the real form. No screenshot and no console capture while the password is in the field.
  await page.goto(`${HOST}/app/sign-in`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('[data-testid="AUTH-03.email"]').first().fill(EMAIL);
  await page.locator('[data-testid="AUTH-03.password"]').first().fill(PASSWORD);
  const answer = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST', { timeout: 30000 });
  await page.locator('[data-testid="AUTH-03.cta.primary"]').first().click();
  const login = await answer.catch(() => null);
  const signedIn = login?.status() === 200;
  results.push({ who: 'member', device: device.name, id: 'AUTH-03', path: '/app/sign-in', ok: signedIn, status: login?.status() ?? null, note: signedIn ? '' : 'sign-in failed' });
  console.log(`${signedIn ? 'PASS' : 'FAIL'} member ${device.name} AUTH-03 sign-in as ${EMAIL} → HTTP ${login?.status() ?? 'no answer'}`);
  if (!signedIn) {
    await browser.close();
    return;
  }
  await page.waitForTimeout(3000);
  await pause();
  const garage = await api(page, '/api/v1/me/vehicles');
  const own = (garage?.data ?? []).find((vehicle) => vehicle.status === 'published' && vehicle.visibility !== 'private');
  await visit(page, device, 'member', 'HOME-01', '/app/', 'HOME-01.root');
  await visit(page, device, 'member', 'GAR-01', '/app/garage', null);
  if (own) {
    await visit(page, device, 'member', 'VEH-01', `/app/v/${own.slug}`, 'VEH-01.root');
    // Story: VEH-07 from the build's "Mehr" sheet, as a member opens it (the page is in the cache, so the card can be customised).
    await visit(page, device, 'member', 'VEH-07', null, 'VEH-07.preview', {
      open: async () => {
        await page.locator('[data-testid="VEH-01.moreActions"]').first().click();
        await page.locator('[data-testid="VEH-01.moreSheet.shareCard"]').first().click();
      },
    });
  } else {
    results.push({ who: 'member', device: device.name, id: 'VEH-01', ok: false, note: 'no published build in the garage' });
  }
  await visit(page, device, 'member', 'DEX-01', '/app/dex', null);
  await visit(page, device, 'member', 'SHOP-01', '/app/shop', 'SHOP-01.root');
  await visit(page, device, 'member', 'CREW-00', '/app/crews', 'CREW-00.root');
  await visit(page, device, 'member', 'FOR-01', '/app/forum', null, { expectText: /Forum/ });
  await browser.close();
}

for (const device of chosen) {
  if (ONLY === 'all' || ONLY === 'guest') await guestPass(device);
  if (ONLY === 'all' || ONLY === 'member') {
    if (PASSWORD === '') {
      results.push({ who: 'member', device: device.name, id: '-', ok: false, note: 'DEMO_MEMBER_PASSWORD is not set: member pass skipped' });
      console.log(`SKIP member ${device.name}: DEMO_MEMBER_PASSWORD is not set`);
    } else await memberPass(device);
  }
}

const failed = results.filter((row) => !row.ok);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ host: HOST, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots and results.json in ${OUT}`);
process.exit(failed.length === 0 ? 0 : 1);
