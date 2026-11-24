#!/usr/bin/env node
// Round 5 (client report): the screens of points a–f, the Forum, the Shop and the feed actions on the staging host, as the demo
// member sebastian.demo, on WebKit iPhone 15 and Chromium 1440 × 900. The password comes only from DEMO_MEMBER_PASSWORD in the
// environment and is never printed; no screenshot is taken while it is in the form. One page every ~6 s (host rate limit).
//   DEMO_MEMBER_PASSWORD=… node scripts/dev/r5-client-shots.mjs [--out=<dir>] [--only=a,b,c,d,e,f,shop,feed] [--devices=iphone,desktop]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'web', 'package.json'));
const { chromium, webkit, devices } = require('@playwright/test');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const HOST = 'https://coral-okapi-906483.hostingersite.com';
const PASSWORD = process.env.DEMO_MEMBER_PASSWORD ?? '';
if (!PASSWORD) throw new Error('DEMO_MEMBER_PASSWORD is not set');
const OUT = resolve(args.out ?? join(ROOT, 'docs', 'reports', 'round-5', 'client-shots'));
mkdirSync(OUT, { recursive: true });
const pause = (ms = 6000) => new Promise((done) => setTimeout(done, ms));
const byId = (page, id) => page.locator(`[data-testid="${id}"]`).first();
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const want = (key) => !ONLY || ONLY.has(key);
const DEVICES = args.devices ? args.devices.split(',') : ['iphone', 'desktop'];
// The demo M4 has one photo; the viewer shot uses a public showcase build with several.
const GALLERY_SLUG = args.gallery ?? 'nissan-skyline-gt-r-r32-x2607bx5';
// Centre an element in its scroll container (a fixed owner bar or tab bar would hide it at the bottom edge).
const centre = (locator) => locator.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => console.log('not found to centre'));

async function signIn(page) {
  await page.goto(`${HOST}/app/sign-in`, { waitUntil: 'networkidle', timeout: 60000 });
  await byId(page, 'AUTH-03.email').fill('sebastian.demo@speedclub.test');
  await byId(page, 'AUTH-03.password').fill(PASSWORD);
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST');
  await byId(page, 'AUTH-03.cta.primary').click();
  if ((await answer).status() !== 200) throw new Error('sign-in failed');
  await page.waitForTimeout(3000);
}

async function shot(page, name, { scrollTo, fullPage = false } = {}) {
  if (scrollTo) await centre(byId(page, scrollTo));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 78, fullPage });
  console.log('shot', name);
}

async function go(page, path, ready) {
  await page.goto(HOST + path, { waitUntil: 'networkidle', timeout: 60000 });
  if (ready) await byId(page, ready).waitFor({ state: 'visible', timeout: 20000 }).catch(() => console.log('not visible:', ready));
  await page.waitForTimeout(1500);
}

for (const [device, engine, context] of [
  ['iphone', webkit, { ...devices['iPhone 15'] }],
  ['desktop', chromium, { viewport: { width: 1440, height: 900 } }],
].filter(([device]) => DEVICES.includes(device))) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...context, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await signIn(page);
  const garage = await (await page.request.get(`${HOST}/api/v1/me/vehicles`, { headers: { Accept: 'application/json', Referer: `${HOST}/app/` } })).json();
  const own = (garage.data ?? []).find((v) => v.status === 'published' && v.visibility !== 'private');
  const slug = own?.slug;

  // a) hero, b) spec strip, c) Beschreibung on the build page.
  if (want('a') || want('b') || want('c')) {
    await go(page, `/app/v/${slug}`, 'VEH-01.specStrip');
    if (want('a')) await shot(page, `a-hero_${device}`);
    if (want('b')) await shot(page, `b-specs_${device}`, { scrollTo: 'VEH-01.specStrip' });
    if (want('c')) await shot(page, `c-beschreibung_${device}`, { scrollTo: 'VEH-01.descriptionBlock' });
    await pause();
  }
  // d) the photo viewer after a swipe to photo 2.
  if (want('d')) {
    await go(page, `/app/v/${GALLERY_SLUG}`, 'VEH-01.root');
    await page.locator('[data-testid^="VEH-01.hero."]').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.keyboard.press('ArrowRight').catch(() => {});
    await shot(page, `d-viewer_${device}`);
    await pause();
  }
  // e) VEH-07 story card editor (from the build's "Mehr" sheet).
  if (want('e')) {
    await go(page, `/app/v/${slug}`, 'VEH-01.root');
    await byId(page, 'VEH-01.moreActions').click();
    await byId(page, 'VEH-01.moreSheet.shareCard').click();
    await byId(page, 'VEH-07.preview').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    await shot(page, `e-sharecard_${device}`);
    await byId(page, 'VEH-07.template.poster').click().catch(() => {});
    await page.waitForTimeout(4000);
    await shot(page, `e-sharecard-poster_${device}`);
    await pause();
  }
  // f) Forum.
  if (want('f')) {
    await go(page, '/app/forum', null);
    await shot(page, `f-forum_${device}`);
    await pause();
  }
  // Shop: three categories (the last one centred, so all three show), then the sticker page.
  if (want('shop')) {
    await go(page, '/app/shop', 'SHOP-01.root');
    await centre(page.locator('[data-testid^="SHOP-01.category."]').last());
    await shot(page, `shop_${device}`);
    await go(page, '/app/shop/c/sticker', null);
    await shot(page, `shop-sticker_${device}`);
    await pause();
  }
  // Home feed: a car card with heart and Kommentare (mobile WebKit has no mouse wheel: centre the card's action instead).
  if (want('feed')) {
    await go(page, '/app/', 'HOME-01.root');
    // The feed list renders lazily: on desktop (Chromium has a wheel) scroll past the Car of the Day block first.
    if (device === 'desktop') { await page.mouse.move(580, 600); await page.mouse.wheel(0, 1400); await page.waitForTimeout(2000); }
    await centre(page.locator('[data-testid^="HOME-01.card."][data-testid$=".comment"]').first());
    await shot(page, `feed_${device}`);
  }
  await browser.close();
}
console.log('done', OUT);
