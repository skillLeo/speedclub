import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { space } from '@/theme';
import { useMotionPreference } from '@/ui/motion';

export type InlineRevealProps = {
  children: ReactNode;
  /** `nativeID` for the control's `aria-controls`. */
  nativeID?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * 10 §5 inline expand ("Alle Daten anzeigen", "+ 5 weitere"): what opens comes in place on spring.default, 8 down to its place and
 * from transparent (the BuildSheet row's own expand, M4.4). Transform and opacity only: the list measures the new height at once.
 * Reduced motion crossfades on effect.default without the move; `qaMotion=off` shows it at once. Mounted only while open.
 */
export function InlineReveal({ children, nativeID, style, testID }: InlineRevealProps) {
  const motion = useMotionPreference();
  const reveal = useSharedValue(motion.enabled ? 0 : 1);

  // Settling at 1 again on a later run is a no-op, so a new preference object never replays the reveal.
  useEffect(() => {
    reveal.set(motion.springTo(1, 'default'));
  }, [motion, reveal]);

  const animated = useAnimatedStyle(() => ({
    opacity: reveal.get(),
    transform: motion.reduced ? [] : [{ translateY: interpolate(reveal.get(), [0, 1], [-space[8], 0]) }],
  }));

  return (
    <Animated.View nativeID={nativeID} style={[style, animated]} testID={testID}>
      {children}
    </Animated.View>
  );
}
