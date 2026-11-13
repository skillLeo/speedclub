/** 09 §4.2 "preload only the two faces used above the fold": the step scripts/export-web.mjs runs on the exported index.html. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { typeScaleFaces, typography } from '@/theme';

import {
  ABOVE_THE_FOLD_FACES,
  baseUrlOf,
  findFaceFiles,
  injectFontPreloads,
  preloadAboveTheFold,
} from '../scripts/preload-fonts';

const HTML = [
  '<!doctype html>',
  '<html lang="de">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <title>SPEED CLUB</title>',
  '  </head>',
  '  <body><script src="/app/_expo/static/js/web/entry-abc.js" defer></script></body>',
  '</html>',
].join('\n');

const FILES = [
  'assets/assets/fonts/web/Inter-Medium.dda47853b5b6de9a9a37510a6aae4cef.woff2',
  'assets/assets/fonts/web/Inter-Medium-latin-ext.0a1b2c3d4e5f60718293a4b5c6d7e8f9.woff2',
  'assets/assets/fonts/web/ArchivoSemiExpanded-SemiBold.3a97fa6883982792cb025ddc0a0d7dbf.woff2',
  'assets/assets/fonts/web/Inter-Regular.cee90a2e8f988429da91a88278926b62.woff2',
];

describe('font preloads in the member web index.html', () => {
  it('preloads two faces, and both are the faces of the first screen: Inter 500 and display.title', () => {
    expect(ABOVE_THE_FOLD_FACES).toHaveLength(2);
    for (const face of ABOVE_THE_FOLD_FACES) expect(typeScaleFaces).toContain(face);
    expect(ABOVE_THE_FOLD_FACES).toContain(typography.displayTitle.fontFamily);
    expect(ABOVE_THE_FOLD_FACES).toContain(typography.callout.fontFamily);
    expect(typography.webTab.fontFamily).toBe(typography.callout.fontFamily);
  });

  it('picks the hashed base file of each face, never its latin-ext file', () => {
    expect(findFaceFiles(FILES)).toEqual([FILES[0], FILES[2]]);
    expect(() => findFaceFiles(FILES.slice(1))).toThrow(/Inter-Medium/);
  });

  it('reads the base URL from the export’s own scripts', () => {
    expect(baseUrlOf(HTML)).toBe('/app');
    expect(() => baseUrlOf('<html><head></head></html>')).toThrow(/base URL/);
  });

  it('adds crossorigin font preloads right after the charset, once', () => {
    const out = injectFontPreloads(HTML, [FILES[0]!, FILES[2]!]);
    const links = out.match(/<link rel="preload"[^>]*>/g) ?? [];
    expect(links).toEqual([
      `<link rel="preload" href="/app/${FILES[0]}" as="font" type="font/woff2" crossorigin data-sc-preload="font" />`,
      `<link rel="preload" href="/app/${FILES[2]}" as="font" type="font/woff2" crossorigin data-sc-preload="font" />`,
    ]);
    expect(out.indexOf('<meta charset')).toBeLessThan(out.indexOf('<link rel="preload"'));
    expect(out.indexOf('<link rel="preload"')).toBeLessThan(out.indexOf('<title>'));
    expect(injectFontPreloads(out, [FILES[0]!, FILES[2]!])).toBe(out);
  });

  it('works on an export folder', () => {
    const dist = mkdtempSync(join(tmpdir(), 'sc-preload-'));
    try {
      for (const file of FILES) {
        mkdirSync(join(dist, file, '..'), { recursive: true });
        writeFileSync(join(dist, file), '');
      }
      writeFileSync(join(dist, 'index.html'), HTML);
      const out = preloadAboveTheFold(readFileSync(join(dist, 'index.html'), 'utf8'), dist);
      expect(out.match(/data-sc-preload="font"/g)).toHaveLength(2);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
