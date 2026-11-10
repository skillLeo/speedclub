/**
 * The inbox as the query cache already holds it, for places outside Nachrichten that must never send a request of their own: the
 * quick switcher's recent conversations (M2.8, `sig.web_shortcuts`) and the block dialog, which drops the blocked member's chats.
 */
import { useQueryClient, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { messagingKeys } from '@/api/queries/messaging';
import { blocksKey, type BlocksPage } from '@/api/queries/social';
import { useSessionStore } from '@/state/session';

import type { ConversationSummary } from './model';

type InboxPage = { rows: ConversationSummary[]; next: string | null };
type InboxCache = InfiniteData<InboxPage, string | null>;
type BlocksCache = InfiniteData<BlocksPage, string | null>;

/** The quick switcher lists at most this many conversations; without a query it shows its group limit of them. */
export const RECENT_CONVERSATIONS = 10;

const nameKey = (username: string) => username.trim().toLowerCase();

/** The signed-in member's id, as the messaging queries key their caches. Null for a guest and while the session changes hands. */
export function useMessagingMember(): string | null {
  return useSessionStore((state) => (state.status === 'member' && !state.memberChanged ? (state.member?.id ?? null) : null));
}

/** The data of one query, followed as the cache changes, without an observer that could fetch it. */
function useCachedQueryData<T>(key: QueryKey | null): T | undefined {
  const client = useQueryClient();
  const hash = key ? JSON.stringify(key) : '';
  const subscribe = useCallback((onChange: () => void) => client.getQueryCache().subscribe(onChange), [client]);
  // Keyed by the hash: the key itself is a new array on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const read = useCallback(() => (key ? client.getQueryData<T>(key) : undefined), [client, hash]);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The open chats with a member who still exists, newest first: Chats only (no requests, nothing archived), and nobody on the block
 * list. The server closes a blocked pair's chats, so a cached copy from before a block must not bring them back.
 */
export function recentConversations(
  inbox: InboxCache | undefined,
  blocked: ReadonlySet<string>,
  limit: number = RECENT_CONVERSATIONS,
): ConversationSummary[] {
  if (!inbox) return [];
  const seen = new Set<string>();
  return inbox.pages
    .flatMap((page) => page.rows)
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return (
        row.folder === 'chats' &&
        row.archivedAt === null &&
        row.other !== null &&
        !row.otherDeleted &&
        !blocked.has(nameKey(row.other.username))
      );
    })
    .sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0))
    .slice(0, limit);
}

/** The lowercased names on the cached block list (SET-08), empty when it was never loaded. */
export function blockedNames(blocks: BlocksCache | undefined): Set<string> {
  return new Set((blocks?.pages ?? []).flatMap((page) => page.data.map((row) => nameKey(row.username))));
}

/** The recent chats from the cached Chats list. No request: nothing shows until Nachrichten has loaded once this session. */
export function useCachedRecentConversations(): ConversationSummary[] {
  const member = useMessagingMember();
  const inbox = useCachedQueryData<InboxCache>(member ? messagingKeys.inbox(member, 'chats', '') : null);
  const blocks = useCachedQueryData<BlocksCache>(member ? blocksKey : null);
  // Stable while the cached lists stay the same, so the switcher's entries are not rebuilt on every render.
  return useMemo(() => (member ? recentConversations(inbox, blockedNames(blocks)) : []), [blocks, inbox, member]);
}

/**
 * After a block: every cached chat and request with that member goes, with its thread, as the server has closed them (contract §2,
 * `CloseConversationsOfPair`). Nachrichten reads the lists again the next time it shows them.
 */
export function forgetConversationsWith(client: QueryClient, member: string, username: string): void {
  const name = nameKey(username);
  const gone = new Set<string>();
  for (const [key, data] of client.getQueriesData<InboxCache>({ queryKey: messagingKeys.inboxAll(member) })) {
    if (!data) continue;
    client.setQueryData<InboxCache>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        rows: page.rows.filter((row) => {
          const match = row.other !== null && nameKey(row.other.username) === name;
          if (match) gone.add(row.id);
          return !match;
        }),
      })),
    });
  }
  // The thread on screen is left right after the block (`onBlocked`): it is not removed under its observer, which would ask again.
  for (const id of gone) {
    client.removeQueries({ queryKey: messagingKeys.conversation(member, id), type: 'inactive' });
    client.removeQueries({ queryKey: messagingKeys.thread(member, id), type: 'inactive' });
  }
  void client.invalidateQueries({ queryKey: messagingKeys.inboxAll(member), refetchType: 'none' });
}
