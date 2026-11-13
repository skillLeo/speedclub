import type { FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import {
  flattenFeed,
  NEW_BUILDS_PREVIEW,
  useFeaturedBuilds,
  useFeed,
  useHomeModules,
  useNewBuildsPreview,
  type ActiveMember,
  type BuildUpdateRowData,
  type FeaturedBuild,
  type FeedItem,
  type FeedSuggestion,
  type FeedTab,
  type FeedVehicle,
  type PopularMod,
} from '@/api/queries/home';
import { useHomeEvents, type EventCard } from '@/api/queries/events';
import { searchPath } from '@/features/discover/navigation';
import { EventsModule } from '@/features/events/components/EventsModule';
import { useTabScrollToTop } from '@/features/shell/retap';
import { AnnouncementBanner } from '@/features/announcements/AnnouncementBanner';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { useTabBadges } from '@/features/shell/useTabBadges';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, space, useBreakpoint, useTheme } from '@/theme';
import { motionDuration, useMotionPreference } from '@/ui/motion';
import {
  BrandHeader,
  Button,
  CollapsingFlashList,
  EmptyState,
  MediaCardSkeleton,
  Screen,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  SkeletonText,
  Spinner,
  Text,
  useCollapsingHeader,
  type HeaderAction,
} from '@/ui';
import { LARGE_FONT_SCALE } from '@/ui/rowParts';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { ActiveMembersStrip } from '../components/ActiveMembersStrip';
import { BrowseErrorState, RestrictionNotice, useBrowseRestriction } from '../components/BrowseStates';
import { buildSuggestions, FollowingEmpty, FollowingGuest } from '../components/FollowingStates';
import { HomeFeedCard, HomeFeedCardSkeleton } from '../components/HomeFeedCard';
import { HomeLead, HomeLeadActionsSkeleton, leadMinHeight } from '../components/HomeLead';
import { HomeRail, HomeRailSkeleton } from '../components/HomeRail';
import { SampleLead } from '../components/SampleLead';
import { UpdateGroupCard, UpdateGroupCardSkeletonRows } from '../components/UpdateGroupCard';
import { NewInGarageRail, NewInGarageRailSkeleton } from '../components/NewInGarageRail';
import { PopularModsChips } from '../components/PopularModsChips';
import { offlineLine } from '../model';
import { updatePath, useOpenMember, vehiclePath } from '../navigation';

const ROUTE = 'HOME-01';
const EDGES: readonly Edge[] = ['left', 'right'];
const COLUMN = layout.feedColumn;
const RAIL_GAP = layout.sectionGap;
const NO_ANCHOR = { disabled: true } as const;
const NEWEST_PATH = { pathname: '/discover/search', params: { sort: 'updated' } } as const;
/** 09 §7.3: a module after every ~6 items of the stream. */
export const MODULE_EVERY = 6;
/** 09 §7.3 "Treffen in deiner Nähe": two EventCards and "Alle Treffen". */
const HOME_EVENT_CARDS = 2;

type Module = 'weekly' | 'members' | 'mods';
type Section = 'newBuilds' | Module;

/** The rows of the list. 09 §7.3 order: lead → Neu in der Garage → the stream, with a module after every 6 items. */
export type HomeRow =
  | { kind: 'hero'; vehicle: FeedVehicle }
  | { kind: 'section'; section: Section }
  | { kind: 'rail'; vehicles: readonly FeedVehicle[] }
  | { kind: 'card'; vehicle: FeedVehicle; key: string; showLatest?: boolean }
  | { kind: 'update'; update: BuildUpdateRowData; key: string }
  | { kind: 'updates'; updates: readonly [BuildUpdateRowData, ...BuildUpdateRowData[]]; key: string }
  | { kind: 'weekly'; vehicle: FeedVehicle }
  | { kind: 'members'; members: readonly ActiveMember[] }
  | { kind: 'mods'; mods: readonly PopularMod[] }
  /** M4.12 "Treffen in deiner Nähe": the module brings its own header and "Alle Treffen". */
  | { kind: 'events'; events: readonly EventCard[] };

/** Remembered while the app runs, so coming back to Start keeps the segment the member chose. */
let lastTab: FeedTab = 'for_you';

/** The segment Start opens on next; a new member starts on Für dich. */
export function rememberHomeTab(tab: FeedTab): void {
  lastTab = tab;
}

/**
 * "Build der Woche": an editorially chosen featured build other than the lead (ADM-29). A build only ranked by completeness is never
 * called that, so without an editorial pick the module hides (09 §7.3: never an empty or invented module).
 */
