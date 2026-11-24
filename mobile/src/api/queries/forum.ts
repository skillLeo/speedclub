/**
 * M5.8 Forum (10 §7, ADR-506, docs/reports/phase-5/m5.8-contract.md §4): FOR-01 home and its search, FOR-02 categories, FOR-03 the
 * thread with its replies, votes, solution and subscription, FOR-04 the composer ("Ähnliche Themen", create, edit, photos through the
 * upload queue), FOR-05 my threads and subscriptions, and the integrations (Home "Gerade im Forum", VEH-01 "Diskussionen").
 *
 * Counts: only a thread's reply count and a reply's "Hilfreich" count exist, and only the forum shows them (ADR-506). Votes, the
 * subscription and the solution are optimistic; a reply is optimistic too (it appears at once with its text, and goes back into the
 * field when the server refuses it).
 *
 * Typed by the generated schema (docs/api/openapi.json, M5.8): threads, posts with their `content` tree (features/forum/content.ts),
 * votes, subscriptions and the notification switches.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { useSessionStore } from '@/state/session';

type ThreadRowData = components['schemas']['ForumThreadRowResource'];
type ThreadData = components['schemas']['ForumThreadResource'];
type PostData = components['schemas']['ForumPostResource'];

export type ForumCategory = components['schemas']['ForumCategoryResource'];
export type ForumThreadRow = ThreadRowData;
export type ForumPost = PostData;
export type ForumThread = ThreadData;
export type ForumThreadSort = components['schemas']['ForumThreadSort'];
export type ForumPostSort = components['schemas']['ForumPostSort'];
export type ForumThreadStatus = components['schemas']['ForumThreadStatus'];
export type ForumPostStatus = components['schemas']['ForumPostStatus'];
export type ForumMember = components['schemas']['MemberSummaryResource'];
export type StoreThreadBody = components['schemas']['StoreForumThreadRequest'];

export const FORUM_FLAG = 'forum';
export const THREAD_SORTS: readonly ForumThreadSort[] = ['active', 'new', 'unanswered', 'solved'];
export const POST_SORTS: readonly ForumPostSort[] = ['oldest', 'helpful'];

/** config/speedclub.php `forum.*` and the FormRequests: the form's limits match the server's. */
export const FORUM_LIMITS = {
  titleMin: 5,
  titleMax: 120,
  openingMin: 10,
  openingMax: 10000,
  replyMax: 5000,
  photos: 6,
  tags: 5,
  tagMax: 24,
  /** `forum/similar` needs this much of the title. */
  similarMin: 3,
  /** `search/threads` (`speedclub.search.query_max_length`). */
  queryMin: 2,
  queryMax: 64,
  /** Pre-moderation for accounts younger than this (`forum.premoderation_days`) or without a verified e-mail. */
  premoderationDays: 3,
} as const;

export const FORUM_PAGE_SIZE = 20;
export const FORUM_THREAD_CLOSED = 'forum_thread_closed';
export const FORUM_THREAD_HAS_REPLIES = 'forum_thread_has_replies';
/** A reply that only exists on this device until the server answers. */
export const LOCAL_POST_PREFIX = 'local-';

export type ThreadFilters = { category: string | null; sort: ForumThreadSort; q: string | null; tag?: string | null };
export const DEFAULT_THREAD_FILTERS: ThreadFilters = { category: null, sort: 'active', q: null };

export type MyForumTab = 'threads' | 'subscriptions';

type Page<T> = { data: T[]; meta: { next_cursor: string | null } };

export const forumKeys = {
  all: ['forum'] as const,
  categories: ['forum', 'categories'] as const,
  category: (slug: string) => ['forum', 'category', slug] as const,
  lists: ['forum', 'list'] as const,
  list: (filters: ThreadFilters) => ['forum', 'list', filters.category ?? '', filters.sort, filters.q ?? '', filters.tag ?? ''] as const,
  active: ['forum', 'active'] as const,
  thread: (id: string) => ['forum', 'thread', id] as const,
  posts: (id: string, sort: ForumPostSort) => ['forum', 'posts', id, sort] as const,
  postsOf: (id: string) => ['forum', 'posts', id] as const,
  similar: (title: string, category: string | null) => ['forum', 'similar', title, category ?? ''] as const,
  mine: (member: string, tab: MyForumTab) => ['forum', 'mine', member, tab] as const,
  vehicle: (id: string) => ['forum', 'vehicle', id] as const,
};

