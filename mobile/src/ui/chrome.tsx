import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ComponentRef, ReactNode, RefObject } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, material, useTheme } from '@/theme';

import {
  androidApiLevel,
  chromeMaterialFor,
  useAndroidBlurSlot,
  webBackdropSupported,
  type ChromeMaterial,
} from './chromeMaterial';
import { Icon, type IconName } from './icons/Icon';
import { useReduceTransparency } from './motion';
import { PressableScale } from './PressableScale';

/**
 * BlurView takes an intensity from 1 to 100, not a radius. This factor gives the blur token the frosted read the CSS radius
 * has on web, under the `chrome.translucent` fill (the tab bar has used it since M1).
 */
const BLUR_INTENSITY = material.chrome.blur * 2.5;

/** Read once: neither changes while the app runs. */
const GLASS_AVAILABLE = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
const BACKDROP_SUPPORTED = Platform.OS === 'web' && webBackdropSupported();

/**
 * `backdrop-filter` from the token, with the prefixed twin Safari before 18 reads; react-native-web passes both through as
 * CSS. Every web chrome surface uses this one style (ChromeSurface, the tab bar).
 */
export const WEB_BACKDROP = { backdropFilter: material.chrome.webBackdrop, WebkitBackdropFilter: material.chrome.webBackdrop } as ViewStyle;

const useStyles = createStyles((t) => ({
  translucent: { backgroundColor: t.color.chrome.translucent, overflow: 'hidden' },
  opaque: { backgroundColor: t.color.chrome.opaque },
  glass: { overflow: 'hidden' },
  webBackdrop: WEB_BACKDROP,
  floatingTarget: {
    alignItems: 'center',
    height: t.size.touchMin,
    justifyContent: 'center',
    width: t.size.touchMin,
  },
  floatingVisual: {
    alignItems: 'center',
    borderRadius: t.radius.full,
    flexGrow: 0,
    height: t.size.touchMin,
    justifyContent: 'center',
    width: t.size.touchMin,
  },
}));

export type ChromeSurfaceProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** A floating control over photography (≤ 2 per screen): the only chrome that may become glass on iOS. */
  floating?: boolean;
  /**
   * Android: the BlurTargetView with the content behind this chrome. Without it Android stays opaque, as 09 §4.4 defaults.
   */
  blurTarget?: RefObject<ComponentRef<typeof View> | null>;
  testID?: string;
};

/** The material this surface renders, live with reduce transparency and the Android blur slot. */
export function useChromeMaterial(floating: boolean, hasBlurTarget: boolean): ChromeMaterial {
  const reduceTransparency = useReduceTransparency();
  const androidApi = androidApiLevel();
  const wantsBlur =
    Platform.OS === 'android' && !reduceTransparency && hasBlurTarget && androidApi >= material.chrome.androidBlurMinApi;
  const holdsBlurSlot = useAndroidBlurSlot(wantsBlur);
  return chromeMaterialFor({
    platform: Platform.OS,
    floating,
    reduceTransparency,
    glassAvailable: GLASS_AVAILABLE,
    backdropSupported: BACKDROP_SUPPORTED,
    androidApi,
    hasBlurTarget,
    holdsBlurSlot,
  });
}

/**
 * The material behind navigation and floating controls (09 §4.4): GlassView, `chrome.translucent` over a blur, or
 * `chrome.opaque`. Never put it behind cards, lists or content, and never nest it (no glass on glass).
 */
export function ChromeSurface({ children, style, floating = false, blurTarget, testID }: ChromeSurfaceProps) {
  const styles = useStyles();
  const theme = useTheme();
  const kind = useChromeMaterial(floating, blurTarget !== undefined);

  if (kind === 'glass') {
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme={theme.colorScheme === 'light' ? 'light' : 'dark'}
        style={[styles.glass, style]}
        testID={testID}
      >
        {children}
      </GlassView>
    );
  }
  if (kind === 'opaque') {
    return (
      <View style={[styles.opaque, style]} testID={testID}>
        {children}
      </View>
    );
  }
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.translucent, styles.webBackdrop, style]} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <View style={[styles.translucent, style]} testID={testID}>
      <BlurView
        intensity={BLUR_INTENSITY}
        tint={theme.colorScheme === 'light' ? 'light' : 'dark'}
        style={StyleSheet.absoluteFill}
        {...(Platform.OS === 'android' ? { blurMethod: 'dimezisBlurViewSdk31Plus' as const, blurTarget } : {})}
      />
      {children}
    </View>
  );
}

export type FloatingControlProps = {
  icon: IconName;
  /** Required: an icon-only control has no other name. */
  label: string;
  onPress: () => void;
  testID?: string;
};

/**
 * A round 44 control over photography (09 §5 IconButton `floating`; hero back, share, QR): glass on iOS where available,
 * `chrome.translucent` elsewhere, opaque under reduced transparency. At most two per screen.
 *
 * DQ-901: the glyph is a child of its surface, never a sibling after an absolutely positioned one. In CSS a positioned box
 * paints above in-flow content that is not positioned, and Phosphor's `<svg>` is not, so on react-native-web the 86 % surface
 * covered the caret (1.14:1). Inside the surface the glyph paints above the surface's own fill on every platform, as in the
 * chrome pill.
 */
export function FloatingControl({ icon, label, onPress, testID }: FloatingControlProps) {
  const styles = useStyles();
  return (
    <PressableScale
      role="button"
      aria-label={label}
      onPress={onPress}
      testID={testID}
      style={styles.floatingTarget}
      contentStyle={styles.floatingVisual}
      ring="onPhoto"
    >
      <ChromeSurface floating style={styles.floatingVisual} testID={testID ? `${testID}.surface` : undefined}>
        <Icon name={icon} size={24} color="text.primary" testID={testID ? `${testID}.glyph` : undefined} />
      </ChromeSurface>
    </PressableScale>
  );
}
