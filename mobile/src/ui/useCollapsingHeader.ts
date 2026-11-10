import { useMemo } from 'react';
import type { ScrollViewProps } from 'react-native';
import { useAnimatedScrollHandler, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { size } from '@/theme';

export type CollapsingHeader = {
  /** The list's vertical offset, on the UI thread. */
  scrollY: SharedValue<number>;
  /** Scroll distance after which the compact title takes over; `HeaderLargeTitle` keeps it equal to its real height. */
  collapseAt: SharedValue<number>;
  /** Spread on `Animated.ScrollView` or `CollapsingFlashList`. A plain ScrollView or FlashList does not fire it. */
  scrollProps: Pick<ScrollViewProps, 'onScroll' | 'scrollEventThrottle'>;
};

/** FlashList with a Reanimated scroll handler, in the shared list frame (`flashListCell.tsx`). */
export { CollapsingFlashList } from './flashListCell';

/**
 * Drives `Header` and `HeaderLargeTitle` from the scroll position:
 *
 *   const header = useCollapsingHeader();
 *   <Header variant="large" title="Garage" scroll={header} />
 *   <Animated.ScrollView {...header.scrollProps}>
 *     <HeaderLargeTitle title="Garage" scroll={header} />
 *     ...
 */
export function useCollapsingHeader(): CollapsingHeader {
  const scrollY = useSharedValue(0);
  const collapseAt = useSharedValue<number>(size.headerLargeTitleBlock);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  return useMemo(
    () => ({
      scrollY,
      collapseAt,
      scrollProps: { onScroll: onScroll as unknown as ScrollViewProps['onScroll'], scrollEventThrottle: 16 },
    }),
    [scrollY, collapseAt, onScroll],
  );
}
