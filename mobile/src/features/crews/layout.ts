import type { BreakpointKind } from '@/theme';

/**
 * R4DQ-05: one column on phones; from 768 the cards stand two across, from 1280 three (09 §6 web layout, content to 1200), packed
 * as a masonry so a long name or a cover never leaves a hole under its neighbour.
 */
export function crewColumns(kind: BreakpointKind): number {
  return kind === 'desktop' ? 3 : kind === 'tablet' ? 2 : 1;
}
