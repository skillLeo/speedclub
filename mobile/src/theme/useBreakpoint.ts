import { useWindowDimensions } from 'react-native';

import { layout } from './tokens.generated';

export type BreakpointKind = 'phone' | 'tablet' | 'desktop';

export type Breakpoint = { kind: BreakpointKind; width: number; gutter: number; columns: number };

export function breakpointFor(width: number): Breakpoint {
  const kind: BreakpointKind =
    width >= layout.breakpoints.desktop ? 'desktop' : width >= layout.breakpoints.tablet ? 'tablet' : 'phone';
  const gutter =
    kind === 'desktop'
      ? layout.gutter.desktop
      : kind === 'tablet'
        ? layout.gutter.tablet
        : // Android dp widths are fractional: everything below 390 is compact, 389.5 included.
          width < layout.compactMaxWidth + 1
          ? layout.gutter.compact
          : layout.gutter.regular;
  return { kind, width, gutter, columns: layout.grid[kind].columns };
}

export function useBreakpoint(): Breakpoint {
  return breakpointFor(useWindowDimensions().width);
}
