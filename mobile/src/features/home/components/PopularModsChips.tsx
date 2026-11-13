import { useMemo } from 'react';
import { View } from 'react-native';

import type { PopularMod } from '@/api/queries/home';
import { createStyles, size, space, typography, useTheme } from '@/theme';
import { Chip, SkeletonBlock } from '@/ui';
import { estimatedInterWidth } from '@/ui/specLabelMetrics';

/** FS-2: the chips take at most two lines. */
const MAX_LINES = 2;

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  // DQ-312: never wider than the row, so a long label ends in its chip's ellipsis at 200 % instead of running off the screen.
  item: { maxWidth: '100%' },
}));

/** The row's gap (`row` above). */
const GAP = space[8];
/** The chip's frame around its label (`Chip`: 12 padding and the control border on each side). */
const CHIP_FRAME = 2 * space[12] + 2 * size.border.control;

/**
 * How many chips fit in `maxLines` lines of a row `rowWidth` wide, from each chip's own width: chips wrap in order with the 8 gap, so
 * the first one that would start a further line ends the list. A chip wider than the row takes a line of its own (its label ends in an
 * ellipsis). Undefined while the row width or a chip width is unknown.
 */
export function chipsThatFit(
  widths: readonly (number | undefined)[],
  rowWidth: number | undefined,
  maxLines: number = MAX_LINES,
  gap: number = GAP,
): number | undefined {
  if (!rowWidth || widths.some((width) => width === undefined)) return undefined;
  let lines = 0;
  let used = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const width = Math.min(widths[index] as number, rowWidth);
    if (lines === 0 || used + gap + width > rowWidth + 0.5) {
      lines += 1;
      if (lines > maxLines) return index;
      used = width;
    } else {
      used += gap + width;
    }
  }
  return widths.length;
}

/**
 * A chip's width before it is drawn: the `callout` label (Inter Medium) at the drawn font scale from the shipped font's advances with
 * the positive kerning bound, plus the chip's frame, never under its 44 minimum. The estimate is never narrower than the screen draws
 * the chip, so the chips it keeps always fit their two lines (BUG-5).
 */
export function estimatedChipWidth(label: string, fontScale: number): number {
  const text = estimatedInterWidth(label, typography.callout.fontSize * Math.max(1, fontScale), typography.callout.letterSpacing, 'medium');
  return Math.max(size.touchMin, Math.ceil(text + CHIP_FRAME));
}

/** The chips of `labels` that fit two lines of a row `rowWidth` wide at `fontScale` (all of them while the width is unknown: 0). */
export function chipsShown(labels: readonly string[], rowWidth: number, fontScale: number, maxLines: number = MAX_LINES): number {
  if (rowWidth <= 0) return 0;
  return chipsThatFit(labels.map((label) => estimatedChipWidth(label, fontScale)), rowWidth, maxLines) ?? 0;
}

export type PopularModsChipsProps = {
  mods: readonly PopularMod[];
  /** The column width. */
  width: number;
  onOpen: (mod: PopularMod) => void;
  testID: string;
};

/**
 * FS-2 "Beliebte Mods diese Woche": brands and parts added most often, as search chips, at most two lines. No counts.
 *
 * BUG-5: the cut is decided before the first paint from the column width and the label metrics. Nothing is measured and no state is
 * set, so the row renders once per change of its input, whatever layouts a hidden screen or a recycled list cell reports.
 */
export function PopularModsChips({ mods, width, onOpen, testID }: PopularModsChipsProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const labels = useMemo(() => mods.map((mod) => mod.label), [mods]);
  const fit = useMemo(() => chipsShown(labels, width, fontScale), [labels, width, fontScale]);

  return (
    <View style={styles.row} testID={testID}>
      {mods.slice(0, fit).map((mod, index) => (
        <View key={`${mod.label}.${index}`} style={styles.item} testID={`${testID}.item.${index}`}>
          <Chip label={mod.label} onPress={() => onOpen(mod)} testID={`${testID}.chip.${index}`} />
        </View>
      ))}
    </View>
  );
}

export function PopularModsChipsSkeleton() {
  const styles = useStyles();
  const widths = ['22%', '30%', '18%', '26%', '20%'] as const;
  return (
    <View style={styles.row}>
      {widths.map((width) => (
        <SkeletonBlock key={width} width={width} height={size.chip} corner="full" />
      ))}
    </View>
  );
}