export function weeklyBuild(featured: readonly FeaturedBuild[] | undefined): FeedVehicle | undefined {
  return featured?.slice(1).find((build) => build.source === 'editorial')?.vehicle;
}

/**
 * DQ-1032: the one-line owner quote of "Build der Woche", from the editorial pick (ADM-29). Lane B gap: `quote` on
 * FeaturedBuildResource; until the types have it, it is read only when present. Null: the module says why it was picked instead.
 */
export function weeklyQuote(featured: readonly FeaturedBuild[] | undefined): string | null {
  const pick = featured?.slice(1).find((build) => build.source === 'editorial');
  const quote = pick && 'quote' in pick ? (pick as { quote?: unknown }).quote : undefined;
  return typeof quote === 'string' && quote.trim() !== '' ? quote.trim() : null;
}

/**
 * DQ-1027 (09 §7.3 Folge ich): the chronological stream with consecutive updates of one build as one compact card, so the tab never
 * shows the same cover card after card. A build (its first publish) keeps the full feed card.
 */
export function followingRows(stream: readonly FeedItem[]): HomeRow[] {
  const rows: HomeRow[] = [];
  for (const row of streamRows(stream)) {
    const last = rows.at(-1);
    if (row.kind === 'update') {
      if (last?.kind === 'updates' && last.updates[0].vehicle.id === row.update.vehicle.id) {
        rows[rows.length - 1] = { ...last, updates: [...last.updates, row.update] };
      } else {
        rows.push({ kind: 'updates', updates: [row.update], key: row.key });
      }
    } else {
      rows.push(row);
    }
  }
  return rows;
}

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  body: { flex: 1 },
  segments: { paddingBottom: t.space[12], paddingTop: t.space[4] },
  heroGap: { paddingBottom: t.space[24] },
  section: { paddingBottom: t.space[12] },
  cardGap: { paddingBottom: t.space[32] },
  // 09 §4.3: 32 between the stream's modules, as between its cards (DQ-1032).
  moduleEnd: { paddingBottom: t.space[32] },
  // A compact update card is a row of the column: 24 to the next item.
  updateGap: { paddingBottom: t.space[24] },
  weeklyQuote: { paddingTop: t.space[8] },
  notice: { paddingBottom: t.space[16] },
  announcement: { marginBottom: t.space[16] },
  listTop: { paddingTop: t.space[8] },
  // RESULT 11: on the cards' column and its start edge, as the rest of the column (§15 left-aligned hierarchy).
  footer: { alignItems: 'flex-start', minHeight: t.size.touchMin, paddingBottom: t.space[32], paddingTop: t.space[8] },
  footerError: { alignItems: 'flex-start', gap: t.space[8], paddingBottom: t.space[32] },
  // DQ-190: the frame is centred by the layout, never by a computed margin, which would fall off the spacing scale.
  frame: { alignSelf: 'center' },
  railLayer: { alignItems: 'center', pointerEvents: 'box-none' },
  railFrame: { alignItems: 'flex-end', flex: 1, pointerEvents: 'box-none' },
  railColumn: { flex: 1 },
  railInPage: { position: 'absolute', right: 0, top: 0 },
  // The rail hangs out of the list header next to the rows, which come later in the document: this keeps it above them, for the pointer too.
  headerOverRows: { zIndex: 1 },
  skeletonGap: { gap: t.space[32] },
}));

/**
 * The centred frame of the pane: the feed column, and from 1280 the rail beside it, both inside `width`. The column starts
 * on the frame's start edge, so on a desktop pane up to 1248 wide it starts on the gutter (ADR-160).
 */
export type HomeFrame = { width: number; column: number; rail: number | null };

export function frameOf(pane: number, gutter: number, desktop: boolean): HomeFrame {
  const available = Math.max(0, pane - 2 * gutter);
  if (!desktop) {
    const column = Math.min(COLUMN, available);
    return { width: column, column, rail: null };
  }
  const width = Math.min(available, layout.contentMax);
  const column = Math.min(COLUMN, width);
  const rail = width - column - RAIL_GAP;
  return rail > 0 ? { width, column, rail } : { width: column, column, rail: null };
}

/**
 * Für dich (09 §7.3): the lead, "Neu in der Garage", then the stream with the modules interleaved after every `MODULE_EVERY` items
 * (Build der Woche, Aktive Mitglieder, Beliebte Mods, in that order). A module without content is left out; modules the stream is too
 * short for follow its end. A build drawn above (the lead, the rail, Build der Woche) is never repeated as a card of the stream.
 */