/** The words of a search: trimmed, inner runs of space collapsed; shorter than the server's minimum = no search. */
export function forumQueryOf(text: string): string | null {
  const q = text.trim().replace(/\s+/g, ' ').slice(0, FORUM_LIMITS.queryMax);
  return q.length < FORUM_LIMITS.queryMin ? null : q;
}

export function isThreadClosed(error: unknown): boolean {
  return error instanceof ApiError && error.code === FORUM_THREAD_CLOSED;
}

export function hasReplies(error: unknown): boolean {
  return error instanceof ApiError && error.code === FORUM_THREAD_HAS_REPLIES;
}

/** The page's rows once each (a row that moved up into a page already read is not listed twice). */
export function flattenThreads(pages: readonly Page<ForumThreadRow>[] | undefined): ForumThreadRow[] {
  const seen = new Set<string>();
  const out: ForumThreadRow[] = [];
  for (const page of pages ?? []) {
    for (const row of page.data) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

export function flattenPosts(pages: readonly Page<ForumPost>[] | undefined): ForumPost[] {
  const seen = new Set<string>();
  const out: ForumPost[] = [];
  for (const page of pages ?? []) {
    for (const post of page.data) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      out.push(post);
    }
  }
  return out;
}

// -- Calls

const cursorOf = (cursor: string | null) => (cursor ? { cursor } : {});

export const forumApi = {
  async categories(signal?: AbortSignal): Promise<ForumCategory[]> {
    return (await apiData(api.GET('/forum/categories', { signal }))).data;
  },
  async category(slug: string, signal?: AbortSignal): Promise<ForumCategory> {
    return (await apiData(api.GET('/forum/categories/{slug}', { params: { path: { slug } }, signal }))).data;
  },
  async threads(filters: ThreadFilters, cursor: string | null, perPage: number = FORUM_PAGE_SIZE, signal?: AbortSignal): Promise<Page<ForumThreadRow>> {
    const shared = { per_page: perPage, sort: filters.sort, ...(filters.category ? { category: filters.category } : {}), ...cursorOf(cursor) };
    if (filters.q) return apiData(api.GET('/search/threads', { params: { query: { ...shared, q: filters.q } }, signal }));
    return apiData(api.GET('/forum/threads', { params: { query: { ...shared, ...(filters.tag ? { tag: filters.tag } : {}) } }, signal }));
  },
  async active(signal?: AbortSignal): Promise<ForumThreadRow[]> {
    return (await apiData(api.GET('/forum/active', { signal }))).data;
  },
  async thread(id: string, signal?: AbortSignal): Promise<ForumThread> {
    return (await apiData(api.GET('/forum/threads/{thread}', { params: { path: { thread: id } }, signal }))).data;
  },
  async posts(id: string, sort: ForumPostSort, cursor: string | null, signal?: AbortSignal): Promise<Page<ForumPost>> {
    const page = await apiData(
      api.GET('/forum/threads/{thread}/posts', { params: { path: { thread: id }, query: { sort, per_page: FORUM_PAGE_SIZE, ...cursorOf(cursor) } }, signal }),
    );
    return { data: page.data, meta: { next_cursor: page.meta.next_cursor } };
  },
  async vehicleThreads(vehicleId: string, signal?: AbortSignal): Promise<ForumThreadRow[]> {
    return (await apiData(api.GET('/vehicles/{vehicle}/forum-threads', { params: { path: { vehicle: vehicleId }, query: { per_page: 3 } }, signal }))).data;
  },
  async similar(title: string, category: string | null, signal?: AbortSignal): Promise<ForumThreadRow[]> {
    return (await apiData(api.GET('/forum/similar', { params: { query: { title, ...(category ? { category } : {}) } }, signal }))).data;
  },
  async mine(tab: MyForumTab, cursor: string | null, signal?: AbortSignal): Promise<Page<ForumThreadRow>> {
    const query = { per_page: FORUM_PAGE_SIZE, ...cursorOf(cursor) };
    return tab === 'threads'
      ? apiData(api.GET('/me/forum/threads', { params: { query }, signal }))
      : apiData(api.GET('/me/forum/subscriptions', { params: { query }, signal }));
  },
  async createThread(body: StoreThreadBody, idempotencyKey: string): Promise<ForumThread> {
    return (await apiData(api.POST('/forum/threads', { body, headers: { 'Idempotency-Key': idempotencyKey } }))).data;
  },
  /** The composer sends every field again (the PATCH takes them all as optional). */
  async updateThread(id: string, body: StoreThreadBody): Promise<ForumThread> {
    return (await apiData(api.PATCH('/forum/threads/{thread}', { params: { path: { thread: id } }, body }))).data;
  },
  async deleteThread(id: string): Promise<void> {
    await apiData(api.DELETE('/forum/threads/{thread}', { params: { path: { thread: id } } }));
  },
  async deletePhoto(threadId: string, mediaId: string): Promise<void> {
    await apiData(api.DELETE('/forum/threads/{thread}/photos/{media}', { params: { path: { thread: threadId, media: mediaId } } }));
  },
  async reply(threadId: string, body: string, parentId: string | null, idempotencyKey: string): Promise<ForumPost> {
    const answer = await apiData(
      api.POST('/forum/threads/{thread}/posts', {
        params: { path: { thread: threadId } },
        body: { body, ...(parentId ? { parent_id: parentId } : {}) },
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    );
    return answer.data;
  },
  async updatePost(postId: string, body: string): Promise<ForumPost> {
    return (await apiData(api.PATCH('/forum/posts/{post}', { params: { path: { post: postId } }, body: { body } }))).data;
  },
  async deletePost(postId: string): Promise<void> {
    await apiData(api.DELETE('/forum/posts/{post}', { params: { path: { post: postId } } }));
  },
  async vote(postId: string, on: boolean): Promise<{ postId: string; helpfulCount: number; voted: boolean }> {
    const call = on
      ? api.PUT('/forum/posts/{post}/vote', { params: { path: { post: postId } } })
      : api.DELETE('/forum/posts/{post}/vote', { params: { path: { post: postId } } });
    const answer = (await apiData(call)).data;
    return { postId: answer.post_id, helpfulCount: answer.helpful_count, voted: answer.voted };
  },
  async solution(threadId: string, postId: string | null): Promise<ForumThread> {
    const call = postId
      ? api.PUT('/forum/threads/{thread}/solution', { params: { path: { thread: threadId } }, body: { post_id: postId } })
      : api.DELETE('/forum/threads/{thread}/solution', { params: { path: { thread: threadId } } });
    return (await apiData(call)).data;
  },
  async subscribe(threadId: string, on: boolean): Promise<boolean> {
    const call = on
      ? api.PUT('/forum/threads/{thread}/subscription', { params: { path: { thread: threadId } } })
      : api.DELETE('/forum/threads/{thread}/subscription', { params: { path: { thread: threadId } } });
    return (await apiData(call)).data.subscribed;
  },
};

// -- Queries

export function useForumOn(): boolean {
  return useFlag(FORUM_FLAG);
}

export function useForumCategories(enabled: boolean = true) {
  const on = useForumOn();
  return useQuery({
    queryKey: forumKeys.categories,
    queryFn: ({ signal }) => forumApi.categories(signal),
    enabled: on && enabled,
    staleTime: 10 * 60 * 1000,
    retry: retryUnlessAnswered,
  });
}

export function useForumCategory(slug: string) {
  const on = useForumOn();
  return useQuery({
    queryKey: forumKeys.category(slug),
    queryFn: ({ signal }) => forumApi.category(slug, signal),
    enabled: on && slug !== '',
    retry: retryUnlessAnswered,
  });
}

export function useForumThreads(filters: ThreadFilters, enabled: boolean = true) {
  const on = useForumOn();
  return useInfiniteQuery({
    queryKey: forumKeys.list(filters),
    queryFn: ({ pageParam, signal }) => forumApi.threads(filters, pageParam, FORUM_PAGE_SIZE, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    enabled: on && enabled,
    retry: retryUnlessAnswered,
  });
}

/** HOME-01 "Gerade im Forum": up to 3 threads with activity in the last 14 days; empty when the forum is quiet. */
export function useForumActive(enabled: boolean = true) {
  const on = useForumOn();
  return useQuery({
    queryKey: forumKeys.active,
    queryFn: ({ signal }) => forumApi.active(signal),
    enabled: on && enabled,
    retry: retryUnlessAnswered,
  });
}

export function useForumThread(id: string) {
  const on = useForumOn();
  return useQuery({
    queryKey: forumKeys.thread(id),
    queryFn: ({ signal }) => forumApi.thread(id, signal),
    enabled: on && id !== '',
    retry: retryUnlessAnswered,
  });
}

export function useForumPosts(id: string, sort: ForumPostSort, enabled: boolean = true) {
  const on = useForumOn();
  return useInfiniteQuery({
    queryKey: forumKeys.posts(id, sort),
    queryFn: ({ pageParam, signal }) => forumApi.posts(id, sort, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    enabled: on && enabled && id !== '',
    retry: retryUnlessAnswered,
  });
}

/** VEH-01 "Diskussionen zu diesem Build": the newest threads about this car. */
export function useVehicleForumThreads(vehicleId: string, enabled: boolean = true) {
  const on = useForumOn();
  return useQuery({
    queryKey: forumKeys.vehicle(vehicleId),
    queryFn: ({ signal }) => forumApi.vehicleThreads(vehicleId, signal),
    enabled: on && enabled && vehicleId !== '',
    retry: retryUnlessAnswered,
  });
}

/** FOR-04 "Ähnliche Themen" while the title is typed (members only; the caller debounces the title). */
export function useSimilarThreads(title: string | null, category: string | null) {
  const on = useForumOn();
  const member = useSessionStore((state) => state.status === 'member');
  const text = title?.trim() ?? '';
  return useQuery({
    queryKey: forumKeys.similar(text, category),
    queryFn: ({ signal }) => forumApi.similar(text, category, signal),
    enabled: on && member && text.length >= FORUM_LIMITS.similarMin,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

export function useMyForumThreads(tab: MyForumTab, enabled: boolean = true) {
  const on = useForumOn();
  const member = useSessionStore((state) => (state.status === 'member' ? (state.member?.id ?? '') : ''));
  return useInfiniteQuery({
    queryKey: forumKeys.mine(member, tab),
    queryFn: ({ pageParam, signal }) => forumApi.mine(tab, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    enabled: on && enabled && member !== '',
    retry: retryUnlessAnswered,
  });
}

// -- Cache edits

type PostPages = InfiniteData<Page<ForumPost>, string | null>;

/** Every loaded copy of a post (top-level, an answer, the thread's solution) changed by `change`. */
export function patchPost(client: QueryClient, threadId: string, postId: string, change: (post: ForumPost) => ForumPost): void {
  const edit = (post: ForumPost): ForumPost => {
    const own = post.id === postId ? change(post) : post;
    const replies = own.replies.some((reply) => reply.id === postId) ? own.replies.map((reply) => (reply.id === postId ? change(reply) : reply)) : own.replies;
    return replies === own.replies ? own : { ...own, replies };
  };
  client.setQueriesData<PostPages>({ queryKey: forumKeys.postsOf(threadId) }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, data: page.data.map(edit) })) } : data,
  );
  client.setQueryData<ForumThread>(forumKeys.thread(threadId), (thread) =>
    thread?.solution && thread.solution.id === postId ? { ...thread, solution: change(thread.solution) } : thread,
  );
}

/** A new reply in the loaded pages: an answer under its top-level reply, a top-level reply at the end of what is loaded. */
export function insertPost(client: QueryClient, threadId: string, post: ForumPost): void {
  client.setQueriesData<PostPages>({ queryKey: forumKeys.postsOf(threadId) }, (data) => {
    if (!data || data.pages.length === 0) return data;
    if (post.parent_id) {
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          data: page.data.map((top) => (top.id === post.parent_id ? { ...top, replies: [...top.replies, post] } : top)),
        })),
      };
    }
    const last = data.pages.length - 1;
    // With pages still to load, the reply would sit before replies it is newer than: it appears once the end is read.
    if (data.pages[last]?.meta.next_cursor) return data;
    return { ...data, pages: data.pages.map((page, index) => (index === last ? { ...page, data: [...page.data, post] } : page)) };
  });
}

/** Swaps the local reply for the server's (or drops it with `replacement` null). */
export function replacePost(client: QueryClient, threadId: string, localId: string, replacement: ForumPost | null): void {
  const swap = (posts: readonly ForumPost[]): ForumPost[] =>
    posts.flatMap((post) => {
      if (post.id === localId) return replacement ? [replacement] : [];
      return [post.replies.some((reply) => reply.id === localId) ? { ...post, replies: swap(post.replies) } : post];
    });
  client.setQueriesData<PostPages>({ queryKey: forumKeys.postsOf(threadId) }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, data: swap(page.data) })) } : data,
  );
}

