#!/usr/bin/env node
/**
 * Renders design/style-tile/index.html (docs/09_PREMIUM_2_0.md §15 M4.1, style tile) to WebP and checks it.
 *
 *   node scripts/dev/qa-run.mjs node design/style-tile/render.mjs
 *   node design/style-tile/render.mjs --check      token mirror only (step 1): no browser, no files written
 *
 * 1 · Token mirror. index.html copies the values the token build does not emit to CSS as --tile-* properties (sizes,
 *     aspect ratios, the scrim text-safe line, the press scale). Each must equal design/tokens/tokens.json or the generated
 *     files. A --tile-* name without a check here, a re-bound scrim that differs from the generated one, and a var(--sc-*)
 *     or .t-* class that the generated CSS does not define (a renamed or retired token, e.g. status.*) fail before anything
 *     renders.
 * 2 · fonts.css from design/fonts/fonts.css (the url()s point at the woff2 files in design/fonts/web).
 * 3 · Render with Chromium from local files only. An external or failed request, a page error, a broken image, a missing
 *     face or horizontal overflow fails the run. Outputs (older style-tile-*.png/.webp files are removed after a clean run):
 *       style-tile-1440.webp · style-tile-390.webp · style-tile-390-en.webp   review: 1x, full page, lossless
 *       style-tile-{1440,390}@2x-{carbon,black,light}.webp                   client: 2x, one image per theme section, q 90
 *     WebP stops at 16,383 px per side, so the 2x pages are cut at the theme sections (the page head goes with Carbon,
 *     the credits with Hell).
 * 4 · Checks on every 1x render, printed as a report:
 *     - On-photo text (DQ-804, ADR-421 b): every [data-onphoto] element over a hero. Its text is hidden, the page is shot
 *       again, and the lightest pixel under each glyph box gives the worst contrast against the text colour: at least
 *       4.5:1, 3:1 for data-onphoto="large". The same is measured with every hero photo replaced by the gate's worst-case
 *       pixel (composite.bases photo.light, white), so the layout holds on any photo. Text must start below the gate's
 *       text-safe line ("large" below the large-text line; "chip" text sits on its own ground and is only measured).
 *     - Two-column rows (DQ-809): where they sit side by side, every second column starts on grid line 8 of the
 *       12-column content grid (7 + 5).
 *     - Red share per theme section, for the whole section and for the worst screen-high window, with and without the
 *       photographs (red = hue ≤ 15° or ≥ 340°, saturation ≥ 0.5, value ≥ 0.35): at most 5 % (SKILL §1). At most one
 *       filled CTA (.btn-primary) per theme section.
 *     The widths 360, 768, 1024 and 1280 get the load, overflow, grid-line and on-photo checks too, without an image.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const require = createRequire(join(root, 'web', 'package.json'));
const { chromium } = require('playwright');
const sharp = require('sharp');

const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const stop = (message) => {
  console.error(`style tile: ${message}`);
  process.exit(1);
};

// 1 · token mirror -------------------------------------------------------------------------------------------
const tokens = JSON.parse(read('design', 'tokens', 'tokens.json'));
const generatedCss = read('web', 'resources', 'css', 'tokens.generated.css');
const generatedTs = read('mobile', 'src', 'theme', 'tokens.generated.ts');
const html = readFileSync(join(here, 'index.html'), 'utf8');

const scrimSafeExport = /export const scrimSafe = (\{.*?\}) as const;/.exec(generatedTs);
if (!scrimSafeExport) stop('mobile/src/theme/tokens.generated.ts no longer exports scrimSafe; update render.mjs');
/** Text-safe lines of scrim.photo per theme, as a share of the photo height (build-tokens --report). */
const scrimSafe = JSON.parse(scrimSafeExport[1]);
/** The tile uses one line for every theme: the highest, so it is safe in each. */
const safeLine = (kind) => Math.max(...Object.values(scrimSafe).map((theme) => theme[kind]));
const aspect = (key) => {
  const m = /^(\d+):(\d+)$/.exec(tokens.aspect?.[key] ?? '');
  if (!m) stop(`tokens.json aspect.${key} is not "w:h"`);
  const [w, h] = [Number(m[1]), Number(m[2])];
  return { ratio: `${w} / ${h}`, height: `${Number(((h / w) * 100).toFixed(4))}%` };
};
const hairlineWeb = /(\d+(?:\.\d+)?)px \(web\)/.exec(tokens.border.hairline)?.[1];
if (!hairlineWeb) stop('tokens.json border.hairline no longer names the web width ("… / 1px (web) …"); update render.mjs');

