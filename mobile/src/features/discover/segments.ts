/**
 * Entdecken › Builds · Treffen · Forum · Crews (10 §1, ADR-501, R4-2.3): the three pages of the Discover tab are routes of their own (`/discover`,
 * `/events`, `/forum`), so each keeps its search, its filters and its deep link. In the Entdecken stack they are "segment roots":
 * the segmented control (and a horizontal swipe) moves between them like a pager. Moving right pushes the next page, so the page
 * left behind keeps its search, scroll and map (review SF-2); moving left pops back to it. At most two segment pages are stacked:
 * past that the top one is replaced. The shared tab layout shows these moves as a fade, the swipe adds the slide (SegmentSwipe). A
 * segment shows only while its flag is on: Treffen behind `events`, Forum behind `forum` (FOR-01, M5.8), Crews behind `crews`
 * (CREW-00, R4-2.3).
 *
 * From 1280 the JS shell's sidebar lists Entdecken, Treffen and Forum as places of their own (10 §1 web), so every segment page drops
 * the segmented control there, and Treffen (and Forum) carry their own title (DQ-M52-03).
 */
import { useNavigation, useRoute, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAppConfig } from '@/api/queries/appConfig';
import { useTabChrome } from '@/features/shell/navMode';
import { qaForcesFlag } from '@/lib/qa';
import { useBreakpoint } from '@/theme';

export type DiscoverSegment = 'builds' | 'events' | 'forum' | 'crews';

export type DiscoverSegmentEntry = {
  value: DiscoverSegment;
  /** The public path, which is also the page's deep link. */
  path: '/discover' | '/events' | '/forum' | '/crews';
  /** The stack screen name of the page in the shared tab layout. */
  screen: 'discover/index' | 'events/index' | 'forum/index' | 'crews/index';
  /** In the `discover` namespace. */
  labelKey: `segments.${DiscoverSegment}`;
  flag?: string;
};

export const DISCOVER_SEGMENTS: readonly DiscoverSegmentEntry[] = [
  { value: 'builds', path: '/discover', screen: 'discover/index', labelKey: 'segments.builds' },
  { value: 'events', path: '/events', screen: 'events/index', labelKey: 'segments.events', flag: 'events' },
  { value: 'forum', path: '/forum', screen: 'forum/index', labelKey: 'segments.forum', flag: 'forum' },
  // R4-2.3 (11_CLIENT_ROUND_4.md): Entdecken › Crews, CREW-00, behind `crews`.
  { value: 'crews', path: '/crews', screen: 'crews/index', labelKey: 'segments.crews', flag: 'crews' },
];

/**
 * The stack screens that get the in-place fade in Entdecken. Only routes that exist (a Stack.Screen for a route that is not there is
 * an error in development): `forum/index` joined with M5.8.
 */
export const DISCOVER_SEGMENT_SCREENS: readonly string[] = ['discover/index', 'events/index', 'forum/index', 'crews/index'];

/** The segments whose flag is on, in order. Pure, for the tests. */
export function visibleSegments(flags: Readonly<Record<string, boolean>>, forced: (flag: string) => boolean = () => false): DiscoverSegmentEntry[] {
  return DISCOVER_SEGMENTS.filter((entry) => !entry.flag || flags[entry.flag] === true || forced(entry.flag));
}

export function useDiscoverSegments(): DiscoverSegmentEntry[] {
  const { config } = useAppConfig();
  return useMemo(() => visibleSegments(config.flags, qaForcesFlag), [config.flags]);
}

/** The neighbour a swipe opens: `1` the next segment (swipe to the left), `-1` the one before. Null at either end. */
export function neighbourSegment(segments: readonly DiscoverSegmentEntry[], current: DiscoverSegment, direction: 1 | -1): DiscoverSegmentEntry | null {
  const index = segments.findIndex((entry) => entry.value === current);
  if (index === -1) return null;
  return segments[index + direction] ?? null;
}

type StackRoute = { key: string; name: string };
type StackState = { routes: readonly StackRoute[]; routeNames?: readonly string[] };

/**
 * A page is a segment root when it sits in the Entdecken stack (the only clone of the shared layout that has `discover/index`)
 * with nothing but segment pages below it: the tab's root, or EVT-01 opened from DISC-01's "Alle Treffen". Pushed anywhere
 * else (from Start, a vehicle page, a push notification in another tab) it is a page of its own with a back button. Pure.
 */
export function isSegmentRoot(state: StackState | undefined, routeKey: string): boolean {
  if (!state?.routeNames?.includes('discover/index')) return false;
  const index = state.routes.findIndex((route) => route.key === routeKey);
  if (index === -1) return false;
  const roots = DISCOVER_SEGMENTS.map((entry) => entry.screen) as readonly string[];
  return state.routes.slice(0, index + 1).every((route) => roots.includes(route.name));
}

/**
 * True while this screen is one of Entdecken's segment pages (see isSegmentRoot). A screen renders before the stack's state lists it,
 * so the answer follows the stack's `state` event.
 */
export function useIsSegmentRoot(): boolean {
  const navigation = useNavigation();
  const route = useRoute();
  const read = useCallback(() => isSegmentRoot(navigation.getState() as StackState | undefined, route.key), [navigation, route.key]);
  const [root, setRoot] = useState(read);
  useEffect(() => {
    return navigation.addListener('state', () => setRoot(read()));
  }, [navigation, read]);
  return root;
}

/** At most this many segment pages in the Entdecken stack: Builds and the one beside it. */
export const MAX_SEGMENT_PAGES = 2;

export type SegmentMove = { kind: 'pop' | 'push' | 'replace'; path: DiscoverSegmentEntry['path'] };

/**
 * How the stack opens `target` from the top page: back to it when it is below (a pop, its state survives), a push when it lies to the
 * right and the stack has room, otherwise in place of the top page. Pure, for the tests.
 */
export function segmentMove(state: StackState | undefined, target: DiscoverSegmentEntry): SegmentMove {
  const names = state?.routes.map((route) => route.name) ?? [];
  const roots = DISCOVER_SEGMENTS.map((entry) => entry.screen) as readonly string[];
  const top = names.at(-1);
  if (names.slice(0, -1).includes(target.screen)) return { kind: 'pop', path: target.path };
  const from = DISCOVER_SEGMENTS.findIndex((entry) => entry.screen === top);
  const to = DISCOVER_SEGMENTS.findIndex((entry) => entry.value === target.value);
  const pages = names.filter((name) => roots.includes(name)).length;
  if (to > from && pages < MAX_SEGMENT_PAGES) return { kind: 'push', path: target.path };
  return { kind: 'replace', path: target.path };
}

/** Opens a segment from the page that calls it, as a pager would (segmentMove). */
export function useOpenSegment(): (segment: DiscoverSegmentEntry) => void {
  const router = useRouter();
  const navigation = useNavigation();
  return useCallback(
    (segment: DiscoverSegmentEntry) => {
      const move = segmentMove(navigation.getState() as StackState | undefined, segment);
      const href = move.path as Href;
      if (move.kind === 'pop') router.dismissTo(href);
      else if (move.kind === 'push') router.push(href);
      else router.replace(href);
    },
    [navigation, router],
  );
}

/** True where the sidebar lists Treffen and Forum itself (the JS shell from 1280): the segment pages then show no segmented control. */
export function useSegmentsInSidebar(): boolean {
  const chrome = useTabChrome();
  const { kind } = useBreakpoint();
  return chrome === 'js' && kind === 'desktop';
}
