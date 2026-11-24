import '../qaStickers';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { ApiError } from '@/api/client';
import { useMyStickers, useStickerStats, type StickerStats } from '@/api/queries/stickers';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, space, useBreakpoint, useTheme } from '@/theme';
import { SampleBadge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { ListRow } from '@/ui/ListRow';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { QrColumns, QrRowGroup, QrSignInState, QrState } from '../components/parts';
import { QrPage } from '../components/QrPage';
import { milestoneFor } from '../stats';

const ROUTE = 'STK-04';
const CHART_HEIGHT = space[64];

const useStyles = createStyles((t) => ({
  hero: { gap: t.space[4] },
  heroRow: { alignItems: 'flex-end', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap' },
  weeks: {
    columnGap: t.space[32],
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: t.space[24],
    rowGap: t.space[16],
  },
  week: { gap: t.space[4] },
  chart: { gap: t.space[8], marginTop: t.space[32] },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  group: { marginTop: t.space[32] },
  privacy: { marginTop: t.space[16] },
  badge: { alignSelf: 'flex-start', marginBottom: t.space[12] },
  zeroBody: { marginTop: t.space[8] },
  groupBeside: { marginTop: t.space[0] },
  zeroAction: { alignSelf: 'flex-start', marginTop: t.space[24] },
}));

/** The 30-day line, scaled to the busiest day; a series without scans is a flat line on the floor. */
export function sparkPath(
  counts: readonly number[],
  width: number,
  height: number,
  inset: number,
): { d: string; last: { x: number; y: number } } {
  const top = Math.max(1, ...counts);
  const step = counts.length > 1 ? (width - 2 * inset) / (counts.length - 1) : 0;
  const points = counts.map((count, index) => ({
    x: inset + index * step,
    y: inset + (height - 2 * inset) * (1 - Math.max(0, count) / top),
  }));
  const d = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  return { d, last: points.at(-1) ?? { x: inset, y: height - inset } };
}

function Sparkline({ stats, label, ghost = false }: { stats: StickerStats; label: string; ghost?: boolean }) {
  const styles = useStyles();
  const theme = useTheme();
  const format = useFormat();
  const [width, setWidth] = useState(0);
  const counts = stats.days.map((day) => day.count);
  const inset = size.progress.height * 2;
  const line = width > 0 ? sparkPath(counts, width, CHART_HEIGHT, inset) : null;
  const first = stats.days[0]?.date;
  const last = stats.days.at(-1)?.date;
  const day = (iso: string | undefined) => (iso ? format.dayMonth(new Date(`${iso}T12:00:00`)) : '');
  return (
    <View style={styles.chart} testID={`${ROUTE}.chart`}>
      <View
        role="img"
        aria-label={label}
        style={{ height: CHART_HEIGHT }}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      >
        {line ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Line
              x1={0}
              y1={CHART_HEIGHT - inset}
              x2={width}
              y2={CHART_HEIGHT - inset}
              stroke={theme.color.border.default}
              strokeWidth={1}
            />
            {/* DQ-M54-12: a month without scans is a ghost line on the floor, no end dot. */}
            {ghost ? null : (
              <>
                <Path
                  d={line.d}
                  stroke={theme.color.text.primary}
                  strokeWidth={size.progress.height}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <Circle
                  cx={line.last.x}
                  cy={line.last.y}
                  r={size.progress.height * 1.5}
                  fill={theme.color.text.primary}
                />
              </>
            )}
          </Svg>
        ) : null}
      </View>
      <View style={styles.axis} aria-hidden>
        <Text variant="caption" numeric color="text.tertiary">
          {day(first)}
        </Text>
        <Text variant="caption" numeric color="text.tertiary">
          {day(last)}
        </Text>
      </View>
    </View>
  );
}

function StatsSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <SkeletonText variant="labelCaps" width="35%" />
      <SkeletonText variant="heroNumeral" width="30%" />
      <View style={styles.weeks}>
        <SkeletonText variant="heroNumeralS" width={space[80]} />
        <SkeletonText variant="heroNumeralS" width={space[80]} />
      </View>
      <View style={styles.chart}>
        <SkeletonBlock height={CHART_HEIGHT} corner="sm" />
      </View>
      <View style={styles.group}>
        <SkeletonBlock height={size.row.single * 3} corner="md" />
      </View>
    </Skeleton>
  );
}