const mirror = {
  '--tile-size-button-l': `${tokens.size.button.l}px`,
  '--tile-size-button-m': `${tokens.size.button.m}px`,
  '--tile-size-chip': `${tokens.size.chip}px`,
  '--tile-size-icon-button': `${tokens.size.iconButton}px`,
  '--tile-size-avatar-sm': `${tokens.size.avatar.sm}px`,
  '--tile-size-status-pill': `${tokens.size.statusPill}px`,
  '--tile-size-icon-m': `${tokens.size.icon.m}px`,
  '--tile-size-unread-dot': `${tokens.size.unreadDot}px`,
  '--tile-size-row': `${tokens.size.row.single}px`,
  '--tile-hairline': `${hairlineWeb}px`,
  '--tile-focus-ring': `${tokens.border.focusRing}px`,
  '--tile-focus-offset': `${tokens.border.focusRingOffset}px`,
  '--tile-press-scale': String(tokens.motion.press.scale),
  '--tile-aspect-hero': aspect('hero').ratio,
  '--tile-hero-h': aspect('hero').height,
  '--tile-aspect-hero-web': aspect('heroWeb').ratio,
  '--tile-hero-h-web': aspect('heroWeb').height,
  '--tile-aspect-rail': aspect('rail').ratio,
  '--tile-aspect-editorial': aspect('editorial').ratio,
  '--tile-scrim-safe-text': String(safeLine('text')),
};
const drift = [];
const declared = new Map();
for (const m of html.matchAll(/(--tile-[a-z0-9-]+)\s*:\s*([^;]+);/g)) if (!declared.has(m[1])) declared.set(m[1], m[2].trim());
for (const [name, want] of Object.entries(mirror)) {
  const got = declared.get(name);
  if (got !== want) drift.push(`${name}: index.html ${got ?? '(missing)'} · tokens ${want}`);
}
for (const name of declared.keys()) if (!(name in mirror)) drift.push(`${name}: declared in index.html without a check (add it to the mirror in render.mjs)`);
// The scrims are re-bound per theme section; they must stay the generated gradients.
for (const name of ['--sc-scrim-photo', '--sc-scrim-top']) {
  const want = new RegExp(`${name}:\\s*([^;]+);`).exec(generatedCss)?.[1].trim();
  const got = new RegExp(`${name}:\\s*([^;]+);`).exec(html)?.[1].trim();
  if (!want) drift.push(`${name}: tokens.generated.css no longer declares it; update index.html and render.mjs`);
  else if (got !== want) drift.push(`${name}: index.html ${got ?? '(missing)'} · generated ${want}`);
}
// Every custom property and type class the tile uses must exist in the generated CSS (catches retired tokens).
const definedVars = new Set([...generatedCss.matchAll(/(--sc-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
for (const m of html.matchAll(/(--sc-[a-z0-9-]+)\s*:/g)) definedVars.add(m[1]);
for (const name of new Set([...html.matchAll(/var\((--sc-[a-z0-9-]+)/g)].map((m) => m[1]))) {
  if (!definedVars.has(name)) drift.push(`var(${name}): not defined in tokens.generated.css (renamed or retired token)`);
}
const typeClasses = new Set([...generatedCss.matchAll(/^\.(t-[a-z0-9-]+)\s*\{/gm)].map((m) => m[1]));
const usedClasses = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('t-')));
for (const name of usedClasses) if (!typeClasses.has(name)) drift.push(`.${name}: not a type class in tokens.generated.css`);
if (drift.length) stop(`token mirror drifted\n  ${drift.join('\n  ')}`);
if (process.argv.includes('--check')) {
  console.log(`style tile: token mirror matches (${Object.keys(mirror).length} --tile-* values, 2 scrims, ${usedClasses.size} type classes, every var(--sc-*) defined)`);
  process.exit(0);
}

// 2 · fonts.css from the fonts pipeline (design/fonts/fonts.css points at ../fonts/2.0/, the web copy; here: design/fonts/web)
const fontsSrc = read('design', 'fonts', 'fonts.css');
if (!/url\("\.\.\/fonts\/2\.0\//.test(fontsSrc)) stop('design/fonts/fonts.css no longer uses url("../fonts/2.0/…"); update the rewrite in render.mjs');
const fontsCss = fontsSrc.replace(/^\/\*[\s\S]*?\*\/\n/, '').replaceAll('url("../fonts/2.0/', 'url("../fonts/web/');
writeFileSync(join(here, 'fonts.css'),
  '/* AUTO-GENERATED by design/style-tile/render.mjs from design/fonts/fonts.css — DO NOT EDIT BY HAND.\n' +
  ' * Same faces and unicode ranges; the url()s point at the woff2 files in design/fonts/web. */\n' + fontsCss);

// 3 · render -------------------------------------------------------------------------------------------------
const pageUrl = pathToFileURL(join(here, 'index.html')).href;
const THEMES = ['carbon', 'black', 'light'];
const FACES = ['Inter', 'Inter Display', 'Archivo Condensed', 'Archivo SemiExpanded'];
const WEBP_MAX = 16383;
const RED_MAX = 0.05;
/** The worst-case photo pixel of the contrast gate (tokens.json composite.bases). */
const PHOTO_LIGHT = tokens.composite?.bases?.['photo.light'];
if (!/^#[0-9A-Fa-f]{6}$/.test(PHOTO_LIGHT ?? '')) stop('tokens.json composite.bases["photo.light"] is missing; update render.mjs');
const reviews = [
  { w: 1440, h: 900, lang: 'de', file: 'style-tile-1440.webp' },
  { w: 390, h: 844, lang: 'de', file: 'style-tile-390.webp' },
  { w: 390, h: 844, lang: 'en', file: 'style-tile-390-en.webp' },
];
const clients = [
  { w: 1440, h: 900, prefix: 'style-tile-1440@2x' },
  { w: 390, h: 844, prefix: 'style-tile-390@2x' },
];
/** Checked like the renders (overflow, faces, grid line, on-photo contrast), but no image is written. */
const SWEEP = [360, 768, 1024, 1280];
const problems = [];
const written = new Set();

async function open(browser, { w, h, dsf, lang, label }) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, colorScheme: 'dark', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('request', (req) => { if (!/^(file|data):/.test(req.url())) problems.push(`${label}: external request ${req.url()}`); });
  page.on('requestfailed', (req) => problems.push(`${label}: failed ${req.url()} (${req.failure()?.errorText})`));
  page.on('pageerror', (err) => problems.push(`${label}: page error ${err.message}`));
  await page.goto(lang === 'en' ? `${pageUrl}?lang=en` : pageUrl, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => null)));
  });
  const facts = await page.evaluate((themes) => ({
    lang: document.documentElement.lang,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    height: document.documentElement.scrollHeight,
    fonts: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')} ${f.weight}`))],
    brokenImages: [...document.images].filter((img) => !img.naturalWidth).map((img) => img.getAttribute('src')),
    sections: themes.map((theme) => {
      const el = document.querySelector(`[data-tile-theme="${theme}"]`);
      const r = el.getBoundingClientRect();
      return { theme, top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), ctas: el.querySelectorAll('.btn-primary').length };
    }),
    // DQ-809: the second column of every two-column row, and the content column it sits in.
    splits: [...document.querySelectorAll('.split')].map((el) => {
      const first = el.firstElementChild.getBoundingClientRect();
      const last = el.lastElementChild.getBoundingClientRect();
      return { left: last.left, layout: last.left > first.left + 1 ? 'row' : 'stacked' };
    }),
    content: (() => { const r = document.querySelector('.theme-body > .container').getBoundingClientRect(); return { left: r.left, width: r.width }; })(),
    gutter: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sc-space-24')),
  }), THEMES);
  if (facts.overflow > 0) problems.push(`${label}: horizontal overflow ${facts.overflow}px`);
  for (const src of facts.brokenImages) problems.push(`${label}: image did not load ${src}`);
  for (const face of FACES) if (!facts.fonts.some((f) => f.startsWith(`${face} `))) problems.push(`${label}: face ${face} did not load`);
  if (facts.lang !== lang) problems.push(`${label}: page language ${facts.lang}, expected ${lang}`);
  return { context, page, facts };
}

async function pixels(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

const linear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Red pixels per row between top and bottom (page pixels at 1x). */
function redRows(img, top, bottom) {
  const rows = [];
  for (let y = top; y < Math.min(bottom, img.height); y++) {
    let n = 0;
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * img.channels;
      const r = img.data[i] / 255, g = img.data[i + 1] / 255, b = img.data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max !== r || max < 0.35 || (max - min) / max < 0.5) continue;
      let hue = 60 * (((g - b) / (max - min)) % 6);
      if (hue < 0) hue += 360;
      if (hue <= 15 || hue >= 340) n++;
    }
    rows.push(n);
  }
  return rows;
}

