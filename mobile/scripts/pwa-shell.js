/**
 * The member web as a home-screen app (09 §8.13, §7.15): what scripts/export-web.mjs adds to an export, and what
 * scripts/pwa-assets.mjs draws. CommonJS like preload-fonts.js, so mobile/tests can import it.
 *
 * - `injectStartupImages(html)`: one apple-touch-startup-image link per current iPhone screen at the <!--sc:pwa-startup-->
 *   marker of public/index.html (portrait; iOS picks the link whose media query matches the device exactly).
 * - `shellFiles(html, files)`: the precache list of the service worker — the /app/ document (the offline fallback), every script
 *   the index loads, its preloaded faces, the manifest and its icons. Nothing else: the rest is cached on first use.
 * - `injectServiceWorker(source, precache)`: writes that list and a version derived from it into dist/sw.js, so each export with
 *   other files is a new worker, and an export with the same files is not.
 */
const { createHash } = require('node:crypto');

const BASE = '/app/';

/** Points as the native splash draws the mark (app.config.ts expo-splash-screen `imageWidth`). */
const SPLASH_MARK_WIDTH_PT = 200;

/**
 * Current iPhone screens in CSS points and their device pixel ratio (portrait), newest first. Several models share one entry.
 * 440×956 16/17 Pro Max · 420×912 Air · 402×874 16/17 Pro, 17 · 430×932 14/15 Pro Max, 15/16 Plus · 393×852 14/15 Pro, 15, 16 ·
 * 428×926 12/13 Pro Max, 14 Plus · 390×844 12/13/14, 16e · 375×812 X/XS/11 Pro, 12/13 mini · 414×896 @3 XS Max/11 Pro Max ·
 * 414×896 @2 XR/11 · 375×667 SE 2/3, 8.
 */
const IPHONE_STARTUP_SCREENS = [
  { width: 440, height: 956, ratio: 3 },
  { width: 420, height: 912, ratio: 3 },
  { width: 402, height: 874, ratio: 3 },
  { width: 430, height: 932, ratio: 3 },
  { width: 393, height: 852, ratio: 3 },
  { width: 428, height: 926, ratio: 3 },
  { width: 390, height: 844, ratio: 3 },
  { width: 375, height: 812, ratio: 3 },
  { width: 414, height: 896, ratio: 3 },
  { width: 414, height: 896, ratio: 2 },
  { width: 375, height: 667, ratio: 2 },
];

const STARTUP_MARKER = '<!--sc:pwa-startup-->';

function startupFileName(screen) {
  return `apple-splash-${screen.width * screen.ratio}x${screen.height * screen.ratio}.png`;
}

function startupLinks(screens = IPHONE_STARTUP_SCREENS) {
  return screens
    .map(
      (screen) =>
        `<link rel="apple-touch-startup-image" media="screen and (device-width: ${screen.width}px) and (device-height: ${screen.height}px) and (-webkit-device-pixel-ratio: ${screen.ratio}) and (orientation: portrait)" href="${BASE}pwa/${startupFileName(screen)}" />`,
    )
    .join('\n    ');
}

/** Throws when the marker is missing, so an export never ships without its startup images silently. */
function injectStartupImages(html) {
  if (!html.includes(STARTUP_MARKER)) throw new Error(`index.html has no ${STARTUP_MARKER} marker`);
  return html.replace(STARTUP_MARKER, startupLinks());
}

/** The manifest's icons and the apple-touch-icon, as public/manifest.webmanifest and index.html name them. */
const SHELL_STATIC = ['manifest.webmanifest', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png', 'pwa/apple-touch-icon.png'];

/**
 * The precache list for an exported index.html. `files` are the export's files relative to dist (forward slashes); a script or
 * preload the index names but the export lacks is an error, as is a missing static shell file.
 */
function shellFiles(html, files) {
  const present = new Set(files);
  const urls = [BASE];
  const referenced = [
    ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]),
  ];
  for (const href of referenced) {
    if (!href.startsWith(BASE)) continue;
    const file = decodeURI(href.slice(BASE.length));
    if (!present.has(file)) throw new Error(`index.html loads ${href}, which the export does not contain`);
    urls.push(href);
  }
  for (const file of SHELL_STATIC) {
    if (!present.has(file)) throw new Error(`the export has no ${file} (mobile/public)`);
    urls.push(BASE + file);
  }
  return [...new Set(urls)];
}

const VERSION_LINE = /const VERSION = '[^']*';/;
const PRECACHE_SLOT = /\/\*sc:precache\*\/ \[\]/;

function injectServiceWorker(source, precache) {
  if (!VERSION_LINE.test(source) || !PRECACHE_SLOT.test(source)) throw new Error('sw.js has no VERSION line or /*sc:precache*/ slot');
  const version = createHash('sha256').update(source).update(JSON.stringify(precache)).digest('hex').slice(0, 12);
  return source.replace(VERSION_LINE, `const VERSION = '${version}';`).replace(PRECACHE_SLOT, JSON.stringify(precache));
}

module.exports = {
  BASE,
  IPHONE_STARTUP_SCREENS,
  SHELL_STATIC,
  SPLASH_MARK_WIDTH_PT,
  STARTUP_MARKER,
  injectServiceWorker,
  injectStartupImages,
  shellFiles,
  startupFileName,
  startupLinks,
};
