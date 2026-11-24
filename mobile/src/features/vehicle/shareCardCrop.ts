/**
 * R5-2e VEH-07 2.0 (12_CLIENT_ROUND_5 "share card contract"): the crop of the card's photo, exactly as the server computes it. The
 * window has the aspect of the template's photo box; zoom 1 is the largest such window that fits the photo, zoom z divides it by z;
 * `x`, `y` (0–1) are its centre in the photo, and the window is clamped inside the photo (never letterboxed).
 *
 * Every function here is a worklet as well: the crop gesture runs them on the UI thread.
 */
import type { ShareCardFormat } from '@/api/queries/signature';
import type { components } from '@/api/schema';

export type ShareCardTemplate = components['schemas']['ShareCardTemplate'];
export const SHARE_CARD_TEMPLATES: readonly ShareCardTemplate[] = ['band', 'poster', 'frame'];

export type Size = { readonly width: number; readonly height: number };

/** The contract's photo box table (lead review r1, rule 6), in card pixels (Pest asserts the same numbers). */
export const SHARE_CARD_PHOTO_BOX: Readonly<Record<ShareCardTemplate, Readonly<Record<ShareCardFormat, Size>>>> = {
  band: { square: { width: 1080, height: 600 }, story: { width: 1080, height: 1920 } },
  poster: { square: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } },
  frame: { square: { width: 984, height: 600 }, story: { width: 984, height: 1080 } },
};

/** The card itself, for the template thumbnails. */
export const SHARE_CARD_SIZE: Readonly<Record<ShareCardFormat, Size>> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 3;
/** One press of "−" / "+". */
export const CROP_ZOOM_STEP = 0.25;
/** One arrow key on the web: a twentieth of the window. */
export const CROP_KEY_STEP = 0.05;

export type ShareCardCrop = { readonly zoom: number; readonly x: number; readonly y: number };
/** The window in photo pixels. */
export type CropWindow = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number): number {
  'worklet';
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** The largest window of the box's aspect that fits the photo (zoom 1). */
export function baseWindow(photo: Size, box: Size): Size {
  'worklet';
  const aspect = box.width / box.height;
  if (photo.width / photo.height > aspect) return { width: photo.height * aspect, height: photo.height };
  return { width: photo.width, height: photo.width / aspect };
}

/** Zoom as the server reads it: 1.00 – 3.00, two decimals. */
export function clampZoom(zoom: number): number {
  'worklet';
  return round(clamp(Number.isFinite(zoom) ? zoom : CROP_ZOOM_MIN, CROP_ZOOM_MIN, CROP_ZOOM_MAX), 2);
}

/** The window of a crop, clamped inside the photo. */
export function cropWindow(photo: Size, box: Size, crop: ShareCardCrop): CropWindow {
  'worklet';
  const base = baseWindow(photo, box);
  const zoom = clampZoom(crop.zoom);
  const width = base.width / zoom;
  const height = base.height / zoom;
  const left = clamp(crop.x * photo.width - width / 2, 0, photo.width - width);
  const top = clamp(crop.y * photo.height - height / 2, 0, photo.height - height);
  return { left, top, width, height };
}

/**
 * The same crop with its centre where the clamped window really is, rounded as it is sent (zoom 2, x and y 3 decimals). Two crops
 * that draw the same window are then equal, so an untouched crop is the default and the query stays short.
 */
export function normalizeCrop(photo: Size, box: Size, crop: ShareCardCrop): ShareCardCrop {
  'worklet';
  const window = cropWindow(photo, box, crop);
  return {
    zoom: clampZoom(crop.zoom),
    x: round((window.left + window.width / 2) / photo.width, 3),
    y: round((window.top + window.height / 2) / photo.height, 3),
  };
}

/** The server's default: zoom 1 around the photo's focal point, else its centre. */
export function defaultCrop(photo: Size, box: Size, focal: { x: number | null; y: number | null } | null): ShareCardCrop {
  'worklet';
  return normalizeCrop(photo, box, { zoom: CROP_ZOOM_MIN, x: focal?.x ?? 0.5, y: focal?.y ?? 0.5 });
}

export function sameCrop(a: ShareCardCrop, b: ShareCardCrop): boolean {
  'worklet';
  return a.zoom === b.zoom && a.x === b.x && a.y === b.y;
}

/**
 * Moves the window by a drag on the crop view: `dx`, `dy` in view points, the view `viewWidth` wide (its height follows the box).
 * Dragging right shows more of the left of the photo, as a photo under a finger does.
 */
export function panCrop(photo: Size, box: Size, crop: ShareCardCrop, dx: number, dy: number, viewWidth: number): ShareCardCrop {
  'worklet';
  const window = cropWindow(photo, box, crop);
  const pointsPerPixel = viewWidth / window.width;
  const centreX = window.left + window.width / 2 - dx / pointsPerPixel;
  const centreY = window.top + window.height / 2 - dy / pointsPerPixel;
  return normalizeCrop(photo, box, { zoom: crop.zoom, x: centreX / photo.width, y: centreY / photo.height });
}

/** Moves the window by a share of its own size, for the arrow keys and the screen reader actions. */
export function nudgeCrop(photo: Size, box: Size, crop: ShareCardCrop, fx: number, fy: number): ShareCardCrop {
  'worklet';
  const window = cropWindow(photo, box, crop);
  const centreX = window.left + window.width / 2 + fx * window.width;
  const centreY = window.top + window.height / 2 + fy * window.height;
  return normalizeCrop(photo, box, { zoom: crop.zoom, x: centreX / photo.width, y: centreY / photo.height });
}

/** Zooms around the window's centre (the centre is clamped again when the window grows at an edge). */
export function zoomCrop(photo: Size, box: Size, crop: ShareCardCrop, zoom: number): ShareCardCrop {
  'worklet';
  const window = cropWindow(photo, box, crop);
  return normalizeCrop(photo, box, {
    zoom,
    x: (window.left + window.width / 2) / photo.width,
    y: (window.top + window.height / 2) / photo.height,
  });
}

/**
 * How the local preview draws a crop: the whole photo `width` × `height` points, moved by `translateX`, `translateY`, inside a view
 * `viewWidth` wide at the box's aspect, so that exactly the window fills the view.
 */
export function cropLayout(photo: Size, box: Size, crop: ShareCardCrop, viewWidth: number): { width: number; height: number; translateX: number; translateY: number } {
  'worklet';
  const window = cropWindow(photo, box, crop);
  const scale = viewWidth / window.width;
  return { width: photo.width * scale, height: photo.height * scale, translateX: -window.left * scale, translateY: -window.top * scale };
}
