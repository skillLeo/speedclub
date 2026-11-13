import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

const styles = StyleSheet.create({ scrim: { left: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0 } });

/**
 * `scrim.top` (09 §4.4): the photo's top darkens so a header and its controls read over it. The stretchy hero (SM5) fades it
 * in as the photo passes under the header. One of the two gradients the design allows (the photo scrims).
 */
export function TopScrim({ height, style }: { height: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <LinearGradient
      aria-hidden
      colors={[theme.color.scrim.topStart, theme.color.scrim.topEnd]}
      style={[styles.scrim, { height }, style]}
    />
  );
}
