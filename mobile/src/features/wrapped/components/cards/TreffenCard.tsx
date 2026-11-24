import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { WrappedPayload, WrappedTreffenCard } from '@/api/queries/wrapped';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { Hairline } from '@/ui/Hairline';

import { CardFrame, CardLine, Numeral } from './parts';

const useStyles = createStyles((t) => ({
  names: { gap: t.space[12] },
}));

export type TreffenCardProps = { card: WrappedTreffenCard; payload: WrappedPayload; width: number; height: number; testID: string };

/** Card 6: the Treffen the member checked in at, and up to three of their public titles (never another member's name). */
export const TreffenCard = forwardRef<ComponentRef<typeof View>, TreffenCardProps>(function TreffenCard({ card, payload, width, height, testID }, ref) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  return (
    <CardFrame ref={ref} width={width} height={height} eyebrow={t('wrapped.cards.treffen.eyebrow')} sample={payload.is_sample === true} testID={testID}>
      <Numeral value={format.number(card.attended)} unit={t('wrapped.cards.treffen.unit', { count: card.attended })} testID={`${testID}.count`} />
      <CardLine>{t('wrapped.cards.treffen.line', { count: card.attended })}</CardLine>
      {card.names.length > 0 ? (
        <View style={styles.names} testID={`${testID}.names`}>
          {card.names.map((name, index) => (
            <View key={name} style={styles.names}>
              {index > 0 ? <Hairline /> : null}
              <CardLine variant="headline">{name}</CardLine>
            </View>
          ))}
        </View>
      ) : null}
    </CardFrame>
  );
});
