#!/usr/bin/env node
/**
 * Generates the member web's home-screen pictures (09 §8.13, §7.15) into public/pwa/, from the app's own icon and splash mark:
 * - icon-192.png, icon-512.png ("any"), icon-maskable-512.png (the mark inside the 80 % safe circle), apple-touch-icon.png (180);
 * - apple-splash-<w>x<h>.png: one iOS startup image per current iPhone screen (portrait, device pixels), the Carbon canvas with the
 *   splash mark at the native splash's width (app.config.ts expo-splash-screen imageWidth 200 pt) — what the first frame of the
 *   app paints as well, so the start has no flash.
 *
 * The files are committed: an export only copies them (public/ → dist). Run again after the icon, the splash mark or the Carbon
 * canvas changes; tests/pwa/pwaShell.test.ts fails when the manifest, index.html and the files on disk disagree.
 *
 *   node scripts/pwa-assets.mjs
 *
 * Uses @expo/image-utils and its jimp-compact (the image helpers of the Expo CLI, installed with it): no new dependency.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { compositeImagesAsync, generateImageAsync } = require('@expo/image-utils');
// image-utils' own background helper draws squares only (its Jimp path), so the canvas comes from the same Jimp build it uses.
const Jimp = require('jimp-compact');
const { IPHONE_STARTUP_SCREENS, SPLASH_MARK_WIDTH_PT, startupFileName } = require('./pwa-shell.js');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'pwa');
const tokens = JSON.parse(readFileSync(join(root, '..', 'design', 'tokens', 'tokens.json'), 'utf8'));
const canvas = tokens.themes.carbon.color['bg.canvas'];
const icon = join(root, 'assets', 'images', 'icon.png');
const mark = join(root, 'assets', 'images', 'splash-icon.png');
const cache = { projectRoot: root, cacheType: 'pwa' };

mkdirSync(out, { recursive: true });

async function canvasOf(width, height) {
  return new Jimp(width, height, canvas).getBufferAsync(Jimp.MIME_PNG);
}

async function write(name, buffer) {
  writeFileSync(join(out, name), buffer);
  console.log(`✔ public/pwa/${name}`);
}

/** The icon on the Carbon canvas; `inset` shrinks it by that share of the side on each edge (image-utils has no padding). */
async function square(name, size, inset = 0) {
  const inner = size - 2 * Math.round(size * inset);
  const { source } = await generateImageAsync(cache, {
    src: icon,
    width: inner,
    height: inner,
    resizeMode: 'contain',
    backgroundColor: canvas,
    removeTransparency: true,
  });
  if (inner === size) {
    await write(name, source);
    return;
  }
  const background = await canvasOf(size, size);
  const offset = (size - inner) / 2;
  await write(name, await compositeImagesAsync({ foreground: source, background, x: offset, y: offset }));
}

await square('icon-192.png', 192);
await square('icon-512.png', 512);
// The maskable safe zone is a circle of 80 % of the side; the icon's mark spans about 67 %, so 12 % padding keeps its corners in.
await square('icon-maskable-512.png', 512, 0.12);
await square('apple-touch-icon.png', 180);

// splash-icon.png is 1000 × 657.
const markSize = { width: 1000, height: 657 };
for (const screen of IPHONE_STARTUP_SCREENS) {
  const width = screen.width * screen.ratio;
  const height = screen.height * screen.ratio;
  const background = await canvasOf(width, height);
  const markWidth = SPLASH_MARK_WIDTH_PT * screen.ratio;
  const markHeight = Math.round((markWidth * markSize.height) / markSize.width);
  const { source: foreground } = await generateImageAsync(cache, { src: mark, width: markWidth, height: markHeight, resizeMode: 'contain' });
  const composed = await compositeImagesAsync({
    foreground,
    background,
    x: Math.round((width - markWidth) / 2),
    y: Math.round((height - markHeight) / 2),
  });
  await write(startupFileName(screen), composed);
}
