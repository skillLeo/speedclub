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
  type FeedItem,
  type FeedSuggestion,
  type FeedTab,
  type FeedVehicle,
  type PopularMod,
} from '@/api/queries/home';
import { searchPath } from '@/features/discover/navigation';
import { useTabScrollToTop } from '@/features/shell/retap';
import { AnnouncementBanner } from '@/features/announcements/AnnouncementBanner';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { useTabBadges } from '@/features/shell/useTabBadges';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, space, useBreakpoint, useMotion, useTheme } from '@/theme';
import {
  BuildUpdateRowSkeleton,
  Button,
  CollapsingFlashList,
  EmptyState,
  Header,
  HeaderLargeTitle,
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

import { ActiveMembersStrip, ActiveMembersStripSkeleton } from '../components/ActiveMembersStrip';
import { BrowseErrorState, RestrictionNotice, useBrowseRestriction } from '../components/BrowseStates';
import { FeaturedHero, FeaturedHeroSkeleton } from '../components/FeaturedHero';
import { FeedVehicleCard, FeedVehicleCardSkeleton } from '../components/FeedVehicleCard';
import { FollowingEmpty, FollowingGuest } from '../components/FollowingStates';
import { HomeRail, HomeRailSkeleton } from '../components/HomeRail';
import { PopularModsChips, PopularModsChipsSkeleton } from '../components/PopularModsChips';
import { UpdateRow } from '../components/UpdateRow';
import { updatePath, useOpenMember, vehiclePath } from '../navigation';

const ROUTE = 'HOME-01';
const EDGES: readonly Edge[] = ['left', 'right'];
const COLUMN = layout.feedColumn;
const RAIL_GAP = layout.sectionGap;
const NO_ANCHOR = { disabled: true } as const;
const NEWEST_PATH = { pathname: '/discover/search', params: { sort: 'updated' } } as const;

type Section = 'newBuilds' | 'updates' | 'members' | 'mods';

/** The rows of the list. FS-2 order: hero → Neue Builds → Build-Updates → Aktive Mitglieder → Beliebte Mods → the stream. */
export type HomeRow =
  | { kind: 'hero'; vehicle: FeedVehicle }
  | { kind: 'section'; section: Section; first: boolean }
  | { kind: 'card'; vehicle: FeedVehicle; key: string; last: boolean; showLatest?: boolean }
  | { kind: 'updates'; updates: readonly BuildUpdateRowData[] }
  | { kind: 'members'; members: readonly ActiveMember[] }
  | { kind: 'mods'; mods: readonly PopularMod[] }
  | { kind: 'streamUpdates'; updates: readonly BuildUpdateRowData[]; key: string };

/** Remembered while the app runs, so coming back to Start keeps the segment the member chose. */
let lastTab: FeedTab = 'for_you';

/** The segment Start opens on next; a new member starts on Für dich. */
export function rememberHomeTab(tab: FeedTab): void {
  lastTab = tab;
}

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  body: { flex: 1 },
  segments: { paddingBottom: t.space[16] },
  heroGap: { paddingBottom: t.space[32] },
  section: { paddingBottom: t.space[12] },
  // Without a featured build the first section follows the segmented control.
  sectionFirst: { paddingTop: t.space[8] },
  cardGap: { paddingBottom: t.space[24] },
  moduleEnd: { paddingBottom: t.space[32] },
  // DQ-288: a block of update rows keeps the rhythm of the cards around it. Its rows have 12 of padding of their own, so the block
  // takes 12 back from the gap above (a card's 24, a module's 32, the 16 under the segments) and adds 12 below: 24 between a card and
  // the thumb above and below, as between two cards.
  streamUpdates: { marginTop: -t.space[12], paddingBottom: t.space[12] },
  // DQ-309: under its header the first update row's own 12 would add to the header's 12, so the module takes it back and its first
  // thumb sits 12 under "Build-Updates", like the strip and the chips under theirs.
  updatesModule: { marginTop: -t.space[12] },
  notice: { paddingBottom: t.space[16] },
  announcement: { marginBottom: t.space[16] },
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
  skeletonGap: { gap: t.space[24] },
  skeletonModule: { paddingBottom: t.space[32] },
  flush: { paddingHorizontal: 0 },
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
 * Für dich (FS-2): the modules, then the stream. Only the hero (featured[0]) is drawn of the featured builds, so the server leaves only
 * that one out of the stream's first page (M2.2 review 2); featured builds 2 and 3 may come in the stream like any build. A build drawn
 * above (the hero, the two Neue Builds) is never repeated in the stream.
 */
export function forYouRows(input: {
  hero: FeedVehicle | undefined;
  newBuilds: readonly FeedVehicle[];
  updates: readonly BuildUpdateRowData[];
  members: readonly ActiveMember[];
  mods: readonly PopularMod[];
  stream: readonly FeedItem[];
}): HomeRow[] {
  const rows: HomeRow[] = [];
  const shown = new Set<string>();
  let first = true;
  const section = (name: Section) => {
    rows.push({ kind: 'section', section: name, first: first && !input.hero });
    first = false;
  };
  if (input.hero) {
    rows.push({ kind: 'hero', vehicle: input.hero });
    shown.add(input.hero.id);
  }
  // DQ-308: a change Build-Updates lists is not repeated by a card's latest-change block, above it or in the stream below.
  const moduleUpdates = new Set(input.updates.map((update) => update.id));
  const repeatsModule = (vehicle: FeedVehicle) => (vehicle.latest_update ? moduleUpdates.has(vehicle.latest_update.id) : false);
  const newBuilds = input.newBuilds.filter((vehicle) => !shown.has(vehicle.id)).slice(0, NEW_BUILDS_PREVIEW);
  if (newBuilds.length > 0) {
    section('newBuilds');
    newBuilds.forEach((vehicle, index) => {
      shown.add(vehicle.id);
      rows.push({ kind: 'card', vehicle, key: `new.${vehicle.id}`, last: index === newBuilds.length - 1, ...(repeatsModule(vehicle) ? { showLatest: false } : {}) });
    });
  }
  if (input.updates.length > 0) {
    section('updates');
    rows.push({ kind: 'updates', updates: input.updates });
  }
  if (input.members.length > 0) {
    section('members');
    rows.push({ kind: 'members', members: input.members });
  }
  if (input.mods.length > 0) {
    section('mods');
    rows.push({ kind: 'mods', mods: input.mods });
  }
  rows.push(...streamRows(input.stream, shown, moduleUpdates));
  return rows;
}

/**
 * The stream as rows: vehicle cards and update rows in the server's order. Consecutive update rows form one block with the §8
 * hairlines between them, as Build-Updates does (DQ-288). A card whose latest change is an update row of the stream does not repeat it
 * (DQ-289), nor one of `elsewhere`, the rows of Build-Updates above (DQ-308).
 */
export function streamRows(stream: readonly FeedItem[], shown: ReadonlySet<string> = new Set(), elsewhere: ReadonlySet<string> = new Set()): HomeRow[] {
  const rows: HomeRow[] = [];
  const updateIds = new Set([...elsewhere, ...stream.flatMap((item) => (item.type === 'update' && item.update ? [item.update.id] : []))]);
  for (const item of stream) {
    if (item.type === 'vehicle' && item.vehicle) {
      if (shown.has(item.vehicle.id)) continue;
      const repeats = item.vehicle.latest_update ? updateIds.has(item.vehicle.latest_update.id) : false;
      rows.push({ kind: 'card', vehicle: item.vehicle, key: `stream.${item.key}`, last: false, ...(repeats ? { showLatest: false } : {}) });
    } else if (item.type === 'update' && item.update) {
      const previous = rows.at(-1);
      if (previous?.kind === 'streamUpdates') rows[rows.length - 1] = { ...previous, updates: [...previous.updates, item.update] };
      else rows.push({ kind: 'streamUpdates', updates: [item.update], key: `stream.${item.key}` });
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
    case 'card':
    case 'streamUpdates':
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

/**
 * The loaded column's geometry: the 16:9 featured build, Neue Builds with its two cards and Build-Updates. DQ-205: most cards have no
 * latest change, so none is drawn: the skeleton never runs longer than the page (§8).
 */
function ForYouSkeleton({ bleed, gutter, column, pane }: { bleed: boolean; gutter: number; column: number; pane: number }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={[styles.heroGap, bleed ? { marginHorizontal: -gutter } : null]}>
        <FeaturedHeroSkeleton width={bleed ? pane : column} bleed={bleed} gutter={gutter} />
      </View>
      {/* DQ-298: "Neue Builds" is as tall as its title line; its "Alle" overhangs that line (SectionHeader). */}
      <View style={styles.section}>
        <SkeletonText variant="titleS" width="40%" />
      </View>
      <View style={styles.skeletonGap}>
        <FeedVehicleCardSkeleton width={column} ownerLink latest={false} testID={`${ROUTE}.skeleton.card`} />
        <FeedVehicleCardSkeleton width={column} ownerLink latest={false} />
      </View>
    </Skeleton>
  );
}

/** Folge ich while it loads: the stream's cards. */
function FollowingSkeleton({ column }: { column: number }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.following.skeleton`}>
      <View style={[styles.skeletonGap, styles.sectionFirst]}>
        <FeedVehicleCardSkeleton width={column} ownerLink latest={false} />
        <FeedVehicleCardSkeleton width={column} ownerLink latest={false} />
      </View>
    </Skeleton>
  );
}

/** The modules that answer after the stream, in their place, so the page does not jump when they arrive. */
function ModulesSkeleton({ width, inset }: { width: number; inset: number }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.modules.skeleton`}>
      <View style={styles.skeletonModule}>
        <View style={styles.section}>
          <SkeletonText variant="titleS" width="40%" />
        </View>
        <View style={styles.updatesModule}>
          <BuildUpdateRowSkeleton inset={space[0]} />
          <BuildUpdateRowSkeleton inset={space[0]} />
          <BuildUpdateRowSkeleton inset={space[0]} divider={false} />
        </View>
      </View>
      <View style={styles.skeletonModule}>
        <View style={styles.section}>
          <SkeletonText variant="titleS" width="45%" />
        </View>
        <ActiveMembersStripSkeleton width={width} inset={inset} />
      </View>
      <View style={styles.skeletonModule}>
        <View style={styles.section}>
          <SkeletonText variant="titleS" width="60%" />
        </View>
        <PopularModsChipsSkeleton />
      </View>
    </Skeleton>
  );
}

/**
 * HOME-01 "/", FS-2: large title "Start" with the bell, the segmented Für dich · Folge ich, then for Für dich the featured build, Neue
 * Builds, Build-Updates, Aktive Mitglieder, Beliebte Mods and the ranked stream; for Folge ich the chronological stream of followed
 * members. From 1280 the rail beside the column holds the Discover shortcuts and the garage (§5).
 */
export function HomeScreen() {
  const { t } = useTranslation('home');
  const tabs = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const motion = useMotion();
  const online = useOnline();
  // M3.5: Start behind a pushed screen or another tab loads no further pages.
  const shown = useScreenFocused();
  const qaState = useQaState();
  const session = useSessionStore((state) => state.status);
  const member = session === 'member';
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
  const forYou = useFeed('for_you');
  const following = useFeed('following', tab === 'following');
  const feed = tab === 'for_you' ? forYou : following;
  const listRef = useRef<FlashListRef<HomeRow>>(null);
  const retained = useRetainedListScroll(listRef);
  const [refreshing, setRefreshing] = useState(false);
  const desktop = kind === 'desktop';
  const [pane, setPane] = useState(desktop ? windowWidth - layout.sidebar : kind === 'tablet' ? windowWidth - layout.rail : windowWidth);
  const frame = frameOf(pane, gutter, desktop);
  const bleed = kind === 'phone';
  const qaEmpty = qaState === 'empty';

  const hero = qaEmpty ? undefined : featured.data?.[0]?.vehicle;
  const stream = useMemo(() => (qaEmpty ? [] : flattenFeed(feed.data?.pages)), [feed.data?.pages, qaEmpty]);
  const suggestions = useMemo<readonly FeedSuggestion[]>(
    () => (qaEmpty ? [] : (following.data?.pages[0]?.meta.suggestions ?? [])),
    [following.data?.pages, qaEmpty],
  );

  const rows = useMemo<HomeRow[]>(() => {
    if (tab === 'following') return streamRows(stream);
    const data = modules.data;
    return forYouRows({
      hero,
      newBuilds: qaEmpty ? [] : (preview.data ?? []),
      updates: qaEmpty ? [] : (data?.build_updates ?? []),
      members: qaEmpty ? [] : (data?.active_members ?? []),
      mods: qaEmpty ? [] : (data?.popular_mods ?? []),
      stream,
    });
  }, [hero, modules.data, preview.data, qaEmpty, stream, tab]);

  const guestFollowing = tab === 'following' && session === 'guest';
  const hasData = feed.data !== undefined;
  const offline = !online || feed.fetchStatus === 'paused';
  const loading =
    !guestFollowing && (qaState === 'loading' || (!hasData && feed.isPending && feed.fetchStatus !== 'paused' && qaState === 'default'));
  // The modules answer on their own: until then their place is held under the Neue Builds.
  const modulesPending = tab === 'for_you' && !qaEmpty && modules.isPending && modules.fetchStatus !== 'paused';
  let state: ReactNode = null;
  if (guestFollowing) {
    state = <FollowingGuest routeId={ROUTE} />;
  } else if (loading) {
    state =
      tab === 'for_you' ? (
        <ForYouSkeleton bleed={bleed} gutter={gutter} column={frame.column} pane={pane} />
      ) : (
        <FollowingSkeleton column={frame.column} />
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
    state = <FollowingEmpty suggestions={suggestions} routeId={ROUTE} />;
  } else if (rows.length === 0 && !modulesPending) {
    state = (
      <EmptyState
        icon="garage"
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
      }, motion.duration.small);
    }
    return true;
  });

  const setTab = (next: FeedTab) => {
    if (next === tab) return;
    lastTab = next;
    setTabState(next);
    // The other segment starts at its top; the segmented control stays in reach under the title.
    scrollToTop(false);
  };

  const open = useCallback((vehicle: FeedVehicle) => router.push(vehiclePath(vehicle.slug)), [router]);
  const openLatest = useCallback(
    (vehicle: FeedVehicle) => {
      if (vehicle.latest_update) router.push(updatePath(vehicle.slug, vehicle.latest_update.id));
    },
    [router],
  );
  const openUpdate = useCallback((update: BuildUpdateRowData) => router.push(updatePath(update.vehicle.slug, update.id)), [router]);
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
  const heroColumnStyle = useMemo(() => [styles.heroGap, columnStyle], [columnStyle, styles.heroGap]);
  const cardColumnStyle = useMemo(() => [styles.cardGap, columnStyle], [columnStyle, styles.cardGap]);
  const lastCardColumnStyle = useMemo(() => [styles.moduleEnd, columnStyle], [columnStyle, styles.moduleEnd]);
  const moduleColumnStyle = useMemo(() => [styles.moduleEnd, columnStyle], [columnStyle, styles.moduleEnd]);
  const updatesColumnStyle = useMemo(() => [styles.moduleEnd, styles.updatesModule, columnStyle], [columnStyle, styles.moduleEnd, styles.updatesModule]);
  const streamUpdatesStyle = useMemo(() => [styles.streamUpdates, columnStyle], [columnStyle, styles.streamUpdates]);

  // DQ-297: the rail starts on the segmented control's top edge, under the large title, whatever height the title has at this font.
  const [titleHeight, setTitleHeight] = useState<number | undefined>(undefined);
  const onTitleLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    if (next > 0 && next !== titleHeight) setTitleHeight(next);
  };

  const onPaneLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    // Web hides an inactive tab with display: none, which reports a 0 × 0 layout. That is no pane: laying the page out for it
    // rebuilt every card, and each photo asked the network again on the next tab switch (offline: a console error each, M2.8).
    if (next <= 0) return;
    if (Math.abs(next - pane) >= 1) setPane(next);
  };

  // DQ-199: on web the rail at a large font is taller than a desktop window, with "Konto erstellen" below the fold of its own
  // scroller, so it is part of the page and everything in it is reached by the one scroller. Native keeps its own scroller: a touch
  // outside the bounds of its parent, the list header, would not reach it on Android.
  // DQ-287: the rail is part of the desktop page in every state that has a page: Folge ich for a guest or with nothing yet, and an
  // empty Start. Only a full-page error or offline state leaves it out, and the skeleton draws its own.
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

  // The large title pads itself with the gutter; in the column it starts on the column's edge instead.
  const titleBlock = (
    <View style={frameStyle}>
      <View style={columnStyle}>
        <View onLayout={onTitleLayout}>
          <HeaderLargeTitle title={tabs('tabs.home')} scroll={header} style={styles.flush} testID={`${ROUTE}.title`} />
        </View>
        {/* DQ-281: the 16 to the hero belongs outside the control, whose own style is its 36 track. */}
        <View style={styles.segments}>
          <SegmentedControl options={segments} value={tab} onChange={setTab} label={t('tabs.label')} role="tablist" testID={`${ROUTE}.tabs`} />
        </View>
        {restriction ? <RestrictionNotice message={restriction} style={styles.notice} testID={`${ROUTE}.restricted`} /> : null}
        {/* M3.5 ADM-30: the current announcement, under the segments on both tabs. */}
        <AnnouncementBanner routeId={ROUTE} style={styles.announcement} />
      </View>
      {railInPage ? (
        <View style={[styles.railInPage, { width: frame.rail ?? 0 }]}>
          <HomeRail inPage top={titleHeight} />
        </View>
      ) : null}
    </View>
  );

  // The footer is a row of the column like the cards: 16/20 from the edge on a phone, on the column's edge beside the sidebar.
  const footerColumnStyle = useMemo(() => [styles.footer, columnStyle], [columnStyle, styles.footer]);
  const footerErrorColumnStyle = useMemo(() => [styles.footerError, columnStyle], [columnStyle, styles.footerError]);
  const footerFrameID = `${ROUTE}.footer`;
  let footer: ReactNode = null;
  if (!state && modulesPending && stream.length === 0) {
    footer = (
      <InColumn frame={frameStyle} style={columnStyle}>
        <ModulesSkeleton width={bleed ? pane : frame.column} inset={bleed ? gutter : 0} />
      </InColumn>
    );
  } else if (!state && feed.isFetchingNextPage) {
    footer = (
      <InColumn frame={frameStyle} style={footerColumnStyle} frameTestID={footerFrameID} testID={`${ROUTE}.loadingMore`}>
        <Spinner label={t('list.loadingMore')} />
      </InColumn>
    );
  } else if (!state && feed.isFetchNextPageError) {
    footer = (
      <InColumn frame={frameStyle} style={footerErrorColumnStyle} frameTestID={footerFrameID} testID={`${ROUTE}.moreError`}>
        <Text variant="supporting" color="text.secondary">
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
      case 'updates':
        return <SectionHeader title={t('updates.title')} testID={`${ROUTE}.updates`} />;
      case 'members':
        return <SectionHeader title={t('members.title')} testID={`${ROUTE}.members`} />;
      default:
        return <SectionHeader title={t('mods.title')} testID={`${ROUTE}.mods`} />;
    }
  };

  const renderItem = ({ item }: { item: HomeRow }) => {
    switch (item.kind) {
      case 'hero':
        return bleed ? (
          <View style={styles.heroGap}>
            <FeaturedHero vehicle={item.vehicle} width={pane} bleed gutter={gutter} onOpen={open} testID={`${ROUTE}.featured`} />
          </View>
        ) : (
          <InColumn frame={frameStyle} style={heroColumnStyle}>
            <FeaturedHero vehicle={item.vehicle} width={frame.column} bleed={false} gutter={gutter} onOpen={open} testID={`${ROUTE}.featured`} />
          </InColumn>
        );
      case 'section':
        return (
          <InColumn frame={frameStyle} style={[columnStyle, styles.section, item.first ? styles.sectionFirst : null]}>
            {sectionTitle(item.section)}
          </InColumn>
        );
      case 'card':
        return (
          <InColumn frame={frameStyle} style={item.last ? lastCardColumnStyle : cardColumnStyle}>
            <FeedVehicleCard
              vehicle={item.vehicle}
              width={frame.column}
              onOpen={open}
              onOpenUpdate={openLatest}
              onOpenOwner={openMember}
              showLatest={item.showLatest ?? true}
              testID={`${ROUTE}.card.${item.vehicle.id}`}
            />
          </InColumn>
        );
      case 'updates':
        return (
          <InColumn frame={frameStyle} style={updatesColumnStyle} testID={`${ROUTE}.updates.list`}>
            {item.updates.map((update, index) => (
              <UpdateRow
                key={update.id}
                update={update}
                onOpen={openUpdate}
                inset={space[0]}
                divider={index < item.updates.length - 1}
                testID={`${ROUTE}.update.${update.id}`}
              />
            ))}
          </InColumn>
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
      case 'mods':
        return (
          <InColumn frame={frameStyle} style={moduleColumnStyle}>
            <PopularModsChips mods={item.mods} width={frame.column} onOpen={openMod} testID={`${ROUTE}.mods.list`} />
          </InColumn>
        );
      case 'streamUpdates':
        return (
          <InColumn frame={frameStyle} style={streamUpdatesStyle}>
            {item.updates.map((update, position) => (
              <UpdateRow
                key={update.id}
                update={update}
                onOpen={openUpdate}
                inset={space[0]}
                divider={position < item.updates.length - 1}
                testID={`${ROUTE}.stream.update.${update.id}`}
              />
            ))}
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
    ...(member && badges.home ? { unread: { label: t('bell.unread', { count: badges.notifications }) } } : {}),
    testID: `${ROUTE}.bell`,
  };

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        title={tabs('tabs.home')}
        scroll={header}
        actions={[bell]}
        contentMaxWidth={bleed ? undefined : frame.width + 2 * gutter}
        contentAlign="center"
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('offline')} />
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
          // FlashList keeps the visible rows in place when rows arrive above them. The featured build and the modules are requests
          // of their own: answering after the stream, they were inserted above the first card and Start opened scrolled down.
          maintainVisibleContentPosition={NO_ANCHOR}
          ListHeaderComponent={titleBlock}
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
          onRefresh={isWeb || (state && !hasData) || guestFollowing ? undefined : () => void refresh()}
          renderItem={renderItem}
          testID={`${ROUTE}.list`}
        />
        {railShown && frame.rail !== null && !railInPage ? (
          <View style={[StyleSheet.absoluteFill, styles.railLayer]}>
            <View style={[styles.railFrame, { width: frame.width }]}>
              <View style={[styles.railColumn, { width: frame.rail }]}>
                {loading ? <HomeRailSkeleton width={frame.rail} top={titleHeight} /> : <HomeRail top={titleHeight} />}
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
