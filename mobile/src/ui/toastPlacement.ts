/**
 * Where the toast sits (§8: bottom, 8 above the tab bar). Three things can cover the bottom of a screen: the tab bar, the
 * sticky CTA bar of a form (§9) and the keyboard. The toast clears the highest of them, so it never sits on the primary
 * action and a hover cannot hold it there either.
 *
 * StickyCTABar reports its height here while its screen is focused. The shell toast host reads it. Hosts inside an
 * overlay do not, because the overlay covers the bar.
 */
import { useSyncExternalStore } from 'react';

import { space } from '@/theme';

/** §8: the toast keeps 8 to whatever it clears. */
export const TOAST_GAP = space[8];

const bars = new Map<string, number>();
let tallest = 0;
const listeners = new Set<() => void>();

/**
 * The height of a sticky bar, from the bottom of the window to its top edge: hairline, padding and the safe inset it
 * pads itself. `null` or 0 takes the bar out. With more than one bar in, the tallest counts.
 */
export function reportStickyBar(key: string, height: number | null): void {
  if (height !== null && height > 0) bars.set(key, height);
  else bars.delete(key);
  const next = bars.size > 0 ? Math.max(...bars.values()) : 0;
  if (next === tallest) return;
  tallest = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The tallest sticky bar on the focused screen, or 0. */
export function useStickyBarHeight(): number {
  return useSyncExternalStore(
    subscribe,
    () => tallest,
    () => 0,
  );
}

export type ToastClearance = {
  /** The tab bar without its safe inset (`size.tabBar`), or 0 where there is none. */
  tabBar: number;
  /** The sticky bar as reported: its safe inset is part of it. 0 where there is none. */
  stickyBar: number;
  /** The bottom safe inset. 0 on web, where only CSS knows it. */
  inset: number;
};

/** The distance from the bottom of the window to the bottom of the toast while the keyboard is closed. */
export function toastBottom({ tabBar, stickyBar, inset }: ToastClearance): number {
  'worklet';
  return Math.max(tabBar + inset, stickyBar) + TOAST_GAP;
}

/** The same for web, where the safe inset exists in CSS only. A measured sticky bar contains it already. */
export function toastBottomCss(tabBar: number, stickyBar: number): string {
  const overTabBar = `env(safe-area-inset-bottom, 0px) + ${tabBar}px`;
  return stickyBar > 0 ? `calc(max(${overTabBar}, ${stickyBar}px) + ${TOAST_GAP}px)` : `calc(${overTabBar} + ${TOAST_GAP}px)`;
}

/**
 * How much higher than `toastBottom` the toast sits while the keyboard is open: above the keyboard, or above the sticky bar
 * riding on it. `keyboard` is the current height of the keyboard and `progress` its 0 to 1, as react-native-keyboard-controller
 * animates them. The bar rises by the keyboard less its own safe inset, which then lies behind the keyboard (the offset of
 * its KeyboardStickyView). The tab bar stays where it is, under the keyboard.
 */
export function toastKeyboardLift(clearance: ToastClearance, keyboard: number, progress: number): number {
  'worklet';
  if (keyboard <= 0) return 0;
  const { tabBar, stickyBar, inset } = clearance;
  const cover = stickyBar > 0 ? stickyBar + keyboard - progress * inset : keyboard;
  return Math.max(0, Math.max(tabBar + inset, cover) + TOAST_GAP - toastBottom(clearance));
}