function setThread(client: QueryClient, thread: ForumThread): void {
  client.setQueryData(forumKeys.thread(thread.id), thread);
}

function refreshLists(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: forumKeys.lists });
  void client.invalidateQueries({ queryKey: forumKeys.active });
  void client.invalidateQueries({ queryKey: ['forum', 'mine'] });
  void client.invalidateQueries({ queryKey: ['forum', 'vehicle'] });
}

// -- Mutations

/** "Hilfreich" (optimistic): the count and the filled thumb change at once and go back when the call fails. */
export function useVote(threadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ post, on }: { post: Pick<ForumPost, 'id'>; on: boolean }) => forumApi.vote(post.id, on),
    onMutate: async ({ post, on }) => {
      await client.cancelQueries({ queryKey: forumKeys.postsOf(threadId) });
      const seen: { before: { count: number; voted: boolean } | null } = { before: null };
      patchPost(client, threadId, post.id, (current) => {
        seen.before ??= { count: current.helpful_count, voted: current.viewer_voted };
        if (current.viewer_voted === on) return current;
        return { ...current, viewer_voted: on, helpful_count: Math.max(0, current.helpful_count + (on ? 1 : -1)) };
      });
      return { before: seen.before };
    },
    onError: (_error, { post }, context) => {
      const before = context?.before;
      if (before) patchPost(client, threadId, post.id, (current) => ({ ...current, helpful_count: before.count, viewer_voted: before.voted }));
    },
    onSuccess: (answer) => {
      patchPost(client, threadId, answer.postId, (current) => ({ ...current, helpful_count: answer.helpfulCount, viewer_voted: answer.voted }));
    },
  });
}

