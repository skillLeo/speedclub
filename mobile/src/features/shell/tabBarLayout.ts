import { useFocusEffect } from 'expo-router';
import { createContext, use, useCallback } from 'react';
import type { ViewStyle } from 'react-native';

import { setTabBarHidden } from '@/state/shell';
import { size } from '@/theme';
import { useSafeEdge, useSafeInset } from '@/ui/safeArea';

/** True while the tab bar floats over this part of the tree. Outside (tabs), and with a rail or sidebar, it is false. */
export const TabBarOverlayContext = createContext(false);

const NO_PADDING: ViewStyle = {};

/** Put this on the content of a screen inside a tab: the end of a list must clear the floating tab bar. */
export function useTabBarPadding(): ViewStyle {
  const overlay = use(TabBarOverlayContext);
  const padding = useSafeEdge('bottom', size.tabBar);
  return overlay ? padding : NO_PADDING;
}

/** The same as a number, for lists that need one (FlashList). On web the CSS safe-area inset is not part of it. */
export function useTabBarInset(): number {
  const overlay = use(TabBarOverlayContext);
  const inset = useSafeInset('bottom');
  return overlay ? size.tabBar + inset : 0;
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
