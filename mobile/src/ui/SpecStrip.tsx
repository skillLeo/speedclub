import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';

import { Hairline } from './Hairline';
import { useStacksAtFontScale } from './rowParts';
import { Text } from './Text';

export type SpecStripItem = {
  /** "500" */
  value: string;
  /** "PS", "Baujahr" */
  label: string;
};

export type SpecStripProps = {
  /** Four in FS-3. */
  items: readonly SpecStripItem[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const COLUMNS = 4;
const COLUMNS_LARGE_FONT = 2;

const useStyles = createStyles((t) => ({
  strip: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md },
  row: { flexDirection: 'row' },
  cell: {
    alignItems: 'center',
    flex: 1,
    gap: t.space[2],
    minWidth: 0,
    paddingHorizontal: t.space[4],
    paddingVertical: t.space[16],
  },
  divided: {
    borderLeftColor: t.color.border.subtle,
    borderLeftWidth: isWeb ? t.size.border.control : StyleSheet.hairlineWidth,
  },
  text: { textAlign: 'center' },
  empty: { flex: 1 },
}));

function rowsOf(items: readonly SpecStripItem[], columns: number): SpecStripItem[][] {
  const rows: SpecStripItem[][] = [];
  for (let start = 0; start < items.length; start += columns) rows.push(items.slice(start, start + columns));
  return rows;
}

/**
 * FS-3 spec strip: bg.surface radius 12, four equal columns with hairlines, `spec.strip` values, `caption` labels.
 * A four-digit value at twice the size no longer fits a quarter of a phone, so large fonts get two columns on two
 * rows. Nothing wraps inside a number and nothing is clipped.
 */
export function SpecStrip({ items, style, testID }: SpecStripProps) {
  const styles = useStyles();
  const columns = useStacksAtFontScale() ? COLUMNS_LARGE_FONT : COLUMNS;
  const rows = rowsOf(items, columns);

  return (
    <View testID={testID} style={[styles.strip, style]}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex}>
          {rowIndex > 0 ? <Hairline /> : null}
          <View style={styles.row}>
            {row.map((item, cellIndex) => (
              <View
                key={cellIndex}
                accessible
                testID={testID ? `${testID}.${rowIndex * columns + cellIndex}` : undefined}
                style={[styles.cell, cellIndex > 0 ? styles.divided : null]}
              >
                <Text hyphenate={false} variant="specStrip" style={styles.text}>
                  {item.value}
                </Text>
                <Text hyphenate={false} variant="caption" color="text.tertiary" style={styles.text}>
                  {item.label}
                </Text>
              </View>
            ))}
            {/* A short last row keeps the width of its columns. */}
            {Array.from({ length: columns - row.length }, (_, index) =>
              rows.length > 1 ? <View key={`empty-${index}`} style={[styles.empty, styles.divided]} /> : null,
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
