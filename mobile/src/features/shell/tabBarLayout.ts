import { useFocusEffect } from 'expo-router';
import { createContext, use, useCallback } from 'react';
import type { ViewStyle } from 'react-native';

import { setTabBarHidden } from '@/state/shell';
import { size } from '@/theme';
import { useCssSafeInset, useSafeEdge, useSafeInset } from '@/ui/safeArea';

/** True while the tab bar floats over this part of the tree. Outside (tabs), and with a rail or sidebar, it is false. */
export const TabBarOverlayContext = createContext(false);

const NO_PADDING: ViewStyle = {};

/** Put this on the content of a screen inside a tab: the end of a list must clear the floating tab bar. */
export function useTabBarPadding(): ViewStyle {
  const overlay = use(TabBarOverlayContext);
  const padding = useSafeEdge('bottom', size.tabBar);
  return overlay ? padding : NO_PADDING;
}

/**
 * The same as a number, for lists that need one (FlashList) and controls that float above the bar. QA-C05: on web the bar grows by the
 * CSS safe-area inset (TabBar's `useSafeEdge('bottom')`), so that inset, measured from CSS, is part of the number there too.
 */
export function useTabBarInset(): number {
  const overlay = use(TabBarOverlayContext);
  const inset = useSafeInset('bottom');
  const cssInset = useCssSafeInset('bottom');
  return overlay ? size.tabBar + inset + cssInset : 0;
}

/** §9: an editor pushed inside a tab hides the bar while it is focused. Wizards and modals do not need this. */
export function useHideTabBar(): void {
  useFocusEffect(
    useCallback(() => {
      setTabBarHidden(true);
      return () => setTabBarHidden(false);
    }, []),
  );
}
