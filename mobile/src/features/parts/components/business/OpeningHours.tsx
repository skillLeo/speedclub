import '@/features/parts/i18n';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import type { OpeningDay } from '@/api/queries/businesses';
import { GroupHeader, RowCard } from '@/features/vehicle/components/RowCard';
import { createStyles, space, useTheme } from '@/theme';
import { Hairline, StatusPill, Text } from '@/ui';

import { dayLabel, hoursText } from '../../model';
import { withClientToday } from './dates';

const useStyles = createStyles((t) => ({
  section: { gap: t.space[12] },
  row: { alignItems: 'center', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', minHeight: t.size.row.single, paddingHorizontal: t.space[16], paddingVertical: t.space[8] },
  // The day keeps its whole word; in the side-by-side layout it takes the free width, so the hours sit at the row's end.
  day: { flexGrow: 1, flexShrink: 0 },
  stackedRow: { gap: t.space[2], justifyContent: 'center', minHeight: t.size.row.single, paddingHorizontal: t.space[16], paddingVertical: t.space[8] },
  stackedDay: { alignItems: 'center', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap' },
}));

export type OpeningHoursProps = {
  days: readonly OpeningDay[];
  /** `BIZ-01.hours`: rows `.hours.<day>`, the pill `.hours.today`. */
  testID: string;
};

/**
 * BIZ-01 Öffnungszeiten (09 §7.11): a grouped list, today highlighted (bold, "Heute" pill) by the app's clock (DQ-1148). Day and hours
 * share a row while every row fits; once one row would wrap (the narrow desktop card, 200 %), every row stacks the hours under the day,
 * so the column reads the same all the way down (DQ-1157). The measurement starts over when the width or the font scale changes.
 */
export function OpeningHours({ days, testID }: OpeningHoursProps) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const { fontScale } = useTheme();
  const rows = useMemo(() => withClientToday(days), [days]);
  const [fit, setFit] = useState({ key: '', stacked: false });
  const onCard = useCallback(
    (event: LayoutChangeEvent) => {
      const key = `${Math.round(event.nativeEvent.layout.width)}@${fontScale}`;
      setFit((current) => (current.key === key ? current : { key, stacked: false }));
    },
    [fontScale],
  );
  const onWrap = useCallback(() => setFit((current) => (current.stacked ? current : { ...current, stacked: true })), []);

  return (
    <View style={styles.section} testID={testID}>
      <GroupHeader title={t('business.hours.title')} />
      <View onLayout={onCard}>
        <RowCard>
          {rows.map((day, index) => (
            <View key={day.day}>
              {index > 0 ? <Hairline inset={space[16]} /> : null}
              <HoursRow day={day} stacked={fit.stacked} onWrap={onWrap} testID={testID} />
            </View>
          ))}
        </RowCard>
      </View>
      <Text variant="caption" color="text.tertiary">
        {t('business.hours.zone')}
      </Text>
    </View>
  );
}

type Box = { y: number; height: number };

function HoursRow({ day, stacked, onWrap, testID }: { day: OpeningDay; stacked: boolean; onWrap: () => void; testID: string }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const name = dayLabel(day.day, t);
  const hours = hoursText(day, t);
  const variant = day.today ? 'bodyStrong' : 'body';
  const boxes = useRef<{ day: Box | null; hours: Box | null }>({ day: null, hours: null });
  // Side by side, the hours have wrapped when they start below the day's line. Read only in the layout callbacks, never in render.
  const onDayLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      boxes.current.day = { y, height };
      const hoursBox = boxes.current.hours;
      if (hoursBox && hoursBox.y >= y + height / 2) onWrap();
    },
    [onWrap],
  );
  const onHoursLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      boxes.current.hours = { y, height };
      const dayBox = boxes.current.day;
      if (dayBox && y >= dayBox.y + dayBox.height / 2) onWrap();
    },
    [onWrap],
  );

  const dayText = (
    <Text variant={variant} hyphenate={false} style={stacked ? null : styles.day} onLayout={stacked ? undefined : onDayLayout}>
      {name}
    </Text>
  );
  const pill = day.today ? <StatusPill label={t('business.hours.today')} testID={`${testID}.today`} /> : null;
  const hoursLine = (
    <Text variant={variant} color={day.ranges.length > 0 ? 'text.primary' : 'text.secondary'} numeric onLayout={stacked ? undefined : onHoursLayout}>
      {hours}
    </Text>
  );
  return (
    <View
      style={stacked ? styles.stackedRow : styles.row}
      aria-label={`${name}${day.today ? `, ${t('business.hours.today')}` : ''}: ${hours}`}
      accessible
      testID={`${testID}.${day.day}`}
    >
      {stacked ? (
        <>
          <View style={styles.stackedDay}>
            {dayText}
            {pill}
          </View>
          {hoursLine}
        </>
      ) : (
        <>
          {dayText}
          {pill}
          {hoursLine}
        </>
      )}
    </View>
  );
}
