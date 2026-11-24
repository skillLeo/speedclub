import type { SFSymbol } from 'sf-symbols-typescript';

import type { IconName } from '@/ui/icons/Icon';

/** The five bottom tabs of Navigation 3.0 (10 §1, ADR-501). Nachrichten is no longer a tab: it lives in the Start and Entdecken headers. */
export type TabName = 'home' | 'discover' | 'garage' | 'shop' | 'profile';

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

/**
 * The five tabs of Navigation 3.0 (10 §1, ADR-501: Start · Entdecken · Garage · Shop · Profil), in order. Every bar reads this one
 * array: JS bar, rail, sidebar and NativeTabs. Shop: SF `bag`, Material `shopping_bag`, Phosphor `Bag`; Garage keeps its glyph.
 */
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
    name: 'shop',
    icon: 'bag',
    labelKey: 'tabs.shop',
    testID: 'tab.shop',
    route: '(shop)',
    sf: { default: 'bag', selected: 'bag.fill' },
    md: { default: 'shopping_bag', selected: 'shopping_bag' },
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

/**
 * The places the wide web bars list besides the tabs (10 §1): Nachrichten (rail and sidebar), Treffen and Forum (sidebar). They
 * are not tabs of the navigator: each one is a route inside a tab's stack (`tab`), reached by `path`.
 */
export type PlaceName = 'messages' | 'events' | 'forum' | 'crews';

export type PlaceDestination = {
  name: PlaceName;
  icon: IconName;
  /** In the `common` namespace. */
  labelKey: `places.${PlaceName}`;
  testID: `shell.place.${PlaceName}`;
  /** The public path; a path starting with it marks the place as the current one. */
  path: '/messages' | '/events' | '/forum' | '/crews';
  /** The tab whose stack the place opens in. */
  tab: TabName;
  /** App-config flag the place needs (Treffen: `events`, Forum: `forum`); none = always. */
  flag?: string;
};

export const PLACE_DESTINATIONS: Readonly<Record<PlaceName, PlaceDestination>> = {
  messages: { name: 'messages', icon: 'paper-plane-tilt', labelKey: 'places.messages', testID: 'shell.place.messages', path: '/messages', tab: 'home' },
  events: { name: 'events', icon: 'meet', labelKey: 'places.events', testID: 'shell.place.events', path: '/events', tab: 'discover', flag: 'events' },
  forum: { name: 'forum', icon: 'chats', labelKey: 'places.forum', testID: 'shell.place.forum', path: '/forum', tab: 'discover', flag: 'forum' },
  // 11 R4-2.3: on the desktop the Entdecken segments are hidden, so Crews needs its own place in the sidebar.
  crews: { name: 'crews', icon: 'users', labelKey: 'places.crews', testID: 'shell.place.crews', path: '/crews', tab: 'discover', flag: 'crews' },
};

export type BarItem = { kind: 'tab'; tab: TabDestination } | { kind: 'place'; place: PlaceDestination };

const tab = (name: TabName): BarItem => ({ kind: 'tab', tab: TAB_DESTINATIONS.find((entry) => entry.name === name) as TabDestination });
const place = (name: PlaceName): BarItem => ({ kind: 'place', place: PLACE_DESTINATIONS[name] });

/** < 768, and native tabs: the five tabs. */
export const TAB_BAR_ITEMS: readonly BarItem[] = TAB_DESTINATIONS.map((entry) => tab(entry.name));
/** 768–1279: the five tabs + Nachrichten (10 §1). */
export const RAIL_ITEMS: readonly BarItem[] = [tab('home'), tab('discover'), tab('garage'), tab('shop'), place('messages'), tab('profile')];
/** ≥ 1280: Start · Entdecken · Treffen · Forum · Crews · Garage · Shop · Nachrichten · Profil (10 §1, 11 R4-2.3). */
export const SIDEBAR_ITEMS: readonly BarItem[] = [
  tab('home'),
  tab('discover'),
  place('events'),
  place('forum'),
  place('crews'),
  tab('garage'),
  tab('shop'),
  place('messages'),
  tab('profile'),
];

/** The items whose flag is on (a place without a flag always shows). */
export function visibleItems(items: readonly BarItem[], flags: Readonly<Record<string, boolean>>): BarItem[] {
  return items.filter((item) => item.kind === 'tab' || !item.place.flag || flags[item.place.flag] === true);
}

/** The key of an item, for React and for the active check. */
export function itemKey(item: BarItem): string {
  return item.kind === 'tab' ? item.tab.name : item.place.name;
}

/**
 * Which item of a bar is the current one: a place when the focused tab is the place's tab (any tab for Nachrichten, which opens
 * inside whichever tab pushed it) and the path is the place's; otherwise the focused tab. Pure, for the tests.
 */
export function activeItemKey(items: readonly BarItem[], focusedTab: TabName, pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const item of items) {
    if (item.kind !== 'place') continue;
    const { place: entry } = item;
    const onPath = path === entry.path || path.startsWith(`${entry.path}/`);
    if (onPath && (entry.name === 'messages' || entry.tab === focusedTab)) return entry.name;
  }
  return focusedTab;
}
