import { View } from 'react-native';

import { createStyles, layout, size, useBreakpoint } from '@/theme';
import { Skeleton, SkeletonBlock, SkeletonText, VehicleCardSkeleton } from '@/ui';

import { stripCardWidth } from './GarageStrip';

/** PROF-01's own rows: Meine QR-Codes, Einstellungen, Fahrzeug hinzufügen, and Gespeichert with its flag (DQ-273). */
const ROWS = 3;

const useStyles = createStyles((t) => ({
  identity: { maxWidth: layout.feedColumn + 2 * layout.gutter.desktop, width: '100%' },
  avatar: { marginTop: t.space[8] },
  // FS-8 with a cover: the avatar overlaps it by 32, as in ProfileHeader.
  avatarOverlap: { alignSelf: 'flex-start', marginTop: -t.space[32] },
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
  stats: { marginTop: t.space[12] },
  bio: { marginTop: t.space[12] },
  actions: { flexDirection: 'row', gap: t.space[8], marginTop: t.space[16] },
  section: { marginTop: t.space[32] },
  card: { marginTop: t.space[12] },
  rows: { marginTop: t.space[32] },
}));

/**
 * The profile in the shape it will have (§8): with the cover when the member has one (DQ-122), avatar, name lines, stats,
 * two lines of bio, the actions, one garage card and the rows. Without a known cover it takes the shorter shape, so it is
 * never longer than what replaces it. `width` is the full width for the cover, `columnWidth` the column's for the card.
 */
export function ProfileSkeleton({
  width,
  columnWidth,
  withCover = false,
  variant = 'own',
  withMessage = false,
  rows = ROWS,
  routeId = 'PROF-01',
}: {
  width: number;
  columnWidth: number;
  withCover?: boolean;
  /** `member` (PROF-02): Folgen, Nachricht and more, and no rows of your own. */
  variant?: 'own' | 'member';
  /** PROF-02 for a guest: Nachricht beside Folgen (members get it with M2.4, DQ-265). */
  withMessage?: boolean;
  /** How many own rows PROF-01 shows. */
  rows?: number;
  routeId?: string;
}) {
  const styles = useStyles();
  const { gutter, kind } = useBreakpoint();
  const cardWidth = stripCardWidth(columnWidth, gutter, kind);
  const column = { paddingHorizontal: gutter };
  return (
    <Skeleton testID={`${routeId}.skeleton`}>
      {withCover && width > 0 ? <SkeletonBlock width={width} aspectRatio={3} testID={`${routeId}.skeleton.cover`} /> : null}
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
          <SkeletonText variant="titleM" width="50%" />
          <SkeletonText variant="supporting" width="30%" />
          <SkeletonText variant="caption" width="55%" />
        </View>
        <SkeletonText variant="bodyStrong" width="70%" style={styles.stats} />
        <SkeletonText variant="body" lines={2} style={styles.bio} />
        {variant === 'own' ? (
          <View style={styles.actions}>
            <SkeletonBlock width="40%" height={size.button.m} corner="sm" />
            <SkeletonBlock width={size.iconButton} height={size.iconButton} corner="sm" />
            <SkeletonBlock width={size.iconButton} height={size.iconButton} corner="sm" />
          </View>
        ) : (
          <View style={styles.actions}>
            <SkeletonBlock width="25%" height={size.button.m} corner="sm" />
            {withMessage ? <SkeletonBlock width="30%" height={size.button.m} corner="sm" /> : null}
            <SkeletonBlock width={size.iconButton} height={size.iconButton} corner="sm" />
          </View>
        )}
      </View>
      <View style={[styles.section, styles.identity, column]}>
        <SkeletonText variant="titleS" width="25%" />
        {cardWidth > 0 ? (
          <View style={[styles.card, { width: cardWidth }]}>
            <VehicleCardSkeleton />
          </View>
        ) : null}
      </View>
      {variant === 'own' ? (
        <View style={[styles.rows, styles.identity, column]}>
          <SkeletonBlock height={size.row.single * rows} corner="md" />
        </View>
      ) : null}
    </Skeleton>
  );
}
