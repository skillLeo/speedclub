import { Image } from 'expo-image';
import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';

import { createStyles, useBreakpoint } from '@/theme';
import { material, motion as motionTokens } from '@/theme/tokens.generated';

import type { PhotoFields } from '../Photo';
import { focalToPosition } from '../Photo';
import { hapticFor } from './haptics';
import { useMotionPreference } from './preference';
import { motionDuration } from './springs';
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
const QR_BACKDROP: { zoom: number; zoomCompact?: number } = material.qrBackdrop;
const BACKDROP_ZOOM_COMPACT = QR_BACKDROP.zoomCompact ?? BACKDROP_ZOOM;
const PERCENT = 100;

/** The backdrop's static zoom around the focal point; `compact` (a phone) takes the stronger phone zoom. */
export function backdropZoom(
  focal: { x: number; y: number } | null | undefined,
  compact: boolean = false,
): Pick<ViewStyle, 'transform' | 'transformOrigin'> & {
  transform: { scale: number }[];
  transformOrigin: string;
} {
  return { transform: [{ scale: compact ? BACKDROP_ZOOM_COMPACT : BACKDROP_ZOOM }], transformOrigin: backdropOrigin(focal) };
}

/** The zoom's origin: the focal point (0–1) as CSS-style percentages, the centre without one. */
export function backdropOrigin(focal: { x: number; y: number } | null | undefined): string {
  const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * PERCENT);
  return focal ? `${clamp(focal.x)}% ${clamp(focal.y)}%` : '50% 50%';
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
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * SM13 QR reveal (VEH-05, the sticker moment): the car's photo blurred behind, the card scales 0.92 → 1 on spring.slow while
 * it fades in (effect.default), one medium haptic (09 §4.8 "QR revealed"). Reduced motion: the card crossfades in, no scale.
 */
export function QrReveal({ photo, revealed, children, placeholder, style, testID }: QrRevealProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const compact = useBreakpoint().kind === 'phone';
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
  return (
    <View style={[styles.stage, style]} testID={testID}>
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
          style={[styles.backdrop, backdropZoom(photo.focal, compact)]}
          testID={testID ? `${testID}.backdrop` : undefined}
        />
      ) : null}
      <View aria-hidden style={styles.dim} />
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
