import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { createStyles, size, space, useMotion } from '@/theme';

import { PressableScale } from './PressableScale';

export type SwitchProps = {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Accessible name; the row usually shows the same text. */
  label: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const INSET = space[2];
const THUMB = size.switch.height - INSET * 2;
const TRAVEL = size.switch.width - size.switch.height;

const useStyles = createStyles((t) => ({
  target: { height: t.size.switch.height, width: t.size.switch.width },
  // The radius also shapes the focus ring.
  track: { borderRadius: t.radius.full, height: t.size.switch.height, width: t.size.switch.width },
  // On a layer of its own: a border on the track would move the absolutely placed thumb by its width.
  trackOff: {
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.control,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.control,
  },
  trackOffDisabled: { borderColor: t.color.border.default },
  trackOn: { backgroundColor: t.color.text.primary, borderRadius: t.radius.full },
  trackOnDisabled: { backgroundColor: t.color.text.disabled, borderRadius: t.radius.full },
  thumb: {
    backgroundColor: t.color.text.secondary,
    borderRadius: t.radius.full,
    height: THUMB,
    left: INSET,
    position: 'absolute',
    top: INSET,
    width: THUMB,
  },
  thumbDisabled: { backgroundColor: t.color.text.disabled },
  thumbOn: { backgroundColor: t.color.bg.canvas, borderRadius: t.radius.full },
}));

/**
 * §8 switch: 51 × 31 everywhere, on = text.primary track + canvas thumb. Colour changes are crossfaded layers,
 * because only transform and opacity animate. The thumb position clamps, so the spring never overshoots.
 */
export function Switch({ value, onValueChange, label, disabled = false, style, testID }: SwitchProps) {
  const styles = useStyles();
  const motion = useMotion();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.set(motion.springTo(value ? 1 : 0));
  }, [motion, progress, value]);

  const onLayer = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.get(), [0, 1], [0, TRAVEL], Extrapolation.CLAMP) }],
  }));

  return (
    <PressableScale
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      feedback={false}
      visualHeight={size.switch.height}
      onPress={() => {
        haptics.selection();
        onValueChange(!value);
      }}
      testID={testID}
      style={[styles.target, style]}
      contentStyle={styles.track}
    >
      <View style={[StyleSheet.absoluteFill, styles.trackOff, disabled ? styles.trackOffDisabled : null]} />
      <Animated.View
        style={[StyleSheet.absoluteFill, disabled ? styles.trackOnDisabled : styles.trackOn, onLayer]}
      />
      <Animated.View style={[styles.thumb, disabled ? styles.thumbDisabled : null, thumb]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.thumbOn, onLayer]} testID={testID ? `${testID}.thumbOn` : undefined} />
      </Animated.View>
    </PressableScale>
  );
}
