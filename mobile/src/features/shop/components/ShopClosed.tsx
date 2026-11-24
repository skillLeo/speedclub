import '@/features/shop/i18n';

import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useQaState } from '@/lib/qa';
import { useRequireAuth } from '@/state/session';
import { createStyles, size, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { Photo, type PhotoFields } from '@/ui/Photo';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

/** Where "Zu deinen Stickern" leads: the sticker hub STK-01 (M5.4). */
export const STICKERS_PATH = '/stickers';

/**
 * A licensed seed photo that no demo member's car uses (DQ-M52-13; design/seed-photos/manifest.json `generic-exterior-01`: an orange
 * GT86 with a windscreen sticker at night, plate blurred, `vehicle: null`), bundled so the page shows it without a network. Thumbhash
 * and focal point from the manifest.
 */
export const SHOP_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/generic-exterior-01.jpg') as number,
  thumbhash: 'CQgGDQLXqZB4WVaXaIWYlUaAUlAn',
  focal: { x: 0.5, y: 0.69 },
};

const useStyles = createStyles((t) => ({
  copy: { gap: t.space[8], paddingBottom: t.space[32], paddingTop: t.space[24] },
  action: { alignSelf: 'flex-start', marginTop: t.space[16] },
  // The copy's geometry (DQ-M52-07): its padding and gap, the button's 16 above it and the 32 below.
  skeleton: { gap: t.space[8], paddingBottom: t.space[32], paddingTop: t.space[24] },
  skeletonAction: { marginTop: t.space[16] },
}));

/**
 * The M5.2 shell of SHOP-01 (ADR-519), kept as the state while the flag `shop` is off: the tab is always there, and with the
 * catalogue switched off the page says plainly what the shop will be and where paying happens, over a night photo, with one way
 * on: the member's stickers. No sample product, no price, no count. SHOP-02 shows the same when a product link is opened while the
 * shop is off. Offline: the frame's banner; nothing here needs the network.
 */
export function ShopClosed({ routeId = 'SHOP-01' }: { routeId?: 'SHOP-01' | 'SHOP-02' | 'SHOP-03' }) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const qaState = useQaState();
  const { gutter, kind } = useBreakpoint();
  const phone = kind === 'phone';

  if (qaState === 'loading') {
    return (
      <Skeleton testID={`${routeId}.skeleton`}>
        <View style={phone ? null : { paddingHorizontal: gutter }}>
          <SkeletonBlock aspectRatio={16 / 9} corner={phone ? 'none' : 'md'} />
        </View>
        <View style={[styles.skeleton, { paddingHorizontal: gutter }]}>
          {/* The title takes two lines on a phone and one from 768, the body likewise; then the M button. */}
          <SkeletonText variant="title2" lines={phone ? 2 : 1} lastLineWidth={phone ? '45%' : '80%'} />
          <SkeletonText variant="body" lines={phone ? 2 : 1} />
          <SkeletonBlock height={size.button.m} width={phone ? '50%' : '30%'} corner="sm" style={styles.skeletonAction} />
        </View>
      </Skeleton>
    );
  }

  return (
    <View testID={`${routeId}.closed`}>
      {/* Photography is the interface (09 §4.6): edge to edge on a phone, in the column with radius 12 from 768. */}
      <View style={phone ? null : { paddingHorizontal: gutter }}>
        <Photo {...SHOP_PHOTO} aspect="16:9" corner={phone ? 'none' : 'md'} label={t('closed.photo')} testID={`${routeId}.photo`} />
      </View>
      <View style={[styles.copy, { paddingHorizontal: gutter }]}>
        <Text variant="title2" role="heading" aria-level={2} testID={`${routeId}.closed.title`}>
          {t('closed.title')}
        </Text>
        <Text variant="body" color="text.secondary" testID={`${routeId}.closed.body`}>
          {t('closed.body')}
        </Text>
        <Button
          label={t('closed.action')}
          variant="secondary"
          size="m"
          role="link"
          onPress={() => requireAuth(() => router.push(STICKERS_PATH), { returnTo: STICKERS_PATH })}
          style={styles.action}
          testID={`${routeId}.stickers`}
        />
      </View>
    </View>
  );
}
