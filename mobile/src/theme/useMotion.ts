import { Easing, ReduceMotion, useReducedMotion, withSpring, withTiming } from 'react-native-reanimated';

import { qa } from '@/lib/qa';

import { motion } from './tokens.generated';

type Durations = Record<keyof typeof motion.duration, number>;
type EasingName = keyof typeof motion.easing;
type SpringName = keyof typeof motion.spring;

function bezier(name: EasingName) {
  const [x1, y1, x2, y2] = motion.easing[name];
  return Easing.bezier(x1, y1, x2, y2);
}

const easing = {
  standard: bezier('standard'),
  decelerate: bezier('decelerate'),
  accelerate: bezier('accelerate'),
};

const spring = motion.spring;

function mapDurations(transform: (value: number) => number): Durations {
  return Object.fromEntries(
    Object.entries(motion.duration).map(([key, value]) => [key, transform(value)]),
  ) as Durations;
}

/**
 * Lives outside the hook, so each mode is built once and `timingTo`/`springTo` keep their identity.
 * Both are worklets: they run from the JS thread and from a gesture or animated-style callback alike.
 */
function buildMotion(duration: Durations, reduced: boolean, enabled: boolean) {
  const crossfade = duration.reducedCrossfade;
  return {
    /** False when transitions should be skipped altogether. */
    enabled,
    reduced,
    duration,
    easing,
    spring,
    /** Animates to a value with a token duration and easing. */
    timingTo: (toValue: number, durationName: keyof Durations = 'small', easingName: EasingName = 'standard') => {
      'worklet';
      // Never: this hook already applies reduced motion; System would skip the crossfade altogether.
      return withTiming(toValue, {
        duration: duration[durationName],
        easing: easing[easingName],
        reduceMotion: ReduceMotion.Never,
      });
    },
    /** Animates to a value with a token spring, or the crossfade duration under reduced motion. */
    springTo: (toValue: number, springName: SpringName = 'snappy') => {
      'worklet';
      return reduced
        ? withTiming(toValue, { duration: crossfade, easing: easing.standard, reduceMotion: ReduceMotion.Never })
        : withSpring(toValue, spring[springName]);
    },
  };
}

const FULL = buildMotion(motion.duration, false, true);
const REDUCED = buildMotion(
  mapDurations((value) => Math.min(value, motion.duration.reducedCrossfade)),
  true,
  true,
);
const OFF = buildMotion(
  mapDurations(() => 0),
  true,
  false,
);

/**
 * Motion tokens for the current device. Reduced motion caps every duration at the 120 ms crossfade
 * and replaces springs with timing; `qaMotion=off` makes everything instant.
 */
export function useMotion() {
  const reducedSystem = useReducedMotion();
  if (qa.motion === 'off') return OFF;
  return reducedSystem ? REDUCED : FULL;
}
