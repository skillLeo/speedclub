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

/** 10 §5 (ADR-505): from 1440 the section index is a vertical list in the 2 left columns of the 12 (2 · 6 · 4). */
export const SIDE_INDEX_COLS = 2;
const GRID_COLS = layoutTokens.grid.desktop.columns;

/**
 * Whether the desktop sets the section index as a vertical list on the left: from 1440, the width at which the content beside the
 * 240 sidebar reaches its 1200 (`contentMax + sidebar`), so the 2 columns it takes leave the content its room.
 */
export function hasSideIndex(layout: ProfileLayout, contentWidth: number): boolean {
  return layout === 'desktop' && contentWidth >= layoutTokens.contentMax;
}

export type DesktopColumns = {
  /** Where the row's padded box starts inside the content width (the row is centred at most `contentMax` + 48 wide). */
  left: number;
  /** The side index column (0 without it), the content column and the card, with 24 between each. */
  index: number;
  gallery: number;
  card: number;
  /** x of each column inside the content width. */
  indexX: number;
  galleryX: number;
  cardX: number;
};

/** The desktop grid under the hero: content 8 + card 4, or index 2 + content 6 + card 4 from 1440 (`hasSideIndex`). */
export function desktopColumns(contentWidth: number, sideIndex: boolean): DesktopColumns {
  const row = Math.min(contentWidth, layoutTokens.contentMax + 2 * space[24]);
  const left = Math.max(0, (contentWidth - row) / 2) + space[24];
  const inner = desktopInnerWidth(contentWidth);
  const gaps = sideIndex ? 2 : 1;
  const unit = Math.max(0, inner - gaps * space[24]) / GRID_COLS;
  const index = sideIndex ? unit * SIDE_INDEX_COLS : 0;
  const card = unit * DESKTOP_CARD_FLEX;
  const gallery = unit * (GRID_COLS - DESKTOP_CARD_FLEX) - index;
  const indexX = left;
  const galleryX = left + (sideIndex ? index + space[24] : 0);
  return { left, index, gallery, card, indexX, galleryX, cardX: galleryX + gallery + space[24] };
}

function ratioOf(value: string): number {
  const [w, h] = value.split(':').map(Number);
  return w && h ? w / h : 1;
}

/** R4-1.3: the desktop hero's highest box (480: five 96 web-section steps). */
export const DESKTOP_HERO_MAX = 5 * space[96];

/**
 * DQ-1047/1048: the hero is the page's opener at every width. 4:5 edge to edge on a phone (09 §7.6), 16:9 across the content from
 * 768 (09 §4.6 web 16:9), at most `fullBleedMax` wide and never rounded. WEB-01 sets the same boxes in public.css.
 */
export function heroBox(layout: ProfileLayout, contentWidth: number, windowHeight?: number): { width: number; ratio: number } {
  if (layout === 'phone') return { width: contentWidth, ratio: ratioOf(aspect.hero) };
  // Client feedback CF-1 (M5.3): from 1280 a wider 21:9 banner (`aspect.heroDesktop`), ≈ 510 high at 1200 instead of 675; still the
  // page's opener, and the content starts within the first screen.
  const width = Math.min(contentWidth, layoutTokens.fullBleedMax);
  if (layout !== 'desktop') return { width, ratio: ratioOf(aspect.heroWeb) };
  // R4-1.3: and never higher than half the window or DESKTOP_HERO_MAX; a lower box is cropped from the photo's focal point.
  const cap = windowHeight && windowHeight > 0 ? Math.min(DESKTOP_HERO_MAX, windowHeight / 2) : DESKTOP_HERO_MAX;
  return { width, ratio: Math.max(ratioOf(aspect.heroDesktop), width / cap) };
}

/** The hero's aspect token per layout (ProfileHero's `aspect`), matching `heroBox`. */
export function heroAspect(layout: ProfileLayout): (typeof aspect)['hero' | 'heroWeb' | 'heroDesktop'] {
  if (layout === 'phone') return aspect.hero;
  return layout === 'desktop' ? aspect.heroDesktop : aspect.heroWeb;
}

/**
 * ADR-421 b: text over `scrim.photo` only below its text-safe line. The identity block starts at the strictest line of the three
 * themes (0.824 of the photo's height), so the same box holds in Carbon, Schwarz and Hell, and WEB-01 uses one number too.
 */
export const HERO_TEXT_SAFE = Math.max(scrimSafe.carbon.text, scrimSafe.black.text, scrimSafe.light.text);

/**
 * The DOM audit's counted exemption for that reach (`scrim-overlap`, web/tests/e2e/support/dom-audit.mjs): the identity's negative
 * margin-top is a layout result of the photo's size, never a spacing step. Allowed only on the identity right after the photo of the
 * stages design QA accepted (VEH-01/GAR-02, EVT-02, the GAR-03 preview, BIZ-01, the profile skeleton); `undefined` without a reach,
 * so a block that does not overlap carries nothing.
 */
export function scrimOverlapDataSet(overlap: number): { qaExempt: 'scrim-overlap' } | undefined {
  return overlap > 0 ? { qaExempt: 'scrim-overlap' } : undefined;
}

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
    const { card } = desktopColumns(contentWidth, hasSideIndex(layout, contentWidth));
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
