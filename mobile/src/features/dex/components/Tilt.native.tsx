import { useEffect, type ReactNode } from 'react';
import Animated, {
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { springTo } from '@/ui/motion';

import { SPOT_CARD_MAX_WIDTH } from './SpotCardFace';

/** At most this much lean either way (spike §5). */
const MAX_DEGREES = 6;
/** Earth's gravity in m/s²: a reading of this size is a full tilt. */
const GRAVITY = 9.81;

function lean(reading: number): number {
  'worklet';
  return Math.max(-MAX_DEGREES, Math.min(MAX_DEGREES, (reading / GRAVITY) * MAX_DEGREES));
}

/** The same depth as the flip (FlipCard), so the lean reads as a turn and not as a squash. */
const PERSPECTIVE = SPOT_CARD_MAX_WIDTH * 4;

type Turn = { turnX: SharedValue<number>; turnY: SharedValue<number> };

/**
 * The gravity reading behind the tilt: mounted only while the tilt is active, so the sensor is registered only then (spike §5:
 * unmounting unregisters it). The way the phone is held when it mounts is "straight": the card leans with changes from there.
 */
function GravityReader({ turnX, turnY }: Turn) {
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
      turnY.set(springTo(lean(reading.x - base.x), 'calm'));
      turnX.set(springTo(-lean(reading.y - base.y), 'calm'));
    },
  );
  return null;
}

/**
 * DEX-03's subtle tilt (spike §5, ADR-508): Reanimated's gravity sensor, read on the UI thread, leans the card by at most 6°,
 * smoothed by spring.calm. `active` (full motion and the screen focused) mounts the sensor; inactive, the card settles back flat.
 * The card keeps one parent either way (CR-P5G-20), so leaving and coming back never remounts it or replays its flip.
 * Where the sensor is missing (iOS without Location Services) the card stays still.
 */
export function Tilt({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const turnY = useSharedValue(0);
  const turnX = useSharedValue(0);
  useEffect(() => {
    if (active) return;
    turnY.set(springTo(0, 'calm'));
    turnX.set(springTo(0, 'calm'));
  }, [active, turnX, turnY]);
  const style = useAnimatedStyle(() => ({
    transform: [{ perspective: PERSPECTIVE }, { rotateY: `${turnY.get()}deg` }, { rotateX: `${turnX.get()}deg` }],
  }));
  return (
    <Animated.View style={style}>
      {active ? <GravityReader turnX={turnX} turnY={turnY} /> : null}
      {children}
    </Animated.View>
  );
}
