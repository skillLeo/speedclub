/**
 * Messaging on the M2.4 API (docs/reports/phase-2/m2.4-api-handover.md): the `MessagingAdapter` the screens read through
 * (features/messages/data.ts). Resources are mapped onto the view models of features/messages/model.ts here, and nowhere else.
 *
 * - Every query belongs to the member signed in (its key carries the member id) and none is persisted: message text and
 *   previews stay in memory, like the outbox, so a shared device never keeps them on disk (ADR-175 a).
 * - Polls send `If-None-Match`; an idle poll is a 304 and changes nothing.
 * - The thread is a cursor list of `before` pages; `pollNewer` asks `after=` the newest message and puts what came on top.
 * - Writes change the cache first where the result is certain (read, organise, delete, hide, react) and put it back when the
 *   server refuses.
 */
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  api,
  apiData,
  apiOrigin,
  ApiError,
  networkError,
  sendsSessionCookie,
  toApiError,
  withIdempotency,
} from '@/api/client';
import { useAppConfig } from '@/api/queries/appConfig';
import { notificationKeys, useUnreadCount } from '@/api/queries/notifications';
import { uploadHeaders, useMyVehicles } from '@/api/queries/profile';
import { usePublicVehicle } from '@/api/queries/vehicles';
import { queryClient as appQueryClient } from '@/api/queryClient';
import type { components } from '@/api/schema';
import type {
  InboxCounts,
  Loadable,
  MessagingActions,
  MessagingAdapter,
  MuteChange,
  OrganisePatch,
  PagedList,
  StartInput,
  ThreadData,
} from '@/features/messages/data';
import { classifyError } from '@/features/messages/errors';
import { newestServerId, uniqueServerMessages } from '@/features/messages/merge';
import { compareIds, isReactionKey } from '@/features/messages/model';
import type {
  ChatMember,
  ChatVehicle,
  ConversationDetail,
  ConversationSummary,
  Folder,
  MessageCandidate,
  MessagePreview,
  ReactionKey,
  ReplyQuote,
  ThreadMessage,
} from '@/features/messages/model';
import type { LocalPhoto, SendRequest } from '@/features/messages/outbox';
import type { ChannelAuth, RealtimeConfig } from '@/features/messages/realtime';
import { photoForm } from '@/features/garage/photos';
import i18n from '@/i18n';
import { isWeb } from '@/lib/platform';
import { sessionSignal, useSessionStore } from '@/state/session';

type Schemas = components['schemas'];
export type ConversationData = Schemas['ConversationResource'];
export type ConversationDetailData = Schemas['ConversationDetailResource'];
export type MessageData = Schemas['MessageResource'];
export type ChatVehicleData = Schemas['ChatVehicleResource'];
export type MessagePreviewData = Schemas['MessagePreviewResource'];
export type MemberSummaryData = Schemas['MemberSummaryResource'];
export type MemberSearchData = Schemas['MemberSearchResource'];

/** Contract §2 and the handover §5. */
export const INBOX_PAGE_SIZE = 30;
export const THREAD_PAGE_SIZE = 30;
export const POLL_PAGE_SIZE = 100;
export const SEARCH_PAGE_SIZE = 20;
/** A poll that keeps finding full pages stops after this many, and the next poll goes on. */
const MAX_POLL_ROUNDS = 5;
/** Every this many polls the open thread reads its newest page again (review 7). */
export const REFRESH_EVERY = 5;
/** Polls per thread, for REFRESH_EVERY. */
const pollCounts = new Map<string, number>();
/** Validators kept at most (review 18); the oldest go first. */
const MAX_ETAGS = 200;
const NOT_MODIFIED = 304;

// -- Mapping (pure, tested on its own)

export function toChatMember(member: MemberSummaryData | null): ChatMember | null {
  return member
    ? {
        username: member.username,
        displayName: member.display_name,
        avatar: member.avatar,
        carCover: readCarCover(member),
        mainVehicle: readMainVehicle(member),
      }
    : null;
}

/** A field of a response the generated types do not have yet (lane B gaps), read only when the server sends it. */
function extraField(source: object, key: string): unknown {
  return key in source ? (source as Record<string, unknown>)[key] : undefined;
}

/** DQ-1086: `main_vehicle {slug, title}` of the conversation member ("fährt BMW M3"); null when absent or without a title. */
export function readMainVehicle(member: object): ChatMember['mainVehicle'] {
  const vehicle = extraField(member, 'main_vehicle');
  if (typeof vehicle !== 'object' || vehicle === null) return null;
  const slug = extraField(vehicle, 'slug');
  const title = extraField(vehicle, 'title');
  return typeof slug === 'string' && typeof title === 'string' && title.trim() !== '' ? { slug, title: title.trim() } : null;
}

/** DQ-1086: the spec mini-line's values, only those the server sends. */
function specOf(vehicle: object): Pick<ChatVehicle, 'powerPs' | 'torqueNm'> {
  const powerPs = readSpec(vehicle, 'power_ps');
  const torqueNm = readSpec(vehicle, 'torque_nm');
  return { ...(powerPs === null ? {} : { powerPs }), ...(torqueNm === null ? {} : { torqueNm }) };
}

