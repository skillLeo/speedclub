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
import { coveringRadius, motionDuration, useMotionPreference } from '@/ui/motion';
import { takeThemeReveal, type RevealOrigin } from './reveal';
import { applyThemeToDocument } from './webDocument';

const ThemeContext = createContext<AppTheme | null>(null);

export function useTheme(): AppTheme {
  const theme = use(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside ThemeProvider.');
  return theme;
}

type Disc = { key: number; origin: RevealOrigin; colour: string };

/**
 * Applies a resolved theme without a flash: an overlay in the previous canvas colour covers the tree,
 * the new theme renders underneath on the next frame, then the overlay fades out. The tree never remounts.
 * Whenever target and applied agree again, also when a change is undone before its frame, the overlay fades.
 *
 * SM14 (M4.10, theme/reveal.ts): a change SET-10 asked to reveal from a swatch grows a disc in the new canvas colour from there
 * (effect.slow) instead, switches beneath it and fades it (effect.fast); a change the web's View Transition already animates
 * applies at once. Reduced motion keeps the crossfade.
 */
function useThemeCrossfade(target: ThemeName) {
  const { enabled, reduced, effectTo } = useMotionPreference();
  const [applied, setApplied] = useState(target);
  const [disc, setDisc] = useState<Disc | null>(null);
  const cover = useSharedValue(0);
  const fill = useSharedValue<string>(themes[target].color.bg.canvas);
  const covering = useRef(false);
  const discs = useRef(0);

  useEffect(() => {
    if (target === applied) {
      if (covering.current) {
        covering.current = false;
        cover.set(effectTo(0, 'slow'));
      }
      return;
    }
    const reveal = takeThemeReveal();
    if (reveal?.mode === 'instant') {
      // The web's View Transition animates this change: apply it on the next frame, with no overlay.
      const frame = requestAnimationFrame(() => setApplied(target));
      return () => cancelAnimationFrame(frame);
    }
    if (reveal?.mode === 'disc' && enabled && !reduced) {
      const origin = reveal.origin;
      const frame = requestAnimationFrame(() => {
        discs.current += 1;
        setDisc({ key: discs.current, origin, colour: themes[target].color.bg.canvas });
      });
      const covered = setTimeout(() => setApplied(target), motionDuration('effect.slow'));
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(covered);
      };
    }
    if (enabled && !covering.current) {
      covering.current = true;
      fill.set(themes[applied].color.bg.canvas);
      cover.set(1);
    }
    const frame = requestAnimationFrame(() => setApplied(target));
    return () => cancelAnimationFrame(frame);
  }, [target, applied, enabled, reduced, effectTo, cover, fill]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: cover.get(), backgroundColor: fill.get() }));
  return { applied, overlayStyle, disc, endDisc: () => setDisc(null) };
}

/** The SM14 disc: grows from the swatch until it covers the window, then fades once the theme beneath has switched. */
function RevealDisc({ disc, width, height, onDone }: { disc: Disc; width: number; height: number; onDone: () => void }) {
  const { effectTo } = useMotionPreference();
  const grow = useSharedValue(0);
  const fade = useSharedValue(1);
  const radius = coveringRadius(disc.origin, width, height);
  useEffect(() => {
    grow.set(effectTo(1, 'slow'));
    const covered = setTimeout(() => fade.set(effectTo(0, 'fast')), motionDuration('effect.slow'));
    const done = setTimeout(onDone, motionDuration('effect.slow') + motionDuration('effect.fast'));
    return () => {
      clearTimeout(covered);
      clearTimeout(done);
    };
    // One run per disc: the callbacks of the first render are the ones that count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ scale: grow.get() }] }));
  return (
    <Animated.View
      aria-hidden
      style={[
        styles.disc,
        {
          backgroundColor: disc.colour,
          borderRadius: radius,
          height: radius * 2,
          left: disc.origin.x - radius,
          top: disc.origin.y - radius,
          width: radius * 2,
        },
        style,
      ]}
      testID="theme.reveal"
    />
  );
}

/** Mounts only after hydration, so the crossfade starts from the stored theme and never fades into it. */
function HydratedThemeProvider({ children }: { children: ReactNode }) {
  const preference = useThemePreference();
  const systemScheme = useColorScheme();
  const { fontScale: osFontScale, width, height } = useWindowDimensions();
  const { applied, overlayStyle, disc, endDisc } = useThemeCrossfade(resolveThemeName(preference, systemScheme));

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
        {disc ? <RevealDisc key={disc.key} disc={disc} width={width} height={height} onDone={endDisc} /> : null}
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
  disc: { pointerEvents: 'none', position: 'absolute', zIndex: zIndex.toast },
});
