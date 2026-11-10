import { useUnreadCount } from '@/api/queries/notifications';
import { useQaState } from '@/lib/qa';

export type TabBadges = {
  /** Unread conversations and requests on Nachrichten (0 until M2.4 fills them). */
  messages: number;
  /** Unread notifications: the dot on Start. */
  home: boolean;
  /** How many, for the bell's accessible name. */
  notifications: number;
};

const NONE: TabBadges = { messages: 0, home: false, notifications: 0 };

/**
 * The badges of TabBar, Rail and Sidebar and the bell on Start, from `notifications/unread-count` (one query, polled every 60 s in
 * the foreground and on focus, paused in the background: `useUnreadCount`). A guest has none, and a forced QA state shows none, so
 * a screenshot never depends on someone else's activity.
 */
export function useTabBadges(): TabBadges {
  const unread = useUnreadCount();
  const qaState = useQaState();
  const data = unread.data;
  if (!data || qaState !== 'default') return NONE;
  return {
    messages: Math.max(0, data.messages) + Math.max(0, data.requests),
    home: data.notifications > 0,
    notifications: Math.max(0, data.notifications),
  };
}
