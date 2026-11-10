/**
 * Whether the screen around a component is the one on show (code review M2.8 nit 4). A tab left behind stays mounted, on web even
 * laid out (features/shell/tabSlotRender.tsx), and a stack screen under the top one too: the skeleton's shimmer, the one loop in the
 * product, pauses there, and a list's `onEndReached` must not load pages for a screen nobody sees.
 *
 * expo-router 58 provides the focus of each route, its parents' included, through `IsFocusedContext` (NavigationProvider), but its
 * public `useIsFocused` throws outside the route tree (the dev gallery, Jest). So this reads the context itself: outside any route it
 * counts as shown. Checked against expo-router 58.0.29 (`build/react-navigation/core/useIsFocused`).
 */
import { use } from 'react';
import { IsFocusedContext } from 'expo-router/build/react-navigation/core/useIsFocused';

export function useScreenFocused(): boolean {
  return use(IsFocusedContext) ?? true;
}
