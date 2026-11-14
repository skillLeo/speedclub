#!/usr/bin/env node
/**
 * The two bundled pictures of the Android widget "Mein Auto" (M4.18, 09 §8.14, ADR-454), from real seed photos (no AI imagery):
 *
 * - mobile/assets/widget/mein-auto-empty.jpg: the empty state's brand photo, porsche-992-01 (Unsplash, CREDITS.md; a night shot
 *   whose plate is blank) cut to the 4:5 hero crop around the car, 480 × 600 like the cut the app makes of a member's photo.
 *   Not the Welcome photo: its seed source carries a flat grey box over a windscreen decal that reads as a censor bar at this size.
 * - mobile/assets/widget/mein-auto-preview.png: the widget picker's preview, a composite of the widget at 4 × 2 cells
 *   (352 × 176 dp at 2×) in Carbon: nissan-r34-01 (Unsplash, design/seed-photos/CREDITS.md) in the photo pane with its plate
 *   blurred, the panel set in the bundled faces with the token colours, and the "Beispiel" badge, because the car is a sample
 *   (09 §8.19).
 *
 *   node design/scripts/build-widget-assets.mjs        (needs web/node_modules for Playwright)
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'mobile', 'assets', 'widget');
mkdirSync(out, { recursive: true });
const tokens = JSON.parse(readFileSync(join(root, 'design', 'tokens', 'tokens.json'), 'utf8'));

const PHOTO = { width: 480, height: 600 };
const QUALITY = 80;

// -- Empty state: the car spans about 90 % of the crop's width, the light bar just below its middle.
await sharp(join(root, 'design', 'seed-photos', 'porsche-992-01.jpg'))
  .extract({ left: 50, top: 300, width: 1180, height: 1475 })
  .resize({ ...PHOTO, kernel: 'lanczos3' })
  .jpeg({ quality: QUALITY, mozjpeg: true })
  .toFile(join(out, 'mein-auto-empty.jpg'));

// -- Preview: the R34's 4:5 crop with its plate blurred (09 §4.6: no readable plates).
const r34 = join(root, 'design', 'seed-photos', 'nissan-r34-01.jpg');
const CROP = { left: 220, top: 560, width: 1080, height: 1350 };
const PLATE = { left: 860, top: 1325, width: 180, height: 95 };
const plate = await sharp(r34).extract(PLATE).blur(12).toBuffer();
const pane = await sharp(r34)
  .composite([{ input: plate, left: PLATE.left, top: PLATE.top }])
  .toBuffer()
  .then((buffer) => sharp(buffer).extract(CROP).resize({ ...PHOTO, kernel: 'lanczos3' }).jpeg({ quality: 88 }).toBuffer());

const c = (key) => tokens.themes.carbon.color[key];
const space = (step) => tokens.space[String(step)];
const radius = (name) => tokens.radius[name];

const font = (file) => `data:font/ttf;base64,${readFileSync(join(root, 'mobile', 'assets', 'fonts', file)).toString('base64')}`;
const WIDGET = { width: 352, height: 176 };
const paneWidth = Math.round(WIDGET.width * 0.42);

/** A type role's size, line and tracking (percent of the size) as CSS. */
const role = (name) => {
  const t = tokens.typography[name];
  const tracking = typeof t.tracking === 'string' ? (Number.parseFloat(t.tracking) / 100) * t.size : t.tracking;
  return `font-size:${t.size}px;line-height:${t.lineHeight}px;letter-spacing:${tracking}px;`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Marque;src:url(${font('ArchivoSemiExpanded-SemiBold.ttf')});}
@font-face{font-family:UiMedium;src:url(${font('Inter-Medium.ttf')});}
@font-face{font-family:UiSemi;src:url(${font('Inter-SemiBold.ttf')});}
html,body{margin:0;background:transparent;}
.w{width:${WIDGET.width}px;height:${WIDGET.height}px;display:flex;border-radius:${radius('xl')}px;overflow:hidden;background:${c('bg.surface')};}
.p{width:${paneWidth}px;height:100%;position:relative;background:url(data:image/jpeg;base64,${pane.toString('base64')}) center/cover;}
.b{position:absolute;left:${space(8)}px;bottom:${space(8)}px;padding:${space(2)}px ${space(8)}px;border-radius:${radius('xs')}px;background:${c('onPhoto.chipBg')};color:${c('onPhoto.primary')};font-family:UiSemi;${role('label.badge')}}
.r{flex:1;padding:${space(16)}px;display:flex;flex-direction:column;justify-content:space-between;}
.g{display:flex;flex-direction:column;gap:${space(4)}px;}
.e{font-family:UiSemi;${role('label.caps')}color:${c('text.secondary')};}
.n{font-family:Marque;${role('display.wordmark')}color:${c('text.primary')};}
.d{font-family:UiMedium;${role('callout')}color:${c('state.warning')};}
</style></head><body><div class="w" id="w">
<div class="p"><span class="b">Beispiel</span></div>
<div class="r"><div class="g"><span class="e">NISSAN</span><span class="n">Skyline GT-R R34</span></div>
<div class="g"><span class="e">HU/AU</span><span class="d">in 23 Tagen</span></div></div>
</div></body></html>`;

const require = createRequire(join(root, 'web', 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: WIDGET.width, height: WIDGET.height } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#w').screenshot({ path: join(out, 'mein-auto-preview.png'), omitBackground: true });
} finally {
  await browser.close();
}
console.log('widget assets written to', out);
