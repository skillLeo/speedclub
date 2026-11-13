import { useWindowDimensions } from 'react-native';

import { layout } from './tokens.generated';

export type BreakpointKind = 'phone' | 'tablet' | 'desktop';

export type Breakpoint = { kind: BreakpointKind; width: number; gutter: number; columns: number };

export function breakpointFor(width: number): Breakpoint {
  const kind: BreakpointKind =
    width >= layout.breakpoints.desktop ? 'desktop' : width >= layout.breakpoints.tablet ? 'tablet' : 'phone';
  // 09 §4.3: 20 on phones below 430 pt, 24 from 430 (large phones), on tablets and on desktop.
  const gutter =
    kind === 'desktop'
      ? layout.gutter.desktop
      : kind === 'tablet'
        ? layout.gutter.tablet
        : width >= layout.phoneLargeMinWidth
          ? layout.gutter.phoneLarge
          : layout.gutter.phone;
  return { kind, width, gutter, columns: layout.grid[kind].columns };
}

export function useBreakpoint(): Breakpoint {
  return breakpointFor(useWindowDimensions().width);
}
