/**
 * One thread out of the server's pages, the messages polling brought, and the outbox (contract §7: no message lost, none twice).
 *
 * - Server messages are unique by id. The same message can come twice, from a page and from a poll, or from the send answer and
 *   a poll: the first copy wins, and its reactions update from the later one.
 * - An outbox entry whose `client_id` the server already returned is not drawn again.
 * - Messages on their way sit at the newest end in the order written; a failed one stays where it was written, so "Erneut
 *   senden" is next to the context it belongs to.
 */
import { compareIds, type ThreadMessage } from './model';
import { entryToMessage, type OutboxEntry } from './outbox';

function newestFirst(a: ThreadMessage, b: ThreadMessage): number {
  if (a.id && b.id) return compareIds(b.id, a.id);
  const diff = (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
  if (diff !== 0) return diff;
  // The same moment: a message without a server id was written after the ones the server already has.
  if (a.id === null && b.id !== null) return -1;
  if (b.id === null && a.id !== null) return 1;
  return 0;
}

/** Server messages without repeats, newest first. A later copy of the same id replaces the earlier one (new reactions). */
export function uniqueServerMessages(batches: readonly (readonly ThreadMessage[])[]): ThreadMessage[] {
  const byId = new Map<string, ThreadMessage>();
  for (const batch of batches) {
    for (const message of batch) {
      if (!message.id) continue;
      byId.set(message.id, message);
    }
  }
  return [...byId.values()].sort(newestFirst);
}

/** The client ids the server has returned, for `Outbox.reconcile`. */
export function serverClientIds(messages: readonly ThreadMessage[]): string[] {
  return messages.flatMap((message) => (message.clientId ? [message.clientId] : []));
}

/** The thread as drawn, newest first. `server` must be newest first and unique (`uniqueServerMessages`). */
export function mergeThread(server: readonly ThreadMessage[], pending: readonly OutboxEntry[]): ThreadMessage[] {
  const known = new Set(serverClientIds(server));
  const open = pending.filter((entry) => !known.has(entry.clientId));
  const failed = open.filter((entry) => entry.state === 'failed').map(entryToMessage);
  const onTheirWay = open
    .filter((entry) => entry.state !== 'failed')
    .sort((a, b) => b.seq - a.seq)
    .map(entryToMessage);
  const settled = failed.length > 0 ? [...server, ...failed].sort(newestFirst) : [...server];
  return [...onTheirWay, ...settled];
}

/** The newest message the server has, for `messages?after=` and the read mark. */
export function newestServerId(messages: readonly ThreadMessage[]): string | null {
  let newest: string | null = null;
  for (const message of messages) {
    if (message.id && (!newest || compareIds(message.id, newest) > 0)) newest = message.id;
  }
  return newest;
}
