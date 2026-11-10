import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { isWeb } from '@/lib/platform';
import { markFirstScreenMounted } from '@/lib/ready';
import { createStyles } from '@/theme';

export type ScreenProps = {
  children?: ReactNode;
  /** Safe-area edges this screen pads. The default leaves `bottom` to the tab bar or a sticky CTA. */
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const DEFAULT_EDGES: readonly Edge[] = ['top', 'left', 'right'];

const useStyles = createStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.color.bg.canvas },
}));

/** Web insets come from CSS, because SDK 58 no longer provides them through the context. */
const webInsets = StyleSheet.create({
  top: { paddingTop: 'env(safe-area-inset-top, 0px)' },
  bottom: { paddingBottom: 'env(safe-area-inset-bottom, 0px)' },
  left: { paddingLeft: 'env(safe-area-inset-left, 0px)' },
  right: { paddingRight: 'env(safe-area-inset-right, 0px)' },
} as unknown as Record<Edge, ViewStyle>);

const NATIVE_PADDING = {
  top: 'paddingTop',
  bottom: 'paddingBottom',
  left: 'paddingLeft',
  right: 'paddingRight',
} as const;

export function Screen({ children, edges = DEFAULT_EDGES, style, testID }: ScreenProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const padding = isWeb
    ? edges.map((edge) => webInsets[edge])
    : edges.map((edge) => ({ [NATIVE_PADDING[edge]]: insets[edge] }));

  useEffect(markFirstScreenMounted, []);

  return (
    <View style={[styles.screen, padding, style]} testID={testID}>
      {children}
    </View>
  );
}
