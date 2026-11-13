import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useQrStats } from '@/api/queries/qr';
import { formatNumber } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space } from '@/theme';
import { Button, Icon, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';
import { RowDivider } from '@/ui/rowParts';
import { metaLineText } from '@/ui/textBreaks';

import { miniBarHeights, milestoneFor, type BarScale } from '../stats';

export const SCAN_STATS_FLAG = 'sig.qr_stats';

/** FS-9's mini bars: 32 high, a 2-pt stub for a day without scans, at least 4 for a day with one. */
const BAR_SCALE: BarScale = { max: space[32], empty: size.progress.height, min: space[4] };
const DAYS = 14;

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row', gap: t.space[12], paddingHorizontal: t.space[16], paddingVertical: t.space[12] },
  glyph: { paddingTop: t.space[2] },
  text: { flex: 1, gap: t.space[4], minWidth: 0 },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: t.space[2], height: t.space[32], marginVertical: t.space[4] },
  bar: { backgroundColor: t.color.text.secondary, borderRadius: t.radius.xs, flex: 1 },
  error: { alignItems: 'flex-start', gap: t.space[4] },
}));

type Props = { vehicleId: string; routeId: string };

/**
 * QR-02 [SIG `sig.qr_stats`]: the 14 days as mini bars in text.secondary, the counts and the milestone line, between
 * "Sticker-Platzierung" and "QR-Code ersetzen". The caller renders it only while the flag is on; a 404 (flag off on the server,
 * a vehicle that is not the member's) takes the row away together with its divider.
 */
export function ScanStats({ vehicleId, routeId }: Props) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const format = useFormat();
  const stats = useQrStats(vehicleId, true);
  const testID = `${routeId}.scans`;
  if (stats.error instanceof ApiError && stats.error.status === 404) return null;

  const number = (value: number) => formatNumber(value, format.locale);
  let body;
  if (stats.data) {
    const counts = stats.data.days.map((day) => day.count);
    const heights = miniBarHeights(counts, BAR_SCALE);
    const milestone = milestoneFor(stats.data.total, stats.data.milestones_reached);
    const milestoneText =
      milestone.reached === null
        ? t(stats.data.total === 0 ? 'stats.milestoneFirst' : 'stats.milestoneNext', { next: number(milestone.next ?? 0) })
        : milestone.next === null
          ? t('stats.milestoneLast', { reached: number(milestone.reached) })
          : t('stats.milestoneReached', { reached: number(milestone.reached), next: number(milestone.next) });
    // DQ-459: a designed zero state, not the counters filled with zeros; DQ-460: the line wraps at its "·", a number stays with its unit.
    const total = stats.data.total;
    const recent = stats.data.total_14_days;
    const summary =
      total === 0
        ? t('stats.summaryNone')
        : metaLineText(
            recent === 0 ? t('stats.summaryNoneRecent', { total: number(total) }) : t('stats.summary', { recent: number(recent), total: number(total) }),
          );
    const label =
      total === 0
        ? t('stats.labelNone', { milestone: milestoneText })
        : t('stats.label', { recent: number(recent), total: number(total), milestone: milestoneText });
    body = (
      <>
        <View
          style={styles.bars}
          role="img"
          aria-label={label}
          testID={`${testID}.bars`}
        >
          {heights.map((height, index) => (
            <View key={stats.data.days[index]?.date ?? index} style={[styles.bar, { height }]} />
          ))}
        </View>
        <Text variant="callout" color="text.secondary" testID={`${testID}.summary`}>
          {summary}
        </Text>
        <Text variant="caption" color="text.tertiary" testID={`${testID}.milestone`}>
          {milestoneText}
        </Text>
        <Text variant="caption" color="text.tertiary">
          {t('stats.privacy')}
        </Text>
      </>
    );
  } else if (stats.isError || stats.fetchStatus === 'paused') {
    body = (
      <View style={styles.error} role="alert" testID={`${testID}.error`}>
        <Text variant="callout" color="text.secondary">
          {t('stats.errorTitle')}
        </Text>
        <Button
          label={t('common.retry')}
          variant="tertiary"
          size="s"
          flush="start"
          loading={stats.isFetching}
          onPress={() => void stats.refetch()}
          testID={`${testID}.retry`}
        />
      </View>
    );
  } else {
    body = (
      <Skeleton testID={`${testID}.skeleton`}>
        <View style={styles.bars}>
          {Array.from({ length: DAYS }, (_, index) => (
            <SkeletonBlock key={index} height={BAR_SCALE.max} corner="xs" style={styles.bar} />
          ))}
        </View>
        <SkeletonText variant="callout" width="60%" />
        <SkeletonText variant="caption" width="45%" />
      </Skeleton>
    );
  }

  return (
    <View testID={testID}>
      <RowDivider inset={space[16]} />
      <View style={styles.row}>
        <View style={styles.glyph}>
          <Icon name="eye" size={20} color="text.secondary" />
        </View>
        <View style={styles.text}>
          <Text variant="body" role="heading" {...({ 'aria-level': 3 } as object)}>
            {t('stats.title')}
          </Text>
          {body}
        </View>
      </View>
    </View>
  );
}
