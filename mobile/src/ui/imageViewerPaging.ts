/**
 * R5-2d: paging and touch rules of the image viewer (VEH-04), apart from its zoom maths (`imageViewerMath`). Worklets, so the
 * gestures read them on the UI thread.
 */

/**
 * How far a finger may travel and still be a tap, and how far it travels before a drag pans. One number for both, so a touch is
 * either a tap or a drag: without a limit on the double tap, two quick swipes counted as two taps and zoomed the photo.
 */
export const VIEWER_TOUCH_SLOP = 8;

/** The page a viewer shows for a requested index: within the photos, 0 without any. */
export function clampIndex(index: number, count: number): number {
  'worklet';
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(index)));
}
