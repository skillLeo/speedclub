import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';

import { createStyles, useBreakpoint, useTheme } from '@/theme';
import { material, motion as motionTokens } from '@/theme/tokens.generated';

import type { PhotoFields } from '../Photo';
import { focalToPosition } from '../Photo';
import { hapticFor } from './haptics';
import { useMotionPreference } from './preference';
import { motionDuration } from './springs';
import { TopScrim } from './TopScrim';
import { Wipe } from './Wipe';

const FROM = motionTokens.signature.qrReveal.fromScale;
/** ADR-443: the car behind the code stays recognisable as the member's car; plates are blurred in the photo pipeline. */
const BACKDROP_BLUR = material.qrBackdrop.blur;
/**
 * DQ-1053 / ADR-451: the card covers the middle of the stage, so the photo is enlarged around its focal point until the car's body
 * (its colour and silhouette) reaches the stage's edges beside and above the card. A static transform: nothing animates.
 */
const BACKDROP_ZOOM = material.qrBackdrop.zoom;
/**
 * DQ-1053 r3: on a phone the card leaves only a 20-wide frame of the stage, so the photo is enlarged further there
 * (`material.qrBackdrop.zoomCompact`, proposed to the lead; until the token exists the regular zoom applies).
 */
const QR_BACKDROP: { zoom: number; zoomCompact?: number; dimCompact?: number } = material.qrBackdrop;
const BACKDROP_ZOOM_COMPACT = QR_BACKDROP.zoomCompact ?? BACKDROP_ZOOM;
/**
 * DQ-1053 / ADR-462: below 768 the stage's dim is lighter, the dark stage colour at this opacity, so the car's colour survives
 * in the narrow side bands. `material.qrBackdrop.dimCompact` is requested from the lead (M4.18); until tokens.json has it,
 * the ADR-462 value applies here. From 768 the regular dim (`scrim.topStart`, 45 %) stays.
 */
const ADR_462_DIM_COMPACT = 0.2;
export const BACKDROP_DIM_COMPACT = QR_BACKDROP.dimCompact ?? ADR_462_DIM_COMPACT;
const PERCENT = 100;
const HALF = 0.5;
const CENTRE = '50% 50%';

/**
 * The backdrop's static zoom (ADR-458, DQ-1053): the photo is enlarged and moved so its focal point (the car) sits in the stage's
 * centre, where the card is, and the car's body fills both side bands beside the card. `box` is the backdrop's size (the stage plus
 * the blur margin); the shift never exceeds what the enlargement adds on each side, so the photo still covers the whole stage. Before
 * the stage is measured (or without a focal point) the zoom stays around the focal point. `compact` (a phone) takes the phone zoom.
 */
export function backdropZoom(
  focal: { x: number; y: number } | null | undefined,
  compact: boolean = false,
  box?: { width: number; height: number } | null,
): Pick<ViewStyle, 'transform' | 'transformOrigin'> & {
  transform: ({ scale: number } | { translateX: number } | { translateY: number })[];
  transformOrigin: string;
} {
  const zoom = compact ? BACKDROP_ZOOM_COMPACT : BACKDROP_ZOOM;
  if (!focal || !box || box.width <= 0 || box.height <= 0) return { transform: [{ scale: zoom }], transformOrigin: backdropOrigin(focal) };
  const shift = (share: number, length: number) => {
    const limit = ((zoom - 1) / 2) * length;
    const wanted = (HALF - Math.min(1, Math.max(0, share))) * length * zoom;
    return Math.round(Math.min(limit, Math.max(-limit, wanted)));
  };
  return {
    transform: [{ translateX: shift(focal.x, box.width) }, { translateY: shift(focal.y, box.height) }, { scale: zoom }],
    transformOrigin: CENTRE,
  };
}

/** The zoom's origin: the focal point (0–1) as CSS-style percentages, the centre without one. */
export function backdropOrigin(focal: { x: number; y: number } | null | undefined): string {
  const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * PERCENT);
  return focal ? `${clamp(focal.x)}% ${clamp(focal.y)}%` : CENTRE;
}

