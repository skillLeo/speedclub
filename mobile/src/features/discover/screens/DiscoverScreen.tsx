import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import type { TextInput as RNTextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useDiscover, type MakeTile } from '@/api/queries/discover';
import { EVENTS_FLAG } from '@/api/queries/events';
import { useFlag } from '@/api/queries/appConfig';
import { flattenBuilds, useNewBuilds, type FeedVehicle } from '@/api/queries/home';
import { normalizeQuery, SEARCH_MAX_LENGTH } from '@/api/queries/search';
import { EmbeddedEvents } from '@/features/events/components/EmbeddedEvents';
import { EventsModule } from '@/features/events/components/EventsModule';
import { EmbeddedBusinesses } from '@/features/parts/components/EmbeddedBusinesses';
import { EmbeddedParts } from '@/features/parts/components/EmbeddedParts';
import { BUSINESSES_FLAG } from '@/api/queries/businesses';
import { PARTS_FLAG } from '@/api/queries/parts';
import { BrowseErrorState, RestrictionNotice, useBrowseRestriction } from '@/features/home/components/BrowseStates';
import { vehiclePath } from '@/features/home/navigation';
import { useTabScrollToTop } from '@/features/shell/retap';
import { registerSearchFocus } from '@/features/shell/shortcuts/searchFocus';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarPadding } from '@/features/shell/tabBarLayout';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, layout, space, useBreakpoint, useTheme } from '@/theme';
import { motionDuration, useMotionPreference } from '@/ui/motion';
import { Chip, EmptyState, Hairline, Header, HeaderLargeTitle, ListRow, Screen, SearchBar, SectionHeader, Skeleton, SkeletonText, useCollapsingHeader } from '@/ui';

import { Collections, CollectionsSkeleton, PopularMods, SimilarMembers } from '../components/DiscoverSections';
import { BuildWall, BuildWallSkeleton } from '../components/BuildWall';
import { columnsFor, MakeTiles, MakeTilesSample, MakeTilesSkeleton, TOP_MAKES, TOP_MAKES_PHONE, widestWordmarkWord, wordmarkScale } from '../components/MakeTiles';
import { estimatedPane, WALL_COLUMNS_BY_KIND, wholeRows, wideWallWidth } from '../layout';
import { QueryChips } from '../components/QueryChips';
import { makePath, SEARCH_SCOPES, searchPath, type SearchScope } from '../navigation';
import { clearRecentSearches, rememberSearch, useRecentSearches } from '../recentSearches';
import { useSearchPlaceholder } from '../useSearchPlaceholder';

const ROUTE = 'DISC-01';
const EDGES: readonly Edge[] = ['left', 'right'];
/** The search bar is the scroll view's second child: it sticks under the header once the large title is gone. */
const STICKY = [1];
/** The band's hairline fades in over this much scroll once the band sticks, as the header's does. */
const HAIRLINE_FADE = space[8];
/** "Neu entdeckt" (09 §7.5, DQ-1038): whole rows of the wall, 4 of 2 on a phone, 3 of 3 from 768, 2 of 4 from 1280. */
const WALL_ROWS = { phone: 4, tablet: 3, desktop: 2 } as const;
const NEWEST_PATH = { pathname: '/discover/search', params: { sort: 'newest' } } as const;
/**
 * M4.12: "Treffen" is a scope of DISC-01 that embeds EVT-01 (09 §7.5); searches from it look in every scope. M4.14: "Betriebe" lists
 * BusinessCards and "Teile" the part brands and ProductRows; there the search field narrows the embedded list instead.
 */
type DiscoverScope = SearchScope | 'events' | 'businesses' | 'parts';
/** The scopes whose list the search field narrows in place (no DISC-02 for them). */
const IN_PLACE_SCOPES: ReadonlySet<DiscoverScope> = new Set(['businesses', 'parts']);
/** "Treffen am Wochenende" (09 §7.5): at most three cards before "Alle Treffen". */
const WEEKEND_CARDS = 3;
const DISCOVER_SCOPES: readonly DiscoverScope[] = ['all', 'vehicles', 'members', 'events', 'businesses', 'parts'];

