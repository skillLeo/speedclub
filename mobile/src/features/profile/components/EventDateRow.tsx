import { View } from 'react-native';

import { createStyles, size, space } from '@/theme';
import { Text } from '@/ui';
import { RowDivider } from '@/ui/rowParts';

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[16], minHeight: t.size.row.withThumb, paddingHorizontal: t.space[16], paddingVertical: t.space[12] },
  // 09 §5 EventCard's date block: the day in hero.numeral.s (tnum), the month as a data label under it.
  date: { alignItems: 'center', minWidth: t.size.thumb.row },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
}));

export type EventDateRowProps = {
  /** "14" */
  day: string;
  /** "JUN" (label.caps sets the case). */
  month: string;
  /** "Cars & Coffee Riem" */
  title: string;
  /** "München · 19:30 Uhr" */
  meta: string;
  divider?: boolean;
  testID?: string;
};

/**
 * PROF-01 Treffen (09 §7.7): an event the member said yes to, as a list row with the date block of 09 §5 EventCard. The full
 * EventCard and the event pages come with M4.12; until then the row is information, not a link.
 */
export function EventDateRow({ day, month, title, meta, divider = true, testID }: EventDateRowProps) {
  const styles = useStyles();
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.date}>
        <Text variant="heroNumeralS" numeric hyphenate={false}>
          {day}
        </Text>
        <Text variant="labelCaps" color="text.secondary" hyphenate={false}>
          {month}
        </Text>
      </View>
      <View style={styles.text}>
        <Text variant="headline" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" color="text.secondary">
          {meta}
        </Text>
      </View>
      {divider ? <RowDivider inset={space[16]} lead={size.thumb.row + space[16]} /> : null}
    </View>
  );
}
