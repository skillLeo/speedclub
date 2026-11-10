import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { createStyles, size, space, useTheme } from '@/theme';
import { ListRow, Text, type ListRowProps } from '@/ui';

/**
 * DQ-103: until the row has measured itself, from this font scale a trailing value takes its own line under the title.
 * Beside it, the title column gets too narrow for a German compound ("Erscheinungsbild").
 */
const STACKED_VALUE_FONT_SCALE = 1.5;
/** The rows of the settings sit 16 inside their card. */
export const ROW_INSET = space[16];

const useStyles = createStyles(() => ({
  // Measures the title and the value on one line each. Invisible, and out of the layout and the accessibility tree.
  measure: { alignItems: 'flex-start', left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', top: 0 },
}));

export type ValueRowGeometry = {
  /** The row's width, its insets included. */
  width: number;
  /** One-line widths of the title and the value. */
  title: number;
  value: number;
  /** A leading icon, and the chevron of a pressable row. */
  icon: boolean;
  chevron: boolean;
};

/**
 * DQ-138: whether the value goes under the title. It does when the title would not stay on one line beside it, or when
 * the value would not stay on one line in its half of the row (ListRow gives the trailing part 50 % at most). `null`
 * until all three widths are measured.
 */
export function valueStacks({ width, title, value, icon, chevron }: ValueRowGeometry): boolean | null {
  if (width <= 0 || title <= 0 || value <= 0) return null;
  const content = width - 2 * ROW_INSET;
  const lead = icon ? size.icon.m + space[12] : 0;
  const end = value + (chevron ? space[8] + size.icon.s : 0);
  if (end > content / 2) return true;
  return lead + title + space[12] + end > content;
}

export type ValueRowProps = Omit<ListRowProps, 'subtitle' | 'value' | 'inset'> & { value: string };

/** A ListRow with a value beside the title while the title fits on one line there, and under it once it does not. */
export function ValueRow({ value, ...row }: ValueRowProps) {
  const styles = useStyles();
  const theme = useTheme();
  const [widths, setWidths] = useState({ width: 0, title: 0, value: 0 });
  const measured = (key: keyof typeof widths) => (event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.width);
    setWidths((current) => (current[key] === next ? current : { ...current, [key]: next }));
  };
  const stacks =
    valueStacks({ ...widths, icon: Boolean(row.icon), chevron: row.chevron ?? (Boolean(row.onPress) && !row.control) }) ??
    theme.fontScale >= STACKED_VALUE_FONT_SCALE;

  return (
    <View onLayout={measured('width')}>
      <ListRow {...row} {...(stacks ? { subtitle: value } : { value })} inset={ROW_INSET} />
      <View aria-hidden style={styles.measure}>
        <Text variant="body" hyphenate={false} selectable={false} onLayout={measured('title')}>
          {row.title}
        </Text>
        <Text variant="supporting" hyphenate={false} selectable={false} onLayout={measured('value')}>
          {value}
        </Text>
      </View>
    </View>
  );
}
