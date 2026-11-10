/**
 * Report targets for the entry points that build them from their own models: a message in a thread (MSG-02), and what a request
 * (MSG-04) or a conversation (MSG-05) is reported as.
 */
import i18n from '@/i18n';

import type { ReportTarget } from './model';

type MessageLike = { id: string | null; mine: boolean; senderUsername: string | null; createdAt: string };

/** "Nachricht von @max.e46". The server keeps it and up to 5 messages before and after it (`message_context`). */
export function messageTarget(message: MessageLike, otherUsername: string | null): ReportTarget | null {
  if (!message.id || message.mine) return null;
  const owner = message.senderUsername ?? otherUsername ?? undefined;
  const label = owner ? i18n.t('targetLabels.message', { ns: 'safety', label: `@${owner}` }) : i18n.t('targetLabels.gone', { ns: 'safety' });
  return { type: 'message', id: message.id, label, ...(owner ? { owner } : {}) };
}

/**
 * What a conversation is reported as: its newest message from the other member, so the evidence holds the messages around it; the
 * member when they have written nothing that is still there.
 */
export function conversationTarget(messages: readonly MessageLike[], otherUsername: string | null): ReportTarget | null {
  const theirs = messages.filter((message) => message.id && !message.mine);
  const newest = theirs.reduce<MessageLike | null>((best, message) => (!best || message.createdAt > best.createdAt ? message : best), null);
  if (newest) return messageTarget(newest, otherUsername);
  return otherUsername ? { type: 'member', id: otherUsername, label: `@${otherUsername}`, owner: otherUsername } : null;
}
