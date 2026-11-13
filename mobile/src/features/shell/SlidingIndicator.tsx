import { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useMotionPreference } from '@/ui/motion';

type Props = {
  axis: 'x' | 'y';
  /** Position along the axis. */
  offset: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The indicator slides on spring.fast (09 §4.7); under reduced motion it moves at once and crossfades in (effect.default). */
export function SlidingIndicator({ axis, offset, style, testID }: Props) {
  const motion = useMotionPreference();
  const position = useSharedValue(offset);
  const opacity = useSharedValue(1);
  const previous = useRef(offset);

  useEffect(() => {
    if (previous.current === offset) return;
    previous.current = offset;
    if (motion.reduced) {
      position.set(offset);
      opacity.set(0);
      opacity.set(motion.effectTo(1, 'default'));
    } else {
      position.set(motion.springTo(offset, 'fast'));
    }
  }, [motion, offset, opacity, position]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: axis === 'x' ? [{ translateX: position.get() }] : [{ translateY: position.get() }],
  }));

  return <Animated.View aria-hidden testID={testID} style={[style, animated]} />;
}
