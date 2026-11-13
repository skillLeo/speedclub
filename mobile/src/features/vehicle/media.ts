/**
 * Photos of a vehicle as the screens need them (§7): the variant that fills the box on this screen, the blurhash, the
 * focal point set in GAR-08, and the larger file for the viewer.
 */
import { PixelRatio } from 'react-native';

import type { MediaCategory, VehicleMedia } from '@/api/queries/vehicles';
import type { PhotoFields, ViewerImage } from '@/ui';

/** The categories of the gallery (VEH-03), in the order of the media resource. */
export const MEDIA_CATEGORIES: readonly MediaCategory[] = ['exterior', 'interior', 'engine', 'wheels', 'detail', 'other'];

function sortedVariants(media: VehicleMedia | null | undefined) {
  return [...(media?.variants ?? [])].sort((a, b) => a.width - b.width);
}

/** The smallest variant that fills `width` points on this screen, or the largest there is. */
export function variantUrl(media: VehicleMedia | null | undefined, width: number, pixelRatio: number = PixelRatio.get()): string | null {
  const variants = sortedVariants(media);
  const needed = Math.ceil(width * pixelRatio);
  return (variants.find((variant) => variant.width >= needed) ?? variants[variants.length - 1])?.url ?? null;
}

/** What `Photo` needs. A photo that is still processing or failed has no variants, and `Photo` keeps its surface. */
export function photoFields(media: VehicleMedia | null | undefined, width: number): PhotoFields {
  if (!media) return { source: null };
  const focal = media.focal_x !== null && media.focal_y !== null ? { x: media.focal_x, y: media.focal_y } : null;
  return { source: variantUrl(media, width), blurhash: media.blurhash, thumbhash: media.thumbhash, focal };
}

/** Only photos with a file can be shown; the owner alone sees the others, in GAR-07. */
export function visiblePhotos(photos: readonly VehicleMedia[]): VehicleMedia[] {
  return photos.filter((photo) => photo.variants.length > 0);
}

/** The viewer zooms up to 4 ×, so it takes the largest file. The ratio comes from the stored size. */
export function viewerImages(photos: readonly VehicleMedia[], fallbackAlt: string): ViewerImage[] {
  return visiblePhotos(photos).flatMap((photo) => {
    const variants = sortedVariants(photo);
    const largest = variants[variants.length - 1];
    if (!largest) return [];
    const width = photo.width ?? largest.width;
    const height = photo.height ?? largest.height;
    return [
      {
        uri: largest.url,
        ...(photo.blurhash ? { blurhash: photo.blurhash } : {}),
        ...(width > 0 && height > 0 ? { aspectRatio: width / height } : {}),
        alt: photo.alt || fallbackAlt,
      },
    ];
  });
}

/** Photos of one gallery category, or all of them. */
export function photosIn(photos: readonly VehicleMedia[], category: MediaCategory | 'all'): VehicleMedia[] {
  const shown = visiblePhotos(photos);
  return category === 'all' ? shown : shown.filter((photo) => photo.category === category);
}

/** The categories that hold photos, with their counts, in the fixed order. */
export function categoryCounts(photos: readonly VehicleMedia[]): { category: MediaCategory; count: number }[] {
  const shown = visiblePhotos(photos);
  return MEDIA_CATEGORIES.flatMap((category) => {
    const count = shown.filter((photo) => photo.category === category).length;
    return count > 0 ? [{ category, count }] : [];
  });
}

export function isMediaCategory(value: unknown): value is MediaCategory {
  return typeof value === 'string' && (MEDIA_CATEGORIES as readonly string[]).includes(value);
}