/** Share of red pixels in the whole span and in the worst window of one screen height. */
function redShare(rows, width, screen) {
  const total = rows.reduce((a, b) => a + b, 0);
  const span = Math.min(screen, rows.length);
  let sum = rows.slice(0, span).reduce((a, b) => a + b, 0);
  let worst = sum;
  for (let y = span; y < rows.length; y++) {
    sum += rows[y] - rows[y - span];
    if (sum > worst) worst = sum;
  }
  return { whole: total / (rows.length * width), window: worst / (span * width) };
}

const pct = (share) => `${(share * 100).toFixed(2)} %`;

async function checkRed(page, label, sections, width, screen, png) {
  const measure = async (img, what) => {
    for (const s of sections) {
      const share = redShare(redRows(img, s.top, s.bottom), width, screen);
      console.log(`  red ${s.theme.padEnd(6)} ${what.padEnd(11)} section ${pct(share.whole)} · worst screen ${pct(share.window)}`);
      if (share.window > RED_MAX) problems.push(`${label}: red share ${pct(share.window)} in a ${s.theme} screen (${what}), max 5 %`);
    }
  };
  await measure(await pixels(png), 'with photos');
  const noPhotos = await page.addStyleTag({ content: 'img { visibility: hidden !important; }' });
  await measure(await pixels(await page.screenshot({ fullPage: true })), 'UI only');
  await noPhotos.evaluate((el) => el.remove());
}

