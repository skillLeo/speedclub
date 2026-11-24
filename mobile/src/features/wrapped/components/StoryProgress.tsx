import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { createStyles } from '@/theme';
import { useMotionPreference } from '@/ui/motion';

import { STORY_CARD_MS } from '../model';

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row', gap: t.size.progress.segmentGap, minHeight: t.size.touchMin, alignItems: 'center' },
  segment: { backgroundColor: t.color.onPhoto.border, borderRadius: t.radius.full, flex: 1, height: t.size.progress.height, overflow: 'hidden' },
  fill: { backgroundColor: t.color.onPhoto.primary, height: '100%', transformOrigin: 'left', width: '100%' },
}));

export type StoryProgressProps = {
  total: number;
  index: number;
  /** The clock runs: the current segment fills. */
  running: boolean;
  testID: string;
};

/**
 * The segmented bars on top of the story (contract §6): one per card, the ones before full, the current one filling with the card's
 * time (a `scaleX` transform on the UI thread, transform only), the ones after empty. The fill is the clock made visible, so it runs
 * under reduced motion too (as a video's progress bar), and stands still while the story is paused. Screen readers hear "Karte 3
 * von 9" once per card.
 */
export function StoryProgress({ total, index, running, testID }: StoryProgressProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const motion = useMotionPreference();
  const elapsed = useSharedValue(0);
  const last = index >= total - 1;

  useEffect(() => {
    elapsed.set(0);
  }, [elapsed, index]);

  const frame = useFrameCallback((info) => {
    'worklet';
    elapsed.set(Math.min(STORY_CARD_MS, elapsed.get() + (info.timeSincePreviousFrame ?? 0)));
  }, false);
  const ticking = running && motion.enabled;
  useEffect(() => {
    frame.setActive(ticking);
  }, [frame, ticking]);

  const current = useAnimatedStyle(() => ({ transform: [{ scaleX: last ? 1 : elapsed.get() / STORY_CARD_MS }] }));

  return (
    <View
      style={styles.row}
      accessible
      role="progressbar"
      aria-label={t('wrapped.player.position', { n: index + 1, total })}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={index + 1}
      aria-live="polite"
      testID={testID}
    >
      {Array.from({ length: total }, (_, position) => (
        <View key={position} style={styles.segment} testID={`${testID}.${position + 1}`}>
          {position < index ? <View style={styles.fill} /> : position === index ? <Animated.View style={[styles.fill, current]} /> : null}
        </View>
      ))}
    </View>
  );
}
