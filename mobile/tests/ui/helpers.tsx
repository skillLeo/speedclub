import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/i18n';
import { ThemeProvider } from '@/theme';

/** Renders a primitive inside the providers the app root gives it. */
export function renderUi(element: ReactElement) {
  return render(
    <GestureHandlerRootView>
      <ThemeProvider>{element}</ThemeProvider>
    </GestureHandlerRootView>,
  );
}

export function flat(style: unknown): ViewStyle & { color?: string; fontSize?: number; lineHeight?: number } {
  return StyleSheet.flatten(style as ViewStyle) as ViewStyle;
}

/** The style of the Animated.View inside a PressableScale: the visual with the metrics. */
export function visualOf(testID: string) {
  const pressable = screen.getByTestId(testID);
  const children = pressable.children.filter((child) => typeof child !== 'string');
  const last = children[children.length - 1];
  return flat(last && typeof last !== 'string' ? last.props.style : undefined);
}
