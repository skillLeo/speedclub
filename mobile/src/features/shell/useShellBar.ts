import { router, usePathname, type Href } from 'expo-router';
import { useTabTrigger } from 'expo-router/ui';
import { useCallback, useMemo } from 'react';

import { useAppConfig } from '@/api/queries/appConfig';
import { qaForcesFlag } from '@/lib/qa';

import { activeItemKey, itemKey, TAB_DESTINATIONS, visibleItems, type BarItem, type PlaceDestination, type TabName } from './destinations';
import { useTabNavigation } from './useTabNavigation';

/** Where each tab's root lives: a tab press while one of its places shows goes back here (10 §1). */
export const TAB_ROOT_PATHS: Readonly<Record<TabName, string>> = {
  home: '/',
  discover: '/discover',
  garage: '/garage',
  shop: '/shop',
  profile: '/profile',
};

type PressEvent = { preventDefault?: () => void; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number } | null | undefined;

/**
 * What a bar of the JS shell needs for its items (tabs and places, 10 §1): the items whose flag is on, which one is current, and the
 * press handlers. A place opens as the next page of a stack: Nachrichten in the tab that shows (as from the Start header), Treffen
 * and Forum in Entdecken; pressed while it is current, it returns to its own page (`dismissTo`). A tab press
 * while one of the tab's places is current returns to the tab's root; otherwise TabTrigger and the re-tap rule decide (§9).
 */
export function useShellBar(items: readonly BarItem[]) {
  const { config } = useAppConfig();
  const pathname = usePathname();
  const { activeIndex: tabIndex, pressHandler } = useTabNavigation();
  const { getTrigger } = useTabTrigger({ name: TAB_DESTINATIONS[0]?.name ?? 'home' });
  const focusedTab = TAB_DESTINATIONS[tabIndex]?.name ?? 'home';

  const flags = useMemo(() => {
    const forced: Record<string, boolean> = {};
    for (const item of items) if (item.kind === 'place' && item.place.flag && qaForcesFlag(item.place.flag)) forced[item.place.flag] = true;
    return { ...config.flags, ...forced };
  }, [config.flags, items]);
  const shown = useMemo(() => visibleItems(items, flags), [flags, items]);
  const activeKey = activeItemKey(shown, focusedTab, pathname);
  const activeIndex = Math.max(0, shown.findIndex((item) => itemKey(item) === activeKey));

  const tabPress = useCallback(
    (name: TabName) => {
      const fallThrough = pressHandler(name);
      return (event: PressEvent) => {
        const placeShowing = activeKey !== focusedTab && name === focusedTab;
        if (placeShowing && !(event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey || (event?.button ?? 0) !== 0)) {
          event?.preventDefault?.();
          router.dismissTo(TAB_ROOT_PATHS[name] as Href);
          return;
        }
        fallThrough(event);
      };
    },
    [activeKey, focusedTab, pressHandler],
  );

  const placePress = useCallback(
    (place: PlaceDestination) => () => {
      // Current already (a conversation over the inbox, an event over Treffen): back to the place's own page.
      if (activeKey === place.name) router.dismissTo(place.path as Href);
      // Nachrichten opens in whichever tab shows, as from the Start header; Treffen and Forum in Entdecken.
      else if (place.name === 'messages' || focusedTab === place.tab) router.push(place.path as Href);
      // The other tab keeps its stack; the place is pushed on top of it.
      else if (getTrigger(place.tab)) router.navigate(`/(tabs)/(${place.tab})${place.path}` as Href);
    },
    [activeKey, focusedTab, getTrigger],
  );

  return { items: shown, activeKey, activeIndex, tabPress, placePress };
}
