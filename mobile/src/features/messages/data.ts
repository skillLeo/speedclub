/**
 * The narrow seam between the messaging screens and the API (contract §2). Screens read and write only through a
 * `MessagingAdapter`; `api/queries/messaging.ts` implements it with TanStack Query and is the default, and tests hand in a fake.
 * `unavailableMessaging` answers "not available" to every read: with it MSG-01 shows its P1 "Bald verfügbar" state.
 */
import { createContext, use } from 'react';

import { ApiError } from '@/api/client';
import { messagingAdapter } from '@/api/queries/messaging';

import type {
  ChatVehicle,
  ConversationDetail,
  ConversationSummary,
  DeliveryFailure,
  Folder,
  MessageCandidate,
  ReactionKey,
  ThreadMessage,
} from './model';
import { classifyError } from './errors';
import type { OutboxTransport } from './outbox';
import type { AuthorizeChannel, RealtimeConfig } from './realtime';

export type Loadable<T> = {
  data: T | undefined;
  /** The first load, nothing to show yet. */
  isPending: boolean;
  /** Paused for the connection with nothing cached: the offline state. */
  isPaused: boolean;
  error: ApiError | null;
  isFetching: boolean;
  refetch: () => void;
};

export type PagedList<T> = Loadable<readonly T[]> & {
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
};

export type ThreadData = PagedList<ThreadMessage> & {
  /**
   * One poll: `messages?after=` the newest server message, merged into the thread (an idle poll is a 304). Also refreshes the
   * conversation (typing, read mark). Resolves with the client ids the server returned, for `Outbox.reconcile`.
   */
  pollNewer: (signal: AbortSignal) => Promise<readonly string[]>;
  /** The newest page read again (on focus): reactions, removals and hidden messages show. */
  refresh: (signal: AbortSignal) => Promise<void>;
  /** The newest id the server's reads have shown in full: what may be marked read. Never moved by a send answer. */
  readUpTo: string | null;
};

export type InboxCounts = { messages: number; requests: number };

/**
 * A mute change: until a moment (at most a year ahead, the server's limit), with no end ("Bis du es wieder änderst"), or off.
 * On the wire (M2.8): `{muted_until: iso}`, `{muted: true}`, `{muted: false}`.
 */
export type MuteChange = { until: string } | 'indefinite' | 'off';

export type OrganisePatch = { mute?: MuteChange; pinned?: boolean; archived?: boolean };

export type StartInput = {
  recipient: string;
  vehicleId: string | null;
  message: { kind: 'text'; body: string } | { kind: 'vehicle'; vehicleId: string };
  clientId: string;
  idempotencyKey: string;
};

/** Writes. Each resolves once the server answered and the cache shows it; optimistic ones change the cache first. */
export type MessagingActions = {
  markRead: (conversationId: string, messageId: string) => Promise<void>;
  accept: (conversationId: string) => Promise<void>;
  decline: (conversationId: string) => Promise<void>;
  organise: (conversationId: string, patch: OrganisePatch) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  hideMessage: (conversationId: string, messageId: string) => Promise<void>;
  /** Null removes your reaction. */
  react: (conversationId: string, messageId: string, key: ReactionKey | null) => Promise<void>;
  typing: (conversationId: string) => Promise<void>;
  /** `POST conversations`: a new conversation, or the existing one of the pair, with its first message. */
  start: (input: StartInput) => Promise<{ conversationId: string }>;
  /** The inbox and the badge counts again, now: the 15 s poll and a realtime event. Resolves when both answered. */
  refreshInbox: () => Promise<void>;
};

export type MessagingAdapter = {
  /** False until the API exists: MSG-01 keeps its placeholder. */
  available: boolean;
  useInbox: (folder: Folder, q: string) => PagedList<ConversationSummary>;
  useCounts: () => InboxCounts;
  useConversation: (conversationId: string | undefined) => Loadable<ConversationDetail>;
  useThread: (conversationId: string | undefined) => ThreadData;
  /** MSG-03: recent conversations first when `q` is empty, then the member search. */
  useCandidates: (q: string) => PagedList<MessageCandidate>;
  /** VEH-01 "Fahrzeug senden": the vehicle to share, by slug (any vehicle the member may view). */
  useSharedVehicle: (slug: string | undefined) => Loadable<ChatVehicle>;
  /** "Fahrzeug teilen": your own vehicles. */
  useOwnVehicles: () => Loadable<readonly ChatVehicle[]>;
  /** For the realtime hub: app-config's public values. */
  useRealtimeConfig: () => RealtimeConfig;
  useActions: () => MessagingActions;
  transport: OutboxTransport;
  /** Puts a delivered message into the thread cache of this member (the outbox's `onDelivered`), outside React. */
  insertDelivered: (memberId: string, conversationId: string, message: ThreadMessage) => void;
  /** A send failed for a reason that changes the conversation (`cannot_message`, `request_pending`): ask for it again. */
  sendRejected: (memberId: string, conversationId: string, failure: DeliveryFailure) => void;
  authorizeChannel: AuthorizeChannel;
  /** Any error to a reason and a message that is safe to show. */
  classify: (error: unknown) => DeliveryFailure;
};

const REALTIME_OFF: RealtimeConfig = { enabled: false, key: null, cluster: null };
const NO_COUNTS: InboxCounts = { messages: 0, requests: 0 };

export function unavailableError(): ApiError {
  return new ApiError({ kind: 'not_found', status: 404, code: 'messaging_unavailable', message: '' });
}

function unavailable<T>(): Loadable<T> {
  return { data: undefined, isPending: false, isPaused: false, error: unavailableError(), isFetching: false, refetch: () => undefined };
}

function unavailableList<T>(): PagedList<T> {
  return { ...unavailable<readonly T[]>(), hasMore: false, isLoadingMore: false, loadMore: () => undefined };
}

const reject = () => Promise.reject(unavailableError());

const NO_ACTIONS: MessagingActions = {
  markRead: reject,
  accept: reject,
  decline: reject,
  organise: reject,
  deleteConversation: reject,
  hideMessage: reject,
  react: reject,
  typing: reject,
  start: reject,
  refreshInbox: () => Promise.resolve(),
};

export const unavailableMessaging: MessagingAdapter = {
  available: false,
  useInbox: () => unavailableList<ConversationSummary>(),
  useCounts: () => NO_COUNTS,
  useConversation: () => unavailable<ConversationDetail>(),
  useThread: () => ({ ...unavailableList<ThreadMessage>(), pollNewer: () => Promise.resolve([]), refresh: () => Promise.resolve(), readUpTo: null }),
  useCandidates: () => unavailableList<MessageCandidate>(),
  useSharedVehicle: () => unavailable<ChatVehicle>(),
  useOwnVehicles: () => unavailable<readonly ChatVehicle[]>(),
  useRealtimeConfig: () => REALTIME_OFF,
  useActions: () => NO_ACTIONS,
  transport: { uploadPhoto: reject, send: reject },
  insertDelivered: () => undefined,
  sendRejected: () => undefined,
  authorizeChannel: reject,
  classify: (error) => classifyError(error, ''),
};

/** The API adapter (api/queries/messaging.ts) by default; tests and the gallery hand in their own. */
export const MessagingContext = createContext<MessagingAdapter>(messagingAdapter);

export function useMessaging(): MessagingAdapter {
  return use(MessagingContext);
}

/** The thread or conversation is gone for this member: 404, which also covers a block (contract §2, never 403). */
export function isConversationGone(error: ApiError | null): boolean {
  return error !== null && error.kind === 'not_found';
}