export function forYouRows(input: {
  hero: FeedVehicle | undefined;
  newBuilds: readonly FeedVehicle[];
  weekly?: FeedVehicle | undefined;
  members: readonly ActiveMember[];
  mods: readonly PopularMod[];
  /** M4.12: the next meets, the first module of the stream (09 §7.3 order: Treffen, Build der Woche, …). */
  events?: readonly EventCard[];
  stream: readonly FeedItem[];
}): HomeRow[] {
  const rows: HomeRow[] = [];
  const shown = new Set<string>();
  if (input.hero) {
    rows.push({ kind: 'hero', vehicle: input.hero });
    shown.add(input.hero.id);
  }
  const rail = input.newBuilds.filter((vehicle) => !shown.has(vehicle.id)).slice(0, NEW_BUILDS_PREVIEW);
  if (rail.length > 0) {
    rows.push({ kind: 'section', section: 'newBuilds' }, { kind: 'rail', vehicles: rail });
    rail.forEach((vehicle) => shown.add(vehicle.id));
  }
  const modules: HomeRow[][] = [];
  if (input.events && input.events.length > 0) modules.push([{ kind: 'events', events: input.events }]);
  if (input.weekly && !shown.has(input.weekly.id)) {
    shown.add(input.weekly.id);
    modules.push([{ kind: 'section', section: 'weekly' }, { kind: 'weekly', vehicle: input.weekly }]);
  }
  if (input.members.length > 0) modules.push([{ kind: 'section', section: 'members' }, { kind: 'members', members: input.members }]);
  if (input.mods.length > 0) modules.push([{ kind: 'section', section: 'mods' }, { kind: 'mods', mods: input.mods }]);
  streamRows(input.stream, shown).forEach((row, index) => {
    rows.push(row);
    if ((index + 1) % MODULE_EVERY === 0) rows.push(...(modules.shift() ?? []));
  });
  rows.push(...modules.flat());
  return rows;
}

/**
 * The stream as feed cards in the server's order: a build, or one change of a build. A build's card does not repeat its latest change
 * when that change has a card of its own in the stream (DQ-289). Builds of `shown` (drawn above) are left out.
 */
export function streamRows(stream: readonly FeedItem[], shown: ReadonlySet<string> = new Set()): HomeRow[] {
  const rows: HomeRow[] = [];
  const updateIds = new Set(stream.flatMap((item) => (item.type === 'update' && item.update ? [item.update.id] : [])));
  for (const item of stream) {
    if (item.type === 'vehicle' && item.vehicle) {
      if (shown.has(item.vehicle.id)) continue;
      const repeats = item.vehicle.latest_update ? updateIds.has(item.vehicle.latest_update.id) : false;
      rows.push({ kind: 'card', vehicle: item.vehicle, key: `stream.${item.key}`, ...(repeats ? { showLatest: false } : {}) });
    } else if (item.type === 'update' && item.update) {
      rows.push({ kind: 'update', update: item.update, key: `stream.${item.key}` });
    }
  }
  return rows;
}

function rowKey(row: HomeRow): string {
  switch (row.kind) {
    case 'hero':
      return `hero.${row.vehicle.id}`;
    case 'section':
      return `section.${row.section}`;
    case 'weekly':
      return `weekly.${row.vehicle.id}`;
    case 'card':
    case 'update':
    case 'updates':
      return row.key;
    default:
      return row.kind;
  }
}

/** One row of the list: the centred frame, and the column on its start edge. */
function InColumn({
  frame,
  style,
  frameTestID,
  testID,
  children,
}: {
  frame: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  frameTestID?: string;
  testID?: string;
  children?: ReactNode;
}) {
  return (
    <View style={frame} testID={frameTestID}>
      <View style={style} testID={testID}>
        {children}
      </View>
    </View>
  );
}

