import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { messagingKeys } from '@/api/queries/messaging';
import { notificationKeys } from '@/api/queries/notifications';

import { useMessaging } from './data';
import { realtimeHub } from './realtime';
import { useMessagingMember, useRealtimeSession } from './session';

/**
 * For the tab shell: with realtime on, `private-user.{id}` keeps the Nachrichten badge live on every tab (`UnreadChanged`,
 * `MessageSent`); the badge asks `notifications/unread-count` again and an open inbox refreshes. Without realtime it does nothing
 * and the badge keeps its 60 s poll (M2.2). Torn down with the session like the rest of messaging.
 */
export function useLiveMessagingBadges(): void {
  const adapter = useMessaging();
  const member = useMessagingMember();
  const client = useQueryClient();
  useRealtimeSession(adapter);
  useEffect(() => {
    if (!member || !adapter.available) return undefined;
    const refresh = () => {
      void client.invalidateQueries({ queryKey: notificationKeys.unread(member) });
      void client.invalidateQueries({ queryKey: messagingKeys.inboxAll(member) });
    };
    return realtimeHub.watchUser({ onMessage: refresh, onUnreadChanged: refresh });
  }, [adapter.available, client, member]);
}
