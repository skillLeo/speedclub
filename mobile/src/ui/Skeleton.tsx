import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { createStyles, maxFontScale, motion as motionTokens, radius, typography, useMotion, useTheme, type TypeVariant } from '@/theme';

import { useScreenFocused } from './SkeletonFocus';

/** §8: a skeleton shows only after 300 ms, so fast responses never flash it. */
export const SKELETON_DELAY_MS = 300;

const ShimmerContext = createContext<SharedValue<number> | null>(null);

const useStyles = createStyles((t) => ({
  hidden: { opacity: 0 },
  block: { backgroundColor: t.color.skeleton.base, overflow: 'hidden' },
  highlight: { backgroundColor: t.color.skeleton.highlight },
  lineBox: { justifyContent: 'center' },
}));

export type SkeletonProps = {
  children: ReactNode;
  /** Accessible name; defaults to the common "loading" string. */
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The state wrapper of a screen or block. It keeps the final geometry from the first frame, stays invisible for
 * 300 ms and drives one shimmer (1.2 s, the only loop in the product) for all blocks inside. No shimmer under
 * reduced motion; with `qaMotion=off` it shows at once and still. The loop pauses while its screen is not on show (a tab left
 * behind, a screen under the top of its stack) and starts again when it is.
 */
export function Skeleton({ children, label, style, testID }: SkeletonProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const motion = useMotion();
  const [delayed, setDelayed] = useState(false);
  const shimmer = useSharedValue(0);
  const visible = delayed || !motion.enabled;
  const focused = useScreenFocused();
  const shimmering = visible && focused && motion.enabled && !motion.reduced;

  useEffect(() => {
    const timer = setTimeout(() => setDelayed(true), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!shimmering) return undefined;
    shimmer.set(
      withRepeat(
        withTiming(1, {
          duration: motionTokens.duration.skeletonCycle / 2,
          easing: motion.easing.standard,
          reduceMotion: ReduceMotion.Never,
        }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(shimmer);
      shimmer.set(0);
    };
  }, [motion.easing.standard, shimmer, shimmering]);

  return (
    <ShimmerContext value={shimmer}>
      <View
        accessible
        role="progressbar"
        aria-label={label ?? t('states.loading')}
        aria-busy
        testID={testID}
        style={[visible ? null : styles.hidden, style]}
      >
        {children}
      </View>
    </ShimmerContext>
  );
}

export type SkeletonBlockProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  /** For images: 4/3, 16/9 … */
  aspectRatio?: number;
  /** Radius token name. */
  corner?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** One bg.raised block. Outside a `Skeleton` it brings its own delay and shimmer. */
export function SkeletonBlock(props: SkeletonBlockProps) {
  if (!use(ShimmerContext)) {
    return (
      <Skeleton>
        <Block {...props} />
      </Skeleton>
    );
  }
  return <Block {...props} />;
}

function Block({ width, height, aspectRatio, corner = 'xs', style, testID }: SkeletonBlockProps) {
  const styles = useStyles();
  const shimmer = use(ShimmerContext);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: shimmer?.get() ?? 0 }));
  return (
    <View
      testID={testID}
      style={[styles.block, { width, height, aspectRatio, borderRadius: radius[corner] }, style]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.highlight, animatedStyle]} />
    </View>
  );
}

export type SkeletonTextProps = {
  /** The Text variant it stands in for: each line takes that line height. */
  variant?: TypeVariant;
  lines?: number;
  /** Width of the last line. */
  lastLineWidth?: DimensionValue;
  /** Width of the other lines. */
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Inter is about this wide per character, in em, across German copy with figures, measured in Chromium on the gallery's
 * rows and cards. A skeleton must never be longer than its content, so the figures stay close to the real widths. A
 * caption has more narrow glyphs ("@", ".", "·", spaces); a card title at 18 size has tighter tracking; display.m is
 * Barlow Semi Condensed, a narrow face (HOME-01's featured title).
 */
const AVERAGE_CHAR_EM = 0.55;
const CHAR_EM: Partial<Record<TypeVariant, number>> = { caption: 0.47, titleS: 0.52, displayM: 0.42 };

/**
 * How many lines a text of about `chars` characters takes at this width and font scale. For skeletons of copy that wraps
 * at a large font: they must not jump when the real text arrives (§8, also at 200 %).
 */
export function estimateLines(chars: number, variant: TypeVariant, fontScale: number, width: number): number {
  if (width <= 0) return 1;
  const cap = (maxFontScale as Partial<Record<TypeVariant, number>>)[variant];
  const scale = Math.min(fontScale, cap ?? fontScale);
  return Math.max(1, Math.ceil((chars * (CHAR_EM[variant] ?? AVERAGE_CHAR_EM) * typography[variant].fontSize * scale) / width));
}

const LAST_LINE_WIDTH: DimensionValue = '60%';
const FULL_WIDTH: DimensionValue = '100%';

/** Lines with the exact line height of a type variant, including the font scale and its cap. */
export function SkeletonText(props: SkeletonTextProps) {
  if (!use(ShimmerContext)) {
    return (
      <Skeleton>
        <Lines {...props} />
      </Skeleton>
    );
  }
  return <Lines {...props} />;
}

function Lines({
  variant = 'body',
  lines = 1,
  width = FULL_WIDTH,
  lastLineWidth = LAST_LINE_WIDTH,
  style,
  testID,
}: SkeletonTextProps) {
  const styles = useStyles();
  const theme = useTheme();
  const cap = (maxFontScale as Partial<Record<TypeVariant, number>>)[variant];
  const scale = Math.min(theme.fontScale, cap ?? theme.fontScale);
  const type = typography[variant];
  return (
    <View testID={testID} style={style}>
      {Array.from({ length: lines }, (_, index) => (
        <View key={index} style={[styles.lineBox, { height: type.lineHeight * scale }]}>
          <SkeletonBlock
            height={type.fontSize * scale}
            width={lines > 1 && index === lines - 1 ? lastLineWidth : width}
          />
        </View>
      ))}
    </View>
  );
}
