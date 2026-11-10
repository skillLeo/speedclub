import type { ChatVehicle, ConversationDetail, ConversationSummary, ThreadMessage } from '@/features/messages/model';

let counter = 0;

/** A server message. Ids are ULID-like: they sort by time. */
export function serverMessage(overrides: Partial<ThreadMessage> & { id: string }): ThreadMessage {
  counter += 1;
  return {
    key: overrides.id,
    clientId: null,
    kind: 'text',
    body: `Nachricht ${counter}`,
    media: null,
    localPhoto: null,
    vehicle: null,
    mine: false,
    senderDeleted: false,
    senderUsername: 'jann.ptrs',
    createdAt: '2026-11-08T10:00:00Z',
    reactions: [],
    delivery: 'sent',
    failure: null,
    ...overrides,
  };
}

export const R34: ChatVehicle = {
  id: '01JVEH0000000000000000R34',
  slug: 'nissan-skyline-gt-r-r34-5tf974vj',
  title: 'Nissan Skyline GT-R R34',
  cover: null,
  ownerUsername: 'lukas.sc',
};

export function conversation(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: '01JCONV000000000000000000A',
    folder: 'chats',
    other: { username: 'jann.ptrs', displayName: 'Jann Peters', avatar: null },
    otherDeleted: false,
    vehicle: null,
    lastMessage: { kind: 'text', body: 'Bis Samstag am Treffpunkt', mine: false, createdAt: '2026-11-08T09:58:00Z' },
    unreadCount: 2,
    mutedUntil: null,
    muted: false,
    pinnedAt: null,
    archivedAt: null,
    canSend: true,
    cannotSendReason: null,
    requestPending: false,
    updatedAt: '2026-11-08T09:58:00Z',
    contextVehicle: null,
    otherTyping: false,
    otherReadMessageId: null,
    ...overrides,
  };
}

export function summary(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  const { contextVehicle: _c, otherTyping: _t, otherReadMessageId: _r, ...rest } = conversation(overrides);
  return rest;
}
