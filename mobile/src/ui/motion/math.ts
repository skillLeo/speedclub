/**
 * The pure geometry of the signature motions (09 §4.7, SM1–SM20). Every function is a worklet, so gestures and animated
 * styles call it on the UI thread, and none reads a device setting, so Jest checks the numbers without a renderer.
 */

export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  'worklet';
  return clamp(value, 0, 1);
}

export function lerp(from: number, to: number, progress: number): number {
  'worklet';
  return from + (to - from) * progress;
}

/* ------------------------------------------------------------------ mask wipe (SM1, SM8 check, SM13 print, SM17 clip) */

export type WipeFrom = 'start' | 'end';

/**
 * A mask wipe from transforms alone: the clipping box moves by `outer` and its content back by `inner`, so the content stays
 * put while the visible window grows. `progress` 0 shows nothing, 1 everything; `from: 'start'` uncovers left → right (or
 * top → bottom), `'end'` the other way. No width or height animates (09 §4.7: transform and opacity only).
 */
export function wipeOffsets(progress: number, size: number, from: WipeFrom): { outer: number; inner: number } {
  'worklet';
  const hidden = (1 - clamp01(progress)) * size;
  return from === 'start' ? { outer: -hidden, inner: hidden } : { outer: hidden, inner: -hidden };
}

/* ------------------------------------------------------------------ rubber band and swipe actions (SM10, SM11, SM20) */

/**
 * The iOS rubber band: past an edge, the content follows the finger ever more slowly and never further than `dimension`.
 * `overshoot` is the distance past the edge (≥ 0), `coefficient` the token (`swipeActions.rubberBand`, 0.55 as UIScrollView).
 */
export function rubberBand(overshoot: number, dimension: number, coefficient: number): number {
  'worklet';
  if (overshoot <= 0 || dimension <= 0) return 0;
  return (1 - 1 / ((overshoot * coefficient) / dimension + 1)) * dimension;
}

/**
 * The row's offset for a finger at `translation` (negative = left) from `start`. Inside [-limit, 0] it follows the finger;
 * past either end it rubber-bands. `limit` is the actions' width, or the row's width for a row with a full-swipe commit, so
 * a plain row stops short of the screen edge and a right drag on a closed row barely moves.
 */
export function swipeOffset(start: number, translation: number, limit: number, rowWidth: number, coefficient: number): number {
  'worklet';
  const raw = start + translation;
  if (raw > 0) return rubberBand(raw, rowWidth, coefficient);
  if (raw < -limit) return -limit - rubberBand(-raw - limit, rowWidth, coefficient);
  return raw;
}

/**
 * SM11 swipe-to-reply (MSG-02): a bubble follows a rightward finger up to `threshold`, then rubber-bands; a leftward finger leaves it
 * where it is (0). `width` is the row's width, the rubber band's dimension.
 */
export function replyOffset(translation: number, threshold: number, width: number, coefficient: number): number {
  'worklet';
  if (translation <= 0) return 0;
  if (translation <= threshold) return translation;
  return threshold + rubberBand(translation - threshold, width, coefficient);
}

export type SwipeSettle = 'closed' | 'open' | 'commit';

export type SwipeRules = { readonly commitRatio: number; readonly flingVelocity: number; readonly fullSwipe: boolean };

/**
 * Where a released row settles: `commit` (the first action runs) past `commitRatio` of the row with a full swipe allowed,
 * `open` (actions shown) past half the actions or on a left fling, `closed` on a right fling or short of half.
 */
export function swipeSettle(offset: number, velocityX: number, actionsWidth: number, rowWidth: number, rules: SwipeRules): SwipeSettle {
  'worklet';
  if (rules.fullSwipe && rowWidth > 0 && -offset >= rowWidth * rules.commitRatio) return 'commit';
  if (velocityX >= rules.flingVelocity) return 'closed';
  if (velocityX <= -rules.flingVelocity) return 'open';
  return -offset > actionsWidth / 2 ? 'open' : 'closed';
}

/** The commit threshold of a full swipe, in points from the closed position (negative, the row moves left). */
export function commitThreshold(rowWidth: number, commitRatio: number): number {
  'worklet';
  return -rowWidth * commitRatio;
}

/**
 * True when a move from `previous` to `next` crosses `threshold` in either direction: the one moment a threshold haptic
 * plays (09 §4.8, never per frame).
 */
export function crossed(previous: number, next: number, threshold: number): boolean {
  'worklet';
  return (previous > threshold && next <= threshold) || (previous <= threshold && next > threshold);
}

/** A toast's swipe-away (SM20): far enough or fast enough to either side. */
export function shouldDismiss(translation: number, velocity: number, width: number, ratio: number, flingVelocity: number): boolean {
  'worklet';
  if (width <= 0) return false;
  return Math.abs(translation) >= width * ratio || (Math.abs(velocity) >= flingVelocity && Math.sign(velocity) === Math.sign(translation));
}

/* ------------------------------------------------------------------ odometer (SM6, SM18) */

export type OdometerCell =
  | { readonly kind: 'digit'; readonly key: string; readonly from: number; readonly to: number }
  | { readonly kind: 'static'; readonly key: string; readonly char: string };

