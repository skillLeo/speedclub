/**
 * UPD-01 photos after "Posten" (ADR-436 d): the post exists first, its photos then go through the app's upload queue to
 * `build-updates/{id}/media`. Uploads finish in any order, so once every photo of a post has arrived (or failed for good) this
 * sends the owner's order and the before/after pairs in one PATCH. Lives for the app run: a post whose uploads outlive a
 * restart keeps its photos in upload order and without pairs (the owner can pair them in the 24-hour edit window).
 */
import { api, apiData } from '@/api/client';
import { queryClient } from '@/api/queryClient';
import { vehicleKeys } from '@/api/queries/vehicles';
import type { UploadItem } from '@/state/uploads';

import { pairsByMedia, type LocalPair } from './model';

export type PendingPost = {
  updateId: string;
  slug: string;
  itemIds: readonly string[];
  pairs: readonly LocalPair[];
};

type Store = {
  getState: () => { items: UploadItem[] };
  subscribe: (listener: (state: { items: UploadItem[] }) => void) => () => void;
};

/** What to send once the uploads of `post` are settled, or null while one is still on its way. Exported for the tests. */
export function settledChange(
  post: PendingPost,
  items: readonly UploadItem[],
): { photo_order: string[]; photo_pairs: string[][] } | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  const mediaIds: (string | null)[] = [];
  for (const id of post.itemIds) {
    const item = byId.get(id);
    // Gone from the queue: cancelled (or cleared after it arrived, which `mediaId` would have told us before).
    if (!item) {
      mediaIds.push(null);
      continue;
    }
    if (item.status === 'done') mediaIds.push(item.mediaId);
    else if (item.status === 'failed' && !item.retryable) mediaIds.push(null);
    else return null;
  }
  const order = mediaIds.filter((id): id is string => id !== null);
  return { photo_order: order, photo_pairs: pairsByMedia(post.pairs, mediaIds) };
}

/** Watches the queue for one post and sends its order and pairs once; resolves when done (or nothing was needed). */
export function finishPostWhenUploaded(store: Store, post: PendingPost): Promise<void> {
  return new Promise((resolve) => {
    let sent = false;
    const check = (items: readonly UploadItem[]) => {
      if (sent) return;
      const change = settledChange(post, items);
      if (!change) return;
      sent = true;
      unsubscribe?.();
      const ordered = change.photo_order.length > 1 || change.photo_pairs.length > 0;
      const send = ordered
        ? apiData(
            api.PATCH('/build-updates/{update}', {
              params: { path: { update: post.updateId } },
              body: change,
            }),
          ).then(() => undefined)
        : Promise.resolve();
      void send
        .catch(() => undefined)
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: vehicleKeys.of(post.slug) });
          void queryClient.invalidateQueries({
            predicate: (query) => query.queryKey[0] === 'build-update' && query.queryKey[2] === post.updateId,
          });
          void queryClient.invalidateQueries({ queryKey: ['home'] });
          resolve();
        });
    };
    let unsubscribe: (() => void) | undefined;
    unsubscribe = store.subscribe((state) => check(state.items));
    check(store.getState().items);
  });
}