/** A scope named in the URL, or null. */
function discoverScopeOf(value: string | string[] | undefined): DiscoverScope | null {
  const first = Array.isArray(value) ? value[0] : value;
  return (DISCOVER_SCOPES as readonly string[]).includes(first ?? '') ? (first as DiscoverScope) : null;
}
/** Remembered while the app runs, so coming back to Entdecken keeps the scope the member chose. */
let lastScope: DiscoverScope = 'all';

/** The scope DISC-01 opens with next. */
function rememberScope(scope: DiscoverScope): void {
  lastScope = scope;
}

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  column: { alignSelf: 'center', maxWidth: layout.feedColumn + 2 * layout.gutter.desktop, width: '100%' },
  // DQ-202: from 1280 a tab root starts on the pane's start edge, as Start does, so the large title stays put between the tabs.
  columnStart: { alignSelf: 'flex-start' },
  searchBand: { backgroundColor: t.color.bg.canvas, paddingBottom: t.space[16] },
  bandHairline: { bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
  body: { gap: t.space[32], paddingBottom: t.space[32] },
  // DQ-1038: from 768 the wall runs in the pane up to the content width, not in the 640 column.
  wide: { maxWidth: layout.contentMax + 2 * layout.gutter.desktop, paddingBottom: t.space[32], width: '100%' },
  header: { paddingBottom: t.space[12] },
  scopes: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  centred: { alignSelf: 'center' },
  submit: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

/**
 * DISC-01 /discover, 09 §7.5: large title (SM3), sticky search, scope chips, recent searches, the Marken BrandTiles (top 12 with their
 * real counts, each opens DISC-03), the Kollektionen photo rail, Beliebte Mods, [SIG] Mitglieder mit ähnlichen Autos and the
 * "Neu entdeckt" photo wall of the newest public builds.
 */
export function DiscoverScreen() {
  const { t } = useTranslation('discover');
  const placeholder = useSearchPlaceholder();
  const tabs = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const motion = useMotionPreference();
  const online = useOnline();
  const qaState = useQaState();
  const restriction = useBrowseRestriction();
  const session = useSessionStore((state) => state.status);
  const addVehicle = useAddVehicle();
  const header = useCollapsingHeader();
  const padding = useTabBarPadding();
  const { gutter, kind, width } = useBreakpoint();
  const { fontScale } = useTheme();
  const discover = useDiscover();
  const recent = useRecentSearches();
  const [text, setText] = useState('');
  // `?scope=` opens a scope by link (the visual matrix, a shared "Betriebe" link); otherwise the one chosen last in this session.
  const scopeParam = useLocalSearchParams<{ scope?: string }>().scope;
  const [scope, setScopeState] = useState<DiscoverScope>(() => discoverScopeOf(scopeParam) ?? lastScope);
  const tEvents = useTranslation('events').t;
  const eventsOn = useFlag(EVENTS_FLAG);
  const eventsScope = scope === 'events' && eventsOn;
  const tParts = useTranslation('parts').t;
  const businessesOn = useFlag(BUSINESSES_FLAG);
  const partsOn = useFlag(PARTS_FLAG);
  const businessesScope = scope === 'businesses' && businessesOn;
  const partsScope = scope === 'parts' && partsOn;
  const inPlace = businessesScope || partsScope;
  const embedded = eventsScope || inPlace;
  const searchScope: SearchScope = scope === 'events' || scope === 'businesses' || scope === 'parts' ? 'all' : scope;
  const [allMakes, setAllMakes] = useState(false);
  const newBuilds = useNewBuilds();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const searchRef = useRef<ComponentRef<typeof RNTextInput>>(null);
  const gutterStyle = useMemo(() => ({ paddingHorizontal: gutter }), [gutter]);
  const columnWidth = Math.min(layout.feedColumn, width - 2 * gutter);
  const column = useMemo(() => [styles.column, kind === 'desktop' ? styles.columnStart : null], [kind, styles.column, styles.columnStart]);
  const typed = normalizeQuery(text);
  // DQ-196: the header and the sticky band are both fixed chrome, so the line belongs under the band, where content scrolls
  // under it. The band sticks once the large title has scrolled away.
  const bandHairline = useAnimatedStyle(() => {
    const stuck = header.collapseAt.get();
    return { opacity: interpolate(header.scrollY.get(), [stuck, stuck + HAIRLINE_FADE], [0, 1], Extrapolation.CLAMP) };
  });

  const readOffset = () => {
    const node = scrollRef.current?.getScrollableNode() as unknown as { scrollTop?: number } | null | undefined;
    return isWeb && typeof node?.scrollTop === 'number' ? node.scrollTop : header.scrollY.get();
  };
  useTabScrollToTop(() => {
    const before = readOffset();
    if (before <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    if (isWeb) {
      // WebKit ignores element.scroll() on an element that was display:none, until something else scrolls it.
      const node = scrollRef.current?.getScrollableNode() as unknown as { scrollTop: number };
      setTimeout(() => {
        if (node.scrollTop === before) node.scrollTop = 0;
      }, motionDuration('effect.default'));
    }
    return true;
  });
  // As TabRootScreen: the header follows the real offset again when the tab returns.
  useFocusEffect(
    useCallback(() => {
      if (!isWeb) return undefined;
      const frame = requestAnimationFrame(() => {
        const node = scrollRef.current?.getScrollableNode() as unknown as { scrollTop?: number } | null | undefined;
        if (typeof node?.scrollTop === 'number') header.scrollY.set(node.scrollTop);
      });
      return () => cancelAnimationFrame(frame);
    }, [header.scrollY]),
  );

  // M2.7 web shortcut "/": the field of the screen in front takes the focus.
  useFocusEffect(
    useCallback(
      () =>
        registerSearchFocus(() => {
          if (!searchRef.current) return false;
          searchRef.current.focus();
          return true;
        }),
      [],
    ),
  );

  // A submitted text is read for filters on DISC-02 (contract §3), where its chips show.
  const search = (term: string) => {
    const q = normalizeQuery(term);
    // Betriebe and Teile narrow their own list as the member types; Enter keeps the text there.
    if (!q || IN_PLACE_SCOPES.has(scope)) return;
    rememberSearch(q);
    setText('');
    router.push(searchPath(q, { understand: true, scope: searchScope }));
  };
  const setScope = (next: DiscoverScope) => {
    rememberScope(next);
    setScopeState(next);
  };
  const openVehicle = useCallback((vehicle: FeedVehicle) => router.push(vehiclePath(vehicle.slug)), [router]);
  const openMake = useCallback((make: MakeTile) => router.push(makePath(make.slug)), [router]);

  const makes = useMemo(() => (qaState === 'empty' ? [] : (discover.data?.makes ?? null)), [discover.data?.makes, qaState]);
  // The page's other sections need real builds: with no make there is no collection or mod either.
  const page = qaState === 'default' || qaState === 'offline' || qaState === 'restricted' ? (makes && makes.length > 0 ? discover.data : undefined) : undefined;
  const phone = kind === 'phone';
  // DQ-1036 / DQ-1038: whole rows of tiles only, never a lone one; a phone shows 6, so a photo reaches its first screen.
  const makeColumns = useMemo(
    () => columnsFor(columnWidth, widestWordmarkWord((makes ?? []).map((make) => make.name), wordmarkScale(fontScale))),
    [columnWidth, fontScale, makes],
  );
  const makeLimit = phone ? TOP_MAKES_PHONE : TOP_MAKES;
  const shownMakes = makes && !allMakes ? makes.slice(0, wholeRows(makes.length, makeColumns, makeLimit)) : makes;
  const moreMakes = makes !== null && shownMakes !== null && makes.length > shownMakes.length && !allMakes;
  let makesBody: ReactNode;
  const loading = qaState === 'loading' || (!makes && discover.isPending && discover.fetchStatus !== 'paused' && qaState === 'default');
  if (loading) {
    makesBody = <MakeTilesSkeleton width={columnWidth} count={makeLimit} testID={`${ROUTE}.skeleton`} />;
  } else if (qaState === 'error' || !makes) {
    makesBody = (
      <BrowseErrorState
        routeId={ROUTE}
        title={t('makes.errorTitle')}
        offline={qaState !== 'error' && (!online || discover.fetchStatus === 'paused')}
        error={discover.error}
        onRetry={() => void discover.refetch()}
        retrying={discover.isFetching}
      />
    );
  } else if (makes.length === 0) {
    // DQ-201 / 09 §4.9: the tiles as they will look, badged "Beispiel", then one action: the first build, as on HOME-01.
    // DQ-1033 (09 §5): left-aligned, the sample preview above title.2, one line and the one action.
    makesBody = (
      <EmptyState
        preview={<MakeTilesSample width={columnWidth} testID={`${ROUTE}.sample`} />}
        title={t('makes.emptyTitle')}
        body={t('makes.emptyBody')}
        action={session === 'loading' ? undefined : { label: t('makes.emptyAction'), onPress: addVehicle }}
        testID={`${ROUTE}.empty`}
      />
    );
  } else {
    makesBody = <MakeTiles makes={shownMakes ?? []} width={columnWidth} onOpen={openMake} testID={`${ROUTE}.makes`} />;
  }

  // "Neu entdeckt": the newest public builds as a photo wall, only where the page has builds; it hides on its own error.
  const wallColumns = WALL_COLUMNS_BY_KIND[kind];
  const newest = useMemo(() => {
    if (!page) return [];
    const withCover = flattenBuilds(newBuilds.data?.pages).filter((vehicle) => vehicle.cover);
    return withCover.slice(0, wholeRows(withCover.length, wallColumns, wallColumns * WALL_ROWS[kind]));
  }, [kind, newBuilds.data, page, wallColumns]);
  const wallWidth = phone ? width : wideWallWidth(estimatedPane(kind, width), gutter);
  const wallPending = loading || (page !== undefined && newBuilds.isPending && newBuilds.fetchStatus !== 'paused');

  const scopes: { value: DiscoverScope; label: string }[] = [
    ...SEARCH_SCOPES.map((value) => ({ value, label: t(`scopes.${value}`) })),
    ...(eventsOn ? [{ value: 'events' as const, label: tEvents('discover.scope') }] : []),
    ...(businessesOn ? [{ value: 'businesses' as const, label: tParts('scope.businesses') }] : []),
    ...(partsOn ? [{ value: 'parts' as const, label: tParts('scope.parts') }] : []),
  ];

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header variant="large" title={tabs('tabs.discover')} scroll={header} hairline={false} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner label={t('offline')} />
      <Animated.ScrollView
        ref={scrollRef}
        {...header.scrollProps}
        stickyHeaderIndices={STICKY}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
        contentContainerStyle={[styles.content, padding]}
        testID={`${ROUTE}.list`}
      >
        <HeaderLargeTitle title={tabs('tabs.discover')} scroll={header} style={column} testID={`${ROUTE}.title`} />
        <View style={styles.searchBand}>
          <View style={[column, gutterStyle]}>
            <SearchBar
              value={text}
              onChangeText={setText}
              placeholder={placeholder}
              onSubmit={search}
              maxLength={SEARCH_MAX_LENGTH}
              autoCorrect={false}
              autoCapitalize="none"
              ref={searchRef}
              testID={`${ROUTE}.search`}
            />
          </View>
          <Animated.View style={[styles.bandHairline, bandHairline]} testID={`${ROUTE}.searchBand.hairline`}>
            <Hairline />
          </Animated.View>
        </View>
        <View style={[column, gutterStyle, styles.body]}>
          {/* 09 §7.5 scope chips: what the next search looks for. Treffen, Betriebe and Teile join with their modules. */}
          <View role="radiogroup" aria-label={t('scopes.label')} style={styles.scopes} testID={`${ROUTE}.scopes`}>
            {scopes.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={scope === option.value}
                selectionRole="radio"
                onPress={() => setScope(option.value)}
                testID={`${ROUTE}.scope.${option.value}`}
              />
            ))}
          </View>
          {restriction ? <RestrictionNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
          {inPlace ? null : typed ? (
            <View style={styles.submit}>
              <ListRow
                icon="magnifying-glass"
                title={t(searchScope === 'all' ? 'search.submit' : `search.submitScoped.${searchScope}`, { query: typed })}
                role="link"
                onPress={() => search(typed)}
                inset={space[16]}
                testID={`${ROUTE}.searchSubmit`}
              />
            </View>
          ) : (
            <QueryChips
              title={t('recent.title')}
              terms={recent}
              onPick={search}
              onClear={clearRecentSearches}
              testID={`${ROUTE}.recent`}
            />
          )}
          {eventsScope ? (
            <EmbeddedEvents width={columnWidth} bleed={phone ? gutter : 0} routeId={ROUTE} />
          ) : businessesScope ? (
            <EmbeddedBusinesses query={text} bleed={gutter} routeId={ROUTE} />
          ) : partsScope ? (
            <EmbeddedParts query={text} width={columnWidth} phone={phone} routeId={ROUTE} />
          ) : (
            <>
            <View>
              <SectionHeader
                title={t('makes.title')}
                actionLabel={moreMakes ? t('makes.all', { count: makes?.length ?? 0 }) : undefined}
                actionAccessibilityLabel={moreMakes ? t('makes.allLabel', { count: makes?.length ?? 0 }) : undefined}
                onAction={moreMakes ? () => setAllMakes(true) : undefined}
                style={styles.header}
                testID={`${ROUTE}.makesHeader`}
              />
              {makesBody}
            </View>
            {loading ? <CollectionsSkeleton column={columnWidth} testID={`${ROUTE}.collectionsSkeleton`} /> : null}
            {/* A copy stored by an app version before M2.3 has makes only: the new sections then wait for the next answer. */}
            {page?.collections ? <Collections collections={page.collections} column={columnWidth} gutter={gutter} testID={`${ROUTE}.collections`} /> : null}
            {page?.popular_mods ? <PopularMods mods={page.popular_mods} column={columnWidth} testID={`${ROUTE}.popularMods`} /> : null}
            {page?.similar_members ? <SimilarMembers members={page.similar_members} testID={`${ROUTE}.similarMembers`} /> : null}
              {/* M4.8 "Treffen am Wochenende" (09 §7.5), only when there are events: never an empty module. */}
              {page && page.weekend_events?.length ? (
                <EventsModule title={tEvents('discover.weekend')} events={page.weekend_events} limit={WEEKEND_CARDS} width={columnWidth} allPath="/events?when=weekend" routeId={ROUTE} />
              ) : null}
            </>
          )}
        </View>
        {!embedded && (wallPending || newest.length > 0) ? (
          <View style={[phone ? column : [styles.wide, kind === 'desktop' ? styles.columnStart : styles.centred], gutterStyle]}>
            {wallPending ? (
              <Skeleton testID={`${ROUTE}.newest.skeleton`}>
                <SkeletonText variant="headline" width="35%" style={styles.header} />
                <View style={phone ? { marginHorizontal: -gutter } : null}>
                  <BuildWallSkeleton width={wallWidth} columns={wallColumns} count={wallColumns * 2} />
                </View>
              </Skeleton>
            ) : newest.length > 0 ? (
              <View testID={`${ROUTE}.newest`}>
                <SectionHeader
                  title={t('newest.title')}
                  actionLabel={tabs('actions.all')}
                  actionAccessibilityLabel={t('newest.allLabel')}
                  onAction={() => router.push(NEWEST_PATH)}
                  style={styles.header}
                  testID={`${ROUTE}.newest.header`}
                />
                {/* A phone runs the wall to the screen edges: photography is the interface (09 §4.6). */}
                <View style={phone ? { marginHorizontal: -gutter } : null}>
                  <BuildWall vehicles={newest} width={wallWidth} columns={wallColumns} onOpen={openVehicle} testID={`${ROUTE}.newest.wall`} />
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </Animated.ScrollView>
    </Screen>
  );
}
