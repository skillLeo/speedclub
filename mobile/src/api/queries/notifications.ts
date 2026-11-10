/**
 * HOME-02 Mitteilungen and the unread badges (docs/reports/phase-2/m2.2-contract.md §2). Members only: a guest never asks.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { api, apiData } from '@/api/client';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import { useSessionStore } from '@/state/session';

import { flattenPages } from './seamedList';

export const NOTIFICATIONS_PAGE_SIZE = 30;
/** §5 contract: the app polls on focus and every 60 s in the foreground, until Pusher arrives with M2.4. */
export const UNREAD_POLL_MS = 60 * 1000;

export const notificationKeys = {
  all: (member: string) => ['notifications', member] as const,
  list: (member: string) => ['notifications', member, 'list'] as const,
  unread: (member: string) => ['notifications', member, 'unread'] as const,
};

async function fetchNotifications(cursor: string | null, signal: AbortSignal) {
  return apiData(api.GET('/notifications', { params: { query: { per_page: NOTIFICATIONS_PAGE_SIZE, ...(cursor ? { cursor } : {}) } }, signal }));
}

async function fetchUnread(signal: AbortSignal) {
  return (await apiData(api.GET('/notifications/unread-count', { signal }))).data;
}

export type NotificationsPage = Awaited<ReturnType<typeof fetchNotifications>>;
export type AppNotification = NotificationsPage['data'][number];
export type UnreadCount = Awaited<ReturnType<typeof fetchUnread>>;

function useMemberId(): string | null {
  return useSessionStore((state) => (state.status === 'member' ? (state.member?.id ?? null) : null));
}

/** Newest first, page by page. Stored with the member's cache (ADR-175 a), so an offline start shows the last list under the banner. */
export function useNotifications() {
  const member = useMemberId();
  return useInfiniteQuery({
    queryKey: notificationKeys.list(member ?? 'guest'),
    queryFn: ({ pageParam, signal }) => fetchNotifications(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: NotificationsPage) => last.meta.next_cursor ?? undefined,
    enabled: member !== null,
    retry: retryUnlessAnswered,
  });
}

export function flattenNotifications(pages: readonly NotificationsPage[] | undefined): AppNotification[] {
  return flattenPages(pages, (row) => row.id);
}

/**
 * The counts for the badges: notifications on Start, messages and requests on Nachrichten (0 until M2.4). Polled every 60 s while
 * the app is in the foreground; TanStack's focus manager (AppState on native, visibility on web) pauses it in the background and asks
 * again on focus. Never stored: an old count on a cold start would be a wrong badge.
 */
export function useUnreadCount() {
  const member = useMemberId();
  return useQuery({
    queryKey: notificationKeys.unread(member ?? 'guest'),
    queryFn: ({ signal }) => fetchUnread(signal),
    enabled: member !== null,
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
    retry: false,
    meta: { persist: false },
  });
}

type ListData = InfiniteData<NotificationsPage, string | null>;

function markRows(data: ListData | undefined, read: (row: AppNotification) => boolean, at: string): ListData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, data: page.data.map((row) => (row.read_at === null && read(row) ? { ...row, read_at: at } : row)) })),
  };
}

/** "Alle als gelesen markieren": every row and the dot at once, and back when the server refuses. */
export function useMarkAllRead() {
  const client = useQueryClient();
  const member = useMemberId() ?? 'guest';
  return useMutation({
    mutationFn: async () => {
      await apiData(api.POST('/notifications/read-all', {}));
    },
    onMutate: async () => {
      await client.cancelQueries({ queryKey: notificationKeys.all(member) });
      const list = client.getQueryData<ListData>(notificationKeys.list(member));
      const unread = client.getQueryData<UnreadCount>(notificationKeys.unread(member));
      client.setQueryData<ListData>(notificationKeys.list(member), (data) => markRows(data, () => true, new Date().toISOString()));
      if (unread) client.setQueryData<UnreadCount>(notificationKeys.unread(member), { ...unread, notifications: 0 });
      return { list, unread };
    },
    onError: (_error, _input, context) => {
      client.setQueryData(notificationKeys.list(member), context?.list);
      client.setQueryData(notificationKeys.unread(member), context?.unread);
    },
    onSettled: () => client.invalidateQueries({ queryKey: notificationKeys.unread(member) }),
  });
}

/** One row read in the cache at once: its mark in the list, and one less on the badge when it was unread there. */
export function markReadInCache(client: QueryClient, member: string, id: string): void {
  const before = client.getQueryData<ListData>(notificationKeys.list(member));
  const wasUnread = before?.pages.some((page) => page.data.some((row) => row.id === id && row.read_at === null)) ?? false;
  client.setQueryData<ListData>(notificationKeys.list(member), (data) => markRows(data, (row) => row.id === id, new Date().toISOString()));
  if (wasUnread) {
    client.setQueryData<UnreadCount>(notificationKeys.unread(member), (unread) =>
      unread ? { ...unread, notifications: Math.max(0, unread.notifications - 1) } : unread,
    );
  }
}

async function patchRead(id: string) {
  return (await apiData(api.PATCH('/notifications/{notification}', { params: { path: { notification: id } }, body: { read: true } }))).data;
}

/**
 * A row read from outside the list, as a tapped push (M2.2 review 17): the cache at once, then the server; the badge and the list ask
 * again afterwards. A failure stays quiet: the row keeps its mark on the server, and the next load shows it.
 */
export async function readNotification(client: QueryClient, member: string, id: string): Promise<void> {
  markReadInCache(client, member, id);
  try {
    await patchRead(id);
  } catch {
    // Nothing to tell the member about: the list says what the server holds.
  }
  await client.invalidateQueries({ queryKey: notificationKeys.all(member) });
}

/** A row opened: read at once; a failure leaves it as it is now, and the next load says what the server holds. */
export function useMarkRead() {
  const client = useQueryClient();
  const member = useMemberId() ?? 'guest';
  return useMutation({
    mutationFn: patchRead,
    onMutate: (id: string) => markReadInCache(client, member, id),
    onSettled: () => client.invalidateQueries({ queryKey: notificationKeys.unread(member) }),
  });
}
