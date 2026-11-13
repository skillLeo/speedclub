import { useEffect, useRef, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useMotionPreference } from './preference';

export type ContentRevealProps = {
  /** True while the data loads: the skeleton shows (the `Skeleton` primitive, same geometry as the content). */
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * SM15 skeleton → content (09 §4.7): when the data arrives the content replaces the skeleton of the same geometry and fades
 * in on effect.default, so the swap reads as a crossfade without stacking both. Content that was already there on mount (a
 * cache hit) shows at once, with no fade. The same under reduced motion (effects stay); `qaMotion=off` jumps.
 */
export function ContentReveal({ loading, skeleton, children, style, testID }: ContentRevealProps) {
  const motion = useMotionPreference();
  const loadedOnMount = useRef(!loading);
  const opacity = useSharedValue(loading ? 0 : 1);
  useEffect(() => {
    if (loading) {
      opacity.set(0);
      loadedOnMount.current = false;
      return;
    }
    if (loadedOnMount.current) return;
    opacity.set(motion.effectTo(1, 'default'));
  }, [loading, motion, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  if (loading) return <>{skeleton}</>;
  return (
    <Animated.View style={[style, animated]} testID={testID}>
      {children}
    </Animated.View>
  );
}
