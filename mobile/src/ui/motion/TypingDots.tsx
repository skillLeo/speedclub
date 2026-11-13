import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence } from 'react-native-reanimated';

import { createStyles, space } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { useMotionPreference } from './preference';

const REST = motionTokens.signature.typingDots.restOpacity;
const DOTS = [0, 1, 2] as const;

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[4], height: t.size.touchMin, paddingHorizontal: t.space[12] },
  dot: { backgroundColor: t.color.text.secondary, borderRadius: t.radius.full, height: space[8], width: space[8] },
}));

/**
 * SM12 typing indicator: three dots pulse in turn on the effect tokens (effect.slow up, effect.slow down, stagger.m apart).
 * Opacity only. Reduced motion: the dots stand at a steady middle tone. The caller names it ("Lukas schreibt …").
 */
export function TypingDots({ label, testID }: { label: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View role="status" aria-label={label} style={styles.row} testID={testID}>
      {DOTS.map((index) => (
        <Dot key={index} index={index} style={styles.dot} />
      ))}
    </View>
  );
}

function Dot({ index, style }: { index: number; style: object }) {
  const motion = useMotionPreference();
  const opacity = useSharedValue(motion.reduced ? (1 + REST) / 2 : REST);
  useEffect(() => {
    if (motion.reduced || !motion.enabled) {
      opacity.set((1 + REST) / 2);
      return undefined;
    }
    opacity.set(
      withDelay(index * motionTokens.stagger.m, withRepeat(withSequence(motion.effectTo(1, 'slow'), motion.effectTo(REST, 'slow')), -1, false)),
    );
    return () => cancelAnimation(opacity);
  }, [index, motion, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View aria-hidden style={[style, animated]} />;
}
