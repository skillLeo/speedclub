import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { photoFields, variantUrl } from '@/features/profile/media';
import { createStyles, size, useBreakpoint } from '@/theme';
import { IconButton, MediaCard, SkeletonBlock } from '@/ui';
import { leadAspect, mediaHeight } from '@/ui/mediaCardLayout';
import { SaveToggle } from '@/ui/motion/kit';

import { useFeedCardActions } from '../feedActions';
import { railSpec } from './NewInGarageRail';

/**
 * DQ-1024: the height a lead row needs at least: its whole photo. The identity reaches up into the photo by a share of the width,
 * so on a wide column (tablet, 640) a short identity ends inside the photo, and the next row was drawn over its lower part. The row
 * reserves the photo and grows with an identity that runs below it.
 */
export function leadMinHeight(width: number, desktop: boolean, wide = false): number {
  return width > 0 ? Math.ceil(mediaHeight(width, leadAspect(desktop || wide))) : 0;
}

const useStyles = createStyles((t) => ({
  // As the feed card's action row (MediaCard `feed`): 44 targets, 4 apart, 8 from the edge.
  actions: { alignItems: 'center', flexDirection: 'row', gap: t.space[4], paddingHorizontal: t.space[8] },
}));

export type HomeLeadProps = {
  vehicle: FeedVehicle;
  width: number;
  /** "Build der Woche": 16:9 at every width, with its one-line owner quote under the card (DQ-1032). */
  wide?: boolean;
  onOpen: (vehicle: FeedVehicle) => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

/**
 * 09 §7.3 lead (MediaCard `lead`) in a row that never ends inside its photo, with save · share (DQ-1025) in an action row under it.
 * M4.8 r2: a save over the photo sat inside the card's open target (two targets on one spot, DOM audit `overlap`), so it takes the
 * feed card's action row instead; the MediaCard `lead` save over `scrim.top` needs an open target that leaves that corner free.
 */
export const HomeLead = memo(function HomeLead({
  vehicle,
  width,
  wide = false,
  onOpen,
  style,
  testID,
}: HomeLeadProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const { kind } = useBreakpoint();
  const { save, onShare, sheet } = useFeedCardActions({
    vehicle,
    routeId: testID.split('.')[0] ?? 'HOME-01',
  });
  return (
    <View style={style}>
      <View style={{ minHeight: leadMinHeight(width, kind === 'desktop', wide) }}>
        <MediaCard
          variant="lead"
          wide={wide}
          title={vehicle.full_title}
          photo={photoFields(vehicle.cover, width)}
          spec={railSpec(vehicle)}
          owner={
            vehicle.owner
              ? {
                  username: vehicle.owner.username,
                  avatarUri: variantUrl(vehicle.owner.avatar, size.avatar.sm),
                  avatarBlurhash: vehicle.owner.avatar?.blurhash ?? null,
                }
              : undefined
          }
          sample={{ is_sample: vehicle.is_sample, is_editorial: vehicle.owner?.is_editorial ?? false }}
          layoutWidth={width}
          onPress={() => onOpen(vehicle)}
          testID={testID}
        />
      </View>
      {save || onShare ? (
        <View style={styles.actions} testID={`${testID}.actions`}>
          {save ? (
            <SaveToggle
              saved={save.saved}
              onToggle={save.onToggle}
              saveLabel={t('actions.save')}
              itemKey={vehicle.id}
              testID={`${testID}.save`}
            />
          ) : null}
          {onShare ? (
            <IconButton
              icon="share-network"
              label={t('actions.share')}
              onPress={onShare}
              testID={`${testID}.share`}
            />
          ) : null}
        </View>
      ) : null}
      {sheet}
    </View>
  );
});

/** The lead's action row while Start loads: two 44 targets, as the loaded row. */
export function HomeLeadActionsSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.actions}>
      <SkeletonBlock width={size.touchMin} height={size.touchMin} corner="full" />
      <SkeletonBlock width={size.touchMin} height={size.touchMin} corner="full" />
    </View>
  );
}
