import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { WrappedPayload, WrappedPhoto, WrappedTopModCard } from '@/api/queries/wrapped';
import { createStyles } from '@/theme';
import { BeforeAfterPair } from '@/ui/BeforeAfterPair';
import { Photo, type PhotoFields } from '@/ui/Photo';
import { Text } from '@/ui/Text';

import { CardFrame, CardLine } from './parts';

const useStyles = createStyles((t) => ({
  text: { gap: t.space[4] },
  // The on-photo badge of BeforeAfterPair (neutral ground, label.badge) on the photo's top-left corner.
  badge: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    left: t.space[8],
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
    position: 'absolute',
    top: t.space[8],
  },
}));

const fields = (photo: WrappedPhoto): PhotoFields => ({ source: photo.source, blurhash: photo.blurhash, thumbhash: photo.thumbhash, focal: photo.focal });

export type TopModCardProps = { card: WrappedTopModCard; payload: WrappedPayload; width: number; height: number; testID: string };

/**
 * Card 5: the season's top modification with its before/after (`BeforeAfterPair`, the server's blurred variants only, ADR-509).
 * With one photo it stands alone under its own "Vorher" or "Nachher" badge (DQ-P5G-31: never a pair of two unrelated angles);
 * without photos the card is the words.
 */
export const TopModCard = forwardRef<ComponentRef<typeof View>, TopModCardProps>(function TopModCard({ card, payload, width, height, testID }, ref) {
  const { t } = useTranslation('profile');
  const { t: tVehicle } = useTranslation('vehicle');
  const styles = useStyles();
  const title = card.brand ? `${card.brand} ${card.name}` : card.name;
  const single = card.after_media ?? card.before_media;
  const singleLabel = card.after_media ? tVehicle('update.after') : tVehicle('update.before');
  return (
    <CardFrame ref={ref} width={width} height={height} eyebrow={t('wrapped.cards.topMod.eyebrow')} sample={payload.is_sample === true} testID={testID}>
      <View style={styles.text}>
        <CardLine variant="title2" testID={`${testID}.name`}>
          {title}
        </CardLine>
        <CardLine variant="callout" tone="secondary" testID={`${testID}.vehicle`}>
          {t('wrapped.cards.topMod.on', { vehicle: card.vehicle_name })}
        </CardLine>
      </View>
      {card.before_media && card.after_media ? (
        <BeforeAfterPair
          before={{ ...fields(card.before_media), label: tVehicle('update.before') }}
          after={{ ...fields(card.after_media), label: tVehicle('update.after') }}
          label={tVehicle('update.beforeAfter')}
          corner="sm"
          testID={`${testID}.pair`}
        />
      ) : single ? (
        <Photo {...fields(single)} aspect="4:5" corner="sm" label={`${singleLabel}: ${title}`} testID={`${testID}.photo`}>
          <View style={styles.badge} aria-hidden>
            <Text variant="labelBadge" color="onPhoto.primary" hyphenate={false} desktopSize={false}>
              {singleLabel}
            </Text>
          </View>
        </Photo>
      ) : null}
    </CardFrame>
  );
});