const isDigit = (char: string) => char >= '0' && char <= '9';

/**
 * The cells of a rolling number, aligned from the right so units stay units ("128" → "1.024": the new thousands digit and
 * the separator appear, every other digit rolls in its own column). A digit without a counterpart rolls from 0. Keys are
 * the position from the right, so a column keeps its identity while the value changes.
 */
export function odometerCells(from: string, to: string): OdometerCell[] {
  const cells: OdometerCell[] = [];
  for (let i = 0; i < to.length; i += 1) {
    const char = to[to.length - 1 - i]!;
    const before = from[from.length - 1 - i];
    const key = `p${i}`;
    if (isDigit(char)) {
      cells.unshift({ kind: 'digit', key, from: before !== undefined && isDigit(before) ? Number(before) : 0, to: Number(char) });
    } else {
      cells.unshift({ kind: 'static', key, char });
    }
  }
  return cells;
}

/** The column's offset for a digit: the column holds 0–9 top to bottom, one line each. */
export function digitOffset(digit: number, lineHeight: number): number {
  'worklet';
  return -digit * lineHeight;
}

/* ------------------------------------------------------------------ carousel and reorder (SM16) */

/**
 * The carousel card at the centre for a scroll offset: the nearest whole interval, kept inside the list. 0 for an empty or
 * unmeasured carousel. Independent of reduced motion: the focus moves the same way, only the scale differs.
 */
export function carouselIndex(scrollX: number, interval: number, count: number): number {
  'worklet';
  if (interval <= 0 || count <= 0) return 0;
  return Math.min(Math.max(Math.round(scrollX / interval), 0), count - 1);
}

/** The scroll offset as a fraction of an interval (the SM2 `PageIndicator` progress), 0 while unmeasured. */
export function carouselProgress(scrollX: number, interval: number): number {
  'worklet';
  return interval > 0 ? scrollX / interval : 0;
}

/**
 * A card's scale and opacity from the carousel's scroll position: 1 / 1 when centred, the neighbour values one interval
 * away and beyond. Reduced motion keeps the scale at 1 (09 §4.7), the opacity still tells where the focus is.
 */
export function carouselNeighbour(
  scrollX: number,
  index: number,
  interval: number,
  neighbourScale: number,
  neighbourOpacity: number,
  reduced: boolean,
): { scale: number; opacity: number } {
  'worklet';
  if (interval <= 0) return { scale: 1, opacity: 1 };
  const distance = clamp01(Math.abs(scrollX / interval - index));
  return { scale: reduced ? 1 : lerp(1, neighbourScale, distance), opacity: lerp(1, neighbourOpacity, distance) };
}

/** The card a snapping carousel rests on for a scroll position. */
export function snapIndex(scrollX: number, interval: number, count: number): number {
  'worklet';
  if (interval <= 0 || count <= 0) return 0;
  return clamp(Math.round(scrollX / interval), 0, count - 1);
}

/** Where a card dragged `translation` from slot `from` drops, in a row of `count` slots `interval` apart. */
export function reorderTarget(from: number, translation: number, interval: number, count: number): number {
  'worklet';
  if (interval <= 0 || count <= 0) return from;
  return clamp(from + Math.round(translation / interval), 0, count - 1);
}

/**
 * How far a card that is not dragged moves while `from` is dragged over `to`: one slot towards the gap, or not at all.
 */
export function reorderShift(index: number, from: number, to: number, interval: number): number {
  'worklet';
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -interval;
  if (from > to && index < from && index >= to) return interval;
  return 0;
}

/** The list after moving `from` to `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/* ------------------------------------------------------------------ reaction picker (SM9) */

/**
 * The reaction under the finger: the picker's items are `itemSize` wide with `gap` between them, starting at the picker's
 * left edge; `x` is relative to that edge. -1 outside the picker (lifting there cancels).
 */
export function reactionIndexAt(x: number, y: number, count: number, itemSize: number, gap: number, slopY: number): number {
  'worklet';
  if (count <= 0 || itemSize <= 0) return -1;
  if (y < -slopY || y > itemSize + slopY) return -1;
  const step = itemSize + gap;
  const width = count * itemSize + (count - 1) * gap;
  if (x < 0 || x > width) return -1;
  return clamp(Math.floor((x + gap / 2) / step), 0, count - 1);
}

/** The left edge of item `index` in the picker. */
export function reactionItemX(index: number, itemSize: number, gap: number): number {
  'worklet';
  return index * (itemSize + gap);
}

/* ------------------------------------------------------------------ flights: hero expand (SM4), message send (SM12) */

export type FlightTransform = { translateX: number; translateY: number; scaleX: number; scaleY: number };

/**
 * The transform that draws a box laid out at `to` exactly over `from` (centre-anchored, as React Native transforms are).
 * Progress 0 → this, 1 → identity: the clone flies from the source to the destination.
 */