/** DQ-1086: a positive number of the shared vehicle's spec, or null. */
function readSpec(vehicle: object, key: string): number | null {
  const value = extraField(vehicle, key);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** 09 §7.8 car badge: `main_vehicle_cover` is not in the API types yet (lane B gap), so it is read only when the server sends it. */
export function readCarCover(member: object): ChatMember['carCover'] {
  if (!('main_vehicle_cover' in member)) return null;
  const cover: unknown = (member as { main_vehicle_cover?: unknown }).main_vehicle_cover;
  return typeof cover === 'object' && cover !== null && 'variants' in cover ? (cover as NonNullable<ChatMember['carCover']>) : null;
}

export function toChatVehicle(vehicle: ChatVehicleData | null): ChatVehicle | null {
  return vehicle
    ? {
        id: vehicle.id,
        slug: vehicle.slug,
        title: vehicle.full_title,
        cover: vehicle.cover,
        ownerUsername: vehicle.owner_username,
        ...specOf(vehicle),
      }
    : null;
}

export function toPreview(preview: MessagePreviewData | null): MessagePreview | null {
  return preview
    ? { kind: preview.type, body: preview.body, mine: preview.is_mine, createdAt: preview.created_at }
    : null;
}

type OrganiseBody = Schemas['OrganiseConversationRequest'];

/** The PATCH body of a mute change (M2.8): `{muted: true}` has no end, `{muted_until}` ends then, `{muted: false}` unmutes. */
export function muteBody(change: MuteChange): Pick<OrganiseBody, 'muted' | 'muted_until'> {
  if (change === 'indefinite') return { muted: true };
  if (change === 'off') return { muted: false };
  return { muted_until: change.until };
}

function muteFields(change: MuteChange): Pick<ConversationSummary, 'mutedUntil' | 'muted'> {
  return { mutedUntil: typeof change === 'object' ? change.until : null, muted: change !== 'off' };
}

export function toSummary(row: ConversationData): ConversationSummary {
  return {
    id: row.id,
    folder: row.folder,
    other: toChatMember(row.other),
    otherDeleted: row.other_deleted,
    vehicle: toChatVehicle(row.vehicle),
    lastMessage: toPreview(row.last_message),
    unreadCount: row.unread_count,
    mutedUntil: row.muted_until,
    muted: row.muted,
    pinnedAt: row.pinned_at,
    archivedAt: row.archived_at,
    canSend: row.can_send,
    cannotSendReason: row.cannot_send_reason,
    requestPending: row.request_pending,
    updatedAt: row.updated_at ?? row.last_message?.created_at ?? '',
  };
}

export function toDetail(row: ConversationDetailData): ConversationDetail {
  return {
    ...toSummary(row),
    contextVehicle: toChatVehicle(row.context_vehicle),
    otherTyping: row.other_typing,
    otherReadMessageId: row.other_read_message_id,
  };
}

/** The key is the client id when there is one (your own), so the server copy takes the optimistic bubble's place. */
export function toMessage(row: MessageData): ThreadMessage {
  return {
    key: row.client_id ?? row.id,
    id: row.id,
    clientId: row.client_id,
    kind: row.type,
    body: row.body,
    media: row.media,
    localPhoto: null,
    vehicle: toChatVehicle(row.vehicle),
    mine: row.is_mine,
    senderDeleted: row.sender_deleted,
    senderUsername: row.is_mine ? null : (row.sender?.username ?? null),
    createdAt: row.created_at,
    // Every key the app knows, the four build reactions (Stark · Sauber · Tief · Laut) included; a key from a newer server is left out.
    reactions: row.reactions.flatMap((reaction) =>
      isReactionKey(reaction.key) ? [{ key: reaction.key, count: reaction.count, mine: reaction.mine }] : [],
    ),
    delivery: 'sent',
    failure: null,
    replyTo: readReplyTo(row),
  };
}

/**
 * Swipe-to-reply (09 §7.8, flag `msg_replies`): `reply_to` is not in the API types yet (lane B gap), so it is read only when the
 * server sends it, and checked field by field.
 */
export function readReplyTo(row: object): ReplyQuote | null {
  if (!('reply_to' in row)) return null;
  const quote: unknown = (row as { reply_to?: unknown }).reply_to;
  if (typeof quote !== 'object' || quote === null) return null;
  const { id, type, body, is_mine: mine, available } = quote as Record<string, unknown>;
  if (typeof id !== 'string' || (type !== 'text' && type !== 'photo' && type !== 'vehicle') || typeof mine !== 'boolean') return null;
  return { id, kind: type, mine, excerpt: typeof body === 'string' ? body : null, ...(available === false ? { available: false } : {}) };
}

/** `cannot_message_reason` codes as MSG-03 says them. */
export function reasonText(reason: string | null): string | null {
  if (!reason) return null;
  const key = `compose.reasons.${reason}`;
  return i18n.exists(key, { ns: 'messages' })
    ? i18n.t(key, { ns: 'messages' })
    : i18n.t('compose.cannot', { ns: 'messages' });
}

export function searchCandidate(row: MemberSearchData, conversationId: string | null): MessageCandidate {
  return {
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    line: row.garage.line || null,
    canMessage: row.can_message,
    reason: row.can_message ? null : reasonText(row.cannot_message_reason),
    conversationId,
  };
}

export function recentCandidate(conversation: ConversationSummary): MessageCandidate | null {
  if (!conversation.other || conversation.otherDeleted) return null;
  return {
    username: conversation.other.username,
    displayName: conversation.other.displayName,
    avatar: conversation.other.avatar,
    line: null,
    canMessage: conversation.canSend,
    reason: conversation.canSend ? null : reasonText(conversation.cannotSendReason),
    conversationId: conversation.id,
  };
}

// -- Keys

export const messagingKeys = {
  all: (member: string) => ['messaging', member] as const,
  inboxAll: (member: string) => ['messaging', member, 'inbox'] as const,
  inbox: (member: string, folder: Folder, q: string) => ['messaging', member, 'inbox', folder, q] as const,
  conversation: (member: string, id: string) => ['messaging', member, 'conversation', id] as const,
  thread: (member: string, id: string) => ['messaging', member, 'thread', id] as const,
  candidates: (member: string, q: string) => ['messaging', member, 'candidates', q] as const,
};

type InboxPage = { rows: ConversationSummary[]; next: string | null };
/**
 * `cursor` (newest page only): the newest id a server read of this thread has seen in full, the newest page or an `after` result.
 * Send answers never move it (review 2): ids are handed out in commit order, so a message of the other member committed just
 * before your own would be skipped by `after=<your id>` and then marked read unseen.
 */
type ThreadPage = { messages: ThreadMessage[]; hasMore: boolean; cursor?: string | null };
type InboxData = InfiniteData<InboxPage, string | null>;
type ThreadCache = InfiniteData<ThreadPage, string | null>;

function useMember(): string | null {
  return useSessionStore((state) =>
    state.status === 'member' && !state.memberChanged ? (state.member?.id ?? null) : null,
  );
}

// -- ETag reads

type Result<T> = { data?: T; error?: unknown; response: Response };

/** The validator of the last 200 per URL key. An idle poll sends it back and gets a 304 without a body. */
const etags = new Map<string, string>();

/** The body of a 200 and its ETag, or null for a 304. Errors as `apiData` throws them. */
export async function readFresh<T>(
  key: string,
  call: (etag: string | undefined) => Promise<Result<T>>,
): Promise<T | null> {
  let result: Result<T>;
  try {
    result = await call(etags.get(key));
  } catch (error) {
    if ((error instanceof Error && error.name === 'AbortError') || error instanceof ApiError) throw error;
    throw networkError();
  }
  if (result.response.status === NOT_MODIFIED) return null;
  const data = await apiData(Promise.resolve(result));
  const etag = result.response.headers.get('ETag');
  etags.delete(key);
  if (etag) etags.set(key, etag);
  while (etags.size > MAX_ETAGS) {
    const oldest = etags.keys().next().value;
    if (oldest === undefined) break;
    etags.delete(oldest);
  }
  return data;
}

/** Forgets every validator and poll count: at the end of a session (review 18), and in tests. */
export function forgetEtags(): void {
  etags.clear();
  pollCounts.clear();
}

// Validators belong to the member who read them: another member, or none, starts without them.
let etagMember: string | null = useSessionStore.getState().member?.id ?? null;
useSessionStore.subscribe((state) => {
  const next = state.status === 'member' ? (state.member?.id ?? null) : null;
  if (next === etagMember) return;
  etagMember = next;
  forgetEtags();
});

const header = (etag: string | undefined) => (etag ? { 'If-None-Match': etag } : undefined);

// -- Cache edits

function editInbox(
  client: QueryClient,
  member: string,
  edit: (row: ConversationSummary, folder: Folder) => ConversationSummary | null,
): void {
  for (const [key, data] of client.getQueriesData<InboxData>({ queryKey: messagingKeys.inboxAll(member) })) {
    if (!data) continue;
    const folder = (key[3] as Folder | undefined) ?? 'chats';
    client.setQueryData<InboxData>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        rows: page.rows.flatMap((row) => edit(row, folder) ?? []),
      })),
    });
  }
}

