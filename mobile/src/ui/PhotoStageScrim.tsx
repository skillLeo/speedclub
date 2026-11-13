import { LinearGradient } from 'expo-linear-gradient';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';

import { createStyles, material, useTheme } from '@/theme';

const PERCENT = 100;

const useStyles = createStyles(() => ({
  bottom: { bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
  top: { left: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0 },
}));

function share(fraction: number): DimensionValue {
  return `${Math.round(fraction * PERCENT * PERCENT) / PERCENT}%`;
}

/**
 * 2.0 `scrim.photo` (09 §4.1, ADR-421 b): the photo fades into the dark stage (`scrim.photoEnd`, dark in every theme) over its
 * bottom part, from `material.scrim.photo.start` of its height to the edge. Text on it only below the gate's text-safe line
 * (`scrimSafe`), or on the stage below the photo (MediaCard lead). One of the two gradients the design allows.
 */
export function PhotoStageScrim({ style, testID }: { style?: StyleProp<ViewStyle>; testID?: string }) {
  const styles = useStyles();
  const theme = useTheme();
  const { start, end } = material.scrim.photo;
  return (
    <LinearGradient
      aria-hidden
      colors={[theme.color.scrim.photoStart, theme.color.scrim.photoEnd]}
      testID={testID}
      style={[styles.bottom, { height: share(end - start) }, style]}
    />
  );
}

/** 2.0 `scrim.top`: the photo's top darkens over `material.scrim.top.end` of its height, for controls over it (09 §4.4). */
export function PhotoTopScrim({ style, testID }: { style?: StyleProp<ViewStyle>; testID?: string }) {
  const styles = useStyles();
  const theme = useTheme();
  const { start, end } = material.scrim.top;
  return (
    <LinearGradient
      aria-hidden
      colors={[theme.color.scrim.topStart, theme.color.scrim.topEnd]}
      testID={testID}
      style={[styles.top, { height: share(end - start) }, style]}
    />
  );
}
