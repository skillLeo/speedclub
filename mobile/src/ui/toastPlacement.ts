/**
 * Where the toast sits (§8: bottom, 8 above the tab bar). Three things can cover the bottom of a screen: the tab bar, the
 * sticky CTA bar of a form (§9) and the keyboard. The toast clears the highest of them, so it never sits on the primary
 * action and a hover cannot hold it there either.
 *
 * StickyCTABar reports its height here while its screen is focused. The shell toast host reads it.
 *
 * DQ-1006: a host inside an overlay clears what is at the bottom there: the footer of an open sheet (its primary action),
 * which the sheet reports with `reportOverlayFooter`, and otherwise what the shell host cleared (the tab bar under a context
 * menu), which the shell host publishes with `reportShellClearance`.
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

/** A tiny store of numbers by key; the largest counts. */
function heightStore() {
  const values = new Map<string, number>();
  let largest = 0;
  const listeners = new Set<() => void>();
  return {
    report(key: string, height: number | null) {
      if (height !== null && height > 0) values.set(key, height);
      else values.delete(key);
      const next = values.size > 0 ? Math.max(...values.values()) : 0;
      if (next === largest) return;
      largest = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => largest,
  };
}

const overlayFooters = heightStore();
const shellTabBar = heightStore();
const shellStickyBar = heightStore();

/**
 * DQ-1006: the footer of an open sheet, from the bottom of the window to its hairline (safe inset included). `null` takes it
 * out when the sheet closes. A toast raised inside the overlay then sits 8 above the sheet's primary action.
 */
export function reportOverlayFooter(key: string, height: number | null): void {
  overlayFooters.report(key, height);
}

/**
 * DQ-1006 r3: an open sheet, as a toast inside its overlay must see it. `height` runs from the bottom of the window to the sheet's
 * visible top edge (safe inset included); `column` is the width of its content column. A toast then sits 8 above the sheet, never
 * on its text field or its primary action, and no wider than its column. `null` takes it out when the sheet closes.
 */
export type OverlayPanel = { height: number; column: number };

const panels = new Map<string, OverlayPanel>();
let panel: OverlayPanel | null = null;
const panelListeners = new Set<() => void>();

export function reportOverlayPanel(key: string, next: OverlayPanel | null): void {
  if (next && next.height > 0) panels.set(key, next);
  else panels.delete(key);
  // The tallest open sheet is the one on top of the others.
  let tallest: OverlayPanel | null = null;
  panels.forEach((entry) => {
    if (!tallest || entry.height > tallest.height) tallest = entry;
  });
  const before = panel;
  const after = tallest as OverlayPanel | null;
  if (before?.height === after?.height && before?.column === after?.column) return;
  panel = after;
  panelListeners.forEach((listener) => listener());
}

function subscribePanel(listener: () => void) {
  panelListeners.add(listener);
  return () => {
    panelListeners.delete(listener);
  };
}

/** The open sheet a toast inside the overlay sits above, or null. */
export function useOverlayPanel(): OverlayPanel | null {
  return useSyncExternalStore(
    subscribePanel,
    () => panel,
    () => null,
  );
}

/**
 * DQ-1006 r3: whether a toast above a sheet `panelHeight` high still fits under the safe top of a `windowHeight` window. When it
 * does not (a sheet at its full snap), the toast goes to the top of the screen instead, never into the sheet's content.
 */
export function toastFitsAbovePanel(panelHeight: number, windowHeight: number, safeTop: number, toastHeight: number): boolean {
  return windowHeight - panelHeight - TOAST_GAP - toastHeight >= safeTop + TOAST_GAP;
}

/** The shell host's clearance, so a host inside an overlay that has no footer (a context menu) still clears the tab bar. */
export function reportShellClearance(tabBar: number, stickyBar: number): void {
  shellTabBar.report('shell', tabBar);
  shellStickyBar.report('shell', stickyBar);
}

/** What a toast inside an overlay clears: the shell's tab bar, and the higher of the shell's sticky bar and a sheet footer. */
export function useOverlayClearance(): { tabBar: number; stickyBar: number } {
  const footer = useSyncExternalStore(overlayFooters.subscribe, overlayFooters.get, () => 0);
  const tabBar = useSyncExternalStore(shellTabBar.subscribe, shellTabBar.get, () => 0);
  const stickyBar = useSyncExternalStore(shellStickyBar.subscribe, shellStickyBar.get, () => 0);
  return { tabBar, stickyBar: Math.max(stickyBar, footer) };
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
