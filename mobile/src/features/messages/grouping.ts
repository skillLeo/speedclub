/**
 * The items of the inverted thread list (FS-7, §8 chat bubble): messages newest first, a day separator above each day's first
 * message, bubbles grouped while the same side writes within 5 minutes on the same Berlin day. The tail and the time belong to
 * the last bubble of a group. A message that did not go out ends its group, so its "Erneut senden" line sits right under it.
 */
import type { FormatLocale } from '@/lib/format';

import { berlinDayKey, dayLabel, type DayLabels } from './dates';
import type { ThreadMessage } from './model';

/** §8: "group within 5 min". */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type MessageItem = {
  type: 'message';
  key: string;
  message: ThreadMessage;
  /** The oldest bubble of its group, at the top of it on screen. */
  groupStart: boolean;
  /** The newest bubble of its group: the tail corner, and the time under it. */
  groupEnd: boolean;
};

export type DayItem = { type: 'day'; key: string; label: string };

export type ThreadItem = MessageItem | DayItem;

function timeOf(message: ThreadMessage): number {
  return Date.parse(message.createdAt) || 0;
}

/** Whether `newer` continues the group of `older`. */
export function sameGroup(older: ThreadMessage, newer: ThreadMessage): boolean {
  if (older.mine !== newer.mine) return false;
  if (!older.mine && older.senderUsername !== newer.senderUsername) return false;
  if (older.delivery === 'failed' || newer.delivery === 'failed') return false;
  const gap = timeOf(newer) - timeOf(older);
  if (gap < 0 || gap > GROUP_WINDOW_MS) return false;
  return berlinDayKey(new Date(timeOf(older))) === berlinDayKey(new Date(timeOf(newer)));
}

/**
 * `messages` newest first, as the inverted list draws them. Returns the same order with day items after (that is, above on
 * screen) the oldest message of each day.
 */
export function threadItems(messages: readonly ThreadMessage[], reference: Date, locale: FormatLocale, labels: DayLabels): ThreadItem[] {
  const items: ThreadItem[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    const newer = index > 0 ? messages[index - 1] : undefined;
    const older = index < messages.length - 1 ? messages[index + 1] : undefined;
    items.push({
      type: 'message',
      key: message.key,
      message,
      groupStart: !older || !sameGroup(older, message),
      groupEnd: !newer || !sameGroup(message, newer),
    });
    const day = berlinDayKey(new Date(timeOf(message)));
    if (!older || berlinDayKey(new Date(timeOf(older))) !== day) {
      items.push({ type: 'day', key: `day-${day}`, label: dayLabel(new Date(timeOf(message)), reference, locale, labels) });
    }
  }
  return items;
}
