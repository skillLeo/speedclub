#!/usr/bin/env node
/**
 * SPEED CLUB — derive every brand asset from the client's logo files in design/brand.
 * Nothing here is edited by hand and the logo is never redrawn: it is only scaled and placed.
 *
 * Usage: npm --prefix design run brand
 *
 * Outputs
 *   mobile/assets/images/  icon, Android adaptive foreground + monochrome, splash, favicon
 *   mobile/assets/brand/   wordmarks used by the app at brand moments
 *   web/public/            favicon.ico, PNG favicons, touch icons
 *   web/public/brand/      wordmarks for Blade and e-mails, default OG image, on-texture hero
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const brand = join(root, 'design', 'brand');
const tokens = JSON.parse(readFileSync(join(root, 'design', 'tokens', 'tokens.json'), 'utf8'));
const CANVAS = tokens.themes.carbon.color['bg.canvas'];

const mobileImages = join(root, 'mobile', 'assets', 'images');
const mobileBrand = join(root, 'mobile', 'assets', 'brand');
const webPublic = join(root, 'web', 'public');
const webBrand = join(webPublic, 'brand');
for (const dir of [mobileImages, mobileBrand, webPublic, webBrand]) mkdirSync(dir, { recursive: true });

const SQUARE_WHITE = join(brand, 'logo-square-white.png');
const WIDE_WHITE = join(brand, 'logo-wide-white.png');
const WIDE_BLACK = join(brand, 'logo-wide-black.png');
const SQUARE_BLACK = join(brand, 'logo-square-black.png');
// Client round 3 (2026-11-19): the app mark is the client's own square icon (letters on the brush texture), used as is.
const APP_MARK = join(brand, 'app-mark.png');
const APP_MARK_LETTERS = join(brand, 'app-mark-letters.png');

const png = () => ({ compressionLevel: 9, palette: false });

/** Logo centred on a square canvas. `ratio` is the logo width as a share of the canvas width. */
async function placed(logo, size, ratio, background) {
  const width = Math.round(size * ratio);
  const layer = await sharp(logo).resize({ width, kernel: 'lanczos3' }).toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: layer, gravity: 'centre' }]);
}

async function write(pipeline, file, label) {
  await pipeline.png(png()).toFile(file);
  console.log(`  ${label ?? file.slice(root.length + 1)}`);
}

/**
 * The web icons as the smaller of truecolour and an indexed PNG, the indexed one only when it decodes to exactly the same pixels
 * (these icons have under 256 colours, so a palette loses nothing). The browser fetches favicon.ico and apple-touch-icon.png on every
 * first visit, right after the page has loaded (M5 gate, public LCP).
 */
async function losslessPng(pipeline) {
  const truecolour = await pipeline.clone().png(png()).toBuffer();
  const indexed = await sharp(truecolour).png({ compressionLevel: 9, palette: true, quality: 100, colours: 256, dither: 0, effort: 10 }).toBuffer();
  const [a, b] = await Promise.all([sharp(truecolour).ensureAlpha().raw().toBuffer(), sharp(indexed).ensureAlpha().raw().toBuffer()]);
  return indexed.length < truecolour.length && a.equals(b) ? indexed : truecolour;
}

/** favicon.ico holding PNG frames, which every current browser accepts. */
function icoFrom(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + frames.length * 16;
  for (const { size, data } of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]);
}

console.log('App icons and splash');
// iOS forbids transparency; the app mark is opaque and fills the icon.
await write(sharp(APP_MARK).resize(1024, 1024, { kernel: 'lanczos3' }).flatten({ background: CANVAS }), join(mobileImages, 'icon.png'));
// Android: the visible part of an adaptive icon is the middle 72/108; at 0.72 the app mark still covers it and its letters stay
// inside the 66/108 safe circle.
await write(await placed(APP_MARK, 1024, 0.72), join(mobileImages, 'android-icon-foreground.png'));
await write(await placed(APP_MARK_LETTERS, 1024, 0.72), join(mobileImages, 'android-icon-monochrome.png'));
await write(sharp(SQUARE_WHITE).resize({ width: 1000, kernel: 'lanczos3' }), join(mobileImages, 'splash-icon.png'));
await write(sharp(APP_MARK).resize(96, 96, { kernel: 'lanczos3' }).flatten({ background: CANVAS }), join(mobileImages, 'favicon.png'));

