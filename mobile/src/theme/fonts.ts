/**
 * The seven faces of the type scale, imported by subpath so unused weights stay out of the bundle.
 * The keys are the family names in tokens; mobile/tests/runtime.test.tsx keeps them in sync.
 */
import { BarlowSemiCondensed_500Medium } from '@expo-google-fonts/barlow-semi-condensed/500Medium';
import { BarlowSemiCondensed_600SemiBold } from '@expo-google-fonts/barlow-semi-condensed/600SemiBold';
import { BarlowSemiCondensed_700Bold } from '@expo-google-fonts/barlow-semi-condensed/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';

import { isWeb } from '@/lib/platform';

export const appFonts = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  BarlowSemiCondensed_500Medium,
  BarlowSemiCondensed_600SemiBold,
  BarlowSemiCondensed_700Bold,
};

/**
 * expo-font loads each family as it inserts that family's @font-face rule. In Chromium most faces in
 * document.fonts still report `unloaded` after that, so text could swap fonts after the first paint.
 * Web therefore loads every face again, once all rules exist and before anything renders.
 */
function loadFinalWebFaces(): Promise<unknown> {
  return Promise.allSettled(Object.keys(appFonts).map((family) => document.fonts.load(`1em "${family}"`)));
}

/**
 * How long the first render waits for font files. Web fetches them over the network, and a stalled request
 * settles neither useFonts nor document.fonts.load, so the wait needs its own bound. Keep this below
 * READY_GATE_TIMEOUT_MS, so the stack is mounted before the ready gates give up.
 */
export const FONT_WAIT_TIMEOUT_MS = 5_000;

/**
 * True once the app may render: all faces are loaded, a font failed, or the wait ran out. In the last two
 * cases text uses the fallback stack, and on web the real faces swap in if they still arrive.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(appFonts);
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
