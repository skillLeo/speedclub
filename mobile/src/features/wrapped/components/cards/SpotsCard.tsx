import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { WrappedPayload, WrappedSpotsCard } from '@/api/queries/wrapped';
import { dexNumberText } from '@/features/dex/copy';
import { useFormat } from '@/lib/useFormat';
import { concentric, createStyles, space } from '@/theme';
import { DisplayTitle } from '@/ui/DisplayTitle';
import { Hairline } from '@/ui/Hairline';
import { Text } from '@/ui/Text';

import { CARD_FONT_SCALE_CAP, CardFrame, CardLine, Numeral, useListText } from './parts';

const useStyles = createStyles((t) => ({
  // The rarity frame as on the Dex cards: Legend and Rare in a 2-wide white outline, Ghost doubled, Street and Tuned a hairline.
  find: { borderColor: t.color.onPhoto.border, borderRadius: t.radius.md, borderWidth: t.size.border.control, gap: t.space[8], padding: t.space[16] },
  findStrong: { borderColor: t.color.onPhoto.primary, borderWidth: t.size.border.focusRing },
  ghostInner: {
    borderColor: t.color.onPhoto.border,
    borderRadius: concentric(t.radius.md, t.space[4]),
    borderWidth: t.size.border.control,
    bottom: t.space[4],
    left: t.space[4],
    pointerEvents: 'none',
    position: 'absolute',
    right: t.space[4],
    top: t.space[4],
  },
  findTop: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], justifyContent: 'space-between' },
  tag: { backgroundColor: t.color.onPhoto.chipBg, borderRadius: t.radius.xs, justifyContent: 'center', minHeight: t.size.statusPill, paddingHorizontal: t.space[8] },
  lines: { gap: t.space[4] },
}));

export type SpotsCardProps = { card: WrappedSpotsCard; payload: WrappedPayload; width: number; height: number; testID: string };

/** Card 2: how many cars the member spotted, in which cities (names only), and the rarest find with its Dex number and frame. */
export const SpotsCard = forwardRef<ComponentRef<typeof View>, SpotsCardProps>(function SpotsCard({ card, payload, width, height, testID }, ref) {
  const { t } = useTranslation('profile');
  const { t: tDex } = useTranslation('dex');
  const styles = useStyles();
  const format = useFormat();
  const list = useListText();
  const rarest = card.rarest;
  const number = rarest ? dexNumberText(rarest.dex_number) : null;
  const strong = rarest?.rarity === 'legend' || rarest?.rarity === 'rare' || rarest?.rarity === 'ghost';
  return (
    <CardFrame ref={ref} width={width} height={height} eyebrow={t('wrapped.cards.spots.eyebrow')} sample={payload.is_sample === true} testID={testID}>
      <Numeral value={format.number(card.count)} unit={t('wrapped.cards.spots.unit', { count: card.count })} testID={`${testID}.count`} />
      <View style={styles.lines}>
        {card.unique_cars > 0 ? (
          <CardLine numeric testID={`${testID}.cars`}>
            {t('wrapped.cards.spots.cars', { count: card.unique_cars, value: format.number(card.unique_cars) })}
          </CardLine>
        ) : null}
        {card.cities.length > 0 ? (
          <CardLine variant="callout" tone="secondary" testID={`${testID}.cities`}>
            {t('wrapped.cards.spots.cities', { cities: list(card.cities) })}
          </CardLine>
        ) : null}
      </View>
      {rarest ? (
        <>
          <Hairline />
          <View
            style={[styles.find, strong ? styles.findStrong : null]}
            accessible
            aria-label={t('wrapped.cards.spots.rarestA11y', { name: rarest.vehicle_name, number: number ?? '', tier: tDex(`rarity.${rarest.rarity}`) })}
            testID={`${testID}.rarest.${rarest.rarity}`}
          >
            <View style={styles.findTop}>
              <Text variant="labelCaps" color="onPhoto.secondary" hyphenate={false} desktopSize={false} fontScaleCap={CARD_FONT_SCALE_CAP}>
                {t('wrapped.cards.spots.rarest')}
              </Text>
              <View style={styles.tag}>
                <Text variant="labelBadge" color="onPhoto.primary" hyphenate={false} desktopSize={false}>
                  {tDex(`rarity.${rarest.rarity}`)}
                </Text>
              </View>
            </View>
            {number ? <Numeral value={t('wrapped.cards.spots.dexNumber', { number })} small testID={`${testID}.dexNumber`} /> : null}
            <DisplayTitle placement="card" layoutWidth={width - 2 * space[24] - 2 * space[16]} color="onPhoto.primary" fontScaleCap={CARD_FONT_SCALE_CAP}>
              {rarest.vehicle_name}
            </DisplayTitle>
            {rarest.rarity === 'ghost' ? <View style={styles.ghostInner} /> : null}
          </View>
        </>
      ) : null}
    </CardFrame>
  );
});
