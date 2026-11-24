import type { Href } from 'expo-router';

/**
 * FOR-04 opens as a modal sheet (`/forum-composer`, like UPD-01): a new thread with an optional category and attached car, or the
 * author's thread to edit (`thread`).
 */
export function composerHref(options: { category?: string | null; vehicleId?: string | null; threadId?: string | null } = {}): Href {
  const params: Record<string, string> = {};
  if (options.category) params.category = options.category;
  if (options.vehicleId) params.vehicleId = options.vehicleId;
  if (options.threadId) params.thread = options.threadId;
  return { pathname: '/forum-composer', params } as unknown as Href;
}

/** FOR-02 of a category. */
export function categoryHref(slug: string): Href {
  return `/forum/c/${encodeURIComponent(slug)}` as Href;
}

/** FOR-03, optionally opened at one reply (`?post=`, as the notifications link it). */
export function threadPath(id: string, postId?: string | null): Href {
  return (postId ? { pathname: '/forum/[id]', params: { id, post: postId } } : `/forum/${id}`) as Href;
}
