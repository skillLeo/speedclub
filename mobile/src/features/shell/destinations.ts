import type { IconName } from '@/ui';

export type TabName = 'home' | 'discover' | 'garage' | 'messages' | 'profile';

export type TabDestination = {
  name: TabName;
  icon: IconName;
  /** In the `common` namespace. */
  labelKey: `tabs.${TabName}`;
  testID: `tab.${TabName}`;
};

/** The five tabs of the brief, in order (ADR-019). The hidden TabList in (tabs)/_layout.tsx defines their routes. */
export const TAB_DESTINATIONS: readonly TabDestination[] = [
  { name: 'home', icon: 'house', labelKey: 'tabs.home', testID: 'tab.home' },
  { name: 'discover', icon: 'magnifying-glass', labelKey: 'tabs.discover', testID: 'tab.discover' },
  { name: 'garage', icon: 'garage', labelKey: 'tabs.garage', testID: 'tab.garage' },
  { name: 'messages', icon: 'chats', labelKey: 'tabs.messages', testID: 'tab.messages' },
  { name: 'profile', icon: 'user', labelKey: 'tabs.profile', testID: 'tab.profile' },
];
