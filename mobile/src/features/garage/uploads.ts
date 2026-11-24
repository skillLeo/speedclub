import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';

import type { GarageMedia } from '@/api/queries/garage';
import { usePlateBlurReview } from '@/features/media/plateBlur/PlateBlurReview';
import { appUploadQueue, sameTarget, type UploadItem, type UploadQueue, type UploadTarget } from '@/state/uploads';
import { toast } from '@/ui/toast';

import { pickPhotos } from './photos';
import { createGarageUploadDriver } from './uploadDriver';

/** The app's upload queue with the real driver, made on first use (or at the start, when a stored one waits). */
export function uploadQueue(): UploadQueue {
  return appUploadQueue(createGarageUploadDriver);
}

export function useUploads<T>(selector: (state: ReturnType<UploadQueue['store']['getState']>) => T): T {
  return useStore(uploadQueue().store, selector);
}

/**
 * The queue items of one vehicle or mod that the screen still has to show: running, waiting and failed ones, and finished
 * ones until the server's list holds their photo, so a tile never blinks out between the upload and the refetch.
 */
export function visibleUploads(items: readonly UploadItem[], target: UploadTarget, photos: readonly Pick<GarageMedia, 'id'>[]): UploadItem[] {
  const known = new Set(photos.map((photo) => photo.id));
  return items.filter(
    (item) => sameTarget(item.target, target) && (item.status !== 'done' || (item.mediaId !== null && !known.has(item.mediaId))),
  );
}

/**
 * M5.9a: every pick goes through the plate blur editor before it is queued (`reviewElement` renders it; `routeId` names its
 * test IDs). Closing the editor without "Hochladen" queues nothing.
 */
export function usePhotoUploads(target: UploadTarget | null, photos: readonly Pick<GarageMedia, 'id'>[], limit: number, routeId = 'GAR-07') {
  const { t } = useTranslation('garage');
  const [picking, setPicking] = useState(false);
  const plateBlur = usePlateBlurReview(routeId);
  const all = useUploads((state) => state.items);
  const uploads = useMemo(() => (target ? visibleUploads(all, target, photos) : []), [all, photos, target]);
  const remaining = Math.max(0, limit - photos.length - uploads.length);

  // Finished items leave the queue once the server lists their photo.
  useEffect(() => {
    if (!target) return;
    const ids = photos.map((photo) => photo.id);
    if (all.some((item) => item.status === 'done' && sameTarget(item.target, target) && item.mediaId !== null && ids.includes(item.mediaId))) {
      uploadQueue().store.getState().clearDone(target, ids);
    }
  }, [all, photos, target]);

  const add = async () => {
    if (!target || remaining === 0 || picking) return;
    setPicking(true);
    try {
      const picked = await pickPhotos(remaining);
      if (!picked || picked.length === 0) return;
      const reviewed = await plateBlur.review(picked);
      if (reviewed && reviewed.length > 0) uploadQueue().store.getState().enqueue(target, reviewed);
    } catch {
      toast(t('upload.pickFailed'));
    } finally {
      setPicking(false);
    }
  };

  return {
    uploads,
    remaining,
    picking,
    add,
    /** The plate blur step for picks the screen queues itself (a mod not saved yet). */
    review: plateBlur.review,
    reviewElement: plateBlur.element,
    retry: (id: string) => uploadQueue().store.getState().retry(id),
    cancel: (id: string) => uploadQueue().store.getState().cancel(id),
    /** Photos still on their way: the review step waits for them before it counts them. */
    busy: uploads.some((item) => item.status !== 'failed' && item.status !== 'done'),
  };
}