function StatsBody({ stats, vehicleId }: { stats: StickerStats; vehicleId: string }) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const { kind } = useBreakpoint();
  const router = useRouter();
  const format = useFormat();
  const n = (value: number) => format.number(value);
  const milestone = milestoneFor(stats.total, stats.milestones_reached);
  const busiest = Math.max(0, ...stats.days.map((day) => day.count));
  const chartLabel =
    stats.total_30_days === 0
      ? t('stickerStats.chartNone')
      : t('stickerStats.chartLabel', {
          count: stats.total_30_days,
          total: n(stats.total_30_days),
          busiest: n(busiest),
        });

  const firstScanRow = (
    <ListRow
      title={t('stickerStats.firstScan')}
      value={
        stats.first_scan_on
          ? format.longDate(new Date(`${stats.first_scan_on}T12:00:00`))
          : t('stickerStats.noScanYet')
      }
      adaptiveValue
      inset={space[16]}
      divider
      testID={`${ROUTE}.firstScan`}
    />
  );
  const milestoneRow = (
    <ListRow
      title={t('stickerStats.milestones')}
      value={
        milestone.reached === null
          ? t('stats.milestoneFirst', { next: n(milestone.next ?? 0) })
          : stats.milestones_reached.map(n).join(' · ')
      }
      adaptiveValue
      inset={space[16]}
      testID={`${ROUTE}.milestones`}
    />
  );

  if (stats.total === 0) {
    // DQ-M54-12: the first state is a sentence and one way on, never the counters filled with zeros.
    return (
      <View testID={`${ROUTE}.empty`}>
        <Text variant="title2" role="heading" aria-level={2} testID={`${ROUTE}.zeroTitle`}>
          {t('stickerStats.zeroTitle')}
        </Text>
        <Text variant="body" color="text.secondary" style={styles.zeroBody}>
          {t('stickerStats.emptyBody')}
        </Text>
        <Sparkline stats={stats} label={chartLabel} ghost />
        <Button
          label={t('hub.design')}
          variant="secondary"
          size="m"
          style={styles.zeroAction}
          onPress={() => router.push({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId } })}
          testID={`${ROUTE}.design`}
        />
        <QrRowGroup style={styles.group} testID={`${ROUTE}.sources`}>
          {firstScanRow}
          {milestoneRow}
        </QrRowGroup>
        <Hairline style={styles.privacy} />
        <Text variant="caption" color="text.tertiary" style={styles.privacy}>
          {t('stats.privacy')}
        </Text>
      </View>
    );
  }

  return (
    <QrColumns
      testID={`${ROUTE}.columns`}
      main={
        <>
          {stats.sample ? <SampleBadge style={styles.badge} testID={`${ROUTE}.sample`} /> : null}
          <View style={styles.hero}>
            <Text variant="labelCaps" color="text.secondary">
              {t('stickerStats.total')}
            </Text>
            <Text variant="heroNumeral" numeric testID={`${ROUTE}.total`}>
              {n(stats.total)}
            </Text>
          </View>
          <View style={styles.weeks}>
            <View style={styles.week}>
              <Text variant="labelCaps" color="text.secondary">
                {t('stickerStats.thisWeek')}
              </Text>
              <Text variant="heroNumeralS" numeric testID={`${ROUTE}.thisWeek`}>
                {n(stats.this_week)}
              </Text>
            </View>
            <View style={styles.week}>
              <Text variant="labelCaps" color="text.secondary">
                {t('stickerStats.lastWeek')}
              </Text>
              <Text variant="heroNumeralS" numeric color="text.secondary" testID={`${ROUTE}.lastWeek`}>
                {n(stats.last_week)}
              </Text>
            </View>
          </View>
          <View style={styles.chart}>
            <Text variant="calloutStrong" color="text.secondary" role="heading" aria-level={2}>
              {t('stickerStats.days', { total: n(stats.total_30_days) })}
            </Text>
          </View>
          <Sparkline stats={stats} label={chartLabel} />
        </>
      }
      side={
        <>
          <QrRowGroup
            style={[styles.group, kind === 'desktop' ? styles.groupBeside : null]}
            testID={`${ROUTE}.sources`}
          >
            <ListRow
              title={t('stickerStats.sourceSticker')}
              value={n(stats.sources.sticker_scan)}
              inset={space[16]}
              divider
              testID={`${ROUTE}.source.sticker`}
            />
            <ListRow
              title={t('stickerStats.sourceLink')}
              subtitle={stats.sources.link === null ? t('stickerStats.sourceLinkPending') : undefined}
              value={stats.sources.link === null ? t('stickerStats.notCounted') : n(stats.sources.link)}
              adaptiveValue
              inset={space[16]}
              divider
              testID={`${ROUTE}.source.link`}
            />
            {firstScanRow}
            {milestoneRow}
          </QrRowGroup>
          <Hairline style={styles.privacy} />
          <Text variant="caption" color="text.tertiary" style={styles.privacy}>
            {t('stats.privacy')}
          </Text>
        </>
      }
    />
  );
}