/** "Abonnieren" (optimistic). */
export function useSubscribe(threadId: string) {
  const client = useQueryClient();
  const apply = (subscribed: boolean) =>
    client.setQueryData<ForumThread>(forumKeys.thread(threadId), (thread) => (thread ? { ...thread, viewer: { ...thread.viewer, subscribed } } : thread));
  return useMutation({
    mutationFn: (on: boolean) => forumApi.subscribe(threadId, on),
    onMutate: async (on) => {
      await client.cancelQueries({ queryKey: forumKeys.thread(threadId) });
      const before = client.getQueryData<ForumThread>(forumKeys.thread(threadId))?.viewer.subscribed;
      apply(on);
      return { before };
    },
    onError: (_error, _on, context) => {
      if (context?.before !== undefined) apply(context.before);
    },
    onSuccess: (subscribed) => apply(subscribed),
    onSettled: () => void client.invalidateQueries({ queryKey: ['forum', 'mine'] }),
  });
}

/** "Als Lösung markieren" / "Lösung entfernen" (optimistic on the replies' marks and the thread's "Gelöst"). */
export function useSolution(threadId: string) {
  const client = useQueryClient();
  const mark = (solutionId: string | null) =>
    client.setQueriesData<PostPages>({ queryKey: forumKeys.postsOf(threadId) }, (data) => {
      if (!data) return data;
      const edit = (post: ForumPost): ForumPost => ({ ...post, is_solution: post.id === solutionId, replies: post.replies.map(edit) });
      return { ...data, pages: data.pages.map((page) => ({ ...page, data: page.data.map(edit) })) };
    });
  return useMutation({
    mutationFn: (postId: string | null) => forumApi.solution(threadId, postId),
    onMutate: async (postId) => {
      await client.cancelQueries({ queryKey: forumKeys.thread(threadId) });
      const thread = client.getQueryData<ForumThread>(forumKeys.thread(threadId));
      const before = thread ? { solved: thread.is_solved, solution: thread.solution } : null;
      mark(postId);
      if (thread) setThread(client, { ...thread, is_solved: postId !== null, solution: postId === null ? null : thread.solution });
      return { before };
    },
    onError: (_error, _postId, context) => {
      const thread = client.getQueryData<ForumThread>(forumKeys.thread(threadId));
      if (thread && context?.before) {
        setThread(client, { ...thread, is_solved: context.before.solved, solution: context.before.solution });
        mark(context.before.solution?.id ?? null);
      }
    },
    onSuccess: (thread) => {
      setThread(client, thread);
      mark(thread.solution?.id ?? null);
    },
    onSettled: () => refreshLists(client),
  });
}

