import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import type { AppTheme } from './theme';
import { useTheme } from './ThemeProvider';

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Declares themed styles outside the component:
 *
 *   const useStyles = createStyles((t) => ({ card: { backgroundColor: t.color.bg.surface } }));
 *
 * The returned hook gives back the same object for the same theme name and font scale.
 */
export function createStyles<T extends NamedStyles<T>>(factory: (theme: AppTheme) => T): () => T {
  const cache = new Map<string, T>();
  return function useStyles(): T {
    const theme = useTheme();
    const key = `${theme.name}|${theme.fontScale}`;
    let styles = cache.get(key);
    if (!styles) {
      styles = StyleSheet.create(factory(theme)) as T;
      cache.set(key, styles);
    }
    return styles;
  };
}
