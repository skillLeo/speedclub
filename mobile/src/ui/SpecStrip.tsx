import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, useBreakpoint, useTheme } from '@/theme';

import { Hairline } from './Hairline';
import { useMotionPreference } from './motion';
import { OdometerNumber, useOdometerOnce, zeroed } from './motion/OdometerNumber';
import { joinLabel } from './rowParts';
import {
  estimatedSpecStripColumns,
  SPEC_CELL_GAP,
  SPEC_CELL_PADDING_X,
  SPEC_CELL_PADDING_Y,
  SPEC_UNIT_GAP,
  specStripColumns,
  specStripNumeralVariant,
  WEB_HAIRLINE,
  type SpecStripEntry,
} from './specStripLayout';
import { Text, useDesktopType } from './Text';

/** One item: "510" + "PS", data label "Leistung", provenance "Herstellerangabe" (09 §5 SpecStrip 2.0). */
export type SpecStripItem = SpecStripEntry;

export type SpecStripProps = {
  /** Three to five (09 §5); VEH-01 has four. */
  items: readonly SpecStripItem[];
  /**
   * The width the parent lays the strip out at, when it knows it before layout (ProfileSummary on VEH-01 and GAR-02, from
   * `profileSummaryWidth`). The first frame then already has the final columns. Without it the strip is laid out but
   * invisible until it has measured its own width (N1b).
   */
  layoutWidth?: number;
  /**
   * SM6: the vehicle's id. The numerals roll from zero the first time this vehicle's strip shows in the session, never again,
   * and never under reduced motion (the number is simply there). Without it nothing rolls.
   */
  rollKey?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const DIVIDER = isWeb ? WEB_HAIRLINE : StyleSheet.hairlineWidth;
const NO_ROLL = '';

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row' },
  cell: {
    alignItems: 'flex-start',
    gap: SPEC_CELL_GAP,
    minWidth: 0,
    paddingHorizontal: SPEC_CELL_PADDING_X,
    paddingVertical: SPEC_CELL_PADDING_Y,
  },
  // The unit sits on the numeral's baseline, `space.4` after it.
  valueLine: { alignItems: 'baseline', flexDirection: 'row', gap: SPEC_UNIT_GAP },
  divided: { borderLeftColor: t.color.border.subtle, borderLeftWidth: DIVIDER },
  // ADR-431 b: no ground, so the first cell of a row starts on the text edge of the page or the card.
  leading: { paddingLeft: 0 },
  empty: {},
  // N1b: laid out (so onLayout fires, never display: none) but not drawn while no width is known.
  pending: { opacity: 0 },
  // One-line copies of the texts, as wide as they want to be: out of sight, out of the accessibility tree and outside the
  // strip, so the strip's own text stays what a reader reads (the Blade/app parity test compares it).
  measure: { alignItems: 'flex-start', left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', top: 0 },
}));

function rowsOf<T>(items: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += columns) rows.push(items.slice(start, start + columns));
  return rows;
}

/** Keys of the measured copies: `v` value, `u` unit, `l` data label, `p` provenance. */
function measureKeys(item: SpecStripItem, index: number): { value: string; unit?: string; label: string; provenance?: string } {
  return {
    value: `v${index}|${item.value}`,
    ...(item.unit ? { unit: `u${index}|${item.unit}` } : {}),
    label: `l${index}|${item.label}`,
    ...(item.provenance ? { provenance: `p${index}|${item.provenance}` } : {}),
  };
}

/** The measured one-line widths of every line of every cell, or null while one is missing. */
export function measuredContentWidths(items: readonly SpecStripItem[], measured: Readonly<Record<string, number>>): number[] | null {
  const widths: number[] = [];
  for (const [index, item] of items.entries()) {
    const keys = measureKeys(item, index);
    const value = measured[keys.value];
    const unit = keys.unit === undefined ? 0 : measured[keys.unit];
    const label = measured[keys.label];
    const provenance = keys.provenance === undefined ? undefined : measured[keys.provenance];
    if (value === undefined || unit === undefined || label === undefined || (keys.provenance !== undefined && provenance === undefined)) return null;
    widths.push(unit > 0 ? value + SPEC_UNIT_GAP + unit : value, label, ...(provenance === undefined ? [] : [provenance]));
  }
  return widths;
}

/**
 * 09 §5 SpecStrip 2.0 (ADR-431 b): no ground, hairlines only (between cells and rows), on the page and inside cards alike; the
 * first cell of a row on the text edge. Per cell the `label.caps` data label (LEISTUNG, text.secondary), the value in
 * `hero.numeral` on the page or `hero.numeral.s` in the desktop's card (specStripNumeralVariant; tabular, capped at 1.3×) with
 * its `label.unit` unit on the baseline, and the provenance in `caption` text.tertiary (Herstellerangabe · Prüfstand ·
 * Geschätzt, ADR-431 c); start-aligned, as the page's text.
 *
 * Columns by fit (DQ-801, ADR-422): all items in one row only when every line of every cell fits with space.12 on each side,
 * else the 2×2 grid, else one column; never a horizontal scroll. ADR-422 d: the estimate (specStripLayout.ts, the same numbers
 * as the public page's SpecStripLayout.php) decides; the measured widths only take columns away, so a font that draws wider
 * than its table never breaks a numeral, and the app and the public page always choose the same columns.
 *
 * N1b: before its own onLayout the strip uses `layoutWidth` from its parent; without one it is laid out at a phone page's width
 * guess but invisible (opacity 0). SM6 (with `rollKey`): the numerals roll once per vehicle per session.
 */
