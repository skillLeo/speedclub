import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { space } from '@/theme';
import { springTo } from '@/ui/motion';

/** At most this far either way: a hint of depth, not a movement (10 §2.3 "subtle parallax"). */
const MAX_SHIFT = space[8];
const GRAVITY = 9.81;

function shift(reading: number): number {
  'worklet';
  return Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, (reading / GRAVITY) * MAX_SHIFT * 2));
}

/** Mounted only while active, so the sensor is registered only then (as DEX-03's Tilt, ADR-508: no expo-sensors). */
function GravityReader({ x, y }: { x: SharedValue<number>; y: SharedValue<number> }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 'auto' });
  const rest = useSharedValue<{ x: number; y: number } | null>(null);
  useAnimatedReaction(
    () => gravity.sensor.get(),
    (reading) => {
      if (!gravity.isAvailable) return;
      const base = rest.get();
      if (base === null) {
        rest.set({ x: reading.x, y: reading.y });
        return;
      }
      x.set(springTo(shift(reading.x - base.x), 'calm'));
      y.set(springTo(-shift(reading.y - base.y), 'calm'));
    },
  );
  return null;
}

/**
 * "am Auto": the photo moves a few points against the device's tilt while the sticker keeps its place on the glass, so the sticker
 * reads as lying on the car (10 §2.3). Reanimated's gravity sensor on the UI thread; `active` is false under reduced motion and when
 * the screen is not focused, and the layer settles back.
 */
export function Parallax({ children, active, style }: { children: ReactNode; active: boolean; style?: StyleProp<ViewStyle> }) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  useEffect(() => {
    if (active) return;
    x.set(springTo(0, 'calm'));
    y.set(springTo(0, 'calm'));
  }, [active, x, y]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));
  return (
    <Animated.View style={[style, animated]}>
      {active ? <GravityReader x={x} y={y} /> : null}
      {children}
    </Animated.View>
  );
}
