import { useMemo } from 'react';

import { layout, useBreakpoint } from '@/theme';

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
