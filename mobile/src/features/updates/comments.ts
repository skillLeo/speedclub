/**
 * The pure parts of the comment thread (09 §8.5, flag build_comments; R4-2.2): where a sent comment lands in the cached pages, what a
 * refused send means for the composer, and the mention being typed at the end of the draft. No React, so Jest covers them directly.
 */
import type { InfiniteData } from '@tanstack/react-query';

import { ApiError } from '@/api/client';
import type { BuildComment } from '@/api/queries/social2';

import { activeMention } from './model';

export type CommentPage = { data: BuildComment[]; meta: { next_cursor?: string | null } };

/**
 * The thread with the server's answer to a send in its place: a reply at the end of its parent's replies, a new comment at the end
 * of the last page once the whole thread is loaded (oldest first). With more pages still to come the cache stays as it is; the read
 * after the send places it. A comment already there is not added twice.
 */
export function withSentComment(
  data: InfiniteData<CommentPage, string | null> | undefined,
  comment: BuildComment,
): InfiniteData<CommentPage, string | null> | undefined {
  if (!data || data.pages.length === 0) return data;
  const known = data.pages.some((page) => page.data.some((entry) => entry.id === comment.id || entry.replies.some((reply) => reply.id === comment.id)));
  if (known) return data;
  if (comment.parent_id) {
    let placed = false;
    const pages = data.pages.map((page) => ({
      ...page,
      data: page.data.map((entry) => {
        if (entry.id !== comment.parent_id) return entry;
        placed = true;
        return { ...entry, replies: [...entry.replies, comment] };
      }),
    }));
    return placed ? { ...data, pages } : data;
  }
  const last = data.pages[data.pages.length - 1];
  if (!last || last.meta.next_cursor) return data;
  return { ...data, pages: [...data.pages.slice(0, -1), { ...last, data: [...last.data, comment] }] };
}

/** The thread without a deleted comment (a top-level one takes its replies with it). */
export function withoutComment(
  data: InfiniteData<CommentPage, string | null> | undefined,
  commentId: string,
): InfiniteData<CommentPage, string | null> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      data: page.data
        .filter((entry) => entry.id !== commentId)
        .map((entry) => (entry.replies.some((reply) => reply.id === commentId) ? { ...entry, replies: entry.replies.filter((reply) => reply.id !== commentId) } : entry)),
    })),
  };
}

/** The loaded top-level comments in their order (each with its replies). */
export function loadedComments(pages: readonly CommentPage[] | undefined): BuildComment[] {
  return pages?.flatMap((page) => page.data) ?? [];
}

/** What a refused send means: the composer closes for good (`closed`, `restricted`), a field message, or a toast with the reason. */
export type SendRefusal =
  | { kind: 'closed' }
  | { kind: 'restricted' }
  | { kind: 'field'; message: string }
  | { kind: 'toast'; message: string | null };

export function sendRefusal(error: unknown): SendRefusal {
  if (!(error instanceof ApiError)) return { kind: 'toast', message: null };
  if (error.code === 'comments_disabled') return { kind: 'closed' };
  if (error.code === 'account_restricted' || error.kind === 'restricted') return { kind: 'restricted' };
  const field = error.fieldErrors.body?.[0] ?? error.fieldErrors.parent_id?.[0];
  if (field) return { kind: 'field', message: field };
  // email_not_verified, rate_limited, forbidden: the server's own translated sentence says why.
  if (error.status === 403 || error.status === 422 || error.status === 429) return { kind: 'toast', message: error.message || null };
  return { kind: 'toast', message: null };
}

/** The mention typed at the end of the draft (the composer reports no caret; typing happens at the end). */
export function trailingMention(draft: string): { start: number; query: string } | null {
  return activeMention(draft, draft.length);
}
