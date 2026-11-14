/**
 * Android widget "Mein Auto" (ADR-454): the main car's photo as a file the widget can draw. The app downloads one variant, cuts
 * the 4:5 hero crop around the photo's focal point (09 §4.6), scales it to 480 × 600 and keeps it as a JPEG in the widget folder.
 * The widget only ever reads that file: no URL is fetched when it renders, and the same variant is never downloaded twice.
 */
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { GarageMedia } from '@/api/queries/garage';

import { focalCrop, PHOTO_ASPECT } from './layout';
import { fileExists, photoFile } from './store';
import type { WidgetPhoto } from './snapshot';

/** The cut photo's width in pixels: a 4 × 2 widget's pane is about 160 dp, 480 px at 3×. */
export const PHOTO_WIDTH = 480;
/** The smallest variant that still leaves the crop at least this wide is downloaded. */
const SOURCE_MIN_WIDTH = 720;
const JPEG_QUALITY = 0.82;

type Variant = GarageMedia['variants'][number];

/** The smallest variant whose 4:5 crop is at least SOURCE_MIN_WIDTH wide, or the largest there is. */
export function pickWidgetVariant(media: Pick<GarageMedia, 'variants'>): Variant | null {
  const variants = [...media.variants].filter((variant) => variant.url && variant.width > 0 && variant.height > 0).sort((a, b) => a.width - b.width);
  const cropWidth = (variant: Variant) => Math.min(variant.width, variant.height * PHOTO_ASPECT);
  return variants.find((variant) => cropWidth(variant) >= SOURCE_MIN_WIDTH) ?? variants[variants.length - 1] ?? null;
}

export type PhotoDeps = {
  download: (url: string, target: File) => Promise<File>;
  cut: (uri: string, crop: ReturnType<typeof focalCrop>) => Promise<string>;
};

const defaultDeps: PhotoDeps = {
  download: (url, target) => File.downloadFileAsync(url, target, { idempotent: true }),
  cut: async (uri, crop) => {
    const context = ImageManipulator.manipulate(uri);
    context.crop(crop).resize({ width: PHOTO_WIDTH });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    return saved.uri;
  },
};

/**
 * The widget photo of `media`: the previous one while it is the same variant and its file exists, else a new cut. Null when the
 * photo has no file yet (processing, failed) or the download fails: the widget keeps its dark pane, and the next sync tries again.
 */
export async function ensureWidgetPhoto(media: GarageMedia | null, previous: WidgetPhoto | null, deps: PhotoDeps = defaultDeps): Promise<WidgetPhoto | null> {
  if (!media || media.status !== 'ready') return null;
  const variant = pickWidgetVariant(media);
  if (!variant) return null;
  if (previous && previous.mediaId === media.id && previous.source === variant.url && fileExists(previous.uri)) return previous;

  const focal = media.focal_x !== null && media.focal_y !== null ? { x: media.focal_x, y: media.focal_y } : null;
  const temp = new File(Paths.cache, `widget-source-${media.id}`);
  try {
    const downloaded = await deps.download(variant.url, temp);
    const cutUri = await deps.cut(downloaded.uri, focalCrop(variant.width, variant.height, focal));
    const target = photoFile(`car-${media.id}-${variant.width}.jpg`);
    await new File(cutUri).move(target, { overwrite: true });
    return {
      uri: target.uri,
      mediaId: media.id,
      source: variant.url,
      width: PHOTO_WIDTH,
      height: Math.round(PHOTO_WIDTH / PHOTO_ASPECT),
    };
  } catch (error) {
    console.warn('The widget photo could not be prepared', error);
    return null;
  } finally {
    try {
      if (temp.exists) temp.delete();
    } catch {
      // A leftover in the cache is removed by the system.
    }
  }
}
