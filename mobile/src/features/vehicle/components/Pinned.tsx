import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isWeb } from '@/lib/platform';
import { createStyles, space, zIndex } from '@/theme';

import { pinnedShift } from '../sections';

const useStyles = createStyles(() => ({
  root: { left: 0, position: 'absolute', top: 0, zIndex: zIndex.sticky },
}));

export type PinnedProps = {
  scrollY: SharedValue<number>;
  /** The rows' tops in the page (`useSectionScroll().rowTops`). */
  rowTops: SharedValue<Record<string, number>>;
  /** The row whose top is this block's place in the page, plus `offset`. */
  anchorKey: string;
  offset?: number;
  /** Where it stays once the page has scrolled it there. */
  pinnedTop: number;
  /** Like CSS sticky at its container's end: the block never reaches past the page's content (the desktop card). */
  clampToEnd?: { contentHeight: SharedValue<number>; bottomGap: number };
  /**
   * DQ-M53R2-02: the layer's height (the list's viewport). A block taller than the room under `pinnedTop` pins by its bottom edge
   * instead, `bottomGap` above the window's end, so its lower controls are reachable (the standard tall-sidebar rule).
   */
  viewport?: SharedValue<number>;
  bottomGap?: number;
  /** Its measured height, for the row that keeps its place in the list. */
  onHeight?: (height: number) => void;
  /** The list's scrollable DOM node on web, so a wheel or a touch swipe over the block still scrolls the page. */
  scrollNode?: () => unknown;
  /** Native: a vertical pan over the block scrolls the list to this offset (review SF-5); horizontal pans stay the block's own. */
  scrollToOffset?: (offset: number) => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
};

/** Where the block pins: `pinnedTop`, or for a block taller than the room below it, its bottom `bottomGap` above the window's end. */
export function pinnedTopFor(pinnedTop: number, blockHeight: number, viewportHeight: number, bottomGap: number): number {
  'worklet';
  if (viewportHeight <= 0 || blockHeight <= 0) return pinnedTop;
  return Math.min(pinnedTop, viewportHeight - blockHeight - bottomGap);
}

/** Points a pan moves before it scrolls the page: below it a press stays a press. */
const PAN_SLOP = space[8] + space[2];

type WebListeners = {
  addEventListener: (type: string, listener: EventListener, options: { passive: boolean }) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
};

type WheelTarget = { addEventListener: (type: 'wheel', listener: (event: WheelEvent) => void, options: { passive: boolean }) => void; removeEventListener: (type: 'wheel', listener: (event: WheelEvent) => void) => void };
type ScrollNode = { scrollBy: (options: { top: number; left: number }) => void };

function isWheelTarget(value: unknown): value is WheelTarget {
  return typeof value === 'object' && value !== null && 'addEventListener' in value && 'removeEventListener' in value;
}

type Measurable = { getBoundingClientRect: () => { top: number; height: number } };

function isMeasurable(value: unknown): value is Measurable {
  return typeof value === 'object' && value !== null && 'getBoundingClientRect' in value;
}

function isScrollNode(value: unknown): value is ScrollNode {
  return typeof value === 'object' && value !== null && 'scrollBy' in value;
}

/**
 * A block that scrolls with the page and then stays (VEH-01's section index and desktop card, 10 §5). It lives outside the list,
 * which positions its rows itself, so CSS `position: sticky` cannot hold it: it follows the scroll offset on the UI thread
 * (`pinnedShift`), in the same frame as the list on native. Its place in the list stays free (a row of its height). Hidden until the
 * list has measured its anchor. On web a vertical wheel over it scrolls the page as it would over the content.
 */
