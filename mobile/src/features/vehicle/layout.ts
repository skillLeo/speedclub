/**
 * Layout decisions of the vehicle screens (§5): the phone layout of FS-3 below 768, one centred column of 768 on a tablet,
 * and from 1280 the gallery 7/12 beside a sticky spec and owner card 5/12, as WEB-01 does.
 */
import { useCallback, useRef, type ComponentProps } from 'react';
import type { LayoutChangeEvent, ViewStyle } from 'react-native';
import type Animated from 'react-native-reanimated';
import { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { aspect, layout as layoutTokens, scrimSafe, space, useBreakpoint, zIndex } from '@/theme';
import type { DisplayTitlePlacement } from '@/ui/displayTitleLayout';

export type ProfileLayout = 'phone' | 'tablet' | 'desktop';

export function useProfileLayout(): ProfileLayout {
  return useBreakpoint().kind;
}

/** WEB-01 from 768: one column of at most 768, gutters included. */
export const TABLET_COLUMN = 768;

/**
 * DQ-1048 (09 §7.6 "web ≥ 1280: hero full width; below, 8/4 grid"): under the full-width hero the tabs and their content take 8 of
 * the 12 columns and the sticky card 4 (token `layout.vehicleDesktop`).
 */
export const DESKTOP_GALLERY_FLEX = layoutTokens.vehicleDesktop.galleryCols;
export const DESKTOP_CARD_FLEX = layoutTokens.vehicleDesktop.specCols;

/** The desktop row's inner width: the content, at most `contentMax`, inside the row's 24 padding. */
export function desktopInnerWidth(contentWidth: number): number {
  return Math.min(contentWidth, layoutTokens.contentMax + 2 * space[24]) - 2 * space[24];
}

function ratioOf(value: string): number {
  const [w, h] = value.split(':').map(Number);
  return w && h ? w / h : 1;
}

/**
 * DQ-1047/1048: the hero is the page's opener at every width. 4:5 edge to edge on a phone (09 §7.6), 16:9 across the content from
 * 768 (09 §4.6 web 16:9), at most `fullBleedMax` wide and never rounded. WEB-01 sets the same boxes in public.css.
 */
export function heroBox(layout: ProfileLayout, contentWidth: number): { width: number; ratio: number } {
  if (layout === 'phone') return { width: contentWidth, ratio: ratioOf(aspect.hero) };
  return { width: Math.min(contentWidth, layoutTokens.fullBleedMax), ratio: ratioOf(aspect.heroWeb) };
}

/**
 * ADR-421 b: text over `scrim.photo` only below its text-safe line. The identity block starts at the strictest line of the three
 * themes (0.824 of the photo's height), so the same box holds in Carbon, Schwarz and Hell, and WEB-01 uses one number too.
 */
export const HERO_TEXT_SAFE = Math.max(scrimSafe.carbon.text, scrimSafe.black.text, scrimSafe.light.text);

/** How far the identity reaches up into a hero `width` wide at `ratio`: from its bottom edge to the text-safe line. */
export function heroIdentityOverlap(width: number, ratio: number): number {
  return ratio > 0 ? ((1 - HERO_TEXT_SAFE) * width) / ratio : 0;
}

/**
 * The width ProfileSummary (eyebrow to owner row, the spec strip included) is laid out at, from the content width of the
 * page: a phone's content between its gutters, the tablet column between its gutters, the desktop card inside its 24
 * padding. VEH-01, GAR-02 and their skeleton use this one function, so the skeleton, the first frame of the strip and its
 * final layout agree (N1b).
 */
export function profileSummaryWidth(layout: ProfileLayout, contentWidth: number, gutter: number): number {
  return summaryWidth(layout, contentWidth, gutter);
}

/** The identity's width on the hero: the hero between the gutters (DQ-1047). The title is laid out at it. */
export function heroIdentityWidth(layout: ProfileLayout, contentWidth: number, gutter: number): number {
  return Math.max(0, heroBox(layout, contentWidth).width - 2 * gutter);
}

function summaryWidth(layout: ProfileLayout, contentWidth: number, gutter: number): number {
  if (layout === 'desktop') {
    const card = ((desktopInnerWidth(contentWidth) - space[24]) * DESKTOP_CARD_FLEX) / (DESKTOP_GALLERY_FLEX + DESKTOP_CARD_FLEX);
    return Math.max(0, card - 2 * space[24]);
  }
  if (layout === 'tablet') return Math.max(0, Math.min(contentWidth, TABLET_COLUMN) - 2 * gutter);
  return Math.max(0, contentWidth - 2 * gutter);
}

/**
 * ADR-426 b: the vehicle's title in the summary is a card title in the desktop's side card (30/34 at every width, as the WEB-01
 * card) and a page title on phones and tablets. ProfileSummary and VehicleProfileSkeleton read it from here, so they agree.
 */
export function summaryTitlePlacement(layout: ProfileLayout): DisplayTitlePlacement {
  // DQ-1047/1048: the title is on the hero at every width now, a page title (the desktop card holds no title any more).
  void layout;
  return 'page';
}

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
