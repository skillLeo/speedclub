import { useMemo } from 'react';

import { layout, useBreakpoint, type BreakpointKind } from '@/theme';

/** The Entdecken column (DQ-193, ADR-160): 640 wide, centred up to the tablet, on the pane's start edge from 1280. */
export const DISCOVER_COLUMN = layout.feedColumn;

/** One column model in the Entdecken stack: DISC-02, -03 and -04 sit where DISC-01's column is. */
export function useDiscoverColumn() {
  const { gutter, kind, width } = useBreakpoint();
  const desktop = kind === 'desktop';
  const style = useMemo(
    () => ({
      alignSelf: desktop ? ('flex-start' as const) : ('center' as const),
      maxWidth: DISCOVER_COLUMN + 2 * gutter,
      paddingHorizontal: gutter,
      width: '100%' as const,
    }),
    [desktop, gutter],
  );
  return {
    style,
    gutter,
    kind,
    desktop,
    /** The column's inner width, for photo variants and tiles. */
    inner: Math.min(DISCOVER_COLUMN, width - 2 * gutter),
    /** The header's column, so back and title stay on the column. */
    headerWidth: kind === 'phone' ? undefined : DISCOVER_COLUMN + 2 * gutter,
    headerAlign: desktop ? ('start' as const) : ('center' as const),
  };
}

/** DQ-1038 (09 §4.3 web grid, §5 wall): a photo wall takes 2 columns below 768, 3 from 768 to 1279 and 4 from 1280. */
export const WALL_COLUMNS_BY_KIND: Readonly<Record<BreakpointKind, number>> = { phone: 2, tablet: 3, desktop: 4 };

/** The model grid of DISC-03 (rail cards, 09 §5): 2 columns on phones, 3 from 768 in the 640 column. */
export const MODEL_GRID_COLUMNS: Readonly<Record<BreakpointKind, number>> = { phone: 2, tablet: 3, desktop: 3 };

/**
 * DQ-1038: a short wall shows whole rows only, so it never ends on a lone tile: the most whole rows of `columns` within `max`
 * items, and at least one row when there is one. A list shorter than one row is shown as it is.
 */
export function wholeRows(count: number, columns: number, max: number = count): number {
  const cap = Math.min(count, max);
  if (columns <= 1 || cap < columns) return cap;
  return cap - (cap % columns);
}

/**
 * DQ-1038: the width a wall runs in beside the column: the pane less its gutters, up to the content width (1200), so walls
 * use the canvas from 768 instead of the 640 column. `pane` is the width beside the rail or the sidebar.
 */
export function wideWallWidth(pane: number, gutter: number): number {
  return Math.max(0, Math.min(layout.contentMax, pane - 2 * gutter));
}

/** The pane beside the shell's rail (768) or sidebar (1280), before it is measured. */
export function estimatedPane(kind: BreakpointKind, windowWidth: number): number {
  return kind === 'desktop' ? windowWidth - layout.sidebar : kind === 'tablet' ? windowWidth - layout.rail : windowWidth;
}