/** STK-04 Scan-Statistik (10 §2.3): 30 days as a line, this and last week, sources, first scan, total. Owner only, counts only. */
export function StickerStatsScreen() {
  const { t } = useTranslation('qr');
  const router = useRouter();
  const { vehicleId: param } = useLocalSearchParams<{ vehicleId: string }>();
  const vehicleId = typeof param === 'string' ? param : '';
  const qaState = useQaState();
  const online = useOnline();
  const session = useSessionStore((state) => state.status);
  const stats = useStickerStats(vehicleId);
  const cards = useMyStickers();
  const title = cards.data?.find((card) => card.vehicle.id === vehicleId)?.vehicle.full_title;
  const error = stats.error instanceof ApiError ? stats.error : null;

  let body: ReactNode;
  if (session === 'guest') {
    body = <QrSignInState routeId={ROUTE} />;
  } else if (
    qaState === 'loading' ||
    session === 'loading' ||
    (!stats.data && stats.isPending && stats.fetchStatus !== 'paused' && qaState === 'default')
  ) {
    body = <StatsSkeleton />;
  } else if (!stats.data && error?.status === 404 && error.code === 'feature_disabled') {
    body = (
      <QrState
        routeId={ROUTE}
        name="disabled"
        icon="chart-bar"
        title={t('stickerStats.disabledTitle')}
        body={t('stickerStats.disabledBody')}
      />
    );
  } else if (qaState === 'empty' || (!stats.data && (error?.status === 404 || error?.status === 403))) {
    body = (
      <QrState
        routeId={ROUTE}
        name="unavailable"
        icon="qr-code"
        title={t('unavailable.title')}
        body={t('unavailable.body')}
        action={{
          label: t('unavailable.garage'),
          onPress: () => router.navigate('/garage'),
          variant: 'secondary',
          size: 'm',
        }}
      />
    );
  } else if (qaState === 'error' || !stats.data) {
    const offline = !online || stats.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('stickerStats.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void stats.refetch()}
        retrying={stats.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else {
    body = <StatsBody stats={stats.data} vehicleId={vehicleId} />;
  }

  return (
    <QrPage
      routeId={ROUTE}
      title={t('stickerStats.title')}
      subtitle={title ? keepNameTogether(title) : undefined}
      subtitlePending={!title && session !== 'guest' && cards.isPending}
      fallback="/stickers"
      offlineLabel={t('common.offlineBanner')}
    >
      {body}
    </QrPage>
  );
}
