/**
 * The motion foundation (09 §4.7, ADR-405). Every animation in the app goes through these helpers: spatial springs with
 * `springTo`, opacity and colour with `effectTo`, the device preference with `useMotionPreference`, the haptics of 09 §4.8
 * with `hapticFor`. The signature motions (SM1–SM20) are components in `@/ui/motion/kit` (kept out of this module because
 * the theme imports it, and the components import the theme).
 */
export {
  __resetSubscriptionForTests,
  __setAccessibilityForTests,
  getReduceMotionChoice,
  hydrateReduceMotionChoice,
  motionPreferenceFor,
  setReduceMotionChoice,
  useReduceMotionChoice,
  setReducedMotionPreview,
  useMotionPreference,
  useReduceTransparency,
} from './preference';
export type { Motion, ReduceMotionChoice } from './preference';
export { cssEasing, cssTransition, effectTo, kenBurnsLoop, motionDuration, shimmerLoop, spinLoop, springTo } from './springs';
export type { EffectToken, MotionCssToken, MotionPreference, SpringToken } from './springs';
export { hapticFor, haptics, useHapticsSetting } from './haptics';
export type { HapticIntent, HapticKind } from './haptics';
export * from './math';
