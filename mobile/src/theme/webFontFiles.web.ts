/* eslint-disable @typescript-eslint/no-require-imports -- woff2 is a Metro asset in @expo/metro-config 58 (assetExts), but eslint-config-expo's asset list for this rule leaves it out. */
/**
 * The member web's subset woff2 files (design/fonts/web, built by design/scripts/build-fonts.py), keyed by PostScript name.
 * Metro hashes them into /app/assets, which the server caches as immutable. A separate web file keeps them out of the native
 * bundles, which embed the TTFs instead.
 */
export const webFontFiles: Readonly<Partial<Record<string, number>>> = {
  'Inter-Regular': require('../../assets/fonts/web/Inter-Regular.woff2') as number,
  'Inter-Medium': require('../../assets/fonts/web/Inter-Medium.woff2') as number,
  'Inter-SemiBold': require('../../assets/fonts/web/Inter-SemiBold.woff2') as number,
  'Inter-Bold': require('../../assets/fonts/web/Inter-Bold.woff2') as number,
  'InterDisplay-SemiBold': require('../../assets/fonts/web/InterDisplay-SemiBold.woff2') as number,
  'InterDisplay-Bold': require('../../assets/fonts/web/InterDisplay-Bold.woff2') as number,
  'ArchivoCondensed-SemiBold': require('../../assets/fonts/web/ArchivoCondensed-SemiBold.woff2') as number,
  'ArchivoCondensed-Bold': require('../../assets/fonts/web/ArchivoCondensed-Bold.woff2') as number,
  'ArchivoSemiExpanded-SemiBold': require('../../assets/fonts/web/ArchivoSemiExpanded-SemiBold.woff2') as number,
  'ArchivoSemiExpanded-Bold': require('../../assets/fonts/web/ArchivoSemiExpanded-Bold.woff2') as number,
};

/**
 * MF-1: the Latin Extended-A/B files of the same faces (Š in Škoda, ę, Ł; U+0100-024F, U+1E9E). latinExtFaces.ts registers each
 * with that unicode-range, so a browser fetches one only when a text on screen needs such a letter and the first load stays the
 * same.
 */
export const webLatinExtFiles: Readonly<Partial<Record<string, number>>> = {
  'Inter-Regular': require('../../assets/fonts/web/Inter-Regular-latin-ext.woff2') as number,
  'Inter-Medium': require('../../assets/fonts/web/Inter-Medium-latin-ext.woff2') as number,
  'Inter-SemiBold': require('../../assets/fonts/web/Inter-SemiBold-latin-ext.woff2') as number,
  'Inter-Bold': require('../../assets/fonts/web/Inter-Bold-latin-ext.woff2') as number,
  'InterDisplay-SemiBold': require('../../assets/fonts/web/InterDisplay-SemiBold-latin-ext.woff2') as number,
  'InterDisplay-Bold': require('../../assets/fonts/web/InterDisplay-Bold-latin-ext.woff2') as number,
  'ArchivoCondensed-SemiBold': require('../../assets/fonts/web/ArchivoCondensed-SemiBold-latin-ext.woff2') as number,
  'ArchivoCondensed-Bold': require('../../assets/fonts/web/ArchivoCondensed-Bold-latin-ext.woff2') as number,
  'ArchivoSemiExpanded-SemiBold': require('../../assets/fonts/web/ArchivoSemiExpanded-SemiBold-latin-ext.woff2') as number,
  'ArchivoSemiExpanded-Bold': require('../../assets/fonts/web/ArchivoSemiExpanded-Bold-latin-ext.woff2') as number,
};
