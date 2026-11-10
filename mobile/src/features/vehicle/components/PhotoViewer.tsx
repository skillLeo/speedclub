import { useMemo, type ReactNode } from 'react';

import type { VehicleMedia } from '@/api/queries/vehicles';
import { ImageViewer } from '@/ui';

import { viewerImages, visiblePhotos } from '../media';

export type PhotoViewerProps = {
  /** Photos with a file: `index` counts in this list. */
  photos: readonly VehicleMedia[];
  /** Alt text for photos without their own. */
  fallbackAlt: string;
  /** The photo it opens on; null keeps it closed. */
  index: number | null;
  onClose: () => void;
  /** Controls for the photo on screen, at the end of the viewer's top bar (VEH-04 "Melden"). */
  actions?: (photo: VehicleMedia) => ReactNode;
  /** A status line along the bottom edge, as the offline banner when the photos come from the cache. */
  notice?: ReactNode;
  /** `.counter`, `.close`, `.previous`, `.next`, `.stage`. */
  testID?: string;
};

/**
 * VEH-04 over the screen that opened it: the `ImageViewer` primitive (pure black, pinch 1–4 ×, double tap 2 ×, swipe,
 * drag to dismiss, arrows and Escape on web, a slider for screen readers, a crossfade under reduced motion). The route
 * `(modals)/viewer` shows the same viewer for a direct link.
 */
export function PhotoViewer({ photos, fallbackAlt, index, onClose, actions, notice, testID = 'VEH-04.viewer' }: PhotoViewerProps) {
  const images = useMemo(() => viewerImages(photos, fallbackAlt), [fallbackAlt, photos]);
  // `viewerImages` keeps the photos with a file, which is what `photos` holds, so the viewer's index is the photo's.
  const shown = useMemo(() => visiblePhotos(photos), [photos]);
  const forIndex = actions
    ? (position: number) => {
        const photo = shown[position];
        return photo ? actions(photo) : null;
      }
    : undefined;
  return <ImageViewer visible={index !== null} images={images} initialIndex={index ?? 0} onClose={onClose} actions={forIndex} notice={notice} testID={testID} />;
}
