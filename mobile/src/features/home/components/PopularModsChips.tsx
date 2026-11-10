import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import type { PopularMod } from '@/api/queries/home';
import { createStyles, size, space, useTheme } from '@/theme';
import { Chip, SkeletonBlock } from '@/ui';

/** FS-2: the chips take at most two lines. */
const MAX_LINES = 2;

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  // DQ-312: the measuring box is as wide as the row at most, so a long label wraps inside its chip at 200 % instead of running off
  // the screen; the Chip's own maxWidth is measured against this box.
  item: { maxWidth: '100%' },
}));

/** The row's gap (`row` above). */
const GAP = space[8];

/**
 * How many chips fit in `maxLines` lines of a row `rowWidth` wide, from each chip's own width: chips wrap in order with the 8 gap, so
 * the first one that would start a further line ends the list. A chip wider than the row takes a line of its own. Undefined until the
 * row and every chip were measured. Widths do not depend on which chips are drawn, so cutting the list never changes the answer.
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

/** A layout that says something: a hidden screen (display:none on web) reports 0 × 0 for everything in it. */
const shown = (event: LayoutChangeEvent) => event.nativeEvent.layout.width > 0 && event.nativeEvent.layout.height > 0;

export type PopularModsChipsProps = {
  mods: readonly PopularMod[];
  /** The column width. */
  width: number;
  onOpen: (mod: PopularMod) => void;
  testID: string;
};

type Measure = { key: string; row?: number; widths: (number | undefined)[] };

/**
 * FS-2 "Beliebte Mods diese Woche": brands and parts added most often, as search chips, at most two lines. No counts.
 *
 * Every chip is drawn once to learn its width; from then on only those that fit. A layout of 0 × 0, while a pushed page covers Start,
 * is ignored, so coming back keeps the two lines (M2.2 test F1, ADR-178).
 */
export function PopularModsChips({ mods, width, onOpen, testID }: PopularModsChipsProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  // The chips' widths hold for these labels at this font scale; anything else measures again.
  const key = `${fontScale}|${mods.map((mod) => mod.label).join('\u0000')}`;
  const [measure, setMeasure] = useState<Measure>({ key, widths: [] });
  const current: Measure = measure.key === key ? measure : { key, row: measure.row, widths: [] };
  const widths = mods.map((_, index) => current.widths[index]);
  const fit = chipsThatFit(widths, current.row ?? (width > 0 ? width : undefined));

  const update = (change: (base: Measure) => Measure | null) =>
    setMeasure((previous) => {
      const base = previous.key === key ? previous : { key, row: previous.row, widths: [] };
      return change(base) ?? previous;
    });
  const onRowLayout = (event: LayoutChangeEvent) => {
    if (!shown(event)) return;
    const row = event.nativeEvent.layout.width;
    update((base) => (base.row === row ? null : { ...base, row }));
  };
  const onChipLayout = (index: number) => (event: LayoutChangeEvent) => {
    if (!shown(event)) return;
    const chip = event.nativeEvent.layout.width;
    update((base) => {
      if (base.widths[index] === chip) return null;
      const next = [...base.widths];
      next[index] = chip;
      return { ...base, widths: next };
    });
  };

  return (
    <View style={styles.row} onLayout={onRowLayout} testID={testID}>
      {mods.map((mod, index) =>
        fit !== undefined && index >= fit ? null : (
          <View key={`${mod.label}.${index}`} style={styles.item} onLayout={onChipLayout(index)} testID={`${testID}.item.${index}`}>
            <Chip label={mod.label} onPress={() => onOpen(mod)} testID={`${testID}.chip.${index}`} />
          </View>
        ),
      )}
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
