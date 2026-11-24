import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { createStyles, themes } from '@/theme';
import { useMotionPreference } from '@/ui/motion';

/**
 * The foil's light: the dark themes' selected tint, because the card is the dark stage in every theme (ADR-421 b). A flat band,
 * no gradient (09 §4: the photo scrim is the only gradient).
 */
const FOIL = themes.carbon.color.state.selected;
/** The band leans like light across a card held in the hand. */
const LEAN = '-20deg';
const BAND_SHARE = 0.35;
/** The band starts beyond the left edge and ends beyond the right one. */
const FROM_SHARE = -0.9;
const TO_SHARE = 1.4;

const useStyles = createStyles(() => ({
  clip: { bottom: 0, left: 0, overflow: 'hidden', pointerEvents: 'none', position: 'absolute', right: 0, top: 0 },
  band: { backgroundColor: FOIL, height: '200%', position: 'absolute', top: '-50%' },
}));

export type FoilShineProps = {
  /** The change to true plays the sweep once. */
  play: boolean;
  width: number;
  testID: string;
};

/**
 * First Spotter foil (contract §8): one sweep of light across the card on spring.slow as it lands. Transform and opacity only.
 * Reduced motion: no sweep at all, the card's "First Spotter" tag carries the meaning (ADR-405: no decorative motion).
 */
export function FoilShine({ play, width, testID }: FoilShineProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const x = useSharedValue(FROM_SHARE * width);
  const glow = useSharedValue(0);
  const played = useRef(false);

  useEffect(() => {
    if (!play || played.current || motion.reduced || width <= 0) return;
    played.current = true;
    x.set(FROM_SHARE * width);
    glow.set(motion.effectTo(1, 'default'));
    x.set(motion.springTo(TO_SHARE * width, 'slow', () => {
      'worklet';
      glow.set(motion.effectTo(0, 'slow'));
    }));
  }, [glow, motion, play, width, x]);

  const bandStyle = useAnimatedStyle(() => ({ opacity: glow.get(), transform: [{ translateX: x.get() }, { rotate: LEAN }] }));
  if (motion.reduced) return null;
  return (
    <View style={styles.clip} aria-hidden testID={testID}>
      <Animated.View style={[styles.band, { width: width * BAND_SHARE }, bandStyle]} />
    </View>
  );
}
