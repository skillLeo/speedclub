import { Easing, ReduceMotion, withRepeat, withSpring, withTiming } from 'react-native-reanimated';

import { motion, type EffectToken, type SpringToken } from '@/theme/tokens.generated';

/**
 * How motion plays (09 §4.7): `full` springs as specified, `reduced` turns every spatial spring into the critically damped
 * effect.default crossfade, `off` (`qaMotion=off`) jumps to the end value at once.
 */
export type MotionPreference = 'full' | 'reduced' | 'off';

export type { EffectToken, SpringToken };

/** Every motion token as its CSS twin names it: `spring.fast`, `effect.default`. */
export type MotionCssToken = keyof typeof motion.css;

/**
 * A spatial spring from the tokens (translate, scale, size). Every config carries mass 1: the installed Reanimated defaults to
 * mass 4 (springConfigs.ts), which halves the damping ratio and doubles every duration.
 *
 * A worklet, so a gesture or an animated-style callback calls it as well as the JS thread. The preference comes from
 * `useMotionPreference()`; this helper does not read the device itself, because a worklet cannot subscribe.
 */
export function springTo(
  value: number,
  token: SpringToken,
  preference: MotionPreference = 'full',
  onDone?: (finished?: boolean) => void,
): number {
  'worklet';
  const config = preference === 'full' ? motion.spring[token] : motion.effect.default;
  return withSpring(value, { ...config, reduceMotion: preference === 'off' ? ReduceMotion.Always : ReduceMotion.Never }, onDone);
}

/** Opacity and colour: critically damped, the same with and without reduced motion; `off` jumps. */
export function effectTo(value: number, token: EffectToken, preference: MotionPreference = 'full'): number {
  'worklet';
  return withSpring(value, {
    ...motion.effect[token],
    reduceMotion: preference === 'off' ? ReduceMotion.Always : ReduceMotion.Never,
  });
}

/**
 * The settle time of a token in milliseconds (its CSS fallback duration): for a timer that waits for a motion, an expo-image
 * `transition` or a CSS transition. Never a reason to animate with timing curves on native.
 */
export function motionDuration(token: MotionCssToken): number {
  return motion.css[token].duration;
}

/** A CSS `transition-timing-function` for web-only style transitions. */
export function cssEasing(token: MotionCssToken): string {
  return `cubic-bezier(${motion.css[token].easing.join(',')})`;
}

/** `opacity 200ms cubic-bezier(…)` for one property, from a token. */
export function cssTransition(property: string, token: MotionCssToken): string {
  return `${property} ${motionDuration(token)}ms ${cssEasing(token)}`;
}

/** The effect.default curve as a Reanimated easing, for the two loops below; nothing else animates on a timing curve. */
const LOOP_EASING = Easing.bezier(...motion.css['effect.default'].easing);

/**
 * SM15: the skeleton shimmer, 0 → 1 → 0 forever over one `skeleton.shimmerCycle` (1.2 s). A loop has no rest point, so it is
 * the one timing animation besides the spinner. Start it only after `skeleton.shimmerAfter` and never under reduced motion.
 */
export function shimmerLoop(): number {
  return withRepeat(
    withTiming(1, { duration: motion.skeleton.shimmerCycle / 2, easing: LOOP_EASING, reduceMotion: ReduceMotion.Never }),
    -1,
    true,
  );
}

/** A spinner's turn to `degrees` at constant speed, one turn per shimmer cycle, forever. Still under reduced motion. */
export function spinLoop(degrees: number): number {
  return withRepeat(
    withTiming(degrees, { duration: motion.skeleton.shimmerCycle, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
    -1,
    false,
  );
}

/**
 * DQ-990 (09 §7.2 AUTH-02, `motion.signature.kenBurns`): the progress 0 → 1 → 0 of the slow photo drift, one way per token duration
 * (12 s), forever. Scale the photo `from + (to - from) * progress`. A loop like the shimmer: start it only with full motion, cancel
 * it in the background and on the first press.
 */
export function kenBurnsLoop(): number {
  'worklet';
  return withRepeat(
    withTiming(1, { duration: motion.signature.kenBurns.duration, easing: LOOP_EASING, reduceMotion: ReduceMotion.Never }),
    -1,
    true,
  );
}
