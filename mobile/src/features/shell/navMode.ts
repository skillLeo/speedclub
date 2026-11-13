/**
 * Which tab chrome the member app runs (09 §6.1, ADR-404): native tabs (`expo-router/native-tabs`: Liquid Glass on iOS,
 * Material 3 on Android) behind the remote flag `nav.native_tabs`, or the JS shell (floating bar, rail, sidebar) that the web
 * always uses and that native falls back to.
 */
import { create } from 'zustand';

import { useAppConfig } from '@/api/queries/appConfig';
import { isWeb } from '@/lib/platform';

export const NATIVE_TABS_FLAG = 'nav.native_tabs';

export type TabChrome = 'native' | 'js';

/**
 * 09 §8.18: the flag defaults to on everywhere, so it is a kill switch. Only an explicit `false` from app-config turns native
 * tabs off; a config without the key (the bundled one on a first launch offline, a server before the flag exists) keeps
 * them. The web never runs native tabs.
 */
export function tabChromeFor(flags: Readonly<Record<string, boolean>>, web: boolean = isWeb): TabChrome {
  if (web) return 'js';
  return flags[NATIVE_TABS_FLAG] === false ? 'js' : 'native';
}

/** The chrome for the current config. Switching it remounts the tab navigator once, which only a kill switch does. */
export function useTabChrome(): TabChrome {
  const { config } = useAppConfig();
  return tabChromeFor(config.flags);
}

type NativeTabBarState = {
  /** True while native tabs are mounted. */
  active: boolean;
  /**
   * How far the native bar covers the bottom of the window, without the bottom safe-area inset (the toast host adds that
   * itself). Measured from the tab content, so 0 where the content runs under the bar (iOS: the system insets scroll views).
   */
  obstruction: number;
};

export const useNativeTabBarStore = create<NativeTabBarState>(() => ({ active: false, obstruction: 0 }));

export function setNativeTabsActive(active: boolean): void {
  useNativeTabBarStore.setState(active ? { active } : { active, obstruction: 0 });
}

/** From the tab content's frame in the window: what lies below it is the bar (and the system inset). */
export function reportNativeTabContentFrame(contentBottom: number, windowHeight: number, bottomInset: number): void {
  const obstruction = Math.max(0, Math.round(windowHeight - contentBottom - bottomInset));
  if (useNativeTabBarStore.getState().obstruction !== obstruction) useNativeTabBarStore.setState({ obstruction });
}
