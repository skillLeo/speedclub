#!/usr/bin/env node
/**
 * The Android native tab bar icons (09 §6.1, M4.5): Phosphor Regular (inactive) and Fill (selected) of the five tab glyphs,
 * rasterised to PNG at the five Android densities (24 dp: @1x … @4x), white on transparent so the bar tints them.
 * NativeTabs takes them through `NativeTabs.Trigger.Icon src` (the `md` Material Symbols need expo-symbols, which is not
 * installed). iOS uses SF Symbols and the web draws the Phosphor components, so these PNGs are Android-only.
 *
 *   node mobile/scripts/build-tab-icons.mjs          writes mobile/assets/tabs/*.png
 *   node mobile/scripts/build-tab-icons.mjs --check  exits 1 when a file is missing
 *
 * Rendering uses the Playwright Chromium of web/ (no extra dependency).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(mobile, 'assets', 'tabs');
const defs = join(mobile, 'node_modules', 'phosphor-react-native', 'src', 'defs');

/** File stem → Phosphor def. Keep in step with TAB_DESTINATIONS (src/features/shell/destinations.ts). */
export const TAB_ICONS = { house: 'House', 'magnifying-glass': 'MagnifyingGlass', garage: 'Garage', chats: 'Chats', user: 'User' };
const WEIGHTS = ['regular', 'fill'];
/** RN asset suffix → scale of the 24 dp glyph. */
const DENSITIES = { '': 1, '@1.5x': 1.5, '@2x': 2, '@3x': 3, '@4x': 4 };
const DP = 24;

const files = Object.keys(TAB_ICONS).flatMap((stem) =>
  WEIGHTS.flatMap((weight) => Object.keys(DENSITIES).map((suffix) => `${stem}-${weight}${suffix}.png`)),
);

if (process.argv.includes('--check')) {
  const missing = files.filter((file) => !existsSync(join(out, file)));
  if (missing.length > 0) {
    console.error(`build-tab-icons: missing ${missing.join(', ')}; run node mobile/scripts/build-tab-icons.mjs`);
    process.exit(1);
  }
  console.log(`build-tab-icons: ${files.length} files present`);
  process.exit(0);
}

/** The `d` attributes of one weight in a generated Phosphor def file. */
function pathsOf(def, weight) {
  const source = readFileSync(join(defs, `${def}.tsx`), 'utf8');
  const start = source.indexOf(`'${weight}',`);
  if (start === -1) throw new Error(`${def}: no ${weight} weight`);
  const end = source.indexOf('\n  ],', start);
  const block = source.slice(start, end === -1 ? undefined : end);
  const paths = [...block.matchAll(/<Path d="([^"]+)"/g)].map((match) => match[1]);
  if (paths.length === 0) throw new Error(`${def}: no paths in ${weight}`);
  return paths;
}

const require = createRequire(join(mobile, '..', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [stem, def] of Object.entries(TAB_ICONS)) {
    for (const weight of WEIGHTS) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="100%" height="100%" fill="#fff">${pathsOf(def, weight)
        .map((d) => `<path d="${d}"/>`)
        .join('')}</svg>`;
      for (const [suffix, scale] of Object.entries(DENSITIES)) {
        const px = Math.round(DP * scale);
        await page.setViewportSize({ width: px, height: px });
        await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('width="100%" height="100%"', `width="${px}" height="${px}"`)}</body></html>`);
        await page.locator('svg').screenshot({ path: join(out, `${stem}-${weight}${suffix}.png`), omitBackground: true });
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`build-tab-icons: wrote ${files.length} files to ${out}`);