export function SpecStrip({ items, layoutWidth, rollKey, style, testID }: SpecStripProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const desktop = useDesktopType();
  const motion = useMotionPreference();
  const { width: windowWidth, gutter } = useBreakpoint();
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState<Readonly<Record<string, number>>>({});
  const firstShowing = useOdometerOnce(rollKey ?? NO_ROLL);
  const rolls = rollKey !== undefined && firstShowing && motion.enabled && !motion.reduced;

  const given = layoutWidth !== undefined && Number.isFinite(layoutWidth) && layoutWidth > 0 ? layoutWidth : 0;
  // The strip's own width once measured, else the parent's; neither known: hidden, at a phone page's width.
  const known = width > 0 ? width : given;
  const pending = known <= 0;
  const fitWidth = pending ? Math.max(0, windowWidth - 2 * gutter) : known;
  const estimated = estimatedSpecStripColumns(items, fitWidth, fontScale, desktop, DIVIDER);
  const contentWidths = pending ? null : measuredContentWidths(items, measured);
  const columns = contentWidths
    ? Math.min(estimated, specStripColumns({ width: fitWidth, count: items.length, contentWidths, divider: DIVIDER, fontScale }))
    : estimated;
  const rows = rowsOf(items, columns);
  const numeral = specStripNumeralVariant(desktop);
  // Equal columns whatever their padding (the first cell has none on its leading side, ADR-431 b), as the public page's grid:
  // a share of the row, borders and padding inside it.
  const share = { width: `${100 / columns}%` } as const;

  const onStripLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  };
  const measuredAs = (key: string) => (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasured((current) => (current[key] === next ? current : { ...current, [key]: next }));
  };

  return (
    <>
      <View testID={testID} style={[style, pending ? styles.pending : null]} onLayout={onStripLayout}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex}>
            {rowIndex > 0 ? <Hairline /> : null}
            <View style={styles.row}>
              {row.map((item, cellIndex) => {
                const index = rowIndex * columns + cellIndex;
                return (
                  <View
                    key={cellIndex}
                    accessible
                    // Native reads the cell as one sentence in reading order; the web reads its texts (a label on a plain
                    // element would be ignored there).
                    {...(isWeb ? {} : { 'aria-label': joinLabel([item.label, item.unit ? `${item.value} ${item.unit}` : item.value, item.provenance]) })}
                    testID={testID ? `${testID}.${index}` : undefined}
                    style={[styles.cell, share, cellIndex > 0 ? styles.divided : styles.leading]}
                  >
                    <Text hyphenate={false} variant="labelCaps" color="text.secondary" testID={testID ? `${testID}.${index}.label` : undefined}>
                      {item.label}
                    </Text>
                    <View style={styles.valueLine}>
                      {rolls && /\d/.test(item.value) ? (
                        <OdometerNumber value={item.value} rollFrom={zeroed(item.value)} variant={numeral} testID={testID ? `${testID}.${index}.roll` : undefined} />
                      ) : (
                        <Text hyphenate={false} variant={numeral} testID={testID ? `${testID}.${index}.value` : undefined}>
                          {item.value}
                        </Text>
                      )}
                      {item.unit ? (
                        <Text hyphenate={false} variant="labelUnit" color="text.secondary" testID={testID ? `${testID}.${index}.unit` : undefined}>
                          {item.unit}
                        </Text>
                      ) : null}
                    </View>
                    {item.provenance ? (
                      <Text hyphenate={false} variant="caption" color="text.tertiary" testID={testID ? `${testID}.${index}.provenance` : undefined}>
                        {item.provenance}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
              {/* A short last row keeps the width of its columns. */}
              {Array.from({ length: columns - row.length }, (_, index) =>
                rows.length > 1 ? <View key={`empty-${index}`} style={[styles.empty, share, styles.divided]} /> : null,
              )}
            </View>
          </View>
        ))}
      </View>
      <View aria-hidden importantForAccessibility="no-hide-descendants" style={styles.measure}>
        {items.map((item, index) => {
          const keys = measureKeys(item, index);
          return [
            <Text key={keys.value} hyphenate={false} variant={numeral} selectable={false} onLayout={measuredAs(keys.value)}>
              {item.value}
            </Text>,
            keys.unit ? (
              <Text key={keys.unit} hyphenate={false} variant="labelUnit" selectable={false} onLayout={measuredAs(keys.unit)}>
                {item.unit}
              </Text>
            ) : null,
            <Text key={keys.label} hyphenate={false} variant="labelCaps" selectable={false} onLayout={measuredAs(keys.label)}>
              {item.label}
            </Text>,
            keys.provenance ? (
              <Text key={keys.provenance} hyphenate={false} variant="caption" selectable={false} onLayout={measuredAs(keys.provenance)}>
                {item.provenance}
              </Text>
            ) : null,
          ];
        })}
      </View>
    </>
  );
}
