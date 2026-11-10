import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { createContext, use, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';

import { useThemeHydrated, useThemePreference } from './preference';
import { getTheme, resolveThemeName, useAccentSet, type AppTheme } from './theme';
import { themes, zIndex, type ThemeName } from './tokens.generated';
import { useMotion } from './useMotion';
import { applyThemeToDocument } from './webDocument';

const ThemeContext = createContext<AppTheme | null>(null);

export function useTheme(): AppTheme {
  const theme = use(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside ThemeProvider.');
  return theme;
}

/**
 * Applies a resolved theme without a flash: an overlay in the previous canvas colour covers the tree,
 * the new theme renders underneath on the next frame, then the overlay fades out. The tree never remounts.
 * Whenever target and applied agree again, also when a change is undone before its frame, the overlay fades.
 */
function useThemeCrossfade(target: ThemeName) {
  const { enabled, timingTo } = useMotion();
  const [applied, setApplied] = useState(target);
  const cover = useSharedValue(0);
  const fill = useSharedValue<string>(themes[target].color.bg.canvas);
  const covering = useRef(false);

  useEffect(() => {
    if (target === applied) {
      if (covering.current) {
        covering.current = false;
        cover.set(timingTo(0, 'small'));
      }
      return;
    }
    if (enabled && !covering.current) {
      covering.current = true;
      fill.set(themes[applied].color.bg.canvas);
      cover.set(1);
    }
    const frame = requestAnimationFrame(() => setApplied(target));
    return () => cancelAnimationFrame(frame);
  }, [target, applied, enabled, timingTo, cover, fill]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: cover.get(), backgroundColor: fill.get() }));
  return { applied, overlayStyle };
}

/** Mounts only after hydration, so the crossfade starts from the stored theme and never fades into it. */
function HydratedThemeProvider({ children }: { children: ReactNode }) {
  const preference = useThemePreference();
  const systemScheme = useColorScheme();
  const { fontScale: osFontScale } = useWindowDimensions();
  const { applied, overlayStyle } = useThemeCrossfade(resolveThemeName(preference, systemScheme));

  const accent = useAccentSet();
  const theme = getTheme(applied, isWeb ? (qa.fontScale ?? 1) : osFontScale, accent);
  const canvas = theme.color.bg.canvas;
  // 'light' means light icons, as in expo-status-bar. The NavigationBarStyle doc comment says the opposite;
  // NavigationBarModule.kt decides: `hasLightBackground = style == "dark"`.
  const systemBarStyle = theme.colorScheme === 'dark' ? 'light' : 'dark';

  useLayoutEffect(() => applyThemeToDocument(theme), [theme]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(canvas).catch(() => undefined);
  }, [canvas]);

  useEffect(() => {
    if (Platform.OS === 'android') NavigationBar.setStyle(systemBarStyle);
  }, [systemBarStyle]);

  return (
    <ThemeContext value={theme}>
      <StatusBar style={systemBarStyle} />
      <View style={[styles.root, { backgroundColor: canvas }]}>
        {children}
        <Animated.View aria-hidden style={[styles.overlay, overlayStyle]} testID="theme.overlay" />
      </View>
    </ThemeContext>
  );
}

/**
 * A subtree in one fixed theme at the app's font scale. The brand layer of §2 (Welcome, the SYS gates) is dark in every
 * theme, so its tokens, the focus ring included, come from a dark theme even when the app is light (DQ-102).
 */
export function ThemeScope({ name, children }: { name: ThemeName; children: ReactNode }) {
  const parent = useTheme();
  const accent = useAccentSet();
  return <ThemeContext value={getTheme(name, parent.fontScale, accent)}>{children}</ThemeContext>;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const hydrated = useThemeHydrated();
  return hydrated ? <HydratedThemeProvider>{children}</HydratedThemeProvider> : null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, pointerEvents: 'none', zIndex: zIndex.toast },
});
