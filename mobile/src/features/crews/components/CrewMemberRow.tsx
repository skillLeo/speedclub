import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { avatarUrlOf } from '@/api/queries/auth';
import type { CrewMember } from '@/api/queries/crews';
import { vehicleCardProps } from '@/features/profile/media';
import { createStyles, size } from '@/theme';
import { GridTile } from '@/ui/GridTile';
import { IconButton } from '@/ui/IconButton';
import { MemberRow } from '@/ui/MemberRow';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';

import { roleLabel } from '../model';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8], paddingBottom: t.space[12] },
  cars: { flexDirection: 'row', gap: t.space[12] },
  car: { width: size.railCard },
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single },
  skeletonText: { flex: 1, gap: t.space[4] },
}));

export type CrewMemberRowProps = {
  row: CrewMember;
  /** "Du" after the role on the viewer's own row. */
  selfLabel?: string;
  onOpenMember: (username: string) => void;
  onOpenVehicle: (slug: string) => void;
  /** CREW-03: the row's "…" with remove / promote / demote / hand over (manage mode only). */
  onManage?: () => void;
  /** CREW-03 (R4DQ-20): the dense row alone, without the member's builds; the car rails belong to CREW-01. */
  compact?: boolean;
  /** A sample crew carries "Beispiel" once, on the crew: its member rows and cars inherit it (R4DQ-31). */
  inheritSample?: boolean;
  testID: string;
};

/**
 * One member of CREW-01: avatar, name, "@lukas.sc · Gründer" and up to three of their public, published builds (contract §2
 * `vehicles`, main first) as 4:3 tiles in a row that scrolls sideways.
 */
export const CrewMemberRow = memo(function CrewMemberRow({
  row,
  selfLabel,
  onOpenMember,
  onOpenVehicle,
  onManage,
  compact = false,
  inheritSample = false,
  testID,
}: CrewMemberRowProps) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  const { member } = row;
  const username = member.username ?? '';
  const name = member.display_name || `@${username}`;
  const meta = [member.display_name ? `@${username}` : null, roleLabel(t, row.role), row.is_self ? selfLabel : null].filter(Boolean).join(' · ');
  return (
    <View style={compact ? null : styles.root} testID={testID}>
      <MemberRow
        name={name}
        meta={meta}
        avatarUri={avatarUrlOf(member.avatar)}
        avatarBlurhash={member.avatar?.blurhash}
        sample={inheritSample ? undefined : member}
        inset={0}
        onPress={username ? () => onOpenMember(username) : undefined}
        trailing={
          onManage ? (
            <IconButton icon="dots-three" label={t('manage.memberActions', { name })} onPress={onManage} testID={`${testID}.actions`} />
          ) : undefined
        }
        testID={`${testID}.member`}
      />
      {!compact && row.vehicles.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cars} testID={`${testID}.cars`}>
          {row.vehicles.map((vehicle) => {
            const card = vehicleCardProps(vehicle, size.railCard);
            return (
              <GridTile
                key={vehicle.id}
                title={card.title}
                spec={(card.specs ?? []).slice(0, 2).join(' · ') || undefined}
                photo={card.photo}
                sample={inheritSample ? undefined : vehicle}
                onPress={() => onOpenVehicle(vehicle.slug)}
                style={styles.car}
                testID={`${testID}.car.${vehicle.slug}`}
              />
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
});

/** The member list while it loads: avatar and two lines per row. */
export function CrewMembersSkeleton({ rows = 3, testID }: { rows?: number; testID?: string }) {
  const styles = useStyles();
  return (
    <Skeleton testID={testID}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.root}>
          <View style={styles.skeletonRow}>
            <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
            <View style={styles.skeletonText}>
              <SkeletonText variant="bodyStrong" width="45%" />
              <SkeletonText variant="callout" width="30%" />
            </View>
          </View>
        </View>
      ))}
    </Skeleton>
  );
}
