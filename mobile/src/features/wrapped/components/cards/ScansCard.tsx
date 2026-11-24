import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { WrappedPayload, WrappedScansCard } from '@/api/queries/wrapped';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { Hairline } from '@/ui/Hairline';

import { CardFrame, CardLine, Numeral } from './parts';

const useStyles = createStyles((t) => ({
  block: { gap: t.space[8] },
}));

export type ScansCardProps = { card: WrappedScansCard; payload: WrappedPayload; width: number; height: number; testID: string };

/**
 * Card 3: how often the sticker on the car was scanned, the views of the profile and the cars (once insights exist), and the city
 * most day scans came from. A part without data stays away; the server leaves the card out when nothing has any.
 */
export const ScansCard = forwardRef<ComponentRef<typeof View>, ScansCardProps>(function ScansCard({ card, payload, width, height, testID }, ref) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const format = useFormat();
  const views = card.profile_or_vehicle_views;
  return (
    <CardFrame ref={ref} width={width} height={height} eyebrow={t('wrapped.cards.scans.eyebrow')} sample={payload.is_sample === true} testID={testID}>
      {card.sticker_scans > 0 ? (
        <View style={styles.block}>
          <Numeral value={format.number(card.sticker_scans)} unit={t('wrapped.cards.scans.unit', { count: card.sticker_scans })} testID={`${testID}.scans`} />
          <CardLine>{t('wrapped.cards.scans.line', { count: card.sticker_scans })}</CardLine>
        </View>
      ) : null}
      {card.sticker_scans > 0 && views ? <Hairline /> : null}
      {views ? (
        <View style={styles.block}>
          <Numeral value={format.number(views)} small={card.sticker_scans > 0} testID={`${testID}.views`} />
          <CardLine variant="callout" tone="secondary">
            {t('wrapped.cards.scans.views', { count: views })}
          </CardLine>
        </View>
      ) : null}
      {card.top_city ? (
        <CardLine variant="callout" tone="secondary" testID={`${testID}.topCity`}>
          {t('wrapped.cards.scans.topCity', { city: card.top_city })}
        </CardLine>
      ) : null}
    </CardFrame>
  );
});
