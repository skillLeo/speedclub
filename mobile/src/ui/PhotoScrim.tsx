import { LinearGradient } from 'expo-linear-gradient';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';

import { createStyles, opacity, useTheme } from '@/theme';

export type PhotoScrimProps = {
  /** Share of the photo height, from the bottom. Defaults to the 45 % of §3; FS-1 uses 0.55. */
  coverage?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const PERCENT = 100;

const useStyles = createStyles(() => ({
  scrim: { bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
}));

/**
 * §3: 0 → overlay.photoScrimEnd across the bottom 45 %. ADR-129: the gradient reaches the alpha that 4.5:1 needs on a white
 * photo only in its bottom 26 %, so onPhoto text is safe on any photo only when its top lies there, or on a band of the end colour.
 */
export function PhotoScrim({ coverage = opacity.photoScrimCoverage, style, testID }: PhotoScrimProps) {
  const styles = useStyles();
  const theme = useTheme();
  const height: DimensionValue = `${Math.round(coverage * PERCENT)}%`;
  return (
    <LinearGradient
      aria-hidden
      colors={['transparent', theme.color.overlay.photoScrimEnd]}
      testID={testID}
      style={[styles.scrim, { height }, style]}
    />
  );
}