async function checkOnPhoto(page, label, { compact = false } = {}) {
  const glyphs = await page.evaluate(() => {
    const out = [];
    for (const section of document.querySelectorAll('[data-tile-theme]')) {
      for (const hero of section.querySelectorAll('.hero')) {
        const media = hero.querySelector('.hero-media').getBoundingClientRect();
        for (const el of hero.querySelectorAll('[data-onphoto]')) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const box = el.getBoundingClientRect();
          out.push({
            theme: section.dataset.tileTheme,
            role: el.dataset.onphoto,
            text: el.textContent.trim(),
            color: getComputedStyle(el).color,
            photoHeight: media.height,
            fromTop: box.top - media.top, // the element's first line box, measured from the photo's top edge
            rects: [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
              .map((r) => ({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height })),
          });
        }
      }
    }
    return out;
  });
  // Shot 1: the real photographs, text hidden. Shot 2: every hero photo replaced by the gate's worst-case photo pixel
  // (composite.bases photo.light), text hidden: the identity must hold on any photo, not only on this dark one.
  const hidden = await page.addStyleTag({ content: '[data-onphoto] { color: transparent !important; text-shadow: none !important; }' });
  const real = await pixels(await page.screenshot({ fullPage: true }));
  const blank = await page.addStyleTag({ content: `.hero-media > img { visibility: hidden !important; } .hero-media { background: ${PHOTO_LIGHT} !important; }` });
  const worstCase = await pixels(await page.screenshot({ fullPage: true }));
  await blank.evaluate((el) => el.remove());
  await hidden.evaluate((el) => el.remove());
  const lines = { large: safeLine('large'), text: safeLine('text') };
  /** Lowest contrast of the text colour against any pixel under the glyph boxes. */
  const lowest = (img, textL, rects) => {
    let worst = Infinity;
    let at = null;
    for (const r of rects) {
      const x0 = Math.max(0, Math.floor(r.x)), x1 = Math.min(img.width, Math.ceil(r.x + r.w));
      const y0 = Math.max(0, Math.floor(r.y)), y1 = Math.min(img.height, Math.ceil(r.y + r.h));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * img.channels;
          const c = contrast(textL, luminance(img.data[i], img.data[i + 1], img.data[i + 2]));
          if (c < worst) { worst = c; at = { x, y }; }
        }
      }
    }
    return { worst, at };
  };
  const summary = {};
  for (const g of glyphs) {
    const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(g.color);
    const textL = luminance(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
    const onPhoto = lowest(real, textL, g.rects);
    const onWhite = lowest(worstCase, textL, g.rects);
    const min = g.role === 'large' ? 3 : 4.5;
    const share = g.fromTop / g.photoHeight;
    const first = g.rects[0];
    const where = first ? `glyph box y ${Math.floor(first.y)}–${Math.ceil(first.y + first.h)}` : 'no glyph box';
    if (!compact) console.log(`  on-photo ${g.theme.padEnd(6)} ${g.role.padEnd(5)} ${JSON.stringify(g.text).padEnd(24)} from ${share.toFixed(3)} of the photo · ${where} · worst ${onPhoto.worst.toFixed(2)}:1, on a white photo ${onWhite.worst.toFixed(2)}:1 (min ${min})`);
    const s = (summary[g.role] ??= { from: Infinity, photo: Infinity, white: Infinity });
    s.from = Math.min(s.from, share);
    s.photo = Math.min(s.photo, onPhoto.worst);
    s.white = Math.min(s.white, onWhite.worst);
    for (const [what, m] of [['over the photo', onPhoto], ['over a white photo', onWhite]]) {
      if (!(m.worst >= min)) problems.push(`${label}: ${g.theme} "${g.text}" ${m.worst.toFixed(2)}:1 ${what} (worst pixel at ${m.at?.x},${m.at?.y}), needs ${min}:1`);
    }
    const line = lines[g.role];
    if (line !== undefined && g.fromTop < line * g.photoHeight - 0.5) {
      problems.push(`${label}: ${g.theme} "${g.text}" starts at ${share.toFixed(3)} of the photo, above the text-safe line ${line}`);
    }
  }
  if (compact) {
    console.log(`  on-photo (all themes, lowest): ${Object.entries(summary).map(([role, s]) => `${role} from ${s.from.toFixed(3)}, ${s.photo.toFixed(2)}:1, white photo ${s.white.toFixed(2)}:1`).join(' · ')}`);
  }
}

