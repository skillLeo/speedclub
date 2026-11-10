import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import type { TextInput as RNTextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useDiscover, type MakeTile } from '@/api/queries/discover';
import { normalizeQuery, SEARCH_MAX_LENGTH } from '@/api/queries/search';
import { BrowseErrorState, RestrictionNotice, useBrowseRestriction } from '@/features/home/components/BrowseStates';
import { useTabScrollToTop } from '@/features/shell/retap';
import { registerSearchFocus } from '@/features/shell/shortcuts/searchFocus';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarPadding } from '@/features/shell/tabBarLayout';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, layout, space, useBreakpoint, useMotion } from '@/theme';
import { EmptyState, Hairline, Header, HeaderLargeTitle, ListRow, Screen, SearchBar, SectionHeader, useCollapsingHeader } from '@/ui';

import { Collections, CollectionsSkeleton, PopularMods, SimilarMembers } from '../components/DiscoverSections';
import { MakeTiles, MakeTilesSkeleton } from '../components/MakeTiles';
import { QueryChips } from '../components/QueryChips';
import { makePath, searchPath } from '../navigation';
import { clearRecentSearches, rememberSearch, useRecentSearches } from '../recentSearches';
import { useSearchPlaceholder } from '../useSearchPlaceholder';

const ROUTE = 'DISC-01';
const EDGES: readonly Edge[] = ['left', 'right'];
/** The search bar is the scroll view's second child: it sticks under the header once the large title is gone. */
const STICKY = [1];
/** The band's hairline fades in over this much scroll once the band sticks, as the header's does. */
const HAIRLINE_FADE = space[8];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  column: { alignSelf: 'center', maxWidth: layout.feedColumn + 2 * layout.gutter.desktop, width: '100%' },
  // DQ-202: from 1280 a tab root starts on the pane's start edge, as Start does, so the large title stays put between the tabs.
  columnStart: { alignSelf: 'flex-start' },
  searchBand: { backgroundColor: t.color.bg.canvas, paddingBottom: t.space[16] },
  bandHairline: { bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
  body: { gap: t.space[32], paddingBottom: t.space[32] },
  header: { paddingBottom: t.space[12] },
  submit: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

/**
 * DISC-01 /discover, FS-11: large title, sticky search, recent searches, the make tiles with their real counts (each opens
 * DISC-03), Kollektionen, Beliebte Mods and [SIG] Mitglieder mit ähnlichen Autos.
 */
export function DiscoverScreen() {
  const { t } = useTranslation('discover');
  const placeholder = useSearchPlaceholder();
  const tabs = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const motion = useMotion();
  const online = useOnline();
  const qaState = useQaState();
  const restriction = useBrowseRestriction();
  const session = useSessionStore((state) => state.status);
  const addVehicle = useAddVehicle();
  const header = useCollapsingHeader();
  const padding = useTabBarPadding();
  const { gutter, kind, width } = useBreakpoint();
  const discover = useDiscover();
  const recent = useRecentSearches();
  const [text, setText] = useState('');
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
      }, motion.duration.small);
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
    if (!q) return;
    rememberSearch(q);
    setText('');
    router.push(searchPath(q, { understand: true }));
  };
  const openMake = useCallback((make: MakeTile) => router.push(makePath(make.slug)), [router]);

  const makes = qaState === 'empty' ? [] : (discover.data?.makes ?? null);
  // The page's other sections need real builds: with no make there is no collection or mod either.
  const page = qaState === 'default' || qaState === 'offline' || qaState === 'restricted' ? (makes && makes.length > 0 ? discover.data : undefined) : undefined;
  let makesBody: ReactNode;
  const loading = qaState === 'loading' || (!makes && discover.isPending && discover.fetchStatus !== 'paused' && qaState === 'default');
  if (loading) {
    makesBody = <MakeTilesSkeleton testID={`${ROUTE}.skeleton`} />;
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
    // DQ-201: §8 one button. The tiles stay empty until a build is public, so the one thing to offer is the first build, as on HOME-01.
    makesBody = (
      <EmptyState
        icon="garage"
        title={t('makes.emptyTitle')}
        body={t('makes.emptyBody')}
        action={session === 'loading' ? undefined : { label: t('makes.emptyAction'), onPress: addVehicle }}
        testID={`${ROUTE}.empty`}
      />
    );
  } else {
    makesBody = <MakeTiles makes={makes} onOpen={openMake} testID={`${ROUTE}.makes`} />;
  }

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
          {restriction ? <RestrictionNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
          {typed ? (
            <View style={styles.submit}>
              <ListRow
                icon="magnifying-glass"
                title={t('search.submit', { query: typed })}
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
          <View>
            <SectionHeader title={t('makes.title')} style={styles.header} testID={`${ROUTE}.makesHeader`} />
            {makesBody}
          </View>
          {loading ? <CollectionsSkeleton column={columnWidth} testID={`${ROUTE}.collectionsSkeleton`} /> : null}
          {/* A copy stored by an app version before M2.3 has makes only: the new sections then wait for the next answer. */}
          {page?.collections ? <Collections collections={page.collections} column={columnWidth} gutter={gutter} testID={`${ROUTE}.collections`} /> : null}
          {page?.popular_mods ? <PopularMods mods={page.popular_mods} column={columnWidth} testID={`${ROUTE}.popularMods`} /> : null}
          {page?.similar_members ? <SimilarMembers members={page.similar_members} testID={`${ROUTE}.similarMembers`} /> : null}
        </View>
      </Animated.ScrollView>
    </Screen>
  );
}