/**
 * Newer server messages on top of the newest page; a message already there is replaced (fresher reactions). `polled` is true only
 * for an `after` result, which moves the poll cursor; a send answer passes false and leaves it where the last server read put it.
 */
export function addNewer(
  client: QueryClient,
  member: string,
  conversationId: string,
  newer: readonly ThreadMessage[],
  polled: boolean = false,
): void {
  if (newer.length === 0) return;
  const ids = new Set(newer.map((message) => message.id));
  client.setQueryData<ThreadCache>(messagingKeys.thread(member, conversationId), (data) => {
    if (!data) return data;
    const pages = data.pages.map((page, index) => {
      const rest = page.messages.filter((message) => !ids.has(message.id));
      if (index !== 0) return { ...page, messages: rest };
      return {
        ...page,
        messages: uniqueServerMessages([rest, [...newer]]),
        cursor: polled ? laterId(page.cursor, newestServerId(newer)) : (page.cursor ?? null),
      };
    });
    return { ...data, pages };
  });
}

function editMessage(
  client: QueryClient,
  member: string,
  conversationId: string,
  messageId: string,
  edit: (message: ThreadMessage) => ThreadMessage | null,
): void {
  client.setQueryData<ThreadCache>(messagingKeys.thread(member, conversationId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            messages: page.messages.flatMap((message) =>
              message.id === messageId ? (edit(message) ?? []) : [message],
            ),
          })),
        }
      : data,
  );
}

