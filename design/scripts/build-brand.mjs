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
// iOS forbids transparency, so the store icon is flattened on the Carbon canvas.
await write((await placed(SQUARE_WHITE, 1024, 0.72, CANVAS)).flatten({ background: CANVAS }), join(mobileImages, 'icon.png'));
// Android keeps everything inside the 66/108 safe zone of adaptive icons.
await write(await placed(SQUARE_WHITE, 1024, 0.58), join(mobileImages, 'android-icon-foreground.png'));
await write(await placed(SQUARE_WHITE, 1024, 0.58), join(mobileImages, 'android-icon-monochrome.png'));
await write(sharp(SQUARE_WHITE).resize({ width: 1000, kernel: 'lanczos3' }), join(mobileImages, 'splash-icon.png'));
await write((await placed(SQUARE_WHITE, 96, 0.86, CANVAS)).flatten({ background: CANVAS }), join(mobileImages, 'favicon.png'));

console.log('App wordmarks');
await write(sharp(WIDE_WHITE).resize({ width: 1200, kernel: 'lanczos3' }), join(mobileBrand, 'logo-wide-white.png'));
await write(sharp(WIDE_BLACK).resize({ width: 1200, kernel: 'lanczos3' }), join(mobileBrand, 'logo-wide-black.png'));
await write(sharp(SQUARE_WHITE).resize({ width: 900, kernel: 'lanczos3' }), join(mobileBrand, 'logo-square-white.png'));
await write(sharp(SQUARE_BLACK).resize({ width: 900, kernel: 'lanczos3' }), join(mobileBrand, 'logo-square-black.png'));

console.log('Web icons');
const faviconFrames = [];
for (const size of [16, 32, 48]) {
  const pipeline = (await placed(SQUARE_WHITE, size, 0.92, CANVAS)).flatten({ background: CANVAS });
  faviconFrames.push({ size, data: await pipeline.png(png()).toBuffer() });
}
writeFileSync(join(webPublic, 'favicon.ico'), icoFrom(faviconFrames));
console.log('  web/public/favicon.ico');
for (const [file, size, ratio] of [
  ['favicon-32.png', 32, 0.92],
  ['apple-touch-icon.png', 180, 0.72],
  ['icon-192.png', 192, 0.72],
  ['icon-512.png', 512, 0.72],
]) {
  await write((await placed(SQUARE_WHITE, size, ratio, CANVAS)).flatten({ background: CANVAS }), join(webPublic, file));
}

console.log('Web wordmarks, e-mail header and OG image');
for (const width of [320, 640, 1280]) {
  for (const [source, tone] of [[WIDE_WHITE, 'white'], [WIDE_BLACK, 'black']]) {
    const resized = sharp(source).resize({ width, kernel: 'lanczos3' });
    await resized.clone().png(png()).toFile(join(webBrand, `logo-wide-${tone}-${width}.png`));
    await resized.clone().webp({ quality: 90, alphaQuality: 100 }).toFile(join(webBrand, `logo-wide-${tone}-${width}.webp`));
    console.log(`  web/public/brand/logo-wide-${tone}-${width}.{png,webp}`);
  }
}
await sharp(join(brand, 'logo-wide-on-texture.jpg'))
  .resize(1200, 630, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
  .jpeg({ quality: 84, mozjpeg: true })
  .toFile(join(webBrand, 'og-default.jpg'));
console.log('  web/public/brand/og-default.jpg');
await sharp(join(brand, 'logo-wide-on-texture.jpg'))
  .webp({ quality: 80 })
  .toFile(join(webBrand, 'logo-wide-on-texture.webp'));
console.log('  web/public/brand/logo-wide-on-texture.webp');

console.log('✔ brand assets generated from design/brand');
