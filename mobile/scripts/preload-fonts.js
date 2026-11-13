/**
 * 09 §4.2 "preload only the two faces used above the fold", for the member web's index.html (scripts/export-web.mjs).
 *
 * The first screen of /app is Start (HOME-01) for guests and members alike: the welcome screen opens only on native
 * (SessionHost). Above the fold it sets the featured build's name in display.title (Archivo SemiExpanded 600) and everything
 * small in Inter 500: the segmented control and the featured eyebrow and byline (callout, caption) and the web tab labels
 * (web.tab). The large title "Start" is one word in Inter Display and loads with the rest. The first render waits for every
 * face anyway (useAppFonts), so preloading the two biggest consumers lets their requests run beside the JS bundle instead of
 * after it.
 *
 * CommonJS like strip-qa.js, so mobile/tests can import it.
 */
const { readdirSync, statSync } = require('node:fs');
const { join, relative, sep } = require('node:path');

/** PostScript names, which are also the file names (src/theme/fontFaces.ts). */
const ABOVE_THE_FOLD_FACES = ['Inter-Medium', 'ArchivoSemiExpanded-SemiBold'];

/** Every file below `dir`, as paths relative to it with forward slashes. */
function filesBelow(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/**
 * The hashed base woff2 of each face in an export ("assets/assets/fonts/web/Inter-Medium.<hash>.woff2"), never its
 * latin-ext file. Throws when a face is missing, so an export never ships without its preloads silently.
 */
function findFaceFiles(files, faces = ABOVE_THE_FOLD_FACES) {
  return faces.map((face) => {
    const pattern = new RegExp(`(^|/)${face.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[0-9a-f]+\\.woff2$`);
    const match = files.filter((file) => pattern.test(file));
    if (match.length !== 1) throw new Error(`preload-fonts: expected one ${face}.<hash>.woff2 in the export, found ${match.length}`);
    return match[0];
  });
}

/** The URL prefix the export serves from ("/app"), read from its own script tags. */
function baseUrlOf(html) {
  const script = /<script[^>]+src="([^"]*?)\/_expo\//.exec(html);
  if (!script) throw new Error('preload-fonts: no /_expo/ script in index.html to read the base URL from');
  return script[1];
}

/**
 * index.html with one `<link rel="preload" as="font">` per file early in <head>: right after `<meta charset>` (which must stay in
 * the first 1024 bytes), before any stylesheet or script. Fonts are fetched in CORS mode, so the link needs `crossorigin` or
 * the browser downloads the file twice. Running it twice changes nothing.
 */
function injectFontPreloads(html, files) {
  const base = baseUrlOf(html);
  const links = files
    .map((file) => `<link rel="preload" href="${base}/${file}" as="font" type="font/woff2" crossorigin data-sc-preload="font" />`)
    .filter((link) => !html.includes(link));
  if (links.length === 0) return html;
  const anchor = /<meta charset[^>]*>/i.exec(html) ?? /<head[^>]*>/i.exec(html);
  if (!anchor) throw new Error('preload-fonts: index.html has no <head>');
  const at = anchor.index + anchor[0].length;
  return `${html.slice(0, at)}${links.map((link) => `\n    ${link}`).join('')}${html.slice(at)}`;
}

/** Adds the preloads to an export folder's index.html content; `dist` is the export folder. */
function preloadAboveTheFold(html, dist) {
  return injectFontPreloads(html, findFaceFiles(filesBelow(dist)));
}

module.exports = { ABOVE_THE_FOLD_FACES, baseUrlOf, filesBelow, findFaceFiles, injectFontPreloads, preloadAboveTheFold };
