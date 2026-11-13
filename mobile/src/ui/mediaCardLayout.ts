/**
 * 09 §5 MediaCard: the pure geometry of its four variants, so Jest covers it and the skeletons share it.
 *
 * - `lead`: full width, 4:5, 0 radius; the identity sits on the dark stage under the photo and reaches up into the photo only
 *   as far as the scrim's large-text-safe line (`scrimSafe.large`), with body text only below the text-safe line
 *   (`scrimSafe.text`, ADR-421 b).
 * - `wall`: two columns, 2 apart, 0 radius.
 */
import { aspect, scrimSafe, space, type ThemeName } from '@/theme';

import { ratioOf, type PhotoAspect } from './Photo';

export const MEDIA_ASPECT = {
  lead: aspect.hero,
  leadWide: aspect.heroWeb,
  feed: aspect.hero,
  feedSquare: aspect.grid,
  rail: aspect.rail,
  wall: aspect.grid,
  wallTall: aspect.gridTall,
} as const;

/** DQ-963 (09 §4.6): the lead is 4:5 on phones and tablets and 16:9 on the desktop, where 4:5 would push its identity below the fold. */
export function leadAspect(desktop: boolean): PhotoAspect {
  return desktop ? MEDIA_ASPECT.leadWide : MEDIA_ASPECT.lead;
}

/** The wall's columns and the gap between its tiles (09 §5: 2 columns, 2 px gap). */
export const MEDIA_WALL_COLUMNS = 2;
export const MEDIA_WALL_GAP = space[2];

/** The width of one wall tile for a wall `width` wide. */
export function mediaWallTileWidth(width: number, columns: number = MEDIA_WALL_COLUMNS, gap: number = MEDIA_WALL_GAP): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return (width - (columns - 1) * gap) / columns;
}

/** The photo's height at `width` for a ratio such as "4:5". */
export function mediaHeight(width: number, ratio: PhotoAspect): number {
  return width / ratioOf(ratio);
}

/**
 * How far the lead's identity reaches up into its 4:5 photo, as a share of the card's width (a percentage margin counts in
 * the parent's width on every platform): from the bottom edge up to the large-text-safe line.
 */
export function leadOverlapShare(theme: ThemeName, ratio: PhotoAspect = MEDIA_ASPECT.lead): number {
  return (1 - scrimSafe[theme].large) / ratioOf(ratio);
}

/**
 * The space between the lead's title and the body text under it (owner, spec line): at least `space.8`, more where one title
 * line would leave the body above the text-safe line. `titleLine` is the title's line height at the current font scale.
 */
export function leadBodyGap(width: number, theme: ThemeName, titleLine: number, ratio: PhotoAspect = MEDIA_ASPECT.lead): number {
  const height = mediaHeight(width, ratio);
  const needed = (scrimSafe[theme].text - scrimSafe[theme].large) * height - titleLine;
  return Math.max(space[8], Math.ceil(needed));
}

/** The page of a horizontal pager at `offset`, clamped to the photos there are. */
export function pageAt(offset: number, pageWidth: number, count: number): number {
  if (pageWidth <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offset / pageWidth)));
}
