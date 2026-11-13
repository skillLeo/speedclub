import type { SFSymbol } from 'sf-symbols-typescript';

import type { IconName } from '@/ui';

export type TabName = 'home' | 'discover' | 'garage' | 'messages' | 'profile';

/** A default/selected pair, as NativeTabs.Trigger.Icon takes it. */
export type IconPair<T> = { default: T; selected: T };

export type TabDestination = {
  name: TabName;
  /** Phosphor (Regular when inactive, Fill when active) in the JS bar, the rail and the sidebar. */
  icon: IconName;
  /** In the `common` namespace. */
  labelKey: `tabs.${TabName}`;
  testID: `tab.${TabName}`;
  /** The route group under (tabs): the name NativeTabs.Trigger takes (09 §6.1). */
  route: `(${TabName})`;
  /** iOS native tabs: SF Symbols. */
  sf: IconPair<SFSymbol>;
  /**
   * Android native tabs, Material Symbols names (09 §6.1). Not drawn yet: `md` icons need expo-symbols, which is not
   * installed, so Android draws the Phosphor pair as PNGs (nativeTabIcons.ts) until the lead adds it (M4.5 report).
   */
  md: IconPair<string>;
};

/** The five tabs of the brief, in order (ADR-019). Every bar reads this one array: JS bar, rail, sidebar and NativeTabs. */
export const TAB_DESTINATIONS: readonly TabDestination[] = [
  {
    name: 'home',
    icon: 'house',
    labelKey: 'tabs.home',
    testID: 'tab.home',
    route: '(home)',
    sf: { default: 'house', selected: 'house.fill' },
    md: { default: 'home', selected: 'home' },
  },
  {
    name: 'discover',
    icon: 'magnifying-glass',
    labelKey: 'tabs.discover',
    testID: 'tab.discover',
    route: '(discover)',
    sf: { default: 'magnifyingglass', selected: 'magnifyingglass' },
    md: { default: 'search', selected: 'search' },
  },
  {
    name: 'garage',
    icon: 'garage',
    labelKey: 'tabs.garage',
    testID: 'tab.garage',
    route: '(garage)',
    sf: { default: 'door.garage.closed', selected: 'door.garage.closed' },
    md: { default: 'garage_home', selected: 'garage_home' },
  },
  {
    name: 'messages',
    icon: 'chats',
    labelKey: 'tabs.messages',
    testID: 'tab.messages',
    route: '(messages)',
    sf: { default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' },
    md: { default: 'forum', selected: 'forum' },
  },
  {
    name: 'profile',
    icon: 'user',
    labelKey: 'tabs.profile',
    testID: 'tab.profile',
    route: '(profile)',
    sf: { default: 'person', selected: 'person.fill' },
    md: { default: 'person', selected: 'person' },
  },
];
