import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { WrappedPayload, WrappedSpiritCard } from '@/api/queries/wrapped';
import { createStyles, space } from '@/theme';
import { DisplayTitle } from '@/ui/DisplayTitle';

import { CARD_FONT_SCALE_CAP, CardFrame, CardLine, CardPhoto } from './parts';

const useStyles = createStyles((t) => ({
  withPhoto: { justifyContent: 'flex-start' },
  text: { gap: t.space[12] },
}));

export type SpiritCardProps = { card: WrappedSpiritCard; payload: WrappedPayload; width: number; height: number; testID: string };

/**
 * Card 7 "Build Spirit" (contract §4): the server's title from fixed rules over the documented mods, its one-line reason, and how it
 * is made. With the server's photo of the car whose mods decide it (ADR-516 a) the photo leads. Never random, never speed words: the
 * words are the server's, the app adds only the rule line.
 */
export const SpiritCard = forwardRef<ComponentRef<typeof View>, SpiritCardProps>(function SpiritCard({ card, payload, width, height, testID }, ref) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const inner = width - 2 * space[24];
  const photo = card.image;
  return (
    <CardFrame
      ref={ref}
      width={width}
      height={height}
      eyebrow={t('wrapped.cards.spirit.eyebrow')}
      sample={payload.is_sample === true}
      bodyStyle={photo ? styles.withPhoto : undefined}
      testID={testID}
    >
      {photo ? <CardPhoto photo={photo} label={t('wrapped.cards.photoLabel')} width={inner} testID={`${testID}.photo`} /> : null}
      <View style={styles.text}>
        <DisplayTitle kind="copy" placement="card" layoutWidth={inner} color="onPhoto.primary" fontScaleCap={CARD_FONT_SCALE_CAP} testID={`${testID}.title`}>
          {card.title}
        </DisplayTitle>
        <CardLine testID={`${testID}.explanation`}>{card.explanation}</CardLine>
      </View>
      <CardLine variant="caption" tone="secondary">
        {t('wrapped.cards.spirit.rule')}
      </CardLine>
    </CardFrame>
  );
});