console.log('App wordmarks');
// The client's wordmark is 696 px wide: kept at its own size, never enlarged.
await write(sharp(WIDE_WHITE).resize({ width: 1200, kernel: 'lanczos3', withoutEnlargement: true }), join(mobileBrand, 'logo-wide-white.png'));
await write(sharp(WIDE_BLACK).resize({ width: 1200, kernel: 'lanczos3', withoutEnlargement: true }), join(mobileBrand, 'logo-wide-black.png'));
await write(sharp(SQUARE_WHITE).resize({ width: 900, kernel: 'lanczos3' }), join(mobileBrand, 'logo-square-white.png'));
await write(sharp(SQUARE_BLACK).resize({ width: 900, kernel: 'lanczos3' }), join(mobileBrand, 'logo-square-black.png'));

console.log('Web icons');
const faviconFrames = [];
for (const size of [16, 32, 48]) {
  const pipeline = sharp(APP_MARK).resize(size, size, { kernel: 'lanczos3' }).flatten({ background: CANVAS });
  faviconFrames.push({ size, data: await losslessPng(pipeline) });
}
writeFileSync(join(webPublic, 'favicon.ico'), icoFrom(faviconFrames));
console.log('  web/public/favicon.ico');
for (const [file, size] of [
  ['favicon-32.png', 32],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  writeFileSync(join(webPublic, file), await losslessPng(sharp(APP_MARK).resize(size, size, { kernel: 'lanczos3' }).flatten({ background: CANVAS })));
  console.log(`  web/public/${file}`);
}

console.log('Web wordmarks, e-mail header and OG image');
for (const width of [320, 640, 1280]) {
  for (const [source, tone] of [[WIDE_WHITE, 'white'], [WIDE_BLACK, 'black']]) {
    const resized = sharp(source).resize({ width, kernel: 'lanczos3' });
    // 1280 enlarges the client's 696 px file (e-mail and schema.org logo); the vector files will replace it (README).
    await resized.clone().png(png()).toFile(join(webBrand, `logo-wide-${tone}-${width}.png`));
    await resized.clone().webp({ quality: 90, alphaQuality: 100 }).toFile(join(webBrand, `logo-wide-${tone}-${width}.webp`));
    console.log(`  web/public/brand/logo-wide-${tone}-${width}.{png,webp}`);
  }
}
// The top bar draws the wordmark at 121 CSS px: 242 is its 2x file beside the 3x 320 (srcset in components/public/top-bar), so a phone
// at 1.75x or 2x no longer loads the 3x file before the hero has painted (M5 gate, public LCP). Alpha at 90 keeps it under 60 % of the
// 320 file (PublicPagesPerformanceTest).
for (const [source, tone] of [[WIDE_WHITE, 'white'], [WIDE_BLACK, 'black']]) {
  await sharp(source).resize({ width: 242, kernel: 'lanczos3' }).webp({ quality: 90, alphaQuality: 90 }).toFile(join(webBrand, `logo-wide-${tone}-242.webp`));
  console.log(`  web/public/brand/logo-wide-${tone}-242.webp`);
}
await sharp(join(brand, 'logo-wide-on-texture.jpg'))
  .resize(1200, 630, { fit: 'contain', background: '#000000', kernel: 'lanczos3' })
  .jpeg({ quality: 84, mozjpeg: true })
  .toFile(join(webBrand, 'og-default.jpg'));
console.log('  web/public/brand/og-default.jpg');
await sharp(join(brand, 'logo-wide-on-texture.jpg'))
  .webp({ quality: 80 })
  .toFile(join(webBrand, 'logo-wide-on-texture.webp'));
console.log('  web/public/brand/logo-wide-on-texture.webp');

console.log('✔ brand assets generated from design/brand');
