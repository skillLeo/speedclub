import '@/features/parts/i18n';

import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { BuildWallSkeleton, wallCellWidth, wallRows, WallRow, WALL_GAP } from '@/features/discover/components/BuildWall';
import { createStyles } from '@/theme';
import { SampleWall } from '@/features/discover/components/SampleWall';
import { Button, EmptyState, SectionHeader, Skeleton, SkeletonText, Text } from '@/ui';

import { useGarageEntry } from './useGarageEntry';

const useStyles = createStyles((t) => ({
  header: { gap: t.space[2], paddingBottom: t.space[12] },
  rows: { gap: WALL_GAP },
  more: { alignSelf: 'flex-start', marginTop: t.space[16] },
}));

export type BuildsWallProps = {
  /** "Builds mit KW", "Builds aus unserer Werkstatt". */
  title: string;
  /** The real count beside the title ("1.204 Builds"), or nothing. */
  count?: string | null;
  vehicles: readonly FeedVehicle[];
  /** The wall's width: the screen on a phone (edge to edge), the content column from 768. */
  width: number;
  columns: number;
  /** The first page is on its way: the wall's geometry as a skeleton. */
  loading: boolean;
  /** Another cursor page exists. */
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** The phone's negative margin, so the wall runs to the screen edges (09 §4.6). */
  bleed?: number;
  /** Shown instead of the wall when there is none (an EmptyState with a sample preview). */
  empty?: ReactNode;
  testID: string;
};

/**
 * "Builds mit {Marke}" (BRD-01), "Builds mit {Produkt}" (BRD-02) and "Builds aus unserer Werkstatt" (BIZ-01): 09 §5 result wall, 1:1
 * tiles 2 apart without radius, whole rows of 2 / 3 / 4 by width, then "Weitere Builds" for the next cursor page.
 */
export function BuildsWall({ title, count, vehicles, width, columns, loading, hasMore, loadingMore, onMore, bleed = 0, empty, testID }: BuildsWallProps) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const open = useCallback((vehicle: FeedVehicle) => router.push(`/v/${vehicle.slug}`), [router]);
  const cell = wallCellWidth(width, columns);
  // DQ-1038: whole rows only while more pages follow; the last page shows what is left.
  const shown = useMemo(() => (hasMore ? vehicles.slice(0, vehicles.length - (vehicles.length % columns)) : vehicles), [columns, hasMore, vehicles]);
  const bleedStyle = bleed > 0 ? { marginHorizontal: -bleed } : null;

  if (loading) {
    return (
      <Skeleton testID={`${testID}.skeleton`}>
        <SkeletonText variant="headline" width="45%" style={styles.header} />
        <View style={bleedStyle}>
          <BuildWallSkeleton width={width} columns={columns} count={columns * 2} />
        </View>
      </Skeleton>
    );
  }
  return (
    <View testID={testID}>
      <View style={styles.header}>
        <SectionHeader title={title} testID={`${testID}.header`} />
        {count ? (
          <Text variant="callout" color="text.secondary" numeric testID={`${testID}.count`}>
            {count}
          </Text>
        ) : null}
      </View>
      {shown.length === 0 && empty ? (
        empty
      ) : (
        <View style={[styles.rows, bleedStyle]}>
          {wallRows(shown, columns).map((row) => (
            <WallRow key={row[0]?.id} vehicles={row} cell={cell} onOpen={open} testID={`${testID}.build`} />
          ))}
        </View>
      )}
      {hasMore ? (
        <Button
          label={t('builds.more')}
          variant="secondary"
          size="m"
          loading={loadingMore}
          onPress={onMore}
          style={styles.more}
          testID={`${testID}.more`}
        />
      ) : null}
    </View>
  );
}

/**
 * A wall with no build yet (09 §5 EmptyState: a badged sample preview, one line, one action): "Fährst du {Teil}?" opens the garage,
 * where the part is entered. A failed first page offers to load it again instead.
 */
export function BuildsEmpty({ routeId, name, failed, onRetry }: { routeId: string; name: string; failed: boolean; onRetry: () => void }) {
  const { t } = useTranslation('parts');
  const garage = useGarageEntry();
  return (
    <EmptyState
      preview={failed ? undefined : <SampleWall testID={`${routeId}.builds.empty.sample`} />}
      icon={failed ? 'wheel' : undefined}
      title={failed ? t('builds.errorTitle') : t('builds.emptyTitle', { name })}
      body={failed ? t('states.errorBody') : t('builds.emptyBody', { name })}
      action={
        failed
          ? { label: t('states.retry'), onPress: onRetry, variant: 'secondary', size: 'm' }
          : { label: t('builds.toGarage'), onPress: garage, variant: 'secondary', size: 'm' }
      }
      testID={`${routeId}.builds.empty`}
    />
  );
}