export function Pinned({ scrollY, rowTops, anchorKey, offset = 0, pinnedTop, clampToEnd, viewport, bottomGap = 0, onHeight, scrollNode, scrollToOffset, style, children, testID }: PinnedProps) {
  const styles = useStyles();
  const height = useSharedValue(0);
  const ref = useRef<ComponentRef<typeof View>>(null);

  const animated = useAnimatedStyle(() => {
    const top = rowTops.get()[anchorKey];
    if (top === undefined || !Number.isFinite(top)) return { opacity: 0, transform: [{ translateY: 0 }] };
    const scroll = scrollY.get();
    let y = pinnedShift(scroll, top + offset, pinnedTopFor(pinnedTop, height.get(), viewport ? viewport.get() : 0, bottomGap));
    if (clampToEnd) y = Math.min(y, clampToEnd.contentHeight.get() - scroll - height.get() - clampToEnd.bottomGap);
    return { opacity: 1, transform: [{ translateY: Math.max(y, top + offset - scroll) }] };
  });

  // Web: a vertical wheel or touch swipe over the block scrolls the page, as it would over the content (review SF-5). A mostly
  // horizontal one stays the block's own (the chip row scrolls sideways).
  useEffect(() => {
    const node: unknown = ref.current;
    if (!isWeb || !scrollNode || !isWheelTarget(node)) return;
    const scrollBy = (dy: number) => {
      const target = scrollNode();
      if (!isScrollNode(target)) return false;
      target.scrollBy({ top: dy, left: 0 });
      return true;
    };
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (scrollBy(event.deltaY)) event.preventDefault();
    };
    let last: { x: number; y: number } | null = null;
    const touchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      last = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const touchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!last || !touch) return;
      const dx = touch.clientX - last.x;
      const dy = touch.clientY - last.y;
      if (Math.abs(dy) <= Math.abs(dx)) return;
      last = { x: touch.clientX, y: touch.clientY };
      if (scrollBy(-dy)) event.preventDefault();
    };
    const touchEnd = () => {
      last = null;
    };
    const target = node as unknown as WebListeners;
    target.addEventListener('wheel', wheel as EventListener, { passive: false });
    target.addEventListener('touchstart', touchStart as EventListener, { passive: true });
    target.addEventListener('touchmove', touchMove as EventListener, { passive: false });
    target.addEventListener('touchend', touchEnd as EventListener, { passive: true });
    return () => {
      target.removeEventListener('wheel', wheel as EventListener);
      target.removeEventListener('touchstart', touchStart as EventListener);
      target.removeEventListener('touchmove', touchMove as EventListener);
      target.removeEventListener('touchend', touchEnd as EventListener);
    };
  }, [scrollNode]);

  // Native: a vertical pan over the block drives the list, so the band of the pinned chip row and the desktop card (iPad landscape)
  // scroll the page too. It starts after 10 vertical points and gives way to a horizontal pan, so chips and buttons keep their taps.
  const startScroll = useSharedValue(0);
  const pan = usePanGesture({
    enabled: !isWeb && Boolean(scrollToOffset),
    activeOffsetY: [-PAN_SLOP, PAN_SLOP],
    failOffsetX: [-PAN_SLOP, PAN_SLOP],
    testID: testID ? `${testID}.pan` : undefined,
    onActivate: () => {
      'worklet';
      startScroll.set(scrollY.get());
    },
    onUpdate: (event) => {
      'worklet';
      if (scrollToOffset) scheduleOnRN(scrollToOffset, Math.max(0, startScroll.get() - event.translationY));
    },
  });

  // DQ-M53-03, DQ-M53R2-02: focus that lands in the block scrolls the page until the focused control is inside the window (24 from
  // either edge): a block below the fold comes up to its pinned place, a tall one moves until the control shows.
  const revealOnFocus = (event: { target?: unknown; nativeEvent?: { target?: unknown } }) => {
    const top = rowTops.get()[anchorKey];
    if (top === undefined || !Number.isFinite(top) || !scrollToOffset) return;
    const natural = top + offset;
    const window = viewport ? viewport.get() : 0;
    const pinnedAt = pinnedTopFor(pinnedTop, height.get(), window, bottomGap);
    const scroll = scrollY.get();
    const target = event.target ?? event.nativeEvent?.target;
    const root: unknown = ref.current;
    // Web: where the control sits inside the block, so a tall block can bring exactly that control into view.
    if (isWeb && window > 0 && isMeasurable(target) && isMeasurable(root)) {
      const inBlock = target.getBoundingClientRect().top - root.getBoundingClientRect().top;
      const controlHeight = target.getBoundingClientRect().height;
      const blockY = Math.max(pinnedAt, natural - scroll);
      const controlY = blockY + inBlock;
      const edge = space[24];
      let wanted = blockY;
      if (controlY + controlHeight > window - edge) wanted = window - edge - controlHeight - inBlock;
      else if (controlY < edge) wanted = edge - inBlock;
      else return;
      // The block's place follows the scroll down to where it pins; it cannot move above that.
      const clamped = Math.max(pinnedAt, Math.min(natural, wanted));
      scrollToOffset(Math.max(0, natural - clamped));
      return;
    }
    if (scroll < natural - pinnedAt - 1) scrollToOffset(natural - pinnedAt);
  };

  return (
    <Animated.View
      onFocus={revealOnFocus}
      style={[styles.root, style, animated]}
      onLayout={(event: LayoutChangeEvent) => {
        height.set(event.nativeEvent.layout.height);
        onHeight?.(Math.ceil(event.nativeEvent.layout.height));
      }}
      testID={testID}
    >
      {/* A plain view inside: on web its ref is the DOM node that takes the wheel and touch listeners. */}
      <GestureDetector gesture={pan}>
        <View ref={ref}>{children}</View>
      </GestureDetector>
    </Animated.View>
  );
}
