import { useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, useBreakpoint, useTheme } from '@/theme';

import { SkeletonText } from './Skeleton';
import { MINI_SPEC_GAP, MINI_SPEC_ROW_GAP, miniSpecCellWidth, miniSpecColumns, type MiniSpecEntry } from './specStripLayout';
import { Text, useDesktopType } from './Text';

/** One cell: "500" + "PS" over "LEISTUNG". */
export type MiniSpecItem = MiniSpecEntry & { key: string };

export type MiniSpecProps = {
  items: readonly MiniSpecItem[];
  /** The width the spec is laid out at, known before its own layout (the card's text column). */
  layoutWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  grid: { columnGap: MINI_SPEC_GAP, flexDirection: 'row', flexWrap: 'wrap', rowGap: MINI_SPEC_ROW_GAP },
  cell: { gap: t.space[2], minWidth: 0 },
  value: { alignItems: 'baseline', columnGap: t.space[4], flexDirection: 'row' },
}));

/** The width to fit before the spec has measured itself: the parent's, else a phone card's. */
function useFitWidth(layoutWidth: number | undefined): [number, (event: LayoutChangeEvent) => void] {
  const { width: windowWidth, gutter } = useBreakpoint();
  const [measured, setMeasured] = useState<number | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && next !== measured) setMeasured(next);
  };
  return [measured ?? layoutWidth ?? windowWidth - 2 * gutter, onLayout];
}

/**
 * 09 §5 SpecStrip, its card form (VehicleCard 2.0, ONB-01/02): `hero.numeral.s` (tnum, capped at 1.3×) with its `label.unit` on one
 * line, the `label.caps` data label under it. DQ-1216: the ADR-422 fit rule decides the columns (`miniSpecColumns`): three in a row
 * where every value line and label fits its column whole, else 2 + 1, else one column; from 150 % never three. A label is never
 * ellipsised, and columns keep `space.12` apart, so a unit never touches the next numeral ("Nm2004").
 */
export function MiniSpec({ items, layoutWidth, style, testID }: MiniSpecProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const desktop = useDesktopType();
  const [width, onLayout] = useFitWidth(layoutWidth);
  const columns = miniSpecColumns(items, width, fontScale, desktop);
  const cell = { width: Math.floor(miniSpecCellWidth(width, columns)) };
  return (
    <View style={[styles.grid, style]} onLayout={onLayout} testID={testID}>
      {items.map((item) => (
        <View key={item.key} style={[styles.cell, cell]} testID={testID ? `${testID}.${item.key}` : undefined}>
          <View style={styles.value}>
            <Text variant="heroNumeralS" numeric hyphenate={false}>
              {item.value}
            </Text>
            {item.unit ? (
              <Text variant="labelUnit" color="text.secondary" hyphenate={false}>
                {item.unit}
              </Text>
            ) : null}
          </View>
          <Text variant="labelCaps" color="text.secondary" hyphenate={false}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The usual three cells of a garage card, for the skeleton's geometry: German labels are the longest the spec meets. */
const TYPICAL_ITEMS: readonly MiniSpecEntry[] = [
  { value: '500', unit: 'PS', label: 'Leistung' },
  { value: '540', unit: 'Nm', label: 'Drehmoment' },
  { value: '2002', unit: null, label: 'Baujahr' },
];

/** The mini spec's loading geometry: the columns the typical three cells take at this width and font scale. */
export function MiniSpecSkeleton({ layoutWidth, style }: { layoutWidth?: number; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const desktop = useDesktopType();
  const [width, onLayout] = useFitWidth(layoutWidth);
  const columns = miniSpecColumns(TYPICAL_ITEMS, width, fontScale, desktop);
  const cell = { width: Math.floor(miniSpecCellWidth(width, columns)) };
  return (
    <View style={[styles.grid, style]} onLayout={onLayout}>
      {TYPICAL_ITEMS.map((item) => (
        <View key={item.label} style={[styles.cell, cell]}>
          <SkeletonText variant="heroNumeralS" width="70%" />
          <SkeletonText variant="labelCaps" width="60%" />
        </View>
      ))}
    </View>
  );
}
