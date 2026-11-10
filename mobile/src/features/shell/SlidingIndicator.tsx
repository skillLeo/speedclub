import { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useMotion } from '@/theme';

type Props = {
  axis: 'x' | 'y';
  /** Position along the axis. */
  offset: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** §10: the indicator slides in 140 ms; under reduced motion it moves at once and crossfades in. Transform only. */
export function SlidingIndicator({ axis, offset, style, testID }: Props) {
  const motion = useMotion();
  const position = useSharedValue(offset);
  const opacity = useSharedValue(1);
  const previous = useRef(offset);

  useEffect(() => {
    if (previous.current === offset) return;
    previous.current = offset;
    if (motion.reduced) {
      position.set(offset);
      opacity.set(0);
      opacity.set(motion.timingTo(1, 'reducedCrossfade'));
    } else {
      position.set(motion.timingTo(offset, 'micro'));
    }
  }, [motion, offset, opacity, position]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: axis === 'x' ? [{ translateX: position.get() }] : [{ translateY: position.get() }],
  }));

  return <Animated.View aria-hidden testID={testID} style={[style, animated]} />;
}
