import { useCallback, useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { estimatedPane, wideWallWidth } from '@/features/discover/layout';
import { layout, space, useBreakpoint, type BreakpointKind } from '@/theme';

/** DEX-01's card grid (09 §4.3 web grid, §5 walls): 2 columns on phones, 3 from 768, 4 from 1280. */
export const CARD_COLUMNS: Readonly<Record<BreakpointKind, number>> = { phone: 2, tablet: 3, desktop: 4 };
/**
 * DEX-05's binder pages: 3 to a phone row (DQ-P5G-09; a name that needs more than two lines there takes the wordmark's shrink pair,
 * ADR-515), 4 from 768, 6 from 1280 (two of the 12 columns each).
 */
export const SLOT_COLUMNS: Readonly<Record<BreakpointKind, number>> = { phone: 3, tablet: 4, desktop: 6 };
/** Between the tiles of a row; the rows keep 16. */
export const TILE_GAP = space[12];
export const ROW_GAP = space[16];

/** `list` in rows of `columns`. */
export function chunk<T>(list: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  const size = Math.max(1, columns);
  for (let index = 0; index < list.length; index += size) rows.push(list.slice(index, index + size));
  return rows;
}

/** The width of one tile of `columns` in a row `width` wide. */
export function tileWidth(width: number, columns: number): number {
  return columns > 0 && width > 0 ? Math.floor((width - TILE_GAP * (columns - 1)) / columns) : 0;
}

/**
 * The Dex screens' column: the phone's width less its gutters; from 768 the pane beside the rail or the sidebar, up to the content
 * width (1200), so the grid uses the canvas (DQ-1038). On the desktop it starts on the pane's start edge, as Entdecken.
 */
export function useDexGrid(columnsByKind: Readonly<Record<BreakpointKind, number>>) {
  const { gutter, kind, width } = useBreakpoint();
  const [measured, setMeasured] = useState<number | null>(null);
  const pane = measured ?? estimatedPane(kind, width);
  const inner = kind === 'phone' ? Math.max(0, pane - 2 * gutter) : wideWallWidth(pane, gutter);
  const columns = columnsByKind[kind];
  const desktop = kind === 'desktop';
  const style = useMemo(
    () => ({
      alignSelf: desktop ? ('flex-start' as const) : ('center' as const),
      maxWidth: layout.contentMax + 2 * gutter,
      paddingHorizontal: gutter,
      width: '100%' as const,
    }),
    [desktop, gutter],
  );
  const onPaneLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0) setMeasured(next);
  }, []);
  return {
    gutter,
    kind,
    inner,
    columns,
    tile: tileWidth(inner, columns),
    style,
    onPaneLayout,
    headerWidth: kind === 'phone' ? undefined : layout.contentMax + 2 * gutter,
    headerAlign: desktop ? ('start' as const) : ('center' as const),
  };
}
