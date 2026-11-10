import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { persistOptions, queryClient } from '@/api/queryClient';
import { SessionHost } from '@/features/auth/SessionHost';
import { BrandThemeSync } from '@/features/auth/useBrandTheme';
import '@/features/auth/sessionLifecycle';
import { AuthRequiredSheet } from '@/features/shell/AuthRequiredSheet';
import { RouteErrorBoundary, RouteErrorFallback } from '@/features/shell/RouteErrorBoundary';
import { ShellToastHost } from '@/features/shell/ShellToastHost';
import { useCanvasStackOptions } from '@/features/shell/useCanvasStackOptions';
import { AppConfigGate } from '@/features/system/AppConfigGate';
import i18n from '@/i18n';
import { qa } from '@/lib/qa';
import { registerFirstScreenGate, registerReadyGate, useAppReady, useFirstScreenMounted } from '@/lib/ready';
import { ViewAsFrame } from '@/features/viewAs/ViewAsFrame';
import { restoreSession } from '@/state/session';
import { hydrateThemePreference, motion, ThemeProvider, useTheme } from '@/theme';
import { useAppFonts } from '@/theme/fonts';
import { applyLocaleToDocument, markDocumentReady, reportQaSession } from '@/theme/webDocument';

SplashScreen.setOptions({ duration: motion.duration.small, fade: true });
SplashScreen.preventAutoHideAsync().catch(() => undefined);

const releaseFonts = registerReadyGate('fonts');
const releaseTheme = registerReadyGate('theme');
const releaseSession = registerReadyGate('session');
registerFirstScreenGate();
hydrateThemePreference().finally(releaseTheme);
// features/auth/sessionLifecycle.ts registered the restore while the imports above ran.
void restoreSession().finally(releaseSession);

i18n.on('languageChanged', applyLocaleToDocument);
if (qa.locale && qa.locale !== i18n.language) void i18n.changeLanguage(qa.locale);
applyLocaleToDocument(i18n.language);
reportQaSession();

/** BH-00: a boundary around each screen, below every Stack. One around a Stack unmounts it, which clears its navigation state. */
export const unstable_settings = { screenErrorBoundary: RouteErrorFallback };

const MODAL_OPTIONS = { presentation: 'modal' } as const;

/** Navigation containers paint the theme canvas, so a screen change can never show their default grey. */
function RootStack() {
  const theme = useTheme();
  const navigationTheme = useMemo(() => {
    const base = theme.colorScheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: theme.color.bg.canvas } };
  }, [theme]);
  const screenOptions = useCanvasStackOptions();
  return (
    <NavigationThemeProvider value={navigationTheme}>
      <RouteErrorBoundary>
        <Stack screenOptions={screenOptions}>
          <Stack.Screen name="(modals)" options={MODAL_OPTIONS} />
        </Stack>
      </RouteErrorBoundary>
      <AppConfigGate />
      <SessionHost />
      <BrandThemeSync />
      <AuthRequiredSheet />
      <ShellToastHost />
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  const fontsSettled = useAppFonts();
  const appReady = useAppReady();
  const screenMounted = useFirstScreenMounted();

  useEffect(() => {
    if (fontsSettled) releaseFonts();
  }, [fontsSettled]);

  useEffect(() => {
    if (appReady) SplashScreen.hide();
  }, [appReady]);

  // A timed-out gate hides the splash, but the QA harness may only proceed once a screen really exists.
  useEffect(() => {
    if (appReady && screenMounted) markDocumentReady();
  }, [appReady, screenMounted]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <KeyboardProvider>
          <ThemeProvider>
            <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
              {fontsSettled ? (
                <ViewAsFrame>
                  <RootStack />
                </ViewAsFrame>
              ) : null}
            </PersistQueryClientProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
