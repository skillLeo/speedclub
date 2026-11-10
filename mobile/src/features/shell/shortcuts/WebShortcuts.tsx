import { router, type Href } from 'expo-router';
import { useTabTrigger } from 'expo-router/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFlag } from '@/api/queries/appConfig';
import { useMyVehicles } from '@/api/queries/profile';
import { useCachedRecentConversations } from '@/features/messages/cachedInbox';
import { visibleGroups } from '@/features/settings/navigation';
import { isWeb } from '@/lib/platform';
import { useSessionStore } from '@/state/session';
import { useBreakpoint } from '@/theme';
import { useTopOverlay } from '@/ui/overlayStack';

import { TAB_DESTINATIONS, type TabName } from '../destinations';
import { createShortcutHandler, modifierLabel, SHORTCUTS_FLAG, type ShortcutAction } from './keys';
import { QuickSwitcher } from './QuickSwitcher';
import { focusRegisteredSearch, focusVisibleSearchBox } from './searchFocus';
import { ShortcutSheet } from './ShortcutSheet';
import { conversationItems, type SwitcherItem } from './switcher';

/** Where each tab's root lives, for the switcher's links. */
const TAB_PATHS: Readonly<Record<TabName, string>> = {
  home: '/',
  discover: '/discover',
  garage: '/garage',
  messages: '/messages',
  profile: '/profile',
};

/** How long `/` waits for Entdecken to render its search box after switching there. */
const SEARCH_RETRY_MS = 50;
const SEARCH_RETRIES = 20;

export type WebShortcutsProps = {
  /**
   * The recent conversations for the switcher, instead of the ones read from the cached Chats list (M2.8): no request of its own,
   * so the group is absent until Nachrichten has loaded once this session.
   */
  conversations?: readonly SwitcherItem[];
};

/**
 * [SIG `sig.web_shortcuts`]: the keyboard layer of the member web on desktop widths. Mounted once inside the tab navigator;
 * renders nothing on native, on narrower widths and while the flag is off.
 */
export function WebShortcuts(props: WebShortcutsProps) {
  const enabled = useFlag(SHORTCUTS_FLAG);
  const { kind } = useBreakpoint();
  if (!isWeb || !enabled || kind !== 'desktop') return null;
  return <ShortcutLayer {...props} />;
}

function ShortcutLayer({ conversations: given }: WebShortcutsProps) {
  const { t } = useTranslation(['common', 'settings', 'messages']);
  const { switchTab } = useTabTrigger({ name: 'home' });
  const member = useSessionStore((state) => state.status === 'member');
  const vehicles = useMyVehicles();
  const recent = useCachedRecentConversations();
  const conversations = useMemo(
    () => given ?? (member ? conversationItems(recent, t('messages:deletedMember')) : []),
    [given, member, recent, t],
  );
  const topOverlay = useTopOverlay();
  const [switcher, setSwitcher] = useState(false);
  const [help, setHelp] = useState(false);
  const overlayOpen = useRef(false);
  const actions = useRef<(action: ShortcutAction) => void>(() => undefined);
  const modifier = modifierLabel(typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent);

  useEffect(() => {
    overlayOpen.current = topOverlay !== null;
  }, [topOverlay]);

  const focusSearch = () => {
    if (focusRegisteredSearch() || focusVisibleSearchBox()) return;
    switchTab('discover', {});
    let tries = 0;
    const retry = () => {
      tries += 1;
      if (!focusVisibleSearchBox() && tries < SEARCH_RETRIES) setTimeout(retry, SEARCH_RETRY_MS);
    };
    setTimeout(retry, SEARCH_RETRY_MS);
  };

  useEffect(() => {
    actions.current = (action) => {
      if (action.kind === 'switcher') setSwitcher(true);
      else if (action.kind === 'help') setHelp(true);
      else if (action.kind === 'tab') switchTab(action.tab, {});
      else focusSearch();
    };
  });

  useEffect(() => {
    const handle = createShortcutHandler({ overlayOpen: () => overlayOpen.current });
    const onKeyDown = (event: KeyboardEvent) => {
      const action = handle(event);
      if (!action) return;
      event.preventDefault();
      actions.current(action);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const items = useMemo<SwitcherItem[]>(() => {
    const own: SwitcherItem[] = member
      ? (vehicles.data ?? []).map((card) => ({
          id: `vehicle.${card.id}`,
          group: 'vehicles',
          label: card.full_title,
          detail: card.nickname ?? undefined,
          href: `/garage/${card.id}`,
        }))
      : [];
    const settings: SwitcherItem[] = visibleGroups(member).flatMap((group) =>
      group.rows.map((row) => ({
        id: `settings.${row.key}`,
        group: 'settings' as const,
        label: t(`settings:rows.${row.key}`),
        detail: t('common:system.shortcuts.switcher.settings'),
        href: row.path,
      })),
    );
    const tabs: SwitcherItem[] = TAB_DESTINATIONS.map((destination) => ({
      id: `tab.${destination.name}`,
      group: 'tabs',
      label: t(`common:${destination.labelKey}`),
      href: TAB_PATHS[destination.name],
    }));
    return [...own, ...conversations, ...settings, ...tabs];
  }, [conversations, member, t, vehicles.data]);

  const open = (item: SwitcherItem) => {
    setSwitcher(false);
    const tab = TAB_DESTINATIONS.find((destination) => item.id === `tab.${destination.name}`);
    if (tab) switchTab(tab.name, {});
    else router.navigate(item.href as Href);
  };

  return (
    <>
      <QuickSwitcher visible={switcher} onClose={() => setSwitcher(false)} items={items} onOpen={open} />
      <ShortcutSheet visible={help} onClose={() => setHelp(false)} modifier={modifier} />
    </>
  );
}
