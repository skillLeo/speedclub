import { useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isAndroid } from '@/lib/platform';
import { createStyles, size, space } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { Icon } from '../icons/Icon';
import { hapticFor } from './haptics';
import { crossed, replyOffset } from './math';
import { useMotionPreference } from './preference';

const SWIPE = motionTokens.signature.swipeActions;

/** The finger travels this far to the right before the reply commits: the glyph's 44 target plus 16 of air. */
export const REPLY_THRESHOLD = size.touchMin + space[16];

const useStyles = createStyles((t) => ({
  // The row's full width, so a child's percentage width (a bubble's 75 %) still refers to the column.
  root: { alignSelf: 'stretch', justifyContent: 'center' },
  start: { alignItems: 'flex-start' },
  end: { alignItems: 'flex-end' },
  glyph: {
    alignItems: 'center',
    height: t.size.touchMin,
    justifyContent: 'center',
    left: t.space[0],
    position: 'absolute',
    width: t.size.touchMin,
  },
  // Android's rotated cells: the glyph sits at the other edge, so it still shows where the bubble came from.
  glyphMirrored: { left: undefined, right: t.space[0] },
}));

export type SwipeReplyProps = {
  /** Off: the children render as they are, with no gesture (web, flag off, a message that cannot be answered). */
  enabled: boolean;
  onReply: () => void;
  /**
   * Inside an inverted FlashList, whose Android cells are rotated 180°: the content's translateX is mirrored back so it follows the
   * finger (iOS and web mirror only the y axis).
   */
  invertedList?: boolean;
  /** Which side the content sits on: an own message at the end, the other member's at the start. */
  align?: 'start' | 'end';
  children: ReactNode;
  testID: string;
};

/**
 * SM11 swipe-to-reply (09 §7.8, MSG-02): a rightward drag on a message pulls it along up to `REPLY_THRESHOLD`, then rubber-bands;
 * the reply glyph fades in behind it, one light haptic marks the threshold (09 §4.8), and a release past it answers the message.
 * The bubble springs back on spring.calm (reduced motion: the effect crossfade of springTo). Vertical first lets the list
 * scroll; screen readers and keyboards answer from the message actions ("Antworten"), so the gesture is never the only way.
 */
export function SwipeReply({ enabled, onReply, invertedList = false, align = 'start', children, testID }: SwipeReplyProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const [width, setWidth] = useState(0);
  const offset = useSharedValue(0);
  const mirror = invertedList && isAndroid ? -1 : 1;

  const pan = usePanGesture({
    enabled,
    activeOffsetX: [-SWIPE.activateX, SWIPE.activateX],
    failOffsetY: [-SWIPE.failY, SWIPE.failY],
    testID: `${testID}.pan`,
    onUpdate: (event) => {
      'worklet';
      const previous = offset.get();
      const next = replyOffset(event.translationX * mirror, REPLY_THRESHOLD, width, SWIPE.rubberBand);
      offset.set(next);
      if (crossed(previous, next, REPLY_THRESHOLD)) scheduleOnRN(hapticFor, 'swipeActionThreshold');
    },
    onDeactivate: () => {
      'worklet';
      const commit = offset.get() >= REPLY_THRESHOLD;
      offset.set(motion.springTo(0, 'calm'));
      if (commit) scheduleOnRN(onReply);
    },
  });

  const front = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() * mirror }] }));
  const glyph = useAnimatedStyle(() => ({ opacity: Math.min(1, offset.get() / REPLY_THRESHOLD) }));

  if (!enabled) return <>{children}</>;
  return (
    <View style={styles.root} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} testID={testID}>
      <Animated.View style={[styles.glyph, mirror === -1 ? styles.glyphMirrored : null, glyph]} aria-hidden>
        <Icon name="arrow-bend-up-left" size={20} color="text.secondary" />
      </Animated.View>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <Animated.View style={[align === 'end' ? styles.end : styles.start, front]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
