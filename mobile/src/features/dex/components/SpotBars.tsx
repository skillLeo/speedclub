import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { SpotStats } from '@/api/queries/dex';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space } from '@/theme';
import { Text } from '@/ui/Text';

/** The bars' box: the tallest day reaches it (the loading state keeps the same height). */
export const CHART_HEIGHT = space[80];
const DAYS = 30;

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8] },
  chart: { alignItems: 'flex-end', flexDirection: 'row', gap: t.space[2], height: CHART_HEIGHT },
  bar: { backgroundColor: t.color.text.tertiary, borderTopLeftRadius: t.radius.xs, borderTopRightRadius: t.radius.xs, flex: 1 },
  // A day without spots keeps its place on the base line.
  zero: { backgroundColor: t.color.border.default, borderRadius: 0, height: t.size.progress.height },
  // The one accent of the screen (09 §4.1 red ≤ 5 %): today.
  today: { backgroundColor: t.color.accent.fill },
  // DQ-P5G-19: the end labels never run into each other, however narrow the chart.
  axis: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], justifyContent: 'space-between' },
}));

/** The last 30 days, oldest first, with a zero for each day the answer leaves out. */
export function lastDays(days: SpotStats['last_30_days'], today: Date): { day: string; count: number }[] {
  const counts = new Map(days.map((entry) => [entry.day.slice(0, 10), entry.count]));
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: DAYS }, (_, index) => {
    const day = new Date(base - (DAYS - 1 - index) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { day, count: Math.max(0, counts.get(day) ?? 0) };
  });
}

/**
 * DEX-06 "Letzte 30 Tage": one bar per day, neutrals with today in the accent, no axis numbers (the bars compare days, the counts
 * live in the label). Static: nothing moves, so reduced motion needs no variant.
 */
export function SpotBars({ days, today, testID }: { days: SpotStats['last_30_days']; today: Date; testID: string }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const format = useFormat();
  const series = lastDays(days, today);
  const max = Math.max(0, ...series.map((entry) => entry.count));
  const last = series[series.length - 1]?.count ?? 0;
  return (
    <View style={styles.root} testID={testID}>
      <View
        style={styles.chart}
        accessible
        role="img"
        aria-label={t('owner.days.chartLabel', { today: format.number(last), max: format.number(max) })}
        testID={`${testID}.chart`}
      >
        {series.map((entry, index) => {
          const isToday = index === series.length - 1;
          const height = max > 0 ? Math.max(space[2], Math.round((entry.count / max) * CHART_HEIGHT)) : 0;
          return (
            <View
              key={entry.day}
              style={[styles.bar, entry.count === 0 ? styles.zero : { height }, isToday && entry.count > 0 ? styles.today : null]}
              testID={`${testID}.bar.${entry.day}`}
            />
          );
        })}
      </View>
      <View style={styles.axis} aria-hidden>
        <Text variant="caption" color="text.tertiary">
          {t('owner.days.start')}
        </Text>
        <Text variant="caption" color="text.tertiary">
          {t('owner.days.today')}
        </Text>
      </View>
    </View>
  );
}
