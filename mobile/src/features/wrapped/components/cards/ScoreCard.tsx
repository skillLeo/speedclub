import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { WrappedPayload, WrappedScoreCard } from '@/api/queries/wrapped';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space } from '@/theme';
import { BuildScoreGauge } from '@/ui/BuildScoreGauge';
import { DisplayTitle } from '@/ui/DisplayTitle';
import { GAUGE_MAX } from '@/ui/buildScoreGaugeMath';

import { CARD_FONT_SCALE_CAP, CardFrame, CardLine, CardPhoto } from './parts';

const useStyles = createStyles((t) => ({
  withPhoto: { justifyContent: 'flex-start' },
  lines: { gap: t.space[4] },
}));

/**
 * The gauge's box as a share of the card's height: alone it leads the card, under the car's photo it gives the photo room. R6-3
 * ("smaller and quieter", hero.numeral.s inside): 0.3 and 0.2 (were 0.42 and 0.28), about 192 and 128 on a 640 high card.
 */
const GAUGE_SHARE = 0.3;
const GAUGE_SHARE_WITH_PHOTO = 0.2;

export type ScoreCardProps = { card: WrappedScoreCard; payload: WrappedPayload; width: number; height: number; testID: string };

/**
 * Card 4: the best car's Build Score over the season. With the server's photo of that car (ADR-516 a) the photo leads, the name and
 * the gauge follow; the gauge at rest at the new total with "+230" (`BuildScoreGauge`, no sweep: the card is a picture), "Von 412
 * auf 642", and the stage change when there was one. Never points for power or speed (F19).
 */
export const ScoreCard = forwardRef<ComponentRef<typeof View>, ScoreCardProps>(function ScoreCard({ card, payload, width, height, testID }, ref) {
  const { t } = useTranslation('profile');
  const { t: tVehicle } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const value = format.number(card.to);
  const max = format.number(GAUGE_MAX);
  const inner = width - 2 * space[24];
  const photo = card.image;
  return (
    <CardFrame
      ref={ref}
      width={width}
      height={height}
      eyebrow={t('wrapped.cards.score.eyebrow')}
      sample={payload.is_sample === true}
      bodyStyle={photo ? styles.withPhoto : undefined}
      testID={testID}
    >
      {photo ? <CardPhoto photo={photo} label={card.vehicle_name} width={inner} testID={`${testID}.photo`} /> : null}
      <DisplayTitle placement="card" layoutWidth={inner} color="onPhoto.primary" fontScaleCap={CARD_FONT_SCALE_CAP} testID={`${testID}.vehicle`}>
        {card.vehicle_name}
      </DisplayTitle>
      <BuildScoreGauge
        total={card.to}
        previousTotal={card.from}
        valueText={value}
        scaleText={tVehicle('score.scale', { max })}
        stageText={tVehicle('score.stage', { stage: card.stage_to })}
        deltaText={(points) => tVehicle('score.delta', { points: format.number(points) })}
        accessibilityLabel={tVehicle('score.a11y', { value, max, stage: card.stage_to })}
        box={Math.round(Math.min(inner, height * (photo ? GAUGE_SHARE_WITH_PHOTO : GAUGE_SHARE)))}
        tone="onPhoto"
        desktopSize={false}
        testID={`${testID}.gauge`}
      />
      <View style={styles.lines}>
        <CardLine numeric testID={`${testID}.range`}>
          {t('wrapped.cards.score.range', { from: format.number(card.from), to: value })}
        </CardLine>
        {card.stage_to > card.stage_from ? (
          <CardLine variant="callout" tone="secondary" numeric testID={`${testID}.stage`}>
            {t('wrapped.cards.score.stageUp', { from: card.stage_from, to: card.stage_to })}
          </CardLine>
        ) : null}
      </View>
    </CardFrame>
  );
});