/** Two-column rows: one right-column edge, on grid line 8 of the 12-column content grid (7 + 5) where they sit side by side. */
function checkSplits(facts, label) {
  const side = facts.splits.filter((s) => s.layout === 'row');
  if (!side.length) {
    console.log(`  two-column rows: all ${facts.splits.length} stacked`);
    return;
  }
  const column = (facts.content.width - 11 * facts.gutter) / 12;
  const line8 = facts.content.left + 7 * (column + facts.gutter);
  const edges = [...new Set(side.map((s) => s.left.toFixed(2)))];
  console.log(`  two-column rows: ${side.length} of ${facts.splits.length} side by side, right column at x ${edges.join(', ')} · grid line 8 at x ${line8.toFixed(2)} (column ${column.toFixed(2)}, gutter ${facts.gutter})`);
  if (edges.length !== 1 || Math.abs(Number(edges[0]) - line8) > 0.5) problems.push(`${label}: two-column rows do not share grid line 8 (x ${edges.join(', ')} vs ${line8.toFixed(2)})`);
}

const browser = await chromium.launch();
try {
  for (const shot of reviews) {
    const label = shot.file;
    const { context, page, facts } = await open(browser, { ...shot, dsf: 1, label });
    console.log(`\n${shot.file}  ${shot.w}×${facts.height} css px @1x  ${shot.lang}  fonts: ${facts.fonts.join(', ')}`);
    console.log(`  sections (y): ${facts.sections.map((s) => `${s.theme} ${s.top}–${s.bottom}`).join(' · ')}`);
    for (const s of facts.sections) if (s.ctas > 1) problems.push(`${label}: ${s.ctas} filled CTAs in ${s.theme}, max 1`);
    console.log(`  filled CTAs (.btn-primary): ${facts.sections.map((s) => `${s.theme} ${s.ctas}`).join(' · ')}`);
    checkSplits(facts, label);
    if (facts.height > WEBP_MAX) problems.push(`${label}: ${facts.height} px is taller than WebP allows (${WEBP_MAX})`);
    const png = await page.screenshot({ fullPage: true });
    await sharp(png).webp({ lossless: true, effort: 6 }).toFile(join(here, shot.file));
    written.add(shot.file);
    await checkOnPhoto(page, label);
    await checkRed(page, label, facts.sections, shot.w, shot.h, png);
    await context.close();
  }
  // Widths between the two renders: no image, the same layout checks (the hero turns 16:9 at 768, the grid starts at 1280).
  for (const w of SWEEP) {
    const label = `sweep ${w}`;
    const { context, page, facts } = await open(browser, { w, h: 900, dsf: 1, lang: 'de', label });
    console.log(`\n${label}  ${w}×${facts.height} css px, no image`);
    checkSplits(facts, label);
    await checkOnPhoto(page, label, { compact: true });
    await context.close();
  }
  for (const shot of clients) {
    const label = `${shot.prefix}-*`;
    const { context, page, facts } = await open(browser, { ...shot, dsf: 2, lang: 'de', label });
    const at = Object.fromEntries(facts.sections.map((s) => [s.theme, s]));
    const parts = [
      { theme: 'carbon', y: 0, h: at.carbon.bottom },
      { theme: 'black', y: at.black.top, h: at.black.bottom - at.black.top },
      { theme: 'light', y: at.light.top, h: facts.height - at.light.top },
    ];
    for (const part of parts) {
      const file = `${shot.prefix}-${part.theme}.webp`;
      if (part.h * 2 > WEBP_MAX) { problems.push(`${file}: ${part.h * 2} px is taller than WebP allows (${WEBP_MAX})`); continue; }
      const png = await page.screenshot({ clip: { x: 0, y: part.y, width: shot.w, height: part.h }, fullPage: true });
      await sharp(png).webp({ quality: 90, effort: 6 }).toFile(join(here, file));
      written.add(file);
      console.log(`${file}  ${shot.w}×${part.h} css px @2x`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

console.log('\nfiles');
let total = 0;
for (const name of [...written].sort()) {
  const size = statSync(join(here, name)).size;
  total += size;
  console.log(`  ${name.padEnd(34)} ${(size / 1024).toFixed(0).padStart(6)} KB`);
}
console.log(`  ${'total'.padEnd(34)} ${(total / 1048576).toFixed(2).padStart(6)} MB`);

if (problems.length) {
  console.error(`\nstyle tile: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
const stale = readdirSync(here).filter((name) => /^style-tile-.*\.(png|webp)$/.test(name) && !written.has(name));
for (const name of stale) rmSync(join(here, name));
if (stale.length) console.log(`removed older outputs: ${stale.join(', ')}`);
console.log('style tile: rendered and checked (token mirror, local files only, faces, no overflow at 360–1440, on-photo contrast on the photo and on white, grid line 8, red share, one filled CTA)');
