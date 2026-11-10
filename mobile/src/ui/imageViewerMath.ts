/** §8 image viewer limits. */
export const VIEWER_MIN_SCALE = 1;
export const VIEWER_MAX_SCALE = 4;
export const VIEWER_DOUBLE_TAP_SCALE = 2;
export const DISMISS_DISTANCE = 120;
export const DISMISS_VELOCITY = 800;
/** A flick to the next photo. */
export const PAGE_VELOCITY = 800;

export function clampScale(scale: number): number {
  'worklet';
  return Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, scale));
}

export function shouldDismiss(translationY: number, velocityY: number): boolean {
  'worklet';
  return Math.abs(translationY) > DISMISS_DISTANCE || Math.abs(velocityY) > DISMISS_VELOCITY;
}

/** The on-screen size of a photo fitted into the stage, before zoom. */
export function fittedSize(
  stageWidth: number,
  stageHeight: number,
  aspect: number,
): { width: number; height: number } {
  'worklet';
  if (aspect <= 0) return { width: stageWidth, height: stageHeight };
  const height = stageWidth / aspect;
  return height <= stageHeight ? { width: stageWidth, height } : { width: stageHeight * aspect, height: stageHeight };
}

/** How far a zoomed photo may move on one axis before an edge leaves the edge of the stage. */
export function panLimit(fitted: number, stage: number, scale: number): number {
  'worklet';
  return Math.max(0, (fitted * scale - stage) / 2);
}

export function clampPan(value: number, limit: number): number {
  'worklet';
  return Math.min(limit, Math.max(-limit, value));
}

/** The translation that keeps the point under `focal` in place during a zoom. `focal` is relative to the stage centre. */
export function zoomAround(focal: number, translation: number, fromScale: number, toScale: number): number {
  'worklet';
  return focal - ((focal - translation) * toScale) / fromScale;
}

/** The page a released horizontal drag settles on. */
export function nextPage(index: number, count: number, translationX: number, velocityX: number, width: number): number {
  'worklet';
  let next = index;
  if (translationX < -width / 2 || velocityX < -PAGE_VELOCITY) next = index + 1;
  else if (translationX > width / 2 || velocityX > PAGE_VELOCITY) next = index - 1;
  return Math.min(count - 1, Math.max(0, next));
}
