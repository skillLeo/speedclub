import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import type { Insights } from '@/api/queries/insights';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space, useTheme } from '@/theme';
import { Text } from '@/ui/Text';

/** The chart's box; the loading state keeps the same height. */
export const INSIGHTS_CHART_HEIGHT = space[96];

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8] },
  axis: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], justifyContent: 'space-between' },
  legend: { columnGap: t.space[16], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  key: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  swatch: { borderRadius: t.radius.full, height: t.size.progress.height, width: t.space[12] },
  views: { backgroundColor: t.color.accent.fg },
  scans: { backgroundColor: t.color.text.tertiary },
}));

/**
 * Both lines on one scale (the busiest value of either), so a day's scans and views compare at a glance; a series of zeros lies on
 * the floor.
 */
export function linePoints(counts: readonly number[], top: number, width: number, height: number, inset: number): { x: number; y: number }[] {
  const max = Math.max(1, top);
  const step = counts.length > 1 ? (width - 2 * inset) / (counts.length - 1) : 0;
  return counts.map((value, index) => ({
    x: inset + index * step,
    y: inset + (height - 2 * inset) * (1 - Math.max(0, value) / max),
  }));
}

export function pathOf(points: readonly { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

/**
 * INS-01 "Letzte 30 Tage" (10 §6.1: one accent + neutrals, tnum): views as the one accent line with today's dot, sticker scans as a
 * neutral line under it (only when the scope has a sticker), the first and last day under the chart. Static: nothing moves, so
 * reduced motion needs no variant. `quiet` draws the floor alone (nothing counted yet).
 */
export function InsightsChart({ insights, quiet = false, testID }: { insights: Insights; quiet?: boolean; testID: string }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const theme = useTheme();
  const format = useFormat();
  const [width, setWidth] = useState(0);
  const views = insights.days.map((day) => day.views);
  const scans = insights.days.map((day) => day.scans);
  const withScans = insights.sticker_scans !== null;
  const top = Math.max(0, ...views, ...(withScans ? scans : []));
  const inset = size.progress.height * 2;
  const height = INSIGHTS_CHART_HEIGHT;
  const viewPoints = width > 0 ? linePoints(views, top, width, height, inset) : [];
  const scanPoints = width > 0 && withScans ? linePoints(scans, top, width, height, inset) : [];
  const last = viewPoints.at(-1);
  const day = (iso: string | undefined) => (iso ? format.dayMonth(new Date(`${iso}T12:00:00`)) : '');
  const busiest = Math.max(0, ...views);
  const label = quiet
    ? t('insights.chart.none')
    : t('insights.chart.label', {
        count: insights.views.total_30_days,
        total: format.number(insights.views.total_30_days),
        busiest: format.number(busiest),
      }) + (withScans ? ` ${t('insights.chart.scansLabel', { count: insights.sticker_scans?.total_30_days ?? 0, total: format.number(insights.sticker_scans?.total_30_days ?? 0) })}` : '');

  return (
    <View style={styles.root} testID={testID}>
      <View
        role="img"
        aria-label={label}
        accessible
        style={{ height }}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        testID={`${testID}.plot`}
      >
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Line x1={0} y1={height - inset} x2={width} y2={height - inset} stroke={theme.color.border.default} strokeWidth={1} />
            {quiet ? null : (
              <>
                {scanPoints.length > 0 ? (
                  <Path
                    d={pathOf(scanPoints)}
                    stroke={theme.color.text.tertiary}
                    strokeWidth={size.progress.height / 2}
                    fill="none"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : null}
                <Path
                  d={pathOf(viewPoints)}
                  stroke={theme.color.accent.fg}
                  strokeWidth={size.progress.height}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {last ? <Circle cx={last.x} cy={last.y} r={size.progress.height * 1.5} fill={theme.color.accent.fg} /> : null}
              </>
            )}
          </Svg>
        ) : null}
      </View>
      <View style={styles.axis} aria-hidden>
        <Text variant="caption" numeric color="text.tertiary">
          {day(insights.days[0]?.date)}
        </Text>
        <Text variant="caption" numeric color="text.tertiary">
          {day(insights.days.at(-1)?.date)}
        </Text>
      </View>
      {withScans && !quiet ? (
        <View style={styles.legend} aria-hidden testID={`${testID}.legend`}>
          <View style={styles.key}>
            <View style={[styles.swatch, styles.views]} />
            <Text variant="caption" color="text.secondary">
              {t('insights.chart.views')}
            </Text>
          </View>
          <View style={styles.key}>
            <View style={[styles.swatch, styles.scans]} />
            <Text variant="caption" color="text.secondary">
              {t('insights.chart.scans')}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** The sample curve's shape: a slow rise with a weekend bump, a picture of "a line of your views" and nobody's real numbers. */
const SAMPLE_SHAPE = [3, 4, 3, 5, 4, 4, 7, 5, 4, 5, 6, 5, 6, 9, 6, 6, 7, 6, 7, 8, 7, 11, 8, 8, 9, 8, 9, 10, 10, 12] as const;

/**
 * DQ-P5-019: INS-01's zero state shows what the chart will be, badged "Beispiel" by the caller: one line in a neutral tone (never the
 * accent, which marks real views), on the same floor and in the same box as the real chart, without dates, numbers or a today dot.
 */
export function InsightsSampleChart({ testID }: { testID: string }) {
  const { t } = useTranslation('profile');
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const height = INSIGHTS_CHART_HEIGHT;
  const inset = size.progress.height * 2;
  const points = width > 0 ? linePoints(SAMPLE_SHAPE, Math.max(...SAMPLE_SHAPE), width, height, inset) : [];
  return (
    <View
      role="img"
      aria-label={t('insights.sample.label')}
      accessible
      style={{ height }}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      testID={testID}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line x1={0} y1={height - inset} x2={width} y2={height - inset} stroke={theme.color.border.default} strokeWidth={1} />
          <Path
            d={pathOf(points)}
            stroke={theme.color.text.tertiary}
            strokeWidth={size.progress.height}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}