export type ReplyVariables = { body: string; parent: ForumPost | null; idempotencyKey: string; author: ForumMember | null };

/**
 * A reply (optimistic "send"): a local copy appears at once under its parent or at the end; the server's answer replaces it (pending
 * for a new account, with its badge). A refused reply disappears again and the caller puts its text back into the field.
 */
export function useReply(threadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, parent, idempotencyKey }: ReplyVariables) => forumApi.reply(threadId, body, parent?.id ?? null, idempotencyKey),
    onMutate: ({ body, parent, idempotencyKey, author }) => {
      const localId = `${LOCAL_POST_PREFIX}${idempotencyKey}`;
      const local: ForumPost = {
        id: localId,
        thread_id: threadId,
        parent_id: parent?.id ?? null,
        status: 'published',
        author,
        body,
        content: body
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter((paragraph) => paragraph !== '')
          .map((paragraph) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text: paragraph, bold: false, italic: false }] })),
        helpful_count: 0,
        viewer_voted: false,
        is_solution: false,
        deleted: false,
        mentions: [],
        edited_at: null,
        created_at: new Date().toISOString(),
        replies: [],
        review_reason: null,
        viewer: { is_author: true, can_edit: false, can_delete: false, can_vote: false, can_report: false },
      };
      insertPost(client, threadId, local);
      return { localId };
    },
    onError: (_error, _variables, context) => {
      if (context) replacePost(client, threadId, context.localId, null);
    },
    onSuccess: (post, _variables, context) => {
      if (context) replacePost(client, threadId, context.localId, post);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: forumKeys.thread(threadId) });
      refreshLists(client);
    },
  });
}

