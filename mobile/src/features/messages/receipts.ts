/**
 * Read state (02 §3.6, §5 `sig.msg_read_receipts`, contract §1 and §2). Two rules, both pure so they are tested on their own:
 *
 * - "Gelesen" shows under your last own message only, and only when the server says the other side has read it. The server
 *   sends `other_read_message_id` only when both members send receipts and the conversation is no request; the client checks
 *   the folder again anyway, so a request can never show read state, whatever an answer says.
 * - The client sends `read` only for a conversation in Chats or Archiviert. A request is never marked read (MSG-04): its sender
 *   must not learn that it was opened.
 */
import { compareIds, type Folder, type ThreadMessage } from './model';

export type ReceiptInput = {
  folder: Folder;
  /** From the conversation; null whenever receipts do not apply. */
  otherReadMessageId: string | null;
  /** Any order. */
  messages: readonly ThreadMessage[];
};

/** Server ids where both have one; otherwise the time, and a message without a server id is the newer one on a tie. */
function isNewer(a: ThreadMessage, b: ThreadMessage): boolean {
  if (a.id && b.id) return compareIds(a.id, b.id) > 0;
  const diff = (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
  if (diff !== 0) return diff > 0;
  return a.id === null && b.id !== null;
}

/** The key of the message that carries "Gelesen", or null for none. */
export function readReceiptKey({ folder, otherReadMessageId, messages }: ReceiptInput): string | null {
  if (folder === 'requests' || !otherReadMessageId) return null;
  let lastOwn: ThreadMessage | null = null;
  for (const message of messages) {
    if (message.mine && (!lastOwn || isNewer(message, lastOwn))) lastOwn = message;
  }
  // A newer own message still on its way (or failed) is the last one, and it has not been read.
  if (!lastOwn?.id || lastOwn.delivery !== 'sent') return null;
  return compareIds(lastOwn.id, otherReadMessageId) <= 0 ? lastOwn.key : null;
}

export type MarkReadInput = {
  folder: Folder;
  /** The newest message from the server in view, not your own pending ones. */
  newestId: string | null;
  /** What the client last told the server for this conversation. */
  lastSentId: string | null;
  /** The thread is on screen and the app in front. */
  visible: boolean;
};

/** The id to send with `POST conversations/{id}/read`, or null when nothing should go out. Never for a request. */
export function readToSend({ folder, newestId, lastSentId, visible }: MarkReadInput): string | null {
  if (folder === 'requests' || !visible || !newestId) return null;
  if (lastSentId && compareIds(newestId, lastSentId) <= 0) return null;
  return newestId;
}