/** 09 §7.3 skeleton: the lead block, the rail and two feed cards, in their geometry (SM15). */
function ForYouSkeleton({ bleed, gutter, column, leadWidth }: { bleed: boolean; gutter: number; column: number; leadWidth: number }) {
  const styles = useStyles();
  const { kind } = useBreakpoint();
  const { fontScale } = useTheme();
  const edge = bleed ? { marginHorizontal: -gutter } : null;
  // DQ-1030: a lead name ("Volkswagen Golf GTI VII (5G)") takes two display lines in a phone's width, one in the wider columns.
  const titleLines = kind === 'phone' || fontScale >= LARGE_FONT_SCALE ? 2 : 1;
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={[styles.heroGap, edge]}>
        <View style={{ minHeight: leadMinHeight(leadWidth, kind === 'desktop') }}>
          <MediaCardSkeleton variant="lead" lines={titleLines} testID={`${ROUTE}.skeleton.featured`} />
        </View>
        <HomeLeadActionsSkeleton />
      </View>
      <View style={styles.section}>
        <SkeletonText variant="headline" width="45%" />
      </View>
      <View style={styles.moduleEnd}>
        <NewInGarageRailSkeleton column={column} bleed={bleed ? gutter : 0} />
      </View>
      <View style={[styles.skeletonGap, edge]}>
        <HomeFeedCardSkeleton testID={`${ROUTE}.skeleton.card`} />
        <HomeFeedCardSkeleton />
      </View>
    </Skeleton>
  );
}

/**
 * Folge ich while it loads (DQ-1083): the stream opens with compact update cards (DQ-1027), so two of those come first, then one
 * feed card, in the loaded stream's geometry.
 */
