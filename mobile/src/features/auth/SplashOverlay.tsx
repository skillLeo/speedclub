import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { qa } from '@/lib/qa';
import { createStyles, ThemeScope } from '@/theme';
import { motionDuration, useMotionPreference } from '@/ui/motion';
import { BrushReveal } from '@/ui/motion/kit';

/** The native splash image (app.config.ts `expo-splash-screen`: `image`, `imageWidth`), so the overlay starts where the splash ends. */
const LOGO = require('../../../assets/images/splash-icon.png') as number;
const LOGO_RATIO = 1000 / 657;
/** app.config.ts `expo-splash-screen` `imageWidth`: the overlay draws the logo at the native splash's size and place. */
export const SPLASH_LOGO_WIDTH = 200;
/**
 * DQ-1029: the asset carries the katakana line "—スピードクラブ—" under the wordmark (ink rows 560–627 of 657; the wordmark ends at
 * 516). The overlay never adds a second one: it cuts the asset at this share of its height, wipes the wordmark band and lets the
 * asset's own katakana band follow on its +120 ms beat (SM1), in the asset's place.
 */
const KANA_CUT = 538 / 657;
const LOGO_HEIGHT = SPLASH_LOGO_WIDTH / LOGO_RATIO;

const useStyles = createStyles((t) => ({
  // The splash canvas (app.config.ts backgroundColor) is Carbon's canvas: the overlay is in the brand layer's theme.
  root: { ...StyleSheet.absoluteFill, alignItems: 'center', backgroundColor: t.color.bg.canvas, justifyContent: 'center', pointerEvents: 'none' },
  logo: { aspectRatio: LOGO_RATIO, width: SPLASH_LOGO_WIDTH },
  // The two bands of the one asset: the wordmark, and the katakana pulled back up by BrushReveal's gap, so it sits where the native
  // splash drew it.
  band: { overflow: 'hidden', width: SPLASH_LOGO_WIDTH },
  wordmarkBand: { height: LOGO_HEIGHT * KANA_CUT },
  kanaBand: { height: LOGO_HEIGHT * (1 - KANA_CUT), marginTop: -t.space[12] },
  kanaImage: { marginTop: -LOGO_HEIGHT * KANA_CUT },
}));

/**
 * DQ-1045: the brand stage is a Carbon ThemeScope in every theme (ADR-421 b): on web `data-theme-scope="carbon"` tells the DOM audit to
 * check its colours against Carbon's tokens. The cast stands until `QaDataSet` (src/lib/rn-web-dataset.d.ts) lists `themeScope`.
 */
const BRAND_STAGE = { qaExempt: 'photo', themeScope: 'carbon' } as ViewProps['dataSet'];

/** Cold start only: once the overlay has played (or was skipped) in this JS context, it never comes back. */
let played = false;

/** Tests: a fresh cold start. */
export function resetSplashOverlay(): void {
  played = false;
}

/**
 * Whether this start shows the overlay. Never twice in one run, never with motion off (`qaMotion=off`). On the web the visual matrix
 * and the e2e flows (any `qa*` override, or an automated browser) start on their screen, unless `?splash=hold` asks for AUTH-01.
 */
export function splashOverlayWanted(input: { hold: boolean; automated: boolean; qaSession: boolean; motionEnabled: boolean }): boolean {
  if (played) return false;
  if (input.hold) return true;
  if (!input.motionEnabled) return false;
  return !(isWeb && (input.automated || input.qaSession));
}

function webFlags(): { hold: boolean; automated: boolean; qaSession: boolean } {
  if (!isWeb || typeof window === 'undefined') return { hold: false, automated: false, qaSession: false };
  const search = window.location?.search ?? '';
  const hold = process.env.EXPO_PUBLIC_APP_ENV !== 'production' && new URLSearchParams(search).get('splash') === 'hold';
  const automated = typeof navigator !== 'undefined' && navigator.webdriver === true;
  return { hold, automated, qaSession: Object.keys(qa).length > 0 };
}

export type SplashOverlayProps = {
  /** The app is ready (fonts, theme, session): the native splash goes and the reveal plays. */
  ready: boolean;
  /** Called once the overlay covers the window, so the native splash can hide under an identical canvas. */
  onCovered: () => void;
};

/**
 * AUTH-01 (09 §7.1, SM1; BUG-3). The native splash stays static (canvas and the white brush logo) until the app is ready. Then this
 * overlay, the same canvas, takes over: the native splash hides at once under it, the brush logo is uncovered left to right
 * (BrushReveal, spring.slow), the katakana follows, it holds 150 ms and the overlay crossfades into the first screen on
 * effect.default. Android 12+ hands its starting window over as a SplashScreenView that can attach up to ~0.2 s after the first app
 * frame; it now lands on this overlay, which lasts longer than that, never on the content. Reduced motion: logo and katakana
 * crossfade in, then the same fade out. Never a spinner, never a loop; cold start only.
 */
export function SplashOverlay({ ready, onCovered }: SplashOverlayProps) {
  const motion = useMotionPreference();
  const [state] = useState(() => {
    const flags = webFlags();
    return { shown: splashOverlayWanted({ ...flags, motionEnabled: motion.enabled }), hold: flags.hold };
  });
  const [gone, setGone] = useState(!state.shown);

  useEffect(() => {
    if (!state.shown) {
      played = true;
      if (ready) onCovered();
    }
  }, [onCovered, ready, state.shown]);

  if (gone) return null;
  return (
    <ThemeScope name="carbon">
      <Overlay
        play={ready}
        hold={state.hold}
        onCovered={onCovered}
        onGone={() => {
          played = true;
          setGone(true);
        }}
      />
    </ThemeScope>
  );
}

function Overlay({ play, hold, onCovered, onGone }: { play: boolean; hold: boolean; onCovered: () => void; onGone: () => void }) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const fade = useSharedValue(1);

  // The overlay is drawn: the native splash can go now without anything showing through.
  useEffect(() => {
    if (play) onCovered();
  }, [onCovered, play]);

  // After the reveal: the crossfade into the first screen, then the overlay leaves the tree.
  const [leaving, setLeaving] = useState(false);
  const done = () => {
    if (hold) return;
    fade.set(motion.effectTo(0, 'default'));
    setLeaving(true);
  };
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(onGone, motionDuration('effect.default'));
    return () => clearTimeout(timer);
  }, [leaving, onGone]);

  const style = useAnimatedStyle(() => ({ opacity: fade.get() }));
  return (
    // The brand splash is the dark stage in every theme (09 §7.1: the canvas of the native splash it continues).
    <Animated.View style={[styles.root, style]} aria-hidden importantForAccessibility="no-hide-descendants" dataSet={BRAND_STAGE} testID="AUTH-01.root">
      <BrushReveal
        play={play}
        onDone={done}
        logo={
          <View style={[styles.band, styles.wordmarkBand]}>
            <Image source={LOGO} contentFit="contain" accessible={false} alt="" style={styles.logo} testID="AUTH-01.logo" />
          </View>
        }
        katakana={
          <View aria-hidden style={[styles.band, styles.kanaBand]} testID="AUTH-01.katakana">
            <Image source={LOGO} contentFit="contain" accessible={false} alt="" style={[styles.logo, styles.kanaImage]} />
          </View>
        }
        testID="AUTH-01.reveal"
      />
    </Animated.View>
  );
}
