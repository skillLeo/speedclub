import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';
import { material } from '@/theme/tokens.generated';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';
import { focalToPosition, type PhotoFields } from '@/ui/Photo';
import { motionDuration, useMotionPreference } from '@/ui/motion';

const useStyles = createStyles((t) => ({
  stage: { alignItems: 'center', backgroundColor: t.color.media.ground, justifyContent: 'center', overflow: 'hidden' },
  // As the QR stage (DQ-1053): the blurred image reaches past every edge, so the stage clips its soft border away.
  backdrop: { bottom: -t.space[32], left: -t.space[32], position: 'absolute', right: -t.space[32], top: -t.space[32] },
  // The dark stage colour at the phone dim of ADR-462, in every theme (ADR-421 b): the sticker reads on it, the car stays visible.
  dim: { ...StyleSheet.absoluteFill, backgroundColor: t.color.scrim.photoEnd, opacity: material.qrBackdrop.dimCompact },
}));

export type StickerStageProps = {
  /** The car's cover; without one the stage is the plain media ground. */
  cover?: PhotoFields | null;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
};

/**
 * The sticker on its car (DQ-M54-08, -10): the car's own cover photo, blurred and dimmed as on the QR stage, behind the drawing, so every
 * card and the sticker page show which car the sticker belongs to. Decoration only: the photo carries no name of its own.
 */
export function StickerStage({ cover, children, style, onLayout, testID }: StickerStageProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const source = cover?.source ?? null;
  // A data: URL on web, not expo-image's blob: placeholder, which WebKit fails to load once the stage unmounts (E2E P5 rerun, F2 step 4
  // leaving STK-02; b756c293).
  const placeholder = useImagePlaceholder(cover?.blurhash, 'cover', cover?.thumbhash);
  return (
    <View style={[styles.stage, style]} onLayout={onLayout} testID={testID}>
      {source ? (
        <>
          <Image
            source={typeof source === 'string' ? { uri: source } : source}
            {...placeholder}
            contentFit="cover"
            contentPosition={cover?.focal ? focalToPosition(cover.focal) : 'center'}
            // DQ-M54R2-10: half the QR stage's blur, so the car stays recognisable behind its sticker.
            blurRadius={material.qrBackdrop.blur / 2}
            transition={motion.reduced ? null : motionDuration('effect.default')}
            accessible={false}
            // expo-image on the web writes the img's alt from accessibilityLabel (as Photo.tsx does): empty = decorative backdrop.
            alt=""
            accessibilityLabel=""
            style={styles.backdrop}
            testID={testID ? `${testID}.backdrop` : undefined}
          />
          <View aria-hidden style={styles.dim} />
        </>
      ) : null}
      {children}
    </View>
  );
}
