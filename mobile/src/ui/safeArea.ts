import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';

type Edge = 'top' | 'bottom';
type Property = 'padding' | 'position';

const STYLE_KEY: Record<Property, Record<Edge, 'paddingTop' | 'paddingBottom' | 'top' | 'bottom'>> = {
  padding: { top: 'paddingTop', bottom: 'paddingBottom' },
  position: { top: 'top', bottom: 'bottom' },
};

/**
 * The device inset of an edge plus `extra`, as a style. Web reads CSS `env()`, because SDK 58 no longer
 * provides insets on web through the context (03_DESIGN_SYSTEM.md §5).
 */
export function useSafeEdge(edge: Edge, extra: number = 0, property: Property = 'padding'): ViewStyle {
  const insets = useSafeAreaInsets();
  const key = STYLE_KEY[property][edge];
  if (isWeb) {
    const value = `calc(env(safe-area-inset-${edge}, 0px) + ${extra}px)`;
    return { [key]: value } as unknown as ViewStyle;
  }
  return { [key]: insets[edge] + extra };
}

/** The numeric inset. Zero on web, where the CSS inset is part of the padding already. */
export function useSafeInset(edge: Edge): number {
  const insets = useSafeAreaInsets();
  return isWeb ? 0 : insets[edge];
}
