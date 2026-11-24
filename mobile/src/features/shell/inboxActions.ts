/**
 * Navigation 3.0 (10 §1, ADR-501): Nachrichten left the tab bar for the headers of Start and Entdecken, as a paper plane with the
 * unread pill ("9+" above nine) next to the notifications bell (Instagram's pattern). Where the shell lists Nachrichten itself (the
 * web rail from 768 and the sidebar from 1280), the header leaves it out: one way in per screen.
 */
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSessionStore, useRequireAuth } from '@/state/session';
import { useBreakpoint } from '@/theme';
import { type HeaderAction } from '@/ui/Header';
import { unreadCountText } from '@/ui/UnreadBadge';

import { useTabChrome } from './navMode';
import { useTabBadges } from './useTabBadges';

/** The header pill's largest figure (10 §1: "9+"). */
export const HEADER_UNREAD_MAX = 9;

/**
 * True where the header carries Nachrichten: under native tabs (five tabs at every size) and below 768 with the JS shell. From 768
 * the JS shell's rail and sidebar list Nachrichten as a place of their own.
 */
export function messagesInHeader(chrome: 'native' | 'js', kind: 'phone' | 'tablet' | 'desktop'): boolean {
  return chrome === 'native' || kind === 'phone';
}

export function useMessagesInHeader(): boolean {
  const chrome = useTabChrome();
  const { kind } = useBreakpoint();
  return messagesInHeader(chrome, kind);
}

/**
 * The Nachrichten action of a tab root's header: a link to MSG-01 (pushed in this tab's stack), named "Nachrichten, 3 ungelesen"
 * while something is unread. A guest is asked to sign in first, as by the bell next to it (DQ-M52-16). Null where the rail or sidebar
 * lists Nachrichten.
 */
export function useMessagesAction(routeId: string): HeaderAction | null {
  const { t } = useTranslation('common');
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const badges = useTabBadges();
  const shown = useMessagesInHeader();
  if (!shown) return null;
  const count = badges.messages;
  return {
    icon: 'paper-plane-tilt',
    label: t('places.messages'),
    role: 'link',
    onPress: () => requireAuth(() => router.push('/messages'), { returnTo: '/messages' }),
    ...(count > 0 ? { unread: { count, max: HEADER_UNREAD_MAX, label: t('a11y.unreadCount', { count: unreadCountText(count, HEADER_UNREAD_MAX) }) } } : {}),
    testID: `${routeId}.messages`,
  };
}

/**
 * The notifications bell (HOME-02), as on Start: a guest is asked to sign in first. Unread notifications show as the dot (DQ-M52-15):
 * the counted pill belongs to Nachrichten next to it, and the count stays in the bell's name and on HOME-02.
 */
export function useBellAction(routeId: string): HeaderAction {
  const { t } = useTranslation('home');
  const router = useRouter();
  const pathname = usePathname();
  const requireAuth = useRequireAuth();
  const badges = useTabBadges();
  const member = useSessionStore((state) => state.status === 'member');
  return {
    icon: 'bell',
    label: t('bell.label'),
    onPress: () => requireAuth(() => router.push('/notifications'), { returnTo: pathname }),
    ...(member && badges.home ? { unread: { label: t('bell.unread', { count: badges.notifications }) } } : {}),
    testID: `${routeId}.bell`,
  };
}

/** Bell, then Nachrichten on the trailing edge (10 §1). */
export function useInboxActions(routeId: string): HeaderAction[] {
  const bell = useBellAction(routeId);
  const messages = useMessagesAction(routeId);
  return messages ? [bell, messages] : [bell];
}
