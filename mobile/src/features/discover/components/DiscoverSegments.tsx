import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView as RNScrollView, type LayoutChangeEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, ScrollView as GestureScrollView, usePanGesture, type PanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, useBreakpoint } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';
import { SegmentedControl, type Segment, type SegmentedControlProps } from '@/ui/SegmentedControl';
import { motionDuration, useMotionPreference } from '@/ui/motion';

import {
  neighbourSegment,
  useDiscoverSegments,
  useOpenSegment,
  useSegmentsInSidebar,
  type DiscoverSegment,
  type DiscoverSegmentEntry,
} from '../segments';

const SWIPE = motionTokens.signature.swipeActions;

/**
 * How far a swipe must travel to open the neighbouring page, as a share of the page's width: what is left of the swipe actions'
 * commit ratio (0.6), so a page turns at 40 % of its width or with a fling.
 */
export const SEGMENT_SWIPE_COMMIT = 1 - SWIPE.commitRatio;

/** The page a released swipe opens: 1 next, -1 previous, 0 none. A worklet, pure, for the tests. */
export function segmentSwipeDirection(translationX: number, velocityX: number, width: number): 1 | -1 | 0 {
  'worklet';
  if (width <= 0) return 0;
  const far = Math.abs(translationX) >= width * SEGMENT_SWIPE_COMMIT;
  const fling = Math.abs(velocityX) >= SWIPE.flingVelocity && Math.sign(velocityX) === Math.sign(translationX);
  if (!far && !fling) return 0;
  return translationX < 0 ? 1 : -1;
}

/**
 * Where the page under the finger goes while it follows a drag: one to one towards a neighbour, rubber-banded where there is none
 * (the first and the last segment). A worklet, pure, for the tests.
 */
export function segmentFollow(translationX: number, canNext: boolean, canPrevious: boolean): number {
  'worklet';
  const towardsNeighbour = translationX < 0 ? canNext : canPrevious;
  return towardsNeighbour ? translationX : translationX * SWIPE.rubberBand;
}

/**
 * The page a committed swipe opens slides in from the side the finger came from (DQ-M52-08): the swipe leaves this note for it, and
 * the page reads it when it mounts (a push) or gets the focus again (a pop).
 */
let pendingEntrance: { segment: DiscoverSegment; from: 1 | -1 } | null = null;

export function pendingSegmentEntranceForTests(): typeof pendingEntrance {
  return pendingEntrance;
}

const useStyles = createStyles(() => ({
  fill: { flex: 1 },
}));

export type DiscoverSegmentBarProps = {
  current: DiscoverSegment;
  style?: StyleProp<ViewStyle>;
  /** `<ROUTE-ID>.segments`; each segment adds `.builds`, `.events`, `.forum`, `.crews`. */
  testID: string;
};

/**
 * The SegmentedControl Builds · Treffen · Forum at the top of Entdecken (10 §1). Hidden while only one segment is on (Treffen and
 * Forum both off): a control with one choice is no choice. Hidden on every segment page from 1280 in the JS shell too, where the
 * sidebar lists Entdecken, Treffen and (with M5.8) Forum as places of their own (DQ-M52-03): one navigation system for the choice,
 * and the band the same on Builds, Treffen and Forum.
 */
export function DiscoverSegmentBar({ current, style, testID }: DiscoverSegmentBarProps) {
  const { t } = useTranslation('discover');
  const segments = useDiscoverSegments();
  const open = useOpenSegment();
  const inSidebar = useSegmentsInSidebar();
  if (segments.length < 2 || inSidebar) return null;
  // R4-2.3 adds Crews as a fourth segment (Builds · Treffen · Forum · Crews, lead brief); the control lays out any count it is given
  // (equal shares, its own scroller at a large font). 03 §8's "max 3 segments" waits for the lead's ADR.
  const options = segments.map<Segment<DiscoverSegment>>((entry) => ({ value: entry.value, label: t(entry.labelKey), testID: `${testID}.${entry.value}` })) as unknown as SegmentedControlProps<DiscoverSegment>['options'];
  return (
    <SegmentedControl<DiscoverSegment>
      options={options}
      value={current}
      onChange={(next) => {
        const entry = segments.find((segment) => segment.value === next);
        if (entry) open(entry);
      }}
      label={t('segments.label')}
      role="tablist"
      style={style}
      testID={testID}
    />
  );
}

/** The page swipe of the SegmentSwipe around a scroller, or null outside one. */
const SegmentPanContext = createContext<PanGesture | null>(null);

export type SegmentRailScrollViewProps = ScrollViewProps & { ref?: Ref<ComponentRef<typeof RNScrollView>> };

/**
 * A horizontal scroller inside an Entdecken page (scope chips, rails, filter chips): on iOS and Android it is the gesture handler's
 * ScrollView and blocks the page swipe, so a drag on a rail scrolls the rail and never turns the page (review SF-3); the swipe waits
 * until the rail's own gesture fails. On the web `touch-action: pan-y` already stops at the scroller, so it is the plain ScrollView.
 */
export function SegmentRailScrollView({ ref, ...props }: SegmentRailScrollViewProps) {
  const pan = useContext(SegmentPanContext);
  if (isWeb) return <RNScrollView ref={ref} horizontal {...props} />;
  return <GestureScrollView ref={ref} horizontal block={pan ?? undefined} {...props} />;
}

