#!/usr/bin/env node
// Client round 6, item 3 (Build Score gauge smaller): the screens that show the gauge, on the local /app export, as the demo member
// sebastian.demo, on WebKit iPhone 15 Pro and Chromium 1440 × 900. The password comes only from DEMO_MEMBER_PASSWORD in the
// environment and is never printed; no screenshot is taken while it is in the form.
//   DEMO_MEMBER_PASSWORD=… node scripts/dev/r6-build-score-shots.mjs --out=<dir> [--devices=iphone,desktop] [--host=http://localhost:8080]
//   node scripts/dev/r6-build-score-shots.mjs --sheet --before=<dir> --after=<dir> --out=<file.html>   (side-by-side contact sheet)
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));

if ('sheet' in args) {
  const before = resolve(args.before);
  const after = resolve(args.after);
  const out = resolve(args.out);
  const names = readdirSync(before).filter((file) => /\.(png|jpg)$/.test(file)).sort();
  const rel = (dir, file) => relative(dirname(out), join(dir, file));
  const rows = names
    .map(
      (file) => `<section><h2>${basename(file).replace(/\.(png|jpg)$/, '')}</h2><div class="pair">
<figure><figcaption>Before</figcaption><img src="${rel(before, file)}" alt="before ${file}"></figure>
<figure><figcaption>After</figcaption><img src="${rel(after, file)}" alt="after ${file}"></figure></div></section>`,
    )
    .join('\n');
  writeFileSync(
    out,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Build Score gauge, before and after</title><style>
body{margin:0;padding:24px;background:#0b0b0c;color:#f5f5f3;font:14px/20px system-ui,sans-serif}
h1{font-size:22px}h2{font-size:15px;margin:32px 0 8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
figure{margin:0}figcaption{color:#a1a1a6;margin-bottom:4px}img{width:100%;height:auto;border:1px solid #242428}
</style></head><body><h1>Client round 6 · item 3 · Build Score gauge (before | after)</h1>
${rows}</body></html>`,
  );
  console.log('sheet', out);
  process.exit(0);
}

const require = createRequire(join(ROOT, 'web', 'package.json'));
const { chromium, webkit, devices } = require('@playwright/test');
const HOST = args.host ?? 'http://localhost:8080';
const PASSWORD = process.env.DEMO_MEMBER_PASSWORD ?? '';
if (!PASSWORD) throw new Error('DEMO_MEMBER_PASSWORD is not set');
const OUT = resolve(args.out ?? join(ROOT, 'docs', 'reports', 'client-round-6', 'build-score', 'shots'));
mkdirSync(OUT, { recursive: true });
const byId = (page, id) => page.locator(`[data-testid="${id}"]`).first();
const DEVICES = args.devices ? args.devices.split(',') : ['iphone', 'desktop'];
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

async function shot(page, name, { scrollTo } = {}) {
  if (scrollTo) await centre(byId(page, scrollTo));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('shot', name);
}

async function go(page, path, ready) {
  await page.goto(HOST + path, { waitUntil: 'networkidle', timeout: 60000 });
  if (ready) await byId(page, ready).waitFor({ state: 'visible', timeout: 20000 }).catch(() => console.log('not visible:', ready));
  await page.waitForTimeout(1500);
}

for (const [device, engine, context] of [
  ['iphone', webkit, { ...devices['iPhone 15 Pro'] }],
  ['desktop', chromium, { viewport: { width: 1440, height: 900 } }],
].filter(([device]) => DEVICES.includes(device))) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...context, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await signIn(page);
  const api = (path) => page.request.get(`${HOST}/api/v1/${path}`, { headers: { Accept: 'application/json', Referer: `${HOST}/app/` } });
  const garage = await (await api('me/vehicles')).json();
  const own = (garage.data ?? []).find((v) => v.status === 'published' && v.visibility !== 'private' && v.build_score) ?? (garage.data ?? [])[0];

  // VEH-01: the build page with its score.
  await go(page, `/app/v/${own.slug}`, 'VEH-01.score.gauge');
  await shot(page, `veh01-score_${device}`, { scrollTo: 'VEH-01.score.gauge' });
  // GAR-02: the owner's overview with the same section; GAR-01: the garage list with the compact score.
  await go(page, `/app/garage/${own.id}`, 'GAR-02.score.gauge');
  await shot(page, `gar02-score_${device}`, { scrollTo: 'GAR-02.score.gauge' });
  await go(page, '/app/garage', `GAR-01.score.${own.id}`);
  await shot(page, `gar01-garage_${device}`, { scrollTo: `GAR-01.score.${own.id}` });
  // The Dex card of this car.
  await go(page, `/app/dex/car/${own.id}`);
  await shot(page, `dex-card_${device}`);

  // The server's share card (square and story), once.
  if (device === 'iphone') {
    for (const format of ['square', 'story']) {
      const response = await api(`vehicles/${own.id}/share-card.png?format=${format}`);
      if (response.ok()) {
        writeFileSync(join(OUT, `share-card-${format}.png`), await response.body());
        console.log('share card', format);
      } else console.log('share card', format, response.status());
    }
  }
  await browser.close();
}
