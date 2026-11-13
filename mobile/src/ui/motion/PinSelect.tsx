import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { useMotionPreference } from './preference';

/**
 * SM19 map pin select, the two parts that need no map (09 §4.7): the pin grows 1 → 1.2 on spring.fast when selected, and the
 * event card slides up on spring.default. The map pan (spring.calm) belongs to the map library, which is not installed yet;
 * it lands with the map in M4.12. Reduced motion: the pin takes its size at once, the card crossfades.
 */
export function MapPinScale({ selected, children, testID }: { selected: boolean; children: ReactNode; testID?: string }) {
  const motion = useMotionPreference();
  const scale = useSharedValue(1);
  useEffect(() => {
    const to = selected ? motionTokens.signature.mapPin.selectedScale : 1;
    // Reduced motion: the size is set without the spring (a preference flip must not leave a pin grown or small).
    scale.set(motion.reduced ? to : motion.springTo(to, 'fast'));
  }, [motion, scale, selected]);
  // The pin's tip stays on its coordinate: it grows from the bottom.
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }], transformOrigin: 'bottom' }));
  return (
    <Animated.View style={style} testID={testID}>
      {children}
    </Animated.View>
  );
}

export type SlideUpCardProps = {
  /** True shows the card; false sends it back down (effect.fast, an exit). */
  visible: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The event card under a selected pin: it slides up from its own height (spring.default), exits down on effect.fast. */
export function SlideUpCard({ visible, children, style, testID }: SlideUpCardProps) {
  const motion = useMotionPreference();
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    if (visible) progress.set(motion.springTo(1, 'default'));
    else progress.set(motion.effectTo(0, 'fast'));
  }, [motion, progress, visible]);
  const animated = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: motion.reduced ? p : Math.min(1, p * 2),
      transform: [{ translateY: motion.reduced ? 0 : (1 - p) * height }],
    };
  });
  const ref = useRef<ComponentRef<typeof View>>(null);
  // Hidden means out of reach: no taps, no screen reader, no keyboard focus (web `inert`; react-native-web has no prop for it).
  useEffect(() => {
    if (!isWeb) return;
    const node = ref.current as unknown as { toggleAttribute?: (name: string, force: boolean) => void } | null;
    node?.toggleAttribute?.('inert', !visible);
  }, [visible]);
  return (
    <Animated.View
      ref={ref}
      aria-hidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      pointerEvents={visible ? 'auto' : 'none'}
      style={[style, animated]}
      onLayout={(event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height)}
      testID={testID}
    >
      {children}
    </Animated.View>
  );
}
