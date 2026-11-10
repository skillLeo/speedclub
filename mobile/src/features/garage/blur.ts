/**
 * GAR-08 [SIG `sig.plate_blur`] (02_PRODUCT_SPEC §5, §9): the regions a member marks on a photo before the server pixelates
 * them in every variant and in the private original. Everything here is normalised to the photo, 0 to 1 from its top left,
 * which is what `PATCH media/{id}` takes (`blur_regions: [{x, y, w, h}]`, at most 10).
 */

export type BlurRegion = { x: number; y: number; w: number; h: number };

export type Point = { x: number; y: number };

/** The API's limit per photo. */
export const MAX_BLUR_REGIONS = 10;

/** A rectangle under this share of the photo's side is a slip of the finger, not a plate. */
export const MIN_REGION_SIDE = 0.02;

/** One arrow key press; with Shift the region moves this many times as far. */
export const NUDGE_STEP = 0.01;
export const NUDGE_FAST = 5;

/** A region added without drawing (a button, a screen reader): centred, wide like a number plate. */
export const DEFAULT_REGION: BlurRegion = { x: 0.35, y: 0.45, w: 0.3, h: 0.1 };

const PRECISION = 10_000;

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The rectangle between two points of a drag, in any direction, clipped to the photo. `size` is the drawn stage, so a drag
 * outside its edges stops at them. Null when it is too small to mean anything.
 */
export function regionFromDrag(start: Point, end: Point, size: { width: number; height: number }): BlurRegion | null {
  if (size.width <= 0 || size.height <= 0) return null;
  const x1 = clamp01(start.x / size.width);
  const y1 = clamp01(start.y / size.height);
  const x2 = clamp01(end.x / size.width);
  const y2 = clamp01(end.y / size.height);
  const region = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  if (region.w < MIN_REGION_SIDE || region.h < MIN_REGION_SIDE) return null;
  return normaliseRegion(region);
}

/** Inside the photo whatever came in: the size first, then the position, so a region never pokes out of an edge. */
export function normaliseRegion(region: BlurRegion): BlurRegion {
  const w = Math.max(MIN_REGION_SIDE, clamp01(region.w));
  const h = Math.max(MIN_REGION_SIDE, clamp01(region.h));
  const x = Math.min(clamp01(region.x), 1 - w);
  const y = Math.min(clamp01(region.y), 1 - h);
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

export type NudgeKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

const DIRECTIONS: Record<NudgeKey, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function isNudgeKey(key: string | undefined): key is NudgeKey {
  return key !== undefined && key in DIRECTIONS;
}

/**
 * Keyboard nudge: the arrows move the region, with Alt they resize it from its bottom right corner (Left/Up smaller,
 * Right/Down larger), Shift makes either five times as far. It stays inside the photo and never below the minimum size.
 */
export function nudgeRegion(region: BlurRegion, key: NudgeKey, options: { fast?: boolean; resize?: boolean } = {}): BlurRegion {
  const [dx, dy] = DIRECTIONS[key];
  const step = NUDGE_STEP * (options.fast ? NUDGE_FAST : 1);
  if (options.resize) {
    const w = Math.min(1 - region.x, Math.max(MIN_REGION_SIDE, region.w + dx * step));
    const h = Math.min(1 - region.y, Math.max(MIN_REGION_SIDE, region.h + dy * step));
    return normaliseRegion({ ...region, w, h });
  }
  return normaliseRegion({ ...region, x: region.x + dx * step, y: region.y + dy * step });
}

/** Adds a region unless the photo already has the most it may have. Returns the same list when it is full. */
export function addRegion(regions: readonly BlurRegion[], region: BlurRegion): readonly BlurRegion[] {
  if (regions.length >= MAX_BLUR_REGIONS) return regions;
  return [...regions, normaliseRegion(region)];
}

export function replaceRegion(regions: readonly BlurRegion[], index: number, region: BlurRegion): readonly BlurRegion[] {
  if (index < 0 || index >= regions.length) return regions;
  return regions.map((entry, at) => (at === index ? normaliseRegion(region) : entry));
}

export function removeRegion(regions: readonly BlurRegion[], index: number): readonly BlurRegion[] {
  return regions.filter((_, at) => at !== index);
}

export function canAddRegion(regions: readonly BlurRegion[]): boolean {
  return regions.length < MAX_BLUR_REGIONS;
}

/** What goes to the API: at most 10 regions, each inside the photo. */
export function blurPayload(regions: readonly BlurRegion[]): BlurRegion[] {
  return regions.slice(0, MAX_BLUR_REGIONS).map(normaliseRegion);
}

/** "x 35 %, y 45 %, 30 × 10 %" for a screen reader: where the region is, in whole percent of the photo. */
export function regionPercent(region: BlurRegion): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(region.x * 100),
    y: Math.round(region.y * 100),
    w: Math.round(region.w * 100),
    h: Math.round(region.h * 100),
  };
}

/** The region under a tap (normalised point), the one drawn last when they overlap; -1 for none. */
export function regionAt(regions: readonly BlurRegion[], point: Point): number {
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index];
    if (region && point.x >= region.x && point.x <= region.x + region.w && point.y >= region.y && point.y <= region.y + region.h) return index;
  }
  return -1;
}

/** A drag shorter than this many points is a tap: it selects instead of drawing. */
export const TAP_SLOP = 8;