export function useEditPost(threadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, body }: { postId: string; body: string }) => forumApi.updatePost(postId, body),
    onSuccess: (post) => patchPost(client, threadId, post.id, (current) => ({ ...post, replies: current.replies })),
  });
}

export function useDeletePost(threadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => forumApi.deletePost(postId),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: forumKeys.postsOf(threadId) });
      void client.invalidateQueries({ queryKey: forumKeys.thread(threadId) });
      refreshLists(client);
    },
  });
}

export function useCreateThread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: StoreThreadBody; idempotencyKey: string }) => forumApi.createThread(body, idempotencyKey),
    onSuccess: (thread) => {
      setThread(client, thread);
      refreshLists(client);
    },
  });
}

export function useUpdateThread(threadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: StoreThreadBody) => forumApi.updateThread(threadId, body),
    onSuccess: (thread) => {
      setThread(client, thread);
      refreshLists(client);
    },
  });
}

export function useDeleteThread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => forumApi.deleteThread(threadId),
    onSuccess: (_answer, threadId) => {
      client.removeQueries({ queryKey: forumKeys.thread(threadId) });
      client.removeQueries({ queryKey: forumKeys.postsOf(threadId) });
      refreshLists(client);
    },
  });
}

/**
 * SF-7: the photos the author removed in FOR-04, deleted only after the edit was saved (until then "Verwerfen" keeps them). Each is
 * tried; the answer is how many could not be deleted.
 */
export function useRemoveForumPhotos(threadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (mediaIds: readonly string[]) => {
      const results = await Promise.allSettled(mediaIds.map((mediaId) => forumApi.deletePhoto(threadId, mediaId)));
      return results.filter((result) => result.status === 'rejected').length;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: forumKeys.thread(threadId) }),
  });
}
