/**
 * MF-1, member web only: the Latin Extended faces. The base woff2 subsets hold Latin, Latin-1 and the copy extras (09 §4.2), so
 * without these rules "Škoda" or "Łukasz" would fall back to the system font inside a car name or a member's name.
 *
 * expo-font's FontFamilyDefinition has no `unicode-range`, so this module writes the rules itself: one `@font-face` per
 * type-scale face, with the family and weight of its base face, `font-display: swap` and the latin-ext range of the font build.
 * Browsers then fetch a file only when a text on screen needs one of its letters (document.fonts.load in fonts.ts asks for a
 * space, which is outside the range, so the first load does not grow). The latin-ext letters are never merged into the base
 * subsets: that would add about 70 KB to the first load.
 */
import { Asset } from 'expo-asset';

import { isWeb } from '@/lib/platform';

import { cssFamily, fontFaces, typeScaleFaces } from './fontFaces';
import { webLatinExtFiles } from './webFontFiles';

/**
 * The range the latin-ext files were cut to: `build.charsets.latinExt` in design/fonts/fonts.lock.json, written to
 * design/fonts/manifest.json `unicodeRanges.latinExt` and design/fonts/fonts.css. tests/fonts.test.tsx keeps them equal.
 */
export const LATIN_EXT_UNICODE_RANGE = 'U+0100-024F, U+1E9E';

/** The id of the style element, so the rules are written once per document. */
export const LATIN_EXT_STYLE_ID = 'sc-latin-ext';

/**
 * The URL Metro serves a bundled asset from (hashed under /app/assets on the member web; the static export hands the URL
 * itself, the dev server a registry id). A face it cannot resolve gets no rule rather than stopping the first render.
 */
function assetUri(module: number): string | null {
  try {
    return Asset.fromModule(module).uri || null;
  } catch {
    return null;
  }
}

/** One `@font-face` rule per type-scale face that has a latin-ext file, in token order. */
export function latinExtFontFaceRules(
  files: Readonly<Partial<Record<string, number>>>,
  uriOf: (module: number) => string | null = assetUri,
): string[] {
  return fontFaces.flatMap((entry) => {
    const module = files[entry.face];
    if (module === undefined || !typeScaleFaces.includes(entry.face)) return [];
    const uri = uriOf(module);
    if (!uri) return [];
    return [
      `@font-face { font-family: "${cssFamily(entry.group)}"; font-style: normal; font-weight: ${entry.weight}; font-display: swap; ` +
        `src: url("${uri}") format("woff2"); unicode-range: ${LATIN_EXT_UNICODE_RANGE}; }`,
    ];
  });
}

/** The part of `document` this module touches, so a test can hand in its own. */
export type FaceDocument = Pick<Document, 'getElementById' | 'createElement' | 'head'>;

/**
 * Writes the latin-ext rules into the document once. Returns the number of rules written by this call (0 when they exist
 * already, on native, or without a document).
 */
export function registerLatinExtFaces(
  doc: FaceDocument | undefined = typeof document === 'undefined' ? undefined : document,
  files: Readonly<Partial<Record<string, number>>> = webLatinExtFiles,
  uriOf?: (module: number) => string | null,
): number {
  if (!doc || doc.getElementById(LATIN_EXT_STYLE_ID)) return 0;
  const rules = latinExtFontFaceRules(files, uriOf);
  if (rules.length === 0) return 0;
  const style = doc.createElement('style');
  style.id = LATIN_EXT_STYLE_ID;
  style.textContent = rules.join('\n');
  doc.head.appendChild(style);
  return rules.length;
}

let registered = false;

/** Once per app start, on the member web only (useAppFonts). Native has these letters in its embedded TTFs. */
export function registerLatinExtFacesOnce(): void {
  if (!isWeb || registered) return;
  registered = true;
  registerLatinExtFaces();
}
