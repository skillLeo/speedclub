/**
 * Layout decisions of the vehicle screens (§5): the phone layout of FS-3 below 768, one centred column of 768 on a tablet,
 * and from 1280 the gallery 7/12 beside a sticky spec and owner card 5/12, as WEB-01 does.
 */
import { useCallback, useRef, type ComponentProps } from 'react';
import type { LayoutChangeEvent, ViewStyle } from 'react-native';
import type Animated from 'react-native-reanimated';
import { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { useBreakpoint, zIndex } from '@/theme';

export type ProfileLayout = 'phone' | 'tablet' | 'desktop';

export function useProfileLayout(): ProfileLayout {
  return useBreakpoint().kind;
}

/** WEB-01 from 768: one column of at most 768, gutters included. */
export const TABLET_COLUMN = 768;

/** Share of the 12-column desktop grid (FS-10: gallery 7, card 5). */
export const DESKTOP_GALLERY_FLEX = 7;
export const DESKTOP_CARD_FLEX = 5;

export type Sticky = {
  /** For an `Animated.View`. */
  style: ComponentProps<typeof Animated.View>['style'];
  onLayout: (event: LayoutChangeEvent) => void;
  /** The scroll offset at which the block reaches its sticky position, or null before its first layout. */
  stickPoint: () => number | null;
};

/**
 * A block that scrolls with the content and then stays `top` below the top edge of the scroller, such as the content tabs
 * under the header. The web uses CSS `position: sticky`, which the browser resolves while it scrolls; native translates the
 * block on the UI thread from the scroll offset, which sticks in the same frame. `offset` is the block parent's distance
 * from the top of the scroll content, because `onLayout` reports the position inside the parent.
 */
export function useSticky(scrollY: SharedValue<number>, top: number, offset: number = 0): Sticky {
  const anchor = useSharedValue(Number.POSITIVE_INFINITY);
  const anchorRef = useRef<number | null>(null);

  const animated = useAnimatedStyle(() => {
    const at = anchor.get();
    const shift = Number.isFinite(at) ? Math.max(0, scrollY.get() + top - at) : 0;
    return { transform: [{ translateY: shift }] };
  });

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const y = event.nativeEvent.layout.y + offset;
      anchorRef.current = y;
      anchor.set(y);
    },
    [anchor, offset],
  );

  const stickPoint = useCallback(() => (anchorRef.current === null ? null : Math.max(0, anchorRef.current - top)), [top]);

  // RN's style types know no `sticky`; React Native Web passes it through to CSS.
  const webStyle = { position: 'sticky', top, zIndex: zIndex.sticky } as unknown as ViewStyle;
  return { style: isWeb ? webStyle : [{ zIndex: zIndex.sticky }, animated], onLayout, stickPoint };
}
