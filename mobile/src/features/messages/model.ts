/**
 * The shapes the messaging screens draw (docs/reports/phase-2/m2.4-contract.md §2, §7). They are view models, not API responses:
 * `api/queries/messaging.ts` maps `ConversationResource` and `MessageResource` onto them once the export has them, so the screens,
 * the outbox and the poller never depend on a response shape. Media keeps the generated `MediaResource`, which already exists.
 */
import type { components } from '@/api/schema';

export type MessageMedia = components['schemas']['MediaResource'];
/**
 * A chat photo (ADR-208): on the private disk, its variant URLs signed for you and valid 10–20 minutes. Every read of the message
 * brings fresh ones; nothing of it is stored.
 */
export type ChatMedia = components['schemas']['ChatMediaResource'];

export type Folder = 'chats' | 'requests' | 'archived';
export type MessageKind = 'text' | 'photo' | 'vehicle';

/** §2 `messages/{id}/reactions`: six fixed keys, one per member and message. */
export const REACTION_KEYS = ['thumbs_up', 'heart', 'fire', 'laugh', 'wow', 'flag'] as const;
export type ReactionKey = (typeof REACTION_KEYS)[number];

export function isReactionKey(value: unknown): value is ReactionKey {
  return typeof value === 'string' && (REACTION_KEYS as readonly string[]).includes(value);
}

export type MessageReaction = { key: ReactionKey; count: number; mine: boolean };

/** The other member of a conversation. Null when the account is gone ("Gelöschtes Mitglied"). */
export type ChatMember = {
  username: string;
  displayName: string | null;
  avatar: MessageMedia | null;
};

/** A shared vehicle: the context card, a vehicle message, MSG-05's shared vehicle. */
export type ChatVehicle = {
  id: string;
  slug: string;
  /** "Nissan Skyline GT-R R34" */
  title: string;
  cover: MessageMedia | null;
  /** "lukas.sc": the context card says "Fahrzeug von @lukas.sc". Null when the owner is not shown. */
  ownerUsername: string | null;
};

/**
 * Where an own message is on its way (contract §7). `sent` is the server's copy. `sending` is under way, `queued` waits for the
 * connection (or for an earlier message of the same conversation), `failed` needs "Erneut senden" or "Löschen".
 */
export type Delivery = 'sent' | 'sending' | 'queued' | 'failed';

/** `consent_required`: 403 while the member has not accepted the changed AGB or Datenschutz (ADR-245); it goes out after the accept. */
export type FailureReason = 'network' | 'rate_limited' | 'request_pending' | 'cannot_message' | 'consent_required' | 'invalid' | 'server';

export type DeliveryFailure = {
  reason: FailureReason;
  message: string;
  /** Seconds from `Retry-After`, for the automatic retry. */
  retryAfter?: number | null;
};

export type ThreadMessage = {
  /** Stable across the optimistic copy and the server's: the client id when there is one, else the server id. */
  key: string;
  /** The server's id, null until the server has the message. ULIDs, so they sort by time. */
  id: string | null;
  clientId: string | null;
  kind: MessageKind;
  body: string | null;
  /** The server's photo, or null while it uploads. */
  media: ChatMedia | null;
  /** A photo not uploaded yet: the local file, its size for the aspect ratio. */
  localPhoto: { uri: string; width: number; height: number } | null;
  vehicle: ChatVehicle | null;
  mine: boolean;
  /** The author's account is gone. */
  senderDeleted: boolean;
  /** The author's handle for screen readers; null for your own and for a deleted member. */
  senderUsername: string | null;
  createdAt: string;
  reactions: readonly MessageReaction[];
  delivery: Delivery;
  failure: DeliveryFailure | null;
};

export type MessagePreview = {
  kind: MessageKind;
  body: string | null;
  mine: boolean;
  createdAt: string;
};

export type ConversationSummary = {
  id: string;
  folder: Folder;
  other: ChatMember | null;
  otherDeleted: boolean;
  vehicle: ChatVehicle | null;
  lastMessage: MessagePreview | null;
  unreadCount: number;
  /** The end of a timed mute; null when not muted or muted with no end ("Bis du es wieder änderst"). */
  mutedUntil: string | null;
  /** Muted as the server answered: with no end, or until `mutedUntil`. The state and the glyph follow this, not `mutedUntil`. */
  muted: boolean;
  pinnedAt: string | null;
  archivedAt: string | null;
  canSend: boolean;
  /** Why not, when `canSend` is false for eligibility. */
  cannotSendReason: CannotSendReason | null;
  /** You wrote a request and wait for the answer: one message is out, no second one (contract Addendum). */
  requestPending: boolean;
  updatedAt: string;
};

export type CannotSendReason = 'recipient_closed' | 'not_verified' | 'restricted';

export type ConversationDetail = ConversationSummary & {
  /** The pinned context card: the conversation's latest vehicle start. */
  contextVehicle: ChatVehicle | null;
  /** [SIG] typing. */
  otherTyping: boolean;
  /** Only when both members send read receipts and this is not a request; the server sends null otherwise (contract §2). */
  otherReadMessageId: string | null;
};

/** A member in MSG-03's picker, with whether you may write to them now. */
export type MessageCandidate = {
  username: string;
  displayName: string | null;
  avatar: MessageMedia | null;
  /** "3 Fahrzeuge · BMW, Nissan" */
  line: string | null;
  canMessage: boolean;
  /** Why not, already translated by the server or the adapter. */
  reason: string | null;
  /** The existing conversation, when there is one: the picker goes straight to it. */
  conversationId: string | null;
};

/** "Lukas" or "@lukas.sc"; the caller names a deleted account. */
export function memberName(member: Pick<ChatMember, 'displayName' | 'username'>): string {
  return member.displayName?.trim() || `@${member.username}`;
}

/** Muted now, at `reference`: `muted`, and a timed mute has not run out since the answer. */
export function isMuted(conversation: Pick<ConversationSummary, 'mutedUntil' | 'muted'>, reference: Date): boolean {
  if (!conversation.muted) return false;
  if (!conversation.mutedUntil) return true;
  const until = Date.parse(conversation.mutedUntil);
  return Number.isFinite(until) && until > reference.getTime();
}

/** ULIDs and the client's time-ordered keys compare as strings. */
export function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Inbox order (contract §2): pinned first, then the latest message. */
export function compareConversations(a: ConversationSummary, b: ConversationSummary): number {
  if (Boolean(a.pinnedAt) !== Boolean(b.pinnedAt)) return a.pinnedAt ? -1 : 1;
  const at = (c: ConversationSummary) => Date.parse(c.lastMessage?.createdAt ?? c.updatedAt) || 0;
  return at(b) - at(a);
}