function FollowingSkeleton({ bleed, gutter }: { bleed: boolean; gutter: number }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.following.skeleton`}>
      {/* DQ-1030: the list header carries the top padding already; the cards start where the loaded ones do. */}
      <View style={styles.skeletonGap}>
        <UpdateGroupCardSkeletonRows />
        <UpdateGroupCardSkeletonRows />
        <View style={bleed ? { marginHorizontal: -gutter } : null}>
          <HomeFeedCardSkeleton />
        </View>
      </View>
    </Skeleton>
  );
}

/**
 * HOME-01 "/", 09 §7.3 ★: the brand header (§6.2 d: brush wordmark, bell) with the sticky "Für dich · Folge ich" under it, then for
 * Für dich the lead build, "Neu in der Garage" and the stream of feed cards with Build der Woche, Aktive Mitglieder and Beliebte Mods
 * between them; for Folge ich the chronological stream of followed members and builds. From 1280 the rail beside the column holds the
 * Discover shortcuts and the garage.
 */
export function HomeScreen() {
  const { t } = useTranslation('home');
  const format = useFormat();
  const tabs = useTranslation('common').t;
  const tEvents = useTranslation('events').t;
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const motion = useMotionPreference();
  const online = useOnline();
  // M3.5: Start behind a pushed screen or another tab loads no further pages.
  const shown = useScreenFocused();
  const qaState = useQaState();
  const session = useSessionStore((state) => state.status);
  const member = session === 'member';
  const me = useSessionStore((state) => state.member?.username ?? null);
  const requireAuth = useRequireAuth();
  const restriction = useBrowseRestriction();
  const addVehicle = useAddVehicle();
  const openMember = useOpenMember();
  const badges = useTabBadges();
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const { gutter, kind, width: windowWidth } = useBreakpoint();
  const { fontScale } = useTheme();
  // `/?tab=following` opens Folge ich: a link to it, and the visual matrix's way in.
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTabState] = useState<FeedTab>(() => (params.tab === 'following' ? 'following' : params.tab === 'for_you' ? 'for_you' : lastTab));
  const featured = useFeaturedBuilds();
  const preview = useNewBuildsPreview();
  const modules = useHomeModules();
  const homeEvents = useHomeEvents();
  const forYou = useFeed('for_you');
  const following = useFeed('following', tab === 'following');
  const feed = tab === 'for_you' ? forYou : following;
  const listRef = useRef<FlashListRef<HomeRow>>(null);
  const retained = useRetainedListScroll(listRef);
  const [refreshing, setRefreshing] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const desktop = kind === 'desktop';
  const [pane, setPane] = useState(desktop ? windowWidth - layout.sidebar : kind === 'tablet' ? windowWidth - layout.rail : windowWidth);
  const frame = frameOf(pane, gutter, desktop);
  const bleed = kind === 'phone';
  const qaEmpty = qaState === 'empty';
  // A phone runs photos edge to edge; wider, they stay in the column.
  const mediaWidth = bleed ? pane : frame.column;

  const hero = qaEmpty ? undefined : featured.data?.[0]?.vehicle;
  const weekly = qaEmpty ? undefined : weeklyBuild(featured.data);
  const quote = weeklyQuote(featured.data);
  const stream = useMemo(() => (qaEmpty ? [] : flattenFeed(feed.data?.pages)), [feed.data?.pages, qaEmpty]);
  const suggestions = useMemo<readonly FeedSuggestion[]>(
    () => (qaEmpty ? [] : (following.data?.pages[0]?.meta.suggestions ?? [])),
    [following.data?.pages, qaEmpty],
  );

  const rows = useMemo<HomeRow[]>(() => {
    if (tab === 'following') return followingRows(stream);
    const data = modules.data;
    return forYouRows({
      hero,
      newBuilds: qaEmpty ? [] : (preview.data ?? []),
      weekly,
      members: qaEmpty ? [] : (data?.active_members ?? []),
      mods: qaEmpty ? [] : (data?.popular_mods ?? []),
      events: qaEmpty ? [] : (homeEvents.data ?? []),
      stream,
    });
  }, [hero, homeEvents.data, modules.data, preview.data, qaEmpty, stream, tab, weekly]);

  const guestFollowing = tab === 'following' && session === 'guest';
  const hasData = feed.data !== undefined;
  const offline = !online || feed.fetchStatus === 'paused';
  // The lead and the rail are requests of their own above the stream: the skeleton holds until they answer (or fail), so the page
  // never jumps down when they arrive after the stream.
  const pending = (query: { isPending: boolean; fetchStatus: string }) => query.isPending && query.fetchStatus !== 'paused';
  const topPending = tab === 'for_you' && !qaEmpty && (pending(featured) || pending(preview));
  const loading =
    !guestFollowing && (qaState === 'loading' || (qaState === 'default' && ((!hasData && pending(feed)) || (hasData && topPending))));
  let state: ReactNode = null;
  if (guestFollowing) {
    state = <FollowingGuest routeId={ROUTE} />;
  } else if (loading) {
    state =
      tab === 'for_you' ? (
        <ForYouSkeleton bleed={bleed} gutter={gutter} column={frame.column} leadWidth={mediaWidth} />
      ) : (
        <FollowingSkeleton bleed={bleed} gutter={gutter} />
      );
  } else if (qaState === 'error' || !hasData) {
    state = (
      <BrowseErrorState
        routeId={ROUTE}
        offline={qaState === 'offline' || (qaState !== 'error' && offline)}
        error={feed.error}
        onRetry={() => {
          void featured.refetch();
          void preview.refetch();
          void modules.refetch();
          void feed.refetch();
        }}
        retrying={feed.isFetching}
      />
    );
  } else if (tab === 'following' && rows.length === 0) {
    state = (
      <FollowingEmpty
        suggestions={suggestions}
        builds={qaEmpty ? [] : buildSuggestions([featured.data?.map((build) => build.vehicle), preview.data], me)}
        routeId={ROUTE}
      />
    );
  } else if (rows.length === 0 && !pending(modules)) {
    state = (
      <EmptyState
        preview={<SampleLead routeId={ROUTE} />}
        title={t('empty.title')}
        body={t('empty.body')}
        action={session === 'loading' ? undefined : { label: t('empty.action'), onPress: addVehicle }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const scrollNode = () => listRef.current?.getScrollableNode() as { scrollTop?: number } | null | undefined;
  const scrollToTop = useCallback(
    (animated: boolean) => {
      retained.forget();
      listRef.current?.scrollToOffset({ offset: 0, animated });
    },
    [retained],
  );
  useTabScrollToTop(() => {
    const node = isWeb ? scrollNode() : null;
    const before = typeof node?.scrollTop === 'number' ? node.scrollTop : header.scrollY.get();
    if (before <= 0) return false;
    scrollToTop(motion.enabled && !motion.reduced);
    if (node) {
      // WebKit ignores element.scroll() on an element that was display:none, until something else scrolls it.
      setTimeout(() => {
        if (node.scrollTop === before) node.scrollTop = 0;
      }, motionDuration('effect.default'));
    }
    return true;
  });

  const setTab = (next: FeedTab) => {
    if (next === tab) return;
    lastTab = next;
    setTabState(next);
    // The other segment starts at its top, under the segmented control that stays in reach.
    scrollToTop(false);
  };

  const open = useCallback((vehicle: FeedVehicle) => router.push(vehiclePath(vehicle.slug)), [router]);
  const openCard = useCallback(
    (vehicle: FeedVehicle, updateId?: string) => router.push(updateId ? updatePath(vehicle.slug, updateId) : vehiclePath(vehicle.slug)),
    [router],
  );
  const openMod = useCallback((mod: PopularMod) => router.navigate(searchPath(mod.query)), [router]);
  const openNotifications = () => requireAuth(() => router.push('/notifications'), { returnTo: pathname });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(
        tab === 'for_you' ? [featured.refetch(), preview.refetch(), modules.refetch(), forYou.refetch()] : [following.refetch()],
      );
    } finally {
      setRefreshing(false);
    }
  }, [featured, following, forYou, modules, preview, tab]);

  // BH-43: FlashList reports the end once, so a turn missed offline is taken on reconnect.
  const missedOffline = useRef(false);
  const loadMore = () => {
    if (state || !feed.hasNextPage || feed.isFetchingNextPage || feed.isFetchNextPageError) return;
    // Offline or out of sight, the turn waits for the connection or for Start to show again.
    if (!online || !shown) {
      missedOffline.current = true;
      return;
    }
    void feed.fetchNextPage();
  };
  const loadMoreAfterReconnect = useEffectEvent(() => {
    missedOffline.current = false;
    loadMore();
  });
  useEffect(() => {
    if (online && shown && missedOffline.current) loadMoreAfterReconnect();
  }, [online, shown]);

  const frameStyle = useMemo(() => [styles.frame, { width: frame.width }], [frame.width, styles.frame]);
  const columnStyle = useMemo(() => ({ width: frame.column }), [frame.column]);
  const cardColumnStyle = useMemo(() => [styles.cardGap, columnStyle], [columnStyle, styles.cardGap]);
  const moduleColumnStyle = useMemo(() => [styles.moduleEnd, columnStyle], [columnStyle, styles.moduleEnd]);
  const gutterStyle = useMemo(() => ({ paddingHorizontal: gutter }), [gutter]);
  const updateColumnStyle = useMemo(() => [styles.updateGap, columnStyle], [columnStyle, styles.updateGap]);

  const onPaneLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    // Web hides an inactive tab with display: none, which reports a 0 × 0 layout. That is no pane: laying the page out for it
    // rebuilt every card, and each photo asked the network again on the next tab switch (offline: a console error each, M2.8).
    if (next <= 0) return;
    if (Math.abs(next - pane) >= 1) setPane(next);
  };
  const onHeaderHeight = (next: number) => {
    if (next > 0 && Math.abs(next - headerHeight) >= 1) setHeaderHeight(next);
  };

  // DQ-199: on web the rail at a large font is taller than a desktop window, so it is part of the page and everything in it is reached
  // by the one scroller. Native keeps its own scroller. DQ-287: the rail is part of the desktop page in every state that has a page.
  const fullPageError = !loading && !guestFollowing && (qaState === 'error' || !hasData);
  const railShown = frame.rail !== null && !fullPageError;
  const railInPage = isWeb && railShown && !loading && fontScale >= LARGE_FONT_SCALE;

  const segments = useMemo(
    () =>
      [
        { value: 'for_you', label: t('tabs.forYou'), testID: `${ROUTE}.tab.forYou` },
        { value: 'following', label: t('tabs.following'), testID: `${ROUTE}.tab.following` },
      ] as const,
    [t],
  );

  const listHeader = (
    <View style={[frameStyle, styles.listTop]}>
      {/* The floating brand header's own height: a spacer, so the list starts under it (its padding stays on the scale). */}
      <View style={{ height: headerHeight }} />
      <View style={columnStyle}>
        <ShellOfflineBanner label={offlineLine(t, feed.dataUpdatedAt, format.relative)} />
        {restriction ? <RestrictionNotice message={restriction} style={styles.notice} testID={`${ROUTE}.restricted`} /> : null}
        {/* M3.5 ADM-30: the current announcement, under the segments on both tabs. */}
        <AnnouncementBanner routeId={ROUTE} style={styles.announcement} />
      </View>
      {railInPage ? (
        <View style={[styles.railInPage, { width: frame.rail ?? 0 }]}>
          <HomeRail inPage top={headerHeight} />
        </View>
      ) : null}
    </View>
  );

  // The footer is a row of the column like the cards: 16/20 from the edge on a phone, on the column's edge beside the sidebar.
  const footerColumnStyle = useMemo(() => [styles.footer, columnStyle], [columnStyle, styles.footer]);
  const footerErrorColumnStyle = useMemo(() => [styles.footerError, columnStyle], [columnStyle, styles.footerError]);
  const footerFrameID = `${ROUTE}.footer`;
  let footer: ReactNode = null;
  if (!state && feed.isFetchingNextPage) {
    footer = (
      <InColumn frame={frameStyle} style={footerColumnStyle} frameTestID={footerFrameID} testID={`${ROUTE}.loadingMore`}>
        <Spinner label={t('list.loadingMore')} />
      </InColumn>
    );
  } else if (!state && feed.isFetchNextPageError) {
    footer = (
      <InColumn frame={frameStyle} style={footerErrorColumnStyle} frameTestID={footerFrameID} testID={`${ROUTE}.moreError`}>
        <Text variant="callout" color="text.secondary">
          {t('list.moreError')}
        </Text>
        <Button label={tabs('actions.retry')} variant="secondary" size="m" onPress={() => void feed.fetchNextPage()} testID={`${ROUTE}.moreRetry`} />
      </InColumn>
    );
  } else if (!state && stream.length > 0 && !feed.hasNextPage) {
    footer = (
      <InColumn frame={frameStyle} style={footerColumnStyle} frameTestID={footerFrameID} testID={`${ROUTE}.end`}>
        <Text variant="caption" color="text.tertiary">
          {tab === 'for_you' ? t('list.end') : t('list.endFollowing')}
        </Text>
      </InColumn>
    );
  } else if (!state && feed.hasNextPage) {
    // BH-43: never a blank end while there is more. Offline it waits, under the banner that says why.
    footer = (
      <InColumn frame={frameStyle} style={footerColumnStyle} frameTestID={footerFrameID} testID={`${ROUTE}.moreRow`}>
        <Button label={t('list.more')} variant="secondary" size="m" disabled={!online} onPress={loadMore} testID={`${ROUTE}.more`} />
      </InColumn>
    );
  } else {
    footer = <View style={styles.footer} />;
  }

  const sectionTitle = (section: Section) => {
    switch (section) {
      case 'newBuilds':
        return (
          <SectionHeader
            title={t('newBuilds.title')}
            actionLabel={tabs('actions.all')}
            actionAccessibilityLabel={t('newBuilds.allLabel')}
            onAction={() => router.navigate(NEWEST_PATH)}
            testID={`${ROUTE}.newBuilds`}
          />
        );
      case 'weekly':
        return <SectionHeader title={t('weekly.title')} testID={`${ROUTE}.weekly`} />;
      case 'members':
        return <SectionHeader title={t('members.title')} testID={`${ROUTE}.members`} />;
      default:
        return <SectionHeader title={t('mods.title')} testID={`${ROUTE}.mods`} />;
    }
  };

  /** A photo row: edge to edge on a phone, in the column wider. */
  const media = (children: ReactNode, style: StyleProp<ViewStyle>, testID?: string) =>
    bleed ? (
      <View style={style} testID={testID}>
        {children}
      </View>
    ) : (
      <InColumn frame={frameStyle} style={[style, columnStyle]} testID={testID}>
        {children}
      </InColumn>
    );

  const renderItem = ({ item }: { item: HomeRow }) => {
    switch (item.kind) {
      case 'hero':
        return media(<HomeLead vehicle={item.vehicle} width={mediaWidth} onOpen={open} testID={`${ROUTE}.featured`} />, styles.heroGap);
      case 'section':
        return (
          <InColumn frame={frameStyle} style={[columnStyle, styles.section]}>
            {sectionTitle(item.section)}
          </InColumn>
        );
      case 'rail':
        return (
          <InColumn frame={frameStyle} style={moduleColumnStyle}>
            <NewInGarageRail vehicles={item.vehicles} column={frame.column} bleed={bleed ? gutter : 0} onOpen={open} testID={`${ROUTE}.newBuilds`} />
          </InColumn>
        );
      case 'card':
        return media(
          <HomeFeedCard
            vehicle={item.vehicle}
            width={mediaWidth}
            showLatest={item.showLatest ?? true}
            onOpen={openCard}
            onOpenOwner={openMember}
            testID={`${ROUTE}.card.${item.vehicle.id}`}
          />,
          bleed ? styles.cardGap : cardColumnStyle,
        );
      case 'update':
        return media(
          <HomeFeedCard vehicle={item.update.vehicle} update={item.update} width={mediaWidth} onOpen={openCard} onOpenOwner={openMember} testID={`${ROUTE}.stream.update.${item.update.id}`} />,
          bleed ? styles.cardGap : cardColumnStyle,
        );
      case 'updates':
        return (
          <InColumn frame={frameStyle} style={updateColumnStyle}>
            <UpdateGroupCard updates={item.updates} onOpen={openCard} testID={`${ROUTE}.stream.update.${item.updates[0].id}`} />
          </InColumn>
        );
      case 'weekly':
        return media(
          <>
            <HomeLead vehicle={item.vehicle} width={mediaWidth} wide onOpen={open} testID={`${ROUTE}.weekly.card`} />
            {/* DQ-1032: the owner's one line in German quotes, or why the editors picked it. */}
            <View style={[styles.weeklyQuote, bleed ? gutterStyle : null]}>
              <Text variant="body" color="text.secondary" numberOfLines={fontScale >= LARGE_FONT_SCALE ? undefined : 1} testID={`${ROUTE}.weekly.quote`}>
                {quote ? t('weekly.quote', { quote }) : t('weekly.reason')}
              </Text>
            </View>
          </>,
          styles.moduleEnd,
        );
      case 'members':
        // A phone runs the strip to the screen edge, starting on the gutter; wider, it stays in the column.
        return bleed ? (
          <View style={styles.moduleEnd}>
            <ActiveMembersStrip members={item.members} width={pane} inset={gutter} onOpen={openMember} testID={`${ROUTE}.activeMembers`} />
          </View>
        ) : (
          <InColumn frame={frameStyle} style={moduleColumnStyle}>
            <ActiveMembersStrip members={item.members} width={frame.column} inset={space[0]} onOpen={openMember} testID={`${ROUTE}.activeMembers`} />
          </InColumn>
        );
      case 'events':
        return (
          <InColumn frame={frameStyle} style={moduleColumnStyle}>
            <EventsModule title={tEvents('home.titleAll')} events={item.events} limit={HOME_EVENT_CARDS} width={frame.column} routeId={ROUTE} />
          </InColumn>
        );
      case 'mods':
        return (
          <InColumn frame={frameStyle} style={moduleColumnStyle}>
            <PopularModsChips mods={item.mods} width={frame.column} onOpen={openMod} testID={`${ROUTE}.mods.list`} />
          </InColumn>
        );
      default:
        return null;
    }
  };

  const bell: HeaderAction = {
    icon: 'bell',
    label: t('bell.label'),
    onPress: openNotifications,
    ...(member && badges.home ? { unread: { count: badges.notifications, label: t('bell.unread', { count: badges.notifications }) } } : {}),
    testID: `${ROUTE}.bell`,
  };

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <View style={styles.body} onLayout={onPaneLayout}>
        <CollapsingFlashList
          ref={listRef}
          {...header.scrollProps}
          data={state ? [] : rows}
          keyExtractor={rowKey}
          getItemType={(row: HomeRow) => row.kind}
          extraData={tab}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: inset }}
          // The skeleton is taller than a phone and holds nothing to focus: a scroll region nobody can reach by keyboard
          // (axe scrollable-region-focusable). There is nothing to scroll to before the builds arrive.
          scrollEnabled={!loading}
          // FlashList keeps the visible rows in place when rows arrive above them; Start must open at its top.
          maintainVisibleContentPosition={NO_ANCHOR}
          ListHeaderComponent={listHeader}
          ListHeaderComponentStyle={railInPage ? styles.headerOverRows : undefined}
          ListEmptyComponent={
            state ? (
              <InColumn frame={frameStyle} style={columnStyle}>
                {state}
              </InColumn>
            ) : null
          }
          ListFooterComponent={footer}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshing={isWeb ? undefined : refreshing}
          progressViewOffset={headerHeight}
          onRefresh={isWeb || (state && !hasData) || guestFollowing ? undefined : () => void refresh()}
          renderItem={renderItem}
          testID={`${ROUTE}.list`}
        />
        {railShown && frame.rail !== null && !railInPage ? (
          <View style={[StyleSheet.absoluteFill, styles.railLayer, { top: headerHeight }]}>
            <View style={[styles.railFrame, { width: frame.width }]}>
              <View style={[styles.railColumn, { width: frame.rail }]}>
                {loading ? <HomeRailSkeleton width={frame.rail} top={0} /> : <HomeRail top={0} />}
              </View>
            </View>
          </View>
        ) : null}
        {/* 09 §6.2 d: the wordmark and the bell float over the list and hide on scroll down; the segments stay (§7.3 sticky). */}
        <BrandHeader
          scroll={header}
          actions={[bell]}
          title={tabs('tabs.home')}
          logo={desktop ? false : undefined}
          contentWidth={bleed ? undefined : frame.width}
          onHeight={onHeaderHeight}
          accessory={
            <View style={[styles.segments, bleed ? null : { width: frame.column }]}>
              <SegmentedControl options={segments} value={tab} onChange={setTab} label={t('tabs.label')} role="tablist" testID={`${ROUTE}.tabs`} />
            </View>
          }
          testID={`${ROUTE}.header`}
        />
      </View>
    </Screen>
  );
}
