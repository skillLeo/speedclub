import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/** Web: no parallax (as DEX-03's Tilt: the Generic Sensor API is Chromium-only and would ask a permission for decoration). */
export function Parallax({ children, style }: { children: ReactNode; active: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={style}>{children}</View>;
}
