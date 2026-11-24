import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { WrappedPayload, WrappedPercentileCard } from '@/api/queries/wrapped';
import { createStyles } from '@/theme';

import { CardFrame, CardLine, Numeral } from './parts';

const useStyles = createStyles((t) => ({
  text: { gap: t.space[8] },
}));

export type PercentileCardProps = { card: WrappedPercentileCard; payload: WrappedPayload; width: number; height: number; testID: string };

/**
 * Card 8: where the member's Build Score stands in their Bundesland ("Top 12 %"), from the server, which sends it only for a group
 * of at least 20 members (contract §3). The Build Score only: never a speed or power number.
 */
export const PercentileCard = forwardRef<ComponentRef<typeof View>, PercentileCardProps>(function PercentileCard({ card, payload, width, height, testID }, ref) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  return (
    <CardFrame ref={ref} width={width} height={height} eyebrow={t('wrapped.cards.percentile.eyebrow', { bundesland: card.bundesland })} sample={payload.is_sample === true} testID={testID}>
      <Numeral value={card.percentile} testID={`${testID}.value`} />
      <View style={styles.text}>
        <CardLine>{t('wrapped.cards.percentile.line', { percentile: card.percentile, bundesland: card.bundesland })}</CardLine>
        <CardLine variant="caption" tone="secondary">
          {t('wrapped.cards.percentile.rule', { bundesland: card.bundesland })}
        </CardLine>
      </View>
    </CardFrame>
  );
});
