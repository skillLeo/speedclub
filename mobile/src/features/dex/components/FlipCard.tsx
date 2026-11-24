import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { createStyles } from '@/theme';
import { useMotionPreference } from '@/ui/motion';

import { SPOT_CARD_MAX_WIDTH } from './SpotCardFace';

/** Depth of the turn: four card widths away, a flat, calm flip rather than a fish-eye. */
const PERSPECTIVE = SPOT_CARD_MAX_WIDTH * 4;
const HALF_TURN = 180;
const HALF = 0.5;

const useStyles = createStyles(() => ({
  face: { backfaceVisibility: 'hidden' },
  back: { ...StyleSheet.absoluteFill, alignItems: 'center', backfaceVisibility: 'hidden', pointerEvents: 'none' },
}));

export type FlipCardProps = {
  /** False shows the back; the change to true turns the card once. */
  revealed: boolean;
  front: ReactNode;
  back: ReactNode;
  testID: string;
};

/**
 * DEX-03 card flip (10 §16.2, contract §8): the back turns to the front on `spring.slow`, transform only (rotateY with
 * perspective); each face is visible on its own half of the turn, so a platform without backface culling never shows a mirror.
 * Reduced motion: the faces crossfade on effect.default, nothing turns (ADR-405). Mounted already revealed, the front stands.
 */
export function FlipCard({ revealed, front, back, testID }: FlipCardProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const progress = useSharedValue(revealed ? 1 : 0);
  const wasRevealed = useRef(revealed);

  useEffect(() => {
    const opening = revealed && !wasRevealed.current;
    wasRevealed.current = revealed;
    if (!revealed) {
      progress.set(0);
      return;
    }
    progress.set(opening ? (motion.reduced ? motion.effectTo(1, 'default') : motion.springTo(1, 'slow')) : 1);
  }, [motion, progress, revealed]);

  const reduced = motion.reduced;
  const frontStyle = useAnimatedStyle(() => {
    const value = progress.get();
    if (reduced) return { opacity: value, transform: [] };
    return {
      opacity: value >= HALF ? 1 : 0,
      transform: [{ perspective: PERSPECTIVE }, { rotateY: `${(value - 1) * HALF_TURN}deg` }],
    };
  });
  const backStyle = useAnimatedStyle(() => {
    const value = progress.get();
    if (reduced) return { opacity: 1 - value, transform: [] };
    return {
      opacity: value < HALF ? 1 : 0,
      transform: [{ perspective: PERSPECTIVE }, { rotateY: `${value * HALF_TURN}deg` }],
    };
  });

  return (
    <View testID={testID}>
      <Animated.View style={[styles.face, frontStyle]} aria-hidden={!revealed} testID={`${testID}.front`}>
        {front}
      </Animated.View>
      <Animated.View style={[styles.back, backStyle]} aria-hidden={revealed} testID={`${testID}.back`}>
        {back}
      </Animated.View>
    </View>
  );
}
