import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import {
  createStyles,
  maxFontScale,
  motion as motionTokens,
  radius,
  typography,
  typographyDesktop,
  useTheme,
  type SizedTypeVariant,
  type TypeVariant,
} from '@/theme';

import { shimmerLoop, useMotionPreference } from './motion';
import { useScreenFocused } from './SkeletonFocus';
import { useDesktopType } from './Text';

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
 * The state wrapper of a screen or block. It keeps the final geometry from the first frame and stays invisible for 300 ms.
 * SM15: it stands still by default; only a load that runs past `skeleton.shimmerAfter` (1.5 s) starts one shimmer
 * (`skeleton.shimmerCycle`, 1.2 s) for all blocks inside. No shimmer under reduced motion; with `qaMotion=off` it shows at once and still. The loop pauses while its screen is not on show (a tab left
 * behind, a screen under the top of its stack) and starts again when it is.
 */
export function Skeleton({ children, label, style, testID }: SkeletonProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const motion = useMotionPreference();
  const [delayed, setDelayed] = useState(false);
  const [slow, setSlow] = useState(false);
  const shimmer = useSharedValue(0);
  const visible = delayed || !motion.enabled;
  const focused = useScreenFocused();
  const shimmering = visible && slow && focused && motion.enabled && !motion.reduced;

  useEffect(() => {
    const timer = setTimeout(() => setDelayed(true), SKELETON_DELAY_MS);
    const late = setTimeout(() => setSlow(true), motionTokens.skeleton.shimmerAfter);
    return () => {
      clearTimeout(timer);
      clearTimeout(late);
    };
  }, []);

  useEffect(() => {
    if (!shimmering) return undefined;
    shimmer.set(shimmerLoop());
    return () => {
      cancelAnimation(shimmer);
      shimmer.set(0);
    };
  }, [shimmer, shimmering]);

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
  /** The Text variant it stands in for: each line takes that line height (a role with its own size). */
  variant?: SizedTypeVariant;
  lines?: number;
  /** Width of the last line. */
  lastLineWidth?: DimensionValue;
  /** Width of the other lines. */
  width?: DimensionValue;
  /**
   * The role's web desktop size and line height on the web desktop (body and body.strong 16/24, the titles, the numerals), as the
   * Text it stands for takes them. On by default, as on Text, so a skeleton's line boxes equal its content's at 1280 too (DQ-064:
   * BuildUpdateRow's body.strong title is 24 high there, a 22 skeleton line was 4 short at 200 %). False where the Text is
   * false: a display.title that is not a page title (`DisplayTitle` placement card or rail), a shrunk title (title.2's 28).
   */
  desktopSize?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Inter is about this wide per character, in em, across German copy with figures, measured in Chromium on the gallery's
 * rows and cards. A skeleton must never be longer than its content, so the figures stay close to the real widths. A
 * caption has more narrow glyphs ("@", ".", "·", spaces); a headline has tighter tracking. display.title is Archivo
 * SemiExpanded, a wide face: M4.1 measured 0.556–0.626 em per character over car names (TTF advances, −1 % tracking), and
 * the floor keeps the skeleton no longer than the shortest-reading name (HOME-01's featured title).
 */
const AVERAGE_CHAR_EM = 0.55;
const CHAR_EM: Partial<Record<SizedTypeVariant, number>> = { caption: 0.47, headline: 0.52, displayTitle: 0.55 };

/**
 * How many lines a text of about `chars` characters takes at this width and font scale. For skeletons of copy that wraps
 * at a large font: they must not jump when the real text arrives (§8, also at 200 %).
 */
export function estimateLines(chars: number, variant: SizedTypeVariant, fontScale: number, width: number): number {
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
  desktopSize = true,
  style,
  testID,
}: SkeletonTextProps) {
  const styles = useStyles();
  const theme = useTheme();
  const desktop = useDesktopType() && desktopSize;
  const cap = (maxFontScale as Partial<Record<TypeVariant, number>>)[variant];
  const scale = Math.min(theme.fontScale, cap ?? theme.fontScale);
  const desktopType = desktop ? (typographyDesktop as Partial<Record<SizedTypeVariant, { fontSize: number; lineHeight: number }>>)[variant] : undefined;
  const type = desktopType ?? typography[variant];
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