export type SegmentSwipeProps = {
  current: DiscoverSegment;
  /**
   * Off where the page is not one of Entdecken's segments (EVT-01 pushed from Start), where its own content takes horizontal drags (the
   * event map), and on desktop, where the pointer clicks. The same elements either way: switching it never remounts the page (SF-4).
   */
  enabled: boolean;
  children: ReactNode;
  testID: string;
};

/**
 * The swipe between Entdecken's pages (10 §1 "swipeable pages"), as a pager (DQ-M52-08): a horizontal drag moves the page with the
 * finger (one to one towards a neighbour, rubber-banded at either end; transform only). A release past 40 % of the width or a fling
 * carries the page on off-screen in the swipe's direction and opens the neighbouring segment, which slides in from the other side,
 * with the selection haptic of a segment change (09 §4.8). Otherwise the page springs back. Vertical first lets the page scroll, and a
 * horizontal scroller inside the page (SegmentRailScrollView) keeps its own drags. Reduced motion: the page stays put and a swipe
 * still turns it, with the stack's crossfade. The segmented control is always the other way (screen readers, keyboards, pointers).
 */
export function SegmentSwipe({ current, enabled, children, testID }: SegmentSwipeProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const { kind, width: windowWidth } = useBreakpoint();
  const segments = useDiscoverSegments();
  const open = useOpenSegment();
  const [measured, setMeasured] = useState(0);
  const width = measured > 0 ? measured : windowWidth;
  const follow = motion.preference === 'full';
  // A page opened by a swipe starts beside the screen, on the side the finger came from (the stack fades it in meanwhile).
  const offset = useSharedValue(follow && pendingEntrance?.segment === current ? pendingEntrance.from * windowWidth : 0);
  const active = enabled && kind !== 'desktop' && segments.length > 1;
  const canNext = neighbourSegment(segments, current, 1) !== null;
  const canPrevious = neighbourSegment(segments, current, -1) !== null;

  const turn = (direction: 1 | -1) => {
    const next = neighbourSegment(segments, current, direction);
    if (!next) return;
    haptics.selection();
    pendingEntrance = { segment: next.value, from: direction };
    open(next as DiscoverSegmentEntry);
  };

  // Web: a pointer that dragged the page lets go over a card that moved with it, and the browser then clicks that card (react-native-web
  // presses on the DOM click). Once the swipe has taken the drag, the click that ends it belongs to the swipe, not to the card under it.
  const host = useRef<ComponentRef<typeof Animated.View>>(null);
  const swallowClick = useRef(false);
  const claimClick = useCallback(() => {
    swallowClick.current = true;
  }, []);
  const releaseClick = useCallback(() => {
    // The click follows the pointer's release in the same task; a touch that moved gets none, so the claim ends shortly after.
    setTimeout(() => {
      swallowClick.current = false;
    }, motionDuration('effect.fast'));
  }, []);
  useEffect(() => {
    const node = host.current as unknown as HTMLElement | null;
    if (!isWeb || typeof node?.addEventListener !== 'function') return undefined;
    const swallow = (event: Event) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.stopPropagation();
      event.preventDefault();
    };
    node.addEventListener('click', swallow, true);
    return () => node.removeEventListener('click', swallow, true);
  }, []);

  // Read when the page gets the focus, not as dependencies: a width measured or a motion setting read mid-entrance must not run the
  // focus effect again and cut the slide short.
  const latest = useRef({ width, follow, motion });
  useLayoutEffect(() => {
    latest.current = { width, follow, motion };
  });

  // Shown again (a pop back to it, or a tap on the control): the page is where it belongs, or slides in when a swipe brought it.
  useFocusEffect(
    useCallback(() => {
      const entrance = pendingEntrance?.segment === current ? pendingEntrance : null;
      if (entrance) pendingEntrance = null;
      const now = latest.current;
      if (entrance && now.follow) {
        offset.set(entrance.from * now.width);
        offset.set(now.motion.springTo(0, 'calm'));
      } else {
        offset.set(0);
      }
    }, [current, offset]),
  );

  const pan = usePanGesture({
    enabled: active,
    activeOffsetX: [-SWIPE.activateX * 2, SWIPE.activateX * 2],
    failOffsetY: [-SWIPE.failY, SWIPE.failY],
    testID: `${testID}.pan`,
    onActivate: () => {
      'worklet';
      if (isWeb) scheduleOnRN(claimClick);
    },
    onUpdate: (event) => {
      'worklet';
      if (follow) offset.set(segmentFollow(event.translationX, canNext, canPrevious));
    },
    onDeactivate: (event) => {
      'worklet';
      if (isWeb) scheduleOnRN(releaseClick);
      const direction = segmentSwipeDirection(event.translationX, event.velocityX, width);
      if (direction === 0 || !(direction === 1 ? canNext : canPrevious)) {
        offset.set(motion.springTo(0, 'calm'));
        return;
      }
      // On off-screen in the swipe's direction; under reduced motion the page never moved and the stack crossfades.
      if (follow) offset.set(motion.springTo(-direction * width, 'calm'));
      scheduleOnRN(turn, direction);
    },
  });

  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));

  // The same elements whether or not the swipe is on: crossing a breakpoint or becoming a segment root must not remount the page.
  return (
    <SegmentPanContext.Provider value={pan}>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <Animated.View ref={host} style={[styles.fill, moved]} onLayout={(event: LayoutChangeEvent) => setMeasured(event.nativeEvent.layout.width)} testID={testID}>
          {children}
        </Animated.View>
      </GestureDetector>
    </SegmentPanContext.Provider>
  );
}
