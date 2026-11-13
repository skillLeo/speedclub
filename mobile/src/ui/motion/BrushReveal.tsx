import { useEffect, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';

import { createStyles } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { useMotionPreference } from './preference';
import { motionDuration } from './springs';
import { Wipe } from './Wipe';

const SPLASH = motionTokens.signature.splash;

/** The longest the static logo holds while the session restores; then the first screen's skeleton (09 §4.7 SM1). */
export const SPLASH_MAX_HOLD_MS = SPLASH.maxHold;

const useStyles = createStyles((t) => ({
  root: { alignItems: 'center', gap: t.space[12] },
}));

export type BrushRevealProps = {
  /** The brush logo (the client's file, never redrawn). */
  logo: ReactNode;
  /** The katakana line under it. */
  katakana?: ReactNode;
  /** False holds everything hidden; true plays once. Replaying needs a new `key`. */
  play: boolean;
  /** After the reveal and the 150 ms hold: crossfade into the first screen. */
  onDone?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The time the full reveal takes before `onDone`, per motion preference. */
export function brushRevealDuration(reduced: boolean, enabled = true): number {
  if (!enabled) return 0;
  if (reduced) return motionDuration('effect.default') + SPLASH.hold;
  return Math.max(motionDuration('spring.slow'), SPLASH.katakanaDelay + motionDuration('effect.default')) + SPLASH.hold;
}

/**
 * SM1 splash brush reveal (cold start only): the brush logo is uncovered left → right on spring.slow, the katakana fades in
 * 120 ms later (effect.default), the whole holds 150 ms, then `onDone`. It never loops and never spins; if the session is
 * still restoring, the caller keeps the static logo up to `SPLASH_MAX_HOLD_MS`. The mask is a transform wipe (the Skia/SVG
 * mask of the spec is replaced: no Skia installed; the result is the same straight-edged left → right reveal on every
 * platform). Reduced motion: logo and katakana crossfade in together.
 */
export function BrushReveal({ logo, katakana, play, onDone, style, testID }: BrushRevealProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const wipe = useSharedValue(motion.reduced ? 1 : 0);
  const fade = useSharedValue(motion.reduced ? 0 : 1);
  const kana = useSharedValue(0);

  useEffect(() => {
    if (!play) return undefined;
    if (!motion.enabled) {
      wipe.set(1);
      fade.set(1);
      kana.set(1);
    } else if (motion.reduced) {
      // Every branch sets the end state of every value (a preference flip between mount and play must not hide the logo).
      wipe.set(1);
      fade.set(motion.effectTo(1, 'default'));
      kana.set(motion.effectTo(1, 'default'));
    } else {
      fade.set(1);
      wipe.set(motion.springTo(1, 'slow'));
      kana.set(withDelay(SPLASH.katakanaDelay, motion.effectTo(1, 'default')));
    }
    const timer = setTimeout(() => onDone?.(), brushRevealDuration(motion.reduced, motion.enabled));
    return () => clearTimeout(timer);
    // One run per `play`: a new onDone identity must not restart the reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const kanaStyle = useAnimatedStyle(() => ({ opacity: kana.get() }));
  return (
    <Animated.View style={[styles.root, style, fadeStyle]} testID={testID}>
      <Wipe progress={wipe}>{logo}</Wipe>
      {katakana ? <Animated.View style={kanaStyle}>{katakana}</Animated.View> : null}
    </Animated.View>
  );
}

