/**
 * The 2.0 faces (09 §4.2, ADR-402): Inter and Inter Display for people and UI, Archivo Condensed for numerals, Archivo
 * SemiExpanded for car names. tokens.json names each face by its PostScript name, which is also its file name.
 *
 * - Native embeds the TTFs through the expo-font config plugin (app.config.ts): nothing loads at runtime and text never swaps
 *   faces. A native style names the face itself (`Inter-SemiBold`) and never sets `fontWeight` (rules/mobile.md).
 * - The member web loads the subset woff2 files at runtime with `font-display: swap`, grouped into the four CSS families of
 *   tokens (`'Inter'`, `'Inter Display'`, …) with a weight per face, so a web style names the family stack and a weight, and
 *   the browser falls back inside that stack if a file fails.
 */
import { FontDisplay, useFonts, type FontFamilyDefinition } from 'expo-font';
import { useEffect, useState } from 'react';

import { isWeb } from '@/lib/platform';

import { cssFamily, fontFaces, fontGroups, typeScaleFaces } from './fontFaces';
import { registerLatinExtFacesOnce } from './latinExtFaces';
import { webFontFiles } from './webFontFiles';

/** The web font map: one family per CSS family, one face per weight, each with `font-display: swap`. */
export function webFontFamilies(files: Readonly<Partial<Record<string, number>>>): FontFamilyDefinition[] {
  return fontGroups
    .map((group) => ({
      fontFamily: cssFamily(group),
      fontDefinitions: fontFaces
        .filter((entry) => entry.group === group && typeScaleFaces.includes(entry.face) && files[entry.face] !== undefined)
        .map((entry) => ({ path: files[entry.face]!, weight: entry.weight, display: FontDisplay.SWAP })),
    }))
    .filter((family) => family.fontDefinitions.length > 0);
}

/** The faces web waits for, as CSS font shorthands such as `600 1em "Inter"`. */
function webFaceQueries(): string[] {
  return fontFaces
    .filter((entry) => typeScaleFaces.includes(entry.face) && webFontFiles[entry.face] !== undefined)
    .map((entry) => `${entry.weight} 1em "${cssFamily(entry.group)}"`);
}

/**
 * expo-font loads each family as it inserts that family's @font-face rules. In Chromium most faces in document.fonts still
 * report `unloaded` after that, so text could swap fonts after the first paint. Web therefore loads every face again, once all
 * rules exist and before anything renders.
 */
function loadFinalWebFaces(): Promise<unknown> {
  return Promise.allSettled(webFaceQueries().map((query) => document.fonts.load(query)));
}

/**
 * How long the first render waits for font files. Web fetches them over the network, and a stalled request settles neither
 * useFonts nor document.fonts.load, so the wait needs its own bound. Keep this below READY_GATE_TIMEOUT_MS, so the stack is
 * mounted before the ready gates give up.
 */
export const FONT_WAIT_TIMEOUT_MS = 5_000;

const NO_RUNTIME_FONTS: FontFamilyDefinition[] = [];
let webFamilies: FontFamilyDefinition[] | null = null;

function runtimeFonts(): FontFamilyDefinition[] {
  if (!isWeb) return NO_RUNTIME_FONTS;
  // MF-1: the latin-ext rules go in with the base faces, before the first text renders. Idempotent.
  registerLatinExtFacesOnce();
  webFamilies ??= webFontFamilies(webFontFiles);
  return webFamilies;
}

/**
 * True once the app may render. Native: at once, the faces are embedded. Web: all faces are loaded, a font failed, or the wait
 * ran out; in the last two cases text uses the fallback stack, and the real faces swap in if they still arrive.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(runtimeFonts());
  const settled = loaded || error != null;
  const [facesReady, setFacesReady] = useState(!isWeb);
  const [waitExpired, setWaitExpired] = useState(false);
  const done = settled && facesReady;

  useEffect(() => {
    if (done) return;
    const timer = setTimeout(() => {
      console.warn(`Fonts did not settle within ${FONT_WAIT_TIMEOUT_MS} ms. Rendering with the fallback stack.`);
      setWaitExpired(true);
    }, FONT_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [done]);

  useEffect(() => {
    if (!settled || !isWeb) return;
    let active = true;
    loadFinalWebFaces().finally(() => {
      if (active) setFacesReady(true);
    });
    return () => {
      active = false;
    };
  }, [settled]);

  return done || waitExpired;
}
