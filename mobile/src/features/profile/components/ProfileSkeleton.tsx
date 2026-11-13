import { View } from 'react-native';

import { createStyles, size, useBreakpoint } from '@/theme';
import { Skeleton, SkeletonBlock, SkeletonText, VehicleCardSkeleton } from '@/ui';

import { PROFILE_COLUMN_MAX, profileCoverHeight, profileCoverWidth } from './ProfileHeader';

const useStyles = createStyles((t) => ({
  identity: { maxWidth: PROFILE_COLUMN_MAX, width: '100%' },
  avatar: { marginTop: t.space[8] },
  // As ProfileIdentity: the avatar overlaps the cover by half its height, inside the canvas ring.
  avatarOverlap: { alignSelf: 'flex-start', marginTop: -size.avatar.xl / 2 },
  ring: {
    backgroundColor: t.color.bg.canvas,
    borderRadius: t.radius.full,
    bottom: -t.space[2],
    left: -t.space[2],
    position: 'absolute',
    right: -t.space[2],
    top: -t.space[2],
  },
  names: { gap: t.space[2], marginTop: t.space[12] },
  bio: { marginTop: t.space[12] },
  stats: { marginTop: t.space[12] },
  actions: { flexDirection: 'row', gap: t.space[8], marginTop: t.space[16] },
  tabs: { flexDirection: 'row', gap: t.space[24], marginTop: t.space[24], minHeight: t.size.contentTab, alignItems: 'center' },
  card: { marginTop: t.space[16] },
}));

/**
 * The profile in the shape it will have (SM15): the cover when the member has one (DQ-122), the avatar, the name lines, two lines of
 * bio, the counts, the actions, the tab row and one garage card. Without a known cover it takes the shorter shape, so it is never
 * longer than what replaces it. `width` is the full width for the cover, `columnWidth` the column's for the card.
 */
export function ProfileSkeleton({
  width,
  columnWidth,
  withCover = false,
  variant = 'own',
  withMessage = false,
  routeId = 'PROF-01',
}: {
  width: number;
  columnWidth: number;
  withCover?: boolean;
  /** `member` (PROF-02): Folgen, Nachricht and more. */
  variant?: 'own' | 'member';
  /** PROF-02: Nachricht beside Folgen. */
  withMessage?: boolean;
  routeId?: string;
}) {
  const styles = useStyles();
  const { gutter, kind } = useBreakpoint();
  const column = { paddingHorizontal: gutter };
  const cardWidth = Math.max(0, columnWidth - 2 * gutter);
  return (
    <Skeleton testID={`${routeId}.skeleton`}>
      {withCover && width > 0 ? <SkeletonBlock width={profileCoverWidth(width, kind)} height={profileCoverHeight(width, kind)} testID={`${routeId}.skeleton.cover`} /> : null}
      <View style={[styles.identity, column]}>
        {withCover ? (
          <View style={styles.avatarOverlap}>
            <View style={styles.ring} />
            <SkeletonBlock width={size.avatar.xl} height={size.avatar.xl} corner="full" />
          </View>
        ) : (
          <SkeletonBlock width={size.avatar.xl} height={size.avatar.xl} corner="full" style={styles.avatar} />
        )}
        <View style={styles.names}>
          <SkeletonText variant="title1" width="55%" />
          <SkeletonText variant="callout" width="30%" />
          <SkeletonText variant="caption" width="55%" />
        </View>
        <SkeletonText variant="body" lines={2} style={styles.bio} />
        <SkeletonText variant="callout" width="70%" style={styles.stats} />
        {variant === 'own' ? (
          <View style={styles.actions}>
            <SkeletonBlock width="40%" height={size.button.m} corner="sm" />
            <SkeletonBlock width={size.iconButton} height={size.iconButton} corner="full" />
            <SkeletonBlock width={size.iconButton} height={size.iconButton} corner="full" />
          </View>
        ) : (
          <View style={styles.actions}>
            <SkeletonBlock width="25%" height={size.button.m} corner="sm" />
            {withMessage ? <SkeletonBlock width="30%" height={size.button.m} corner="sm" /> : null}
            <SkeletonBlock width={size.iconButton} height={size.iconButton} corner="full" />
          </View>
        )}
        <View style={styles.tabs}>
          <SkeletonText variant="bodyStrong" width="15%" />
          <SkeletonText variant="bodyStrong" width="15%" />
          {variant === 'own' ? <SkeletonText variant="bodyStrong" width="15%" /> : null}
        </View>
        {cardWidth > 0 ? (
          <View style={[styles.card, { width: cardWidth }]}>
            <VehicleCardSkeleton />
          </View>
        ) : null}
      </View>
    </Skeleton>
  );
}