export function flightTransform(from: Rect, to: Rect): FlightTransform {
  'worklet';
  const scaleX = to.width > 0 ? from.width / to.width : 1;
  const scaleY = to.height > 0 ? from.height / to.height : 1;
  return {
    translateX: from.x + from.width / 2 - (to.x + to.width / 2),
    translateY: from.y + from.height / 2 - (to.y + to.height / 2),
    scaleX,
    scaleY,
  };
}

/** The flight at `progress` (may overshoot 1 on a bouncy spring). */
export function flightAt(start: FlightTransform, progress: number): FlightTransform {
  'worklet';
  return {
    translateX: lerp(start.translateX, 0, progress),
    translateY: lerp(start.translateY, 0, progress),
    scaleX: lerp(start.scaleX, 1, progress),
    scaleY: lerp(start.scaleY, 1, progress),
  };
}

/** Where a flight's clone is on screen at `progress` (window rect): the start of a reverse flight that takes over mid-air. */
export function flightRectAt(from: Rect, to: Rect, progress: number): Rect {
  'worklet';
  const now = flightAt(flightTransform(from, to), progress);
  const width = to.width * now.scaleX;
  const height = to.height * now.scaleY;
  const cx = to.x + to.width / 2 + now.translateX;
  const cy = to.y + to.height / 2 + now.translateY;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * The counter-scale of the content inside a non-uniformly scaled clip, so a photo keeps its aspect and covers the clip
 * (as `contentFit="cover"` does) at every frame of the flight.
 */
export function coverCounterScale(scaleX: number, scaleY: number): { scaleX: number; scaleY: number } {
  'worklet';
  const sx = Math.max(scaleX, 1e-3);
  const sy = Math.max(scaleY, 1e-3);
  const cover = Math.max(sx, sy);
  return { scaleX: cover / sx, scaleY: cover / sy };
}

/** The clip's corner radius in its own (scaled) coordinates, so the corner looks `radius` on screen. */
export function flightRadius(radiusFrom: number, radiusTo: number, progress: number, scaleX: number, scaleY: number): number {
  'worklet';
  const visual = Math.max(0, lerp(radiusFrom, radiusTo, clamp01(progress)));
  return visual / Math.max(Math.min(scaleX, scaleY), 1e-3);
}

/* ------------------------------------------------------------------ stretchy hero (SM5), pager (SM2) */

/**
 * The hero under a scroll offset: pulled down (negative offset), it scales from the top up to `maxScale`; scrolled up, it
 * moves at `parallax` of the scroll (it trails the content). Reduced motion: neither.
 */
export function stretchyHero(offset: number, height: number, maxScale: number, parallax: number, reduced: boolean): { scale: number; translateY: number } {
  'worklet';
  if (reduced || height <= 0) return { scale: 1, translateY: 0 };
  if (offset < 0) return { scale: Math.min(maxScale, 1 + -offset / height), translateY: 0 };
  return { scale: 1, translateY: offset * parallax };
}

/** The header's background and `scrim.top` (0 → 1) as the hero's lower part passes under a header `headerHeight` tall. */
export function heroHeaderFade(offset: number, heroHeight: number, headerHeight: number): number {
  'worklet';
  const end = heroHeight - headerHeight;
  if (end <= 0) return offset > 0 ? 1 : 0;
  const start = Math.max(0, end - headerHeight);
  return clamp01((offset - start) / Math.max(1, end - start));
}

/** A pager photo's horizontal shift: it trails its page at `factor` of the page offset. */
export function pagerParallax(scrollX: number, index: number, pageWidth: number, factor: number, reduced: boolean): number {
  'worklet';
  if (reduced || pageWidth <= 0) return 0;
  return (scrollX - index * pageWidth) * factor;
}

/**
 * The page indicator's pill (SM2), as left and right edge in points: at a whole page it is `active` wide over its dot;
 * between pages its leading edge runs ahead and the trailing edge follows, so the pill stretches and settles.
 */
export function indicatorEdges(progress: number, dot: number, gap: number, active: number): { left: number; right: number } {
  'worklet';
  const step = dot + gap;
  const base = Math.floor(progress);
  const t = progress - base;
  const leftOf = (index: number) => index * step + dot / 2 - active / 2;
  const leftHere = leftOf(base);
  const leftNext = leftOf(base + 1);
  // The leading edge covers the way in the first half, the trailing edge in the second.
  const lead = clamp01(t * 2);
  const trail = clamp01(t * 2 - 1);
  return { left: lerp(leftHere, leftNext, trail), right: lerp(leftHere, leftNext, lead) + active };
}

/* ------------------------------------------------------------------ before/after (SM17), circular reveal (SM14) */

/** The divider position (0–1) after a drag of `translation` from `start` across `width`. */
export function dividerPosition(start: number, translation: number, width: number): number {
  'worklet';
  if (width <= 0) return clamp01(start);
  return clamp01(start + translation / width);
}

/** The radius that covers a `width` × `height` box from `origin`: the distance to its farthest corner. */
export function coveringRadius(origin: { x: number; y: number }, width: number, height: number): number {
  'worklet';
  const dx = Math.max(origin.x, width - origin.x);
  const dy = Math.max(origin.y, height - origin.y);
  return Math.sqrt(dx * dx + dy * dy);
}
