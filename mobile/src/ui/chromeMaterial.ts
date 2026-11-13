import { useEffect, useId, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { material } from '@/theme/tokens.generated';

/**
 * Which material a piece of chrome gets (09 §4.4, SKILL §4). Chrome is navigation and floating controls only: never cards,
 * lists or content, never glass on glass.
 *
 * - `glass`: iOS `GlassView`, only for a floating control over photography, only when the Liquid Glass API exists at runtime
 *   (`isGlassEffectAPIAvailable`, some iOS 26 betas crash without it) and is in use (`isLiquidGlassAvailable`).
 * - `translucent`: `chrome.translucent` over a blur. iOS BlurView; web `backdrop-filter` where the browser has it; Android
 *   only from API 31, with a blur target, and only one blur view on screen.
 * - `opaque`: `chrome.opaque`. Reduced transparency always lands here, as does Android by default.
 */
export type ChromeMaterial = 'glass' | 'translucent' | 'opaque';

export type ChromeConditions = {
  platform: string;
  /** Floating control over a photo: the only place glass may appear. */
  floating: boolean;
  reduceTransparency: boolean;
  /** iOS: `isGlassEffectAPIAvailable() && isLiquidGlassAvailable()`. */
  glassAvailable: boolean;
  /** Web: the browser supports `backdrop-filter`. */
  backdropSupported: boolean;
  /** Android: the API level. */
  androidApi: number;
  /** Android: a BlurTargetView behind this chrome was passed. */
  hasBlurTarget: boolean;
  /** Android: this surface holds the one blur slot of the screen. */
  holdsBlurSlot: boolean;
};

export function chromeMaterialFor(c: ChromeConditions): ChromeMaterial {
  if (c.reduceTransparency) return 'opaque';
  switch (c.platform) {
    case 'ios':
      return c.floating && c.glassAvailable ? 'glass' : 'translucent';
    case 'web':
      return c.backdropSupported ? 'translucent' : 'opaque';
    case 'android':
      return c.androidApi >= material.chrome.androidBlurMinApi && c.hasBlurTarget && c.holdsBlurSlot
        ? 'translucent'
        : 'opaque';
    default:
      return 'opaque';
  }
}

/** Web: whether `backdrop-filter` works (Safari before 18 needs the prefix). */
export function webBackdropSupported(): boolean {
  const css = typeof globalThis === 'undefined' ? undefined : (globalThis as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS;
  if (!css?.supports) return false;
  const value = material.chrome.webBackdrop;
  return css.supports('backdrop-filter', value) || css.supports('-webkit-backdrop-filter', value);
}

export function androidApiLevel(): number {
  if (Platform.OS !== 'android') return 0;
  return typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version) || 0;
}

/**
 * Android allows `material.chrome.androidMaxBlurViews` (1) blur view on screen. Surfaces that want to blur queue for the slot
 * in mount order; the rest render opaque, and the next in line takes the slot when its holder unmounts.
 */
const queue: string[] = [];
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function claimBlurSlot(id: string): () => void {
  if (!queue.includes(id)) queue.push(id);
  notify();
  return () => {
    const index = queue.indexOf(id);
    if (index >= 0) queue.splice(index, 1);
    notify();
  };
}

export function holdsBlurSlot(id: string): boolean {
  return queue.indexOf(id) > -1 && queue.indexOf(id) < material.chrome.androidMaxBlurViews;
}

/** True while this surface may blur on Android. Never claims anything when `wanted` is false. */
export function useAndroidBlurSlot(wanted: boolean): boolean {
  const id = useId();
  useEffect(() => (wanted ? claimBlurSlot(id) : undefined), [id, wanted]);
  return useSyncExternalStore(
    subscribe,
    () => wanted && holdsBlurSlot(id),
    () => false,
  );
}
