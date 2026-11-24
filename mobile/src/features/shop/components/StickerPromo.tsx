import '@/features/shop/i18n';

import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useMyVehicles } from '@/api/queries/profile';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/icons/Icon';
import { Text } from '@/ui/Text';

import { STICKERS_PATH } from './ShopClosed';

/** R4-3.2: what the sticker does, in this order, each with its glyph (copy in `shop.promo.points`). */
export const STICKER_POINTS: readonly { key: string; icon: IconName }[] = [
  { key: 'page', icon: 'qr-sticker' },
  { key: 'meets', icon: 'meet' },
  { key: 'control', icon: 'eye-slash' },
  { key: 'insights', icon: 'chart-bar' },
  { key: 'design', icon: 'pencil-simple' },
];

const useStyles = createStyles((t) => ({
  // One tile on the page's surface (radius 12, no border, no shadow): the copy, the points as a list, the order button.
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[16], padding: t.space[16] },
  head: { gap: t.space[4] },
  points: { gap: t.space[12] },
  point: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12] },
  pointText: { flex: 1, minWidth: 0 },
  action: { alignSelf: 'flex-start' },
}));

/**
 * "Dein Sticker" on SHOP-01 (10 §3, R4-3.2): what the QR sticker does and why — it opens the car's build page, people at a meet scan
 * instead of asking, the member decides what the page shows (never a plate), scans show up in the member's own insights, one sticker
 * per car with its design made in the app — and one way to order: the designer STK-05 of the member's main car (else the first;
 * DQ-P5-032), or the sticker hub STK-01 without a car. A guest signs in first. No claim about the material.
 * R4DQ-13: under SHOP-01's hero, which already says "Dein Build. Dein Sticker.", the block has no headline of its own (`titled`
 * false) and leads with its explanation.
 */
export function StickerPromo({ titled = true, style, testID }: { titled?: boolean; style?: StyleProp<ViewStyle>; testID: string }) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const member = useSessionStore((state) => state.status === 'member');
  const vehicles = useMyVehicles();
  const car = member ? ((vehicles.data ?? []).find((vehicle) => vehicle.is_main) ?? vehicles.data?.[0]) : undefined;
  const target = car ? (`/stickers/${car.id}/design` as Href) : STICKERS_PATH;
  return (
    <View style={[styles.card, style]} testID={testID}>
      <View style={styles.head}>
        {titled ? (
          <Text variant="title2" role="heading" aria-level={2} testID={`${testID}.title`}>
            {t('promo.title')}
          </Text>
        ) : null}
        <Text variant={titled ? 'body' : 'headline'} color={titled ? 'text.secondary' : 'text.primary'} testID={`${testID}.body`}>
          {t('promo.lead')}
        </Text>
      </View>
      <View role="list" style={styles.points} testID={`${testID}.points`}>
        {STICKER_POINTS.map((point) => (
          <View key={point.key} role="listitem" style={styles.point} testID={`${testID}.point.${point.key}`}>
            <Icon name={point.icon} size={20} color="text.secondary" />
            <Text variant="callout" style={styles.pointText}>
              {t(`promo.points.${point.key}`)}
            </Text>
          </View>
        ))}
      </View>
      <Button
        label={t('promo.order')}
        variant="primary"
        size="m"
        onPress={() => requireAuth(() => router.push(target), { returnTo: STICKERS_PATH })}
        style={styles.action}
        testID={`${testID}.order`}
      />
    </View>
  );
}
