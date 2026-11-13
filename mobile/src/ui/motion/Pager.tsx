import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, type SharedValue } from 'react-native-reanimated';

import { createStyles, space } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { indicatorEdges, pagerParallax } from './math';
import { useMotionPreference } from './preference';

/**
 * SM2 onboarding pager (09 §4.7): the page photo trails its page at 0.3× (`onboardingParallax`), the text of a page arrives
 * with stagger.s, and the page indicator's pill stretches from dot to dot. Reduced motion: no parallax, no stagger (the text
 * crossfades), the pill jumps between whole pages.
 */
export function usePagerParallax(scrollX: SharedValue<number>, index: number, pageWidth: number) {
  const motion = useMotionPreference();
  return useAnimatedStyle(() => ({
    transform: [{ translateX: pagerParallax(scrollX.get(), index, pageWidth, motionTokens.signature.onboardingParallax, motion.reduced) }],
  }));
}

/**
 * The text of a page arriving: `order` 0, 1, 2… waits `stagger.s` each, then fades in and rises a few points on
 * spring.default. Only for a small group at a brand moment (onboarding, splash), never for list items (09 §4.7).
 */
export function StaggerIn({ order, active, children }: { order: number; active: boolean; children: ReactNode }) {
  const motion = useMotionPreference();
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (!active) {
      progress.set(0);
      return;
    }
    progress.set(motion.reduced ? motion.effectTo(1, 'default') : withDelay(order * motionTokens.stagger.s, motion.springTo(1, 'default')));
  }, [active, motion, order, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.get()),
    transform: [{ translateY: motion.reduced ? 0 : (1 - progress.get()) * space[8] }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

const DOT = space[8];
// Wide enough that the pill (24) over a dot never touches its neighbours.
const GAP = space[16];
const ACTIVE = space[24];

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: GAP, height: t.size.touchMin, justifyContent: 'center' },
  dot: { backgroundColor: t.color.text.disabled, borderRadius: t.radius.full, height: DOT, width: DOT },
  overlay: { pointerEvents: 'none' },
  track: { height: DOT, position: 'relative' },
  cap: { backgroundColor: t.color.text.primary, borderRadius: t.radius.full, height: DOT, left: 0, position: 'absolute', top: 0, width: DOT },
  middle: { backgroundColor: t.color.text.primary, height: DOT, left: 0, position: 'absolute', top: 0, transformOrigin: 'left', width: t.size.border.control },
}));

export type PageIndicatorProps = {
  /** The page as a fraction (scroll offset / page width), live from the pager's scroll handler. */
  progress: SharedValue<number>;
  count: number;
  /** "Seite 2 von 4" from the caller's namespace. */
  label: string;
  testID?: string;
};

/**
 * The SM2 page indicator: dots and one pill. The pill is two round caps and a middle bar that scales in X, so its "width
 * morph" is made of transforms (09 §4.7). It follows the pager's scroll directly; a jump between pages (a tap on "Weiter")
 * runs through the scroll and so through the same path. Reduced motion: the pill sits on the nearest whole page.
 */
export function PageIndicator({ progress, count, label, testID }: PageIndicatorProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const edges = (p: number) => {
    'worklet';
    const page = motion.reduced ? Math.round(p) : p;
    return indicatorEdges(Math.min(Math.max(page, 0), count - 1), DOT, GAP, ACTIVE);
  };
  const leftCap = useAnimatedStyle(() => ({ transform: [{ translateX: edges(progress.get()).left }] }));
  const rightCap = useAnimatedStyle(() => ({ transform: [{ translateX: edges(progress.get()).right - DOT }] }));
  const middle = useAnimatedStyle(() => {
    const { left, right } = edges(progress.get());
    return { transform: [{ translateX: left + DOT / 2 }, { scaleX: Math.max(0, right - left - DOT) }] };
  });
  return (
    <View role="img" aria-label={label} style={styles.row} testID={testID}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.dot} />
      ))}
      <View style={[StyleSheet.absoluteFill, styles.row, styles.overlay]}>
        <View style={[styles.track, { width: count * DOT + (count - 1) * GAP }]}>
          <Animated.View style={[styles.middle, middle]} />
          <Animated.View style={[styles.cap, leftCap]} />
          <Animated.View style={[styles.cap, rightCap]} />
        </View>
      </View>
    </View>
  );
}
