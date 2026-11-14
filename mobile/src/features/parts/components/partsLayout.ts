import { useMemo } from 'react';

import { estimatedPane, useDiscoverColumn, wideWallWidth } from '@/features/discover/layout';
import { layout, space, useBreakpoint } from '@/theme';

/** The 12-column split of BRD-01/02 on the desktop (DQ-1142, 09 §7.15): the page in 8, key data in 4, as VEH-01 (ADR-448). */
const MAIN_COLS = layout.vehicleDesktop.galleryCols;
const SIDE_COLS = layout.vehicleDesktop.specCols;
/** The gap between the two columns: the desktop grid's gutter. */
export const SPLIT_GAP = layout.grid.desktop.gutter;

/**
 * BRD-01/02 width model: the Entdecken column on phones and tablets; from 1280 the content width (up to 1200) on the pane's start
 * edge, split 8/4, so the desktop is no longer a phone column on a 1,040 canvas (DQ-1142).
 */
export function usePartsColumns() {
  const column = useDiscoverColumn();
  const { width, kind } = useBreakpoint();
  const split = kind === 'desktop';
  const inner = split ? wideWallWidth(estimatedPane(kind, width), column.gutter) : column.inner;
  const main = split ? Math.floor(((inner - SPLIT_GAP) * MAIN_COLS) / (MAIN_COLS + SIDE_COLS)) : inner;
  const style = useMemo(
    () =>
      split
        ? { alignSelf: 'flex-start' as const, maxWidth: layout.contentMax + 2 * column.gutter, paddingHorizontal: column.gutter, width: '100%' as const }
        : column.style,
    [column.gutter, column.style, split],
  );
  return { ...column, split, inner, main, side: split ? inner - main - SPLIT_GAP : inner, style, gap: space[32] };
}