function patchDetail(
  client: QueryClient,
  member: string,
  id: string,
  patch: Partial<ConversationDetail>,
): void {
  client.setQueryData<ConversationDetail>(messagingKeys.conversation(member, id), (data) =>
    data ? { ...data, ...patch } : data,
  );
}

function refreshCounts(client: QueryClient, member: string): Promise<void> {
  return client.invalidateQueries({ queryKey: notificationKeys.unread(member) });
}

/** The reactions after your own changed: one per member and message (contract §2). */
export function withReaction(message: ThreadMessage, key: ReactionKey | null): ThreadMessage {
  const before = message.reactions.find((reaction) => reaction.mine)?.key ?? null;
  let reactions = message.reactions.map((reaction) =>
    reaction.key === before ? { ...reaction, count: reaction.count - 1, mine: false } : reaction,
  );
  if (key) {
    const existing = reactions.find((reaction) => reaction.key === key);
    reactions = existing
      ? reactions.map((reaction) =>
          reaction.key === key ? { ...reaction, count: reaction.count + 1, mine: true } : reaction,
        )
      : [...reactions, { key, count: 1, mine: true }];
  }
  return { ...message, reactions: reactions.filter((reaction) => reaction.count > 0) };
}

// -- Reads

function loadable<T>(query: {
  data: T | undefined;
  isPending: boolean;
  fetchStatus: string;
  error: unknown;
  isFetching: boolean;
  refetch: () => unknown;
}): Loadable<T> {
  return {
    data: query.data,
    isPending: query.isPending && query.fetchStatus !== 'paused',
    isPaused: query.data === undefined && query.fetchStatus === 'paused',
    error: query.error instanceof ApiError ? query.error : query.error ? networkError() : null,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

function useInbox(folder: Folder, q: string): PagedList<ConversationSummary> {
  const member = useMember();
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: messagingKeys.inbox(member ?? 'guest', folder, q),
    queryFn: async ({ pageParam, signal, queryKey }): Promise<InboxPage> => {
      const params = {
        folder,
        per_page: INBOX_PAGE_SIZE,
        ...(q ? { q } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      };
      // Only the first page is polled, so only it carries a validator.
      const etagKey = pageParam ? null : JSON.stringify(queryKey);
      const read = (etag: string | undefined) =>
        api.GET('/conversations', { params: { query: params, header: header(etag) }, signal });
      if (!etagKey) {
        const page = await apiData(read(undefined));
        return { rows: page.data.map(toSummary), next: page.meta.next_cursor };
      }
      const page = await readFresh(etagKey, read);
      if (page) return { rows: page.data.map(toSummary), next: page.meta.next_cursor };
      const cached = client.getQueryData<InboxData>(queryKey)?.pages[0];
      if (cached) return cached;
      etags.delete(etagKey);
      const again = await apiData(read(undefined));
      return { rows: again.data.map(toSummary), next: again.meta.next_cursor };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: member !== null,
    staleTime: 0,
    retry: false,
    meta: { persist: false },
  });
  const rows = useMemo(() => {
    if (!query.data) return undefined;
    const seen = new Set<string>();
    return query.data.pages
      .flatMap((page) => page.rows)
      .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  }, [query.data]);
  return {
    ...loadable({ ...query, data: rows }),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  };
}

function useCounts(): InboxCounts {
  const unread = useUnreadCount();
  return {
    messages: Math.max(0, unread.data?.messages ?? 0),
    requests: Math.max(0, unread.data?.requests ?? 0),
  };
}

async function fetchDetail(
  client: QueryClient,
  member: string,
  id: string,
  signal: AbortSignal,
): Promise<ConversationDetail> {
  const key = messagingKeys.conversation(member, id);
  const etagKey = JSON.stringify(key);
  const read = (etag: string | undefined) =>
    api.GET('/conversations/{conversation}', {
      params: { path: { conversation: id }, header: header(etag) },
      signal,
    });
  const body = await readFresh(etagKey, read);
  if (body) return toDetail(body.data);
  const cached = client.getQueryData<ConversationDetail>(key);
  if (cached) return cached;
  etags.delete(etagKey);
  return toDetail((await apiData(read(undefined))).data);
}

function useConversation(id: string | undefined): Loadable<ConversationDetail> {
  const member = useMember();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: messagingKeys.conversation(member ?? 'guest', id ?? ''),
    queryFn: ({ signal }) => fetchDetail(client, member ?? 'guest', id ?? '', signal),
    enabled: member !== null && Boolean(id),
    staleTime: 0,
    retry: false,
    meta: { persist: false },
  });
  return loadable(query);
}