const useStyles = createStyles((t) => ({
  stage: {
    alignItems: 'center',
    backgroundColor: t.color.media.ground,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // DQ-1053: a light dim, so the car stays recognisable (ADR-443); the white card carries its own contrast.
  dim: { ...StyleSheet.absoluteFill, backgroundColor: t.color.scrim.topStart },
  // ADR-462: the phone dim, the dark stage colour (every theme, ADR-421 b) at the compact opacity.
  dimCompact: { ...StyleSheet.absoluteFill, backgroundColor: t.color.scrim.photoEnd, opacity: BACKDROP_DIM_COMPACT },
  // DQ-1053: a blur fades the image's own edges to transparent (CSS `filter: blur()` on the web), which drew a grey vignette
  // on the media ground. The image reaches twice the blur radius past every edge, so the stage clips the soft border away.
  backdrop: {
    bottom: -t.space[32],
    left: -t.space[32],
    position: 'absolute',
    right: -t.space[32],
    top: -t.space[32],
  },
  placeholder: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  topScrim: { left: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0 },
  rule: { backgroundColor: t.color.accent.fg, height: t.size.border.control, transformOrigin: 'left' },
}));

export type QrRevealProps = {
  /** The vehicle's cover, blurred behind the card. Without one the dark media ground stays. */
  photo?: PhotoFields;
  /** False keeps the card hidden (loading); true reveals it once. */
  revealed: boolean;
  /** The QR card (`QRDisplay`). */
  children: ReactNode;
  /**
   * Shown on the stage while `revealed` is false, outside the reveal's opacity (a skeleton of the card's geometry while the
   * code loads). It leaves when the card is revealed.
   */
  placeholder?: ReactNode;
  /**
   * ADR-463: the height of `scrim.top` over the stage's top, behind what sits there (GAR-04's wordmark on a phone), so white keeps
   * 4.5:1 on a bright photo. It shows with the card. Omitted: none.
   */
  topScrim?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * SM13 QR reveal (VEH-05, the sticker moment): the car's photo blurred behind, the card scales 0.92 → 1 on spring.slow while
 * it fades in (effect.default), one medium haptic (09 §4.8 "QR revealed"). Reduced motion: the card crossfades in, no scale.
 */
export function QrReveal({ photo, revealed, children, placeholder, topScrim, style, testID }: QrRevealProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const compact = useBreakpoint().kind === 'phone';
  const theme = useTheme();
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  // The backdrop reaches the blur margin past every edge (styles.backdrop), so its box is the stage's plus twice that margin.
  const onStageLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const margin = 2 * theme.space[32];
    setBox((current) => (current && current.width === width + margin && current.height === height + margin ? current : { width: width + margin, height: height + margin }));
  };
  const scale = useSharedValue(revealed || motion.reduced ? 1 : FROM);
  const fade = useSharedValue(revealed ? 1 : 0);
  /** What the last run saw: the haptic and the motion belong to the false → true change only, never to mount or a preference flip. */
  const wasRevealed = useRef(revealed);

  useEffect(() => {
    const opening = revealed && !wasRevealed.current;
    wasRevealed.current = revealed;
    if (!revealed) {
      fade.set(0);
      scale.set(motion.reduced ? 1 : FROM);
      return;
    }
    if (!opening) {
      // Mounted revealed, or the preference changed while shown: the end state, without a second reveal.
      fade.set(1);
      scale.set(1);
      return;
    }
    fade.set(motion.effectTo(1, 'default'));
    // Every branch sets the end state of every value: reduced motion lands the scale at 1 at once.
    scale.set(motion.reduced ? 1 : motion.springTo(1, 'slow'));
    hapticFor('qrRevealed');
  }, [fade, motion, revealed, scale]);

  const cardStyle = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ scale: scale.get() }] }));
  const cardFade = useAnimatedStyle(() => ({ opacity: fade.get() }));
  return (
    <View style={[styles.stage, style]} onLayout={onStageLayout} testID={testID}>
      {photo?.source ? (
        <Image
          aria-hidden
          source={photo.source}
          placeholder={
            photo.blurhash
              ? { blurhash: photo.blurhash }
              : photo.thumbhash
                ? { thumbhash: photo.thumbhash }
                : undefined
          }
          contentFit="cover"
          contentPosition={photo.focal ? focalToPosition(photo.focal) : 'center'}
          blurRadius={BACKDROP_BLUR}
          style={[styles.backdrop, backdropZoom(photo.focal, compact, box)]}
          testID={testID ? `${testID}.backdrop` : undefined}
        />
      ) : null}
      <View aria-hidden style={compact ? styles.dimCompact : styles.dim} testID={testID ? `${testID}.dim` : undefined} />
      {topScrim && topScrim > 0 ? (
        <Animated.View aria-hidden style={[styles.topScrim, { height: topScrim }, cardFade]} testID={testID ? `${testID}.topScrim` : undefined}>
          <TopScrim height={topScrim} />
        </Animated.View>
      ) : null}
      {!revealed && placeholder ? (
        <View style={styles.placeholder} testID={testID ? `${testID}.placeholder` : undefined}>
          {placeholder}
        </View>
      ) : null}
      <Animated.View style={cardStyle}>{children}</Animated.View>
    </View>
  );
}

/**
 * SM13 print (GAR-04, after publishing): the code is uncovered top → bottom on spring.slow, like a sticker coming out of a
 * printer. Reduced motion: it fades in (effect.default). `printing` starts it once.
 */
export function PrintWipe({
  printing,
  children,
  testID,
}: {
  printing: boolean;
  children: ReactNode;
  testID?: string;
}) {
  const motion = useMotionPreference();
  const wipe = useSharedValue(motion.reduced ? 1 : 0);
  const fade = useSharedValue(motion.reduced ? 0 : 1);
  useEffect(() => {
    if (!printing) return;
    // Every branch ends with both values at 1, so a preference flip between mount and print never leaves the code covered.
    if (!motion.enabled) {
      wipe.set(1);
      fade.set(1);
    } else if (motion.reduced) {
      wipe.set(1);
      fade.set(motion.effectTo(1, 'default'));
    } else {
      fade.set(1);
      wipe.set(motion.springTo(1, 'slow'));
    }
  }, [fade, motion, printing, wipe]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  return (
    <Animated.View style={fadeStyle} testID={testID}>
      <Wipe progress={wipe} axis="y" testID={testID ? `${testID}.wipe` : undefined}>
        {children}
      </Wipe>
    </Animated.View>
  );
}

/**
 * The 1 px accent rule under the wordmark that draws itself left → right after the print (effect.slow, no bounce).
 * Reduced motion: it is simply there.
 */
export function DrawnRule({
  drawn,
  width,
  afterPrint = true,
  testID,
}: {
  drawn: boolean;
  width: number;
  afterPrint?: boolean;
  testID?: string;
}) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const progress = useSharedValue(motion.reduced ? 1 : 0);
  useEffect(() => {
    if (!drawn) return;
    if (motion.reduced) {
      progress.set(1);
      return;
    }
    progress.set(
      afterPrint
        ? withDelay(motionDuration('spring.slow'), motion.effectTo(1, 'slow'))
        : motion.effectTo(1, 'slow'),
    );
  }, [afterPrint, drawn, motion, progress]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleX: interpolate(progress.get(), [0, 1], [0, 1]) }],
  }));
  return <Animated.View aria-hidden style={[styles.rule, { width }, style]} testID={testID} />;
}
