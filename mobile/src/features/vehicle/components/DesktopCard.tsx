import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useMyStickers } from '@/api/queries/stickers';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { CardArt, STAGE_RATIO } from '@/features/qr/components/StickerHubCard';
import { StickerStage } from '@/features/qr/components/StickerStage';
import { isWeb } from '@/lib/platform';
import { createStyles, size } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { PressableScale, type PressableVisualState } from '@/ui/PressableScale';
import { Text } from '@/ui/Text';
import { vehicleNameText } from '@/ui/textBreaks';

import { photoFields, variantUrl } from '../media';
import { ownerName } from '../model';

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[16], padding: t.space[24] },
  head: { gap: t.space[8] },
  chip: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: t.space[8], maxWidth: '100%', minHeight: t.size.touchMin },
  chipVisual: { alignItems: 'center', borderRadius: t.radius.full, flexDirection: 'row', gap: t.space[8], minHeight: t.size.touchMin },
  chipText: { flexShrink: 1 },
  hover: { backgroundColor: t.color.state.hover },
  // The member's sticker on its car's blurred cover, as STK-01's card (radius 12): 10 §0.2, the sticker is the platform's signature.
  sticker: { gap: t.space[8] },
  stage: { aspectRatio: STAGE_RATIO, borderRadius: t.radius.md },
  stickerVisual: { borderRadius: t.radius.md },
}));

export type DesktopCardProps = {
  vehicle: PublicVehicle;
  routeId: string;
  /** PROF-02 (or PROF-01); without it the owner chip is not a link (GAR-02). */
  onOpenOwner?: () => void;
  /** The SpecStrip and the actions (ProfileSummary `card`). */
  children: ReactNode;
  /** The card's inner width, for the sticker drawing. */
  width: number;
};

/**
 * DQ-M53-02 (10 §5 web desktop): the right sticky card from the top — the car's name (`display.wordmark`, so the car is named once the
 * hero has scrolled away), the owner chip, the SpecStrip and the actions, and for the owner the sticker itself (STK-01's drawing on
 * the car's blurred cover, to STK-02). A visitor's page carries no sticker drawing (the API sends it to the owner only).
 */
export function DesktopCard({ vehicle, routeId, onOpenOwner, children, width }: DesktopCardProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const owner = vehicle.owner;
  const stickers = useMyStickers();
  const sticker = vehicle.is_owner ? stickers.data?.find((card) => card.vehicle.id === vehicle.id) : undefined;

  const chipContent = owner ? (
    <>
      <Avatar name={ownerName(owner)} uri={variantUrl(owner.avatar, size.avatar.sm)} blurhash={owner.avatar?.blurhash} size={size.avatar.sm} decorative />
      <Text variant="callout" numberOfLines={1} hyphenate={false} style={styles.chipText}>
        {owner.username ? `@${owner.username}` : ownerName(owner)}
      </Text>
    </>
  ) : null;

  return (
    <View style={styles.card} testID={`${routeId}.card`}>
      <View style={styles.head}>
        {/* The name the hero carried, as a car speaks (Archivo SemiExpanded); the h1 stays on the hero. */}
        <Text variant="displayWordmark" hyphenate={false} testID={`${routeId}.card.name`}>
          {vehicleNameText(vehicle.title)}
        </Text>
        {owner && chipContent ? (
          // The owner row lives here from 1280 (the hero leaves it out), with the IDs the flows and the parity test know.
          <View style={styles.chip} testID={`${routeId}.ownerRow`}>
            {onOpenOwner ? (
              <PressableScale
                role="link"
                aria-label={isWeb ? undefined : t('owner.open', { name: ownerName(owner) })}
                onPress={onOpenOwner}
                contentStyle={(state: PressableVisualState) => [styles.chipVisual, state.hovered ? styles.hover : null]}
                testID={`${routeId}.ownerRow.identity`}
              >
                {chipContent}
              </PressableScale>
            ) : (
              chipContent
            )}
          </View>
        ) : null}
      </View>
      {children}
      {sticker && vehicle.qr ? (
        <View style={styles.sticker}>
          <PressableScale
            role="link"
            aria-label={t('card.stickerOpen', { code: vehicle.qr.code })}
            onPress={() => router.push(`/stickers/${vehicle.id}`)}
            contentStyle={styles.stickerVisual}
            testID={`${routeId}.card.sticker`}
          >
            <StickerStage cover={photoFields(vehicle.cover, Math.round(width))} style={styles.stage} testID={`${routeId}.card.stickerStage`}>
              <CardArt card={sticker} width={width} label={t('card.stickerArt', { code: vehicle.qr.code })} testID={`${routeId}.card.sticker`} />
            </StickerStage>
          </PressableScale>
          <Text variant="caption" color="text.secondary" numeric testID={`${routeId}.card.stickerCode`}>
            {t('card.stickerCaption', { code: vehicle.qr.code })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