async function fetchThreadPage(id: string, before: string | null, signal: AbortSignal): Promise<ThreadPage> {
  const page = await apiData(
    api.GET('/conversations/{conversation}/messages', {
      params: {
        path: { conversation: id },
        query: { limit: THREAD_PAGE_SIZE, ...(before ? { before } : {}) },
      },
      signal,
    }),
  );
  const messages = page.data.map(toMessage);
  return { messages, hasMore: page.meta.has_more, ...(before ? {} : { cursor: newestServerId(messages) }) };
}

function laterId(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return compareIds(a, b) >= 0 ? a : b;
}

/** The poll cursor of a thread in the cache: only server reads set it. */
export function pollCursor(client: QueryClient, member: string, conversationId: string): string | null {
  return (
    client.getQueryData<ThreadCache>(messagingKeys.thread(member, conversationId))?.pages[0]?.cursor ?? null
  );
}

/**
 * The newest page read again and laid over the cached one (review 7): reactions, removals and messages hidden for you show up.
 * Older cached messages and anything newer than the read (a send answered meanwhile) stay.
 */
export async function refreshNewest(
  client: QueryClient,
  member: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<void> {
  const fresh = await fetchThreadPage(conversationId, null, signal);
  client.setQueryData<ThreadCache>(messagingKeys.thread(member, conversationId), (data) => {
    const first = data?.pages[0];
    if (!data || !first) return data;
    const newest = fresh.messages[0]?.id ?? null;
    const oldest = fresh.messages[fresh.messages.length - 1]?.id ?? null;
    const older =
      oldest && fresh.hasMore
        ? first.messages.filter((message) => message.id && compareIds(message.id, oldest) < 0)
        : [];
    const newer = first.messages.filter(
      (message) => message.id && (!newest || compareIds(message.id, newest) > 0),
    );
    const page: ThreadPage = {
      ...first,
      messages: uniqueServerMessages([older, fresh.messages, newer]),
      hasMore: fresh.hasMore ? first.hasMore : false,
      cursor: laterId(first.cursor, fresh.cursor),
    };
    // A thread that fits the newest page has nothing older: pages read before are gone with what was hidden in them.
    return fresh.hasMore
      ? { ...data, pages: [page, ...data.pages.slice(1)] }
      : { pages: [page], pageParams: [data.pageParams[0] ?? null] };
  });
}

function useThread(id: string | undefined): ThreadData {
  const member = useMember();
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: messagingKeys.thread(member ?? 'guest', id ?? ''),
    queryFn: ({ pageParam, signal }) => fetchThreadPage(id ?? '', pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.hasMore ? (last.messages[last.messages.length - 1]?.id ?? undefined) : undefined,
    enabled: member !== null && Boolean(id),
    staleTime: Infinity,
    retry: false,
    meta: { persist: false },
  });
  const messages = useMemo(
    () => (query.data ? uniqueServerMessages(query.data.pages.map((page) => page.messages)) : undefined),
    [query.data],
  );

  const pollNewer = useMemo(
    () => async (signal: AbortSignal) => {
      if (!member || !id) return [];
      const detail = fetchDetail(client, member, id, signal).then((next) =>
        client.setQueryData(messagingKeys.conversation(member, id), next),
      );
      // The poll may throw (abort, offline) before it reaches `await detail`; without a handler attached now, the detail's own
      // rejection would surface as an unhandled rejection (A1). The later await still rethrows it when the poll gets there.
      detail.catch(() => undefined);
      const clientIds: string[] = [];
      const seenIds = () =>
        (
          client.getQueryData<ThreadCache>(messagingKeys.thread(member, id))?.pages[0]?.messages ?? []
        ).flatMap((message) => (message.clientId ? [message.clientId] : []));
      const count = (pollCounts.get(`${member}|${id}`) ?? 0) + 1;
      pollCounts.set(`${member}|${id}`, count);
      let after = pollCursor(client, member, id);
      // No server read yet (an empty thread) or every Nth poll: the newest page again, which also sets the cursor.
      if (!after || count % REFRESH_EVERY === 0) {
        await refreshNewest(client, member, id, signal);
        await detail;
        return seenIds();
      }
      for (let round = 0; round < MAX_POLL_ROUNDS && after; round += 1) {
        const etagKey = `${member}|${id}|after|${after}`;
        const cursor: string = after;
        const body = await readFresh(etagKey, (etag) =>
          api.GET('/conversations/{conversation}/messages', {
            params: {
              path: { conversation: id },
              query: { after: cursor, limit: POLL_PAGE_SIZE },
              header: header(etag),
            },
            signal,
          }),
        );
        if (!body || body.data.length === 0) break;
        const newer = body.data.map(toMessage);
        addNewer(client, member, id, newer, true);
        newer.forEach((message) => message.clientId && clientIds.push(message.clientId));
        // The validator of a cursor that moved on is never sent again (review 18).
        etags.delete(etagKey);
        after = pollCursor(client, member, id);
        if (!body.meta.has_more) break;
      }
      await detail;
      return clientIds;
    },
    [client, id, member],
  );
  const refresh = useMemo(
    () => async (signal: AbortSignal) => {
      if (member && id) await refreshNewest(client, member, id, signal);
    },
    [client, id, member],
  );
  const readUpTo = query.data?.pages[0]?.cursor ?? null;

  return {
    ...loadable({ ...query, data: messages }),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
    pollNewer,
    refresh,
    readUpTo,
  };
}

function useCandidates(q: string): PagedList<MessageCandidate> {
  const member = useMember();
  const recent = useInbox('chats', '');
  const query = useInfiniteQuery({
    queryKey: messagingKeys.candidates(member ?? 'guest', q),
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        api.GET('/search/users', {
          params: { query: { q, per_page: SEARCH_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) } },
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: member !== null && q !== '',
    retry: false,
    meta: { persist: false },
  });
  const byUsername = useMemo(
    () =>
      new Map(
        (recent.data ?? []).flatMap((row) => (row.other ? [[row.other.username, row.id] as const] : [])),
      ),
    [recent.data],
  );
  const results = useMemo(
    () =>
      q === ''
        ? recent.data?.flatMap((row) => recentCandidate(row) ?? [])
        : query.data?.pages.flatMap((page) =>
            page.data
              .filter((row) => !row.is_self)
              .map((row) => searchCandidate(row, byUsername.get(row.username) ?? null)),
          ),
    [byUsername, q, query.data, recent.data],
  );
  if (q === '') return { ...recent, data: results };
  return {
    ...loadable({ ...query, data: results }),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  };
}

function useSharedVehicle(slug: string | undefined): Loadable<ChatVehicle> {
  const query = usePublicVehicle(slug);
  const data = query.data;
  const vehicle = useMemo<ChatVehicle | undefined>(
    () =>
      data
        ? {
            id: data.id,
            slug: data.slug,
            title: data.full_title,
            cover: data.cover,
            ownerUsername: data.owner?.username ?? null,
          }
        : undefined,
    [data],
  );
  return loadable({ ...query, data: vehicle });
}

function useOwnVehicles(): Loadable<readonly ChatVehicle[]> {
  const query = useMyVehicles();
  const username = useSessionStore((state) => state.member?.username ?? null);
  const data = query.data;
  const vehicles = useMemo(
    () =>
      data
        ?.filter((vehicle) => vehicle.status === 'published')
        .map((vehicle) => ({
          id: vehicle.id,
          slug: vehicle.slug,
          title: vehicle.full_title,
          cover: vehicle.cover,
          ownerUsername: username,
        })),
    [data, username],
  );
  return loadable({ ...query, data: vehicles });
}

const REALTIME_OFF: RealtimeConfig = { enabled: false, key: null, cluster: null };

function useRealtimeConfig(): RealtimeConfig {
  return useAppConfig().config.realtime ?? REALTIME_OFF;
}

// -- Writes

async function noContent(call: Promise<Result<unknown>>): Promise<void> {
  await apiData(call);
}

function refreshInbox(client: QueryClient, member: string): Promise<void> {
  return Promise.all([
    client.refetchQueries({ queryKey: messagingKeys.inboxAll(member), type: 'active' }),
    refreshCounts(client, member),
  ]).then(() => undefined);
}

/** The folder of a conversation as the cache knows it: the detail first, then any inbox list. */
function folderOf(client: QueryClient, member: string, id: string): Folder | null {
  const detail = client.getQueryData<ConversationDetail>(messagingKeys.conversation(member, id));
  if (detail) return detail.folder;
  for (const [, data] of client.getQueriesData<InboxData>({ queryKey: messagingKeys.inboxAll(member) })) {
    const row = data?.pages.flatMap((page) => page.rows).find((item) => item.id === id);
    if (row) return row.folder;
  }
  return null;
}

export function createActions(client: QueryClient, member: string): MessagingActions {
  const inboxChanged = () => void client.invalidateQueries({ queryKey: messagingKeys.inboxAll(member) });
  const declineRequest = async (id: string) => {
    await noContent(
      api.POST('/conversations/{conversation}/decline', { params: { path: { conversation: id } } }),
    );
    editInbox(client, member, (row) => (row.id === id ? null : row));
    client.removeQueries({ queryKey: messagingKeys.conversation(member, id) });
    client.removeQueries({ queryKey: messagingKeys.thread(member, id) });
    void refreshCounts(client, member);
  };
  return {
    markRead: async (id, messageId) => {
      // Review 20: a refusal puts back the counts this call cleared, and nothing a later answer set.
      const counts = new Map<string, number>();
      for (const [, data] of client.getQueriesData<InboxData>({ queryKey: messagingKeys.inboxAll(member) })) {
        data?.pages.forEach((page) =>
          page.rows.forEach((row) => row.id === id && counts.set('inbox', row.unreadCount)),
        );
      }
      const detailCount = client.getQueryData<ConversationDetail>(
        messagingKeys.conversation(member, id),
      )?.unreadCount;
      editInbox(client, member, (row) => (row.id === id ? { ...row, unreadCount: 0 } : row));
      patchDetail(client, member, id, { unreadCount: 0 });
      try {
        await noContent(
          api.POST('/conversations/{conversation}/read', {
            params: { path: { conversation: id } },
            body: { message_id: messageId },
          }),
        );
      } catch (error) {
        const inboxCount = counts.get('inbox');
        if (inboxCount !== undefined)
          editInbox(client, member, (row) =>
            row.id === id && row.unreadCount === 0 ? { ...row, unreadCount: inboxCount } : row,
          );
        if (detailCount !== undefined) {
          client.setQueryData<ConversationDetail>(messagingKeys.conversation(member, id), (data) =>
            data && data.unreadCount === 0 ? { ...data, unreadCount: detailCount } : data,
          );
        }
        throw error;
      }
      void refreshCounts(client, member);
    },
    accept: async (id) => {
      const body = await apiData(
        api.POST('/conversations/{conversation}/accept', { params: { path: { conversation: id } } }),
      );
      client.setQueryData(messagingKeys.conversation(member, id), toDetail(body.data));
      inboxChanged();
      void refreshCounts(client, member);
    },
    decline: async (id) => {
      await declineRequest(id);
    },
    deleteConversation: async (id) => {
      // A pending request is never DELETEd (review 1): "Löschen" of a request declines it, so its sender stays held at one message.
      if (folderOf(client, member, id) === 'requests') {
        await declineRequest(id);
        return;
      }
      const before = client.getQueriesData<InboxData>({ queryKey: messagingKeys.inboxAll(member) });
      editInbox(client, member, (row) => (row.id === id ? null : row));
      try {
        await noContent(
          api.DELETE('/conversations/{conversation}', { params: { path: { conversation: id } } }),
        );
      } catch (error) {
        before.forEach(([key, data]) => client.setQueryData(key, data));
        throw error;
      }
      client.removeQueries({ queryKey: messagingKeys.thread(member, id) });
      client.removeQueries({ queryKey: messagingKeys.conversation(member, id) });
      void refreshCounts(client, member);
    },
    organise: async (id, patch: OrganisePatch) => {
      const before = client.getQueriesData<InboxData>({ queryKey: messagingKeys.inboxAll(member) });
      const detailBefore = client.getQueryData<ConversationDetail>(messagingKeys.conversation(member, id));
      const now = new Date().toISOString();
      const change = (row: ConversationSummary): ConversationSummary => ({
        ...row,
        ...(patch.mute !== undefined ? muteFields(patch.mute) : {}),
        ...(patch.pinned !== undefined ? { pinnedAt: patch.pinned ? now : null } : {}),
        ...(patch.archived !== undefined
          ? {
              archivedAt: patch.archived ? now : null,
              folder: patch.archived ? 'archived' : 'chats',
              pinnedAt: patch.archived ? null : row.pinnedAt,
            }
          : {}),
      });
      // Archiving moves the row out of the folder on screen at once.
      editInbox(client, member, (row, folder) => {
        if (row.id !== id) return row;
        const next = change(row);
        return patch.archived === undefined || next.folder === folder ? next : null;
      });
      if (detailBefore)
        client.setQueryData(messagingKeys.conversation(member, id), {
          ...detailBefore,
          ...change(detailBefore),
        });
      try {
        const changes: OrganiseBody = {
          ...(patch.mute !== undefined ? muteBody(patch.mute) : {}),
          ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
          ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        };
        const body = await apiData(api.PATCH('/conversations/{conversation}', { params: { path: { conversation: id } }, body: changes }));
        client.setQueryData(messagingKeys.conversation(member, id), toDetail(body.data));
      } catch (error) {
        before.forEach(([key, data]) => client.setQueryData(key, data));
        if (detailBefore) client.setQueryData(messagingKeys.conversation(member, id), detailBefore);
        throw error;
      } finally {
        inboxChanged();
        void refreshCounts(client, member);
      }
    },
    hideMessage: async (conversationId, messageId) => {
      const key = messagingKeys.thread(member, conversationId);
      const page =
        client
          .getQueryData<ThreadCache>(key)
          ?.pages.findIndex((item) => item.messages.some((message) => message.id === messageId)) ?? -1;
      const hidden =
        page >= 0
          ? client
              .getQueryData<ThreadCache>(key)
              ?.pages[page]?.messages.find((message) => message.id === messageId)
          : undefined;
      editMessage(client, member, conversationId, messageId, () => null);
      try {
        await noContent(api.DELETE('/messages/{message}', { params: { path: { message: messageId } } }));
      } catch (error) {
        // Put the one message back where it was, leaving every later change of the thread alone (review 20).
        if (hidden) {
          client.setQueryData<ThreadCache>(key, (data) =>
            data
              ? {
                  ...data,
                  pages: data.pages.map((item, index) =>
                    index === page
                      ? { ...item, messages: uniqueServerMessages([item.messages, [hidden]]) }
                      : item,
                  ),
                }
              : data,
          );
        }
        throw error;
      }
      inboxChanged();
    },
    react: async (conversationId, messageId, key) => {
      const reactionsBefore = client
        .getQueryData<ThreadCache>(messagingKeys.thread(member, conversationId))
        ?.pages.flatMap((page) => page.messages)
        .find((message) => message.id === messageId)?.reactions;
      editMessage(client, member, conversationId, messageId, (message) => withReaction(message, key));
      try {
        const path = { params: { path: { message: messageId } } };
        const body = key
          ? await apiData(api.POST('/messages/{message}/reactions', { ...path, body: { key } }))
          : await apiData(api.DELETE('/messages/{message}/reactions', path));
        editMessage(client, member, conversationId, messageId, (message) => ({
          ...toMessage(body.data),
          key: message.key,
        }));
      } catch (error) {
        // Only this message's reactions go back, and only to what they were (review 20).
        if (reactionsBefore)
          editMessage(client, member, conversationId, messageId, (message) => ({
            ...message,
            reactions: reactionsBefore,
          }));
        throw error;
      }
    },
    typing: async (id) => {
      try {
        await noContent(
          api.POST('/conversations/{conversation}/typing', { params: { path: { conversation: id } } }),
        );
      } catch (error) {
        // `sig.msg_typing` off or the limit reached: typing is a courtesy, never an error the member sees.
        if (error instanceof ApiError && (error.kind === 'not_found' || error.kind === 'rate_limited'))
          return;
        throw error;
      }
    },
    start: async ({ recipient, vehicleId, message, clientId, idempotencyKey }: StartInput) => {
      const body = await apiData(
        api.POST('/conversations', {
          body: {
            recipient,
            vehicle_id: vehicleId,
            message:
              message.kind === 'text'
                ? { type: 'text', body: message.body }
                : { type: 'vehicle', vehicle_id: message.vehicleId },
            client_id: clientId,
          },
          ...withIdempotency(idempotencyKey),
        }),
      );
      const detail = toDetail(body.data.conversation);
      client.setQueryData(messagingKeys.conversation(member, detail.id), detail);
      addNewer(client, member, detail.id, [toMessage(body.data.message)]);
      inboxChanged();
      return { conversationId: detail.id };
    },
    refreshInbox: () => refreshInbox(client, member),
  };
}

function useActions(): MessagingActions {
  const client = useQueryClient();
  const member = useMember() ?? 'guest';
  return useMemo(() => createActions(client, member), [client, member]);
}

// -- Transport of the outbox and realtime auth

/** One photo to `POST conversations/{id}/media` (multipart), with the session's credentials and its abort (SEC-S-01). */
async function uploadPhoto(conversationId: string, photo: LocalPhoto, signal: AbortSignal): Promise<string> {
  const form = await photoForm(photo.uri);
  const headers = await uploadHeaders();
  const bound = typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, sessionSignal()]) : signal;
  let response: Response;
  try {
    response = await globalThis.fetch(
      `${apiOrigin()}/api/v1/conversations/${encodeURIComponent(conversationId)}/media`,
      {
        method: 'POST',
        headers,
        body: form,
        credentials: isWeb && sendsSessionCookie() ? 'include' : 'omit',
        signal: bound,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw networkError();
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const id =
    typeof body === 'object' && body !== null ? (body as { data?: { id?: unknown } }).data?.id : undefined;
  if (response.ok && typeof id === 'string') return id;
  throw toApiError(response, body);
}

/** `POST conversations/{id}/messages`. A replay (200, `Idempotency-Replayed`) answers the first message, which dedupes on client_id. */
async function sendMessage({
  conversationId,
  clientId,
  idempotencyKey,
  draft,
  mediaId,
  signal,
}: SendRequest): Promise<ThreadMessage> {
  const body =
    draft.kind === 'text'
      ? { type: 'text' as const, body: draft.body, client_id: clientId, ...(draft.replyTo ? { reply_to_id: draft.replyTo.id } : {}) }
      : draft.kind === 'photo'
        ? { type: 'photo' as const, media_id: mediaId, client_id: clientId }
        : { type: 'vehicle' as const, vehicle_id: draft.vehicle.id, client_id: clientId };
  const answer = await apiData(
    api.POST('/conversations/{conversation}/messages', {
      params: { path: { conversation: conversationId } },
      body,
      signal,
      ...withIdempotency(idempotencyKey),
    }),
  );
  return toMessage(answer.data);
}

async function authorizeChannel(
  channelName: string,
  socketId: string,
  signal: AbortSignal,
): Promise<ChannelAuth> {
  const answer = await apiData(
    api.POST('/broadcasting/auth', { body: { channel_name: channelName, socket_id: socketId }, signal }),
  );
  return { auth: answer.auth };
}

/** The adapter of the app. `client` is the app's query client; tests hand in their own. */
export function createMessagingAdapter(client: QueryClient = appQueryClient): MessagingAdapter {
  return {
    available: true,
    useInbox,
    useCounts,
    useConversation,
    useThread,
    useCandidates,
    useSharedVehicle,
    useOwnVehicles,
    useRealtimeConfig,
    useActions,
    transport: { uploadPhoto, send: sendMessage },
    insertDelivered: (member, conversationId, message) => {
      addNewer(client, member, conversationId, [message]);
      void client.invalidateQueries({ queryKey: messagingKeys.inboxAll(member) });
    },
    sendRejected: (member, conversationId) => {
      void client.invalidateQueries({ queryKey: messagingKeys.conversation(member, conversationId) });
    },
    authorizeChannel,
    classify: (error) => classifyError(error, i18n.t('thread.sendFailed', { ns: 'messages' })),
  };
}

export const messagingAdapter: MessagingAdapter = createMessagingAdapter();
