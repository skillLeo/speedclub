import type { FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import {
  BUNDESLAENDER,
  CREW_LIMITS,
  CREW_SORTS,
  crewQueryOf,
  flattenPages,
  useCrewList,
  useCrewsOn,
  type Bundesland,
  type CrewCard,
  type CrewFilters,
  type CrewSort,
} from '@/api/queries/crews';
import { DiscoverSegmentBar, SegmentRailScrollView, SegmentSwipe } from '@/features/discover/components/DiscoverSegments';
import { OptionRow } from '@/features/discover/components/OptionRow';
import { useIsSegmentRoot, useSegmentsInSidebar } from '@/features/discover/segments';
import { useDebouncedValue } from '@/features/discover/useDebouncedValue';
import { useInboxActions } from '@/features/shell/inboxActions';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useBack } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth } from '@/state/session';
import { createStyles, layout, space, useBreakpoint } from '@/theme';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Header, HeaderLargeTitle, type HeaderAction } from '@/ui/Header';
import { RowGroup } from '@/ui/RowGroup';
import { useMotionPreference } from '@/ui/motion';
import { Screen } from '@/ui/Screen';
import { SearchBar } from '@/ui/SearchBar';
import { Sheet } from '@/ui/Sheet';
import { Skeleton } from '@/ui/Skeleton';
import { Spinner } from '@/ui/Spinner';
import { Text } from '@/ui/Text';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { useCrewAccess } from '../access';
import { CrewCardSkeleton, CrewCardView } from '../components/CrewCardView';
import { CrewsProfileEntry } from '../components/CrewsProfileEntry';
import { crewColumns } from '../layout';
import { bundeslandLabel, crewFiltersFromParams, crewPath, CREWS_PATH, sampleCrew } from '../model';

const ROUTE = 'CREW-00';
const EDGES: readonly Edge[] = ['left', 'right'];
const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_CARDS = 2;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', width: '100%' },
  narrow: { maxWidth: layout.feedColumn },
  controls: { gap: t.space[16], paddingBottom: t.space[16] },
  intro: { gap: t.space[4] },
  // Tablet and desktop (R4DQ-05, R4DQ-40): one toolbar across the grid's width: the search takes what the chips leave, the chips sit
  // on its centre line and end on the grid's right edge. A large font wraps the chips under the search, still at the right edge.
  filterRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[12], justifyContent: 'flex-end' },
  search: { flexBasis: layout.feedColumn / 2, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  chips: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  chipsWrap: { flexShrink: 0, flexWrap: 'wrap' },
  card: { paddingBottom: t.space[16] },
  gridCard: { paddingBottom: t.space[24] },
  state: { paddingTop: t.space[16] },
  skeleton: { gap: t.space[16] },
  skeletonGrid: { flexDirection: 'row', gap: t.space[24] },
  skeletonCell: { flex: 1 },
  more: { alignItems: 'flex-start', minHeight: t.size.touchMin, paddingVertical: t.space[8] },
  mine: { alignSelf: 'stretch' },
}));

/**
 * CREW-00 Crews (11 R4-2.3, contract §3 #1): Entdecken › Crews `/crews`. The crews' own search (2–40 characters, name contains), the
 * Bundesland filter and the sort Name (A–Z) · Neueste in sheets — never by size (C2) —, the crews as photo-led cards with the member
 * count as a plain fact, and "Crew gründen" in the header. The filters live in the address (`?q=&bundesland=&sort=`).
 *
 * As a segment page of Entdecken it carries the tab's title, the segmented control, the bell and Nachrichten and swipes to its
 * neighbour; pushed elsewhere it is "Crews" with back. Hidden (unavailable state) while the `crews` flag is off.
 */
export function CrewListScreen() {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const tabs = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; bundesland?: string; sort?: string }>();
  const qaState = useQaState();
  const online = useOnline();
  const motion = useMotionPreference();
  const flag = useCrewsOn();
  const access = useCrewAccess();
  const requireAuth = useRequireAuth();
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const back = useBack('/discover');
  const segmentRoot = useIsSegmentRoot();
  const inSidebar = useSegmentsInSidebar();
  const inbox = useInboxActions(ROUTE);
  const { gutter, kind, width: windowWidth } = useBreakpoint();
  const [listWidth, setListWidth] = useState(windowWidth);
  const listRef = useRef<FlashListRef<CrewCard>>(null);

  const initial = useMemo(() => crewFiltersFromParams(params), []); // eslint-disable-line react-hooks/exhaustive-deps -- the address seeds the state once
  const [text, setText] = useState(initial.text);
  const [bundesland, setBundesland] = useState<Bundesland | null>(initial.bundesland);
  const [sort, setSort] = useState<CrewSort>(initial.sort);
  const [sheet, setSheet] = useState<'sort' | 'region' | null>(null);
  const query = useDebouncedValue(crewQueryOf(text), SEARCH_DEBOUNCE_MS);
  const typedShort = text.trim().length > 0 && text.trim().length < CREW_LIMITS.queryMin;
  const filters = useMemo<CrewFilters>(() => ({ q: query, bundesland, sort }), [bundesland, query, sort]);

  const forced = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const list = useCrewList(filters, forced);
  const rows = useMemo(() => (qaState === 'empty' ? [] : flattenPages(list.data?.pages, (crew) => crew.id)), [list.data?.pages, qaState]);

  const updateAddress = useCallback(
    (next: { q?: string | null; bundesland?: Bundesland | null; sort?: CrewSort }) => {
      router.setParams({
        ...(next.q !== undefined ? { q: next.q ?? undefined } : {}),
        ...(next.bundesland !== undefined ? { bundesland: next.bundesland ?? undefined } : {}),
        ...(next.sort !== undefined ? { sort: next.sort === 'name' ? undefined : next.sort } : {}),
      });
    },
    [router],
  );
  const chooseRegion = (next: Bundesland | null) => {
    setSheet(null);
    if (next === bundesland) return;
    haptics.selection();
    setBundesland(next);
    updateAddress({ bundesland: next });
  };
  const chooseSort = (next: CrewSort) => {
    setSheet(null);
    if (next === sort) return;
    haptics.selection();
    setSort(next);
    updateAddress({ sort: next });
  };
  const reset = () => {
    setText('');
    setBundesland(null);
    setSort('name');
    updateAddress({ q: null, bundesland: null, sort: 'name' });
  };

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    listRef.current?.scrollToOffset({ offset: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  const create = useCallback(() => {
    requireAuth(() => router.push(`${CREWS_PATH}/new` as Href), { returnTo: CREWS_PATH });
  }, [requireAuth, router]);

  const actions: HeaderAction[] = [
    { icon: 'plus', label: t('list.create'), onPress: create, locked: access.status === 'member' ? access.restriction : null, testID: `${ROUTE}.create` },
  ];
  if (segmentRoot) actions.push(...inbox);

  // R4DQ-05: the grid. The list's padding plus half a grid gutter on each side of a cell makes every gap the grid gutter whatever
  // column the masonry puts a card in; past 1200 of content the right padding grows, so the grid never runs wider (09 §6).
  const columns = crewColumns(kind);
  const half = columns > 1 ? space[24] / 2 : 0;
  const capped = Math.max(0, listWidth - 2 * gutter - layout.contentMax);
  const listPadding = useMemo(
    () => ({ paddingBottom: inset, paddingLeft: gutter - half, paddingRight: gutter - half + capped }),
    [capped, gutter, half, inset],
  );
  const columnStyle = useMemo(() => [styles.column, columns === 1 ? styles.narrow : null, { paddingHorizontal: half }], [columns, half, styles.column, styles.narrow]);
  const cellStyle = useMemo(() => [columns > 1 ? styles.gridCard : styles.card, { paddingHorizontal: half }], [columns, half, styles.card, styles.gridCard]);
  const titleStyle = useMemo(() => ({ paddingHorizontal: half }), [half]);
  const loading = qaState === 'loading' || (qaState === 'default' && !list.data && list.isPending && list.fetchStatus !== 'paused');
  const offline = qaState === 'offline' || (!online && !list.data) || (!list.data && list.fetchStatus === 'paused');
  const filtered = query !== null || bundesland !== null;

  let state: ReactNode = null;
  let skeleton = false;
  if (!flag && qaState === 'default') {
    state = <EmptyState icon="users" title={t('list.unavailableTitle')} body={t('list.unavailableBody')} testID={`${ROUTE}.unavailable`} />;
  } else if (loading) {
    skeleton = true;
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={columns > 1 ? styles.skeletonGrid : styles.skeleton}>
          {Array.from({ length: Math.max(SKELETON_CARDS, columns) }, (_, index) => (
            <CrewCardSkeleton key={index} style={columns > 1 ? styles.skeletonCell : undefined} />
          ))}
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || (offline && !list.data) || (!list.data && list.isError)) {
    const isOffline = qaState === 'offline' || (qaState !== 'error' && offline);
    state = (
      <ErrorState
        title={isOffline ? t('states.offlineTitle') : t('list.errorTitle')}
        message={isOffline ? t('states.offlineBody') : undefined}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        testID={`${ROUTE}.${isOffline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    state = filtered ? (
      <EmptyState
        preview={<CrewCardView crew={sampleCrew(t)} inert testID={`${ROUTE}.emptyFiltered.sample`} />}
        title={t('list.emptyFilteredTitle')}
        body={t('list.emptyFilteredBody')}
        action={{ label: t('list.resetFilters'), onPress: reset, variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.emptyFiltered`}
      />
    ) : (
      <EmptyState
        preview={<CrewCardView crew={sampleCrew(t)} inert testID={`${ROUTE}.empty.sample`} />}
        title={t('list.emptyTitle')}
        body={t('list.emptyBody')}
        action={{ label: t('list.create'), onPress: create, variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const regionLabel = bundesland ? bundeslandLabel(t, bundesland) : t('list.allRegions');
  const chipRow = (
    <>
      <Chip
        label={t('list.sortValue', { sort: t(`sort.${sort}`) })}
        icon="sort-ascending"
        opensSheet
        accessibilityLabel={`${t('list.sortLabel')}: ${t(`sort.${sort}`)}`}
        onPress={() => setSheet('sort')}
        testID={`${ROUTE}.sort`}
      />
      <Chip
        label={regionLabel}
        icon="map-pin"
        opensSheet
        selected={bundesland !== null}
        accessibilityLabel={`${t('list.regionLabel')}: ${regionLabel}`}
        onPress={() => setSheet('region')}
        testID={`${ROUTE}.region`}
      />
    </>
  );

  const pageTitle = segmentRoot && !inSidebar ? tabs('tabs.discover') : t('title');
  const searchShort = typedShort ? (
    <Text variant="caption" color="text.secondary" testID={`${ROUTE}.searchShort`}>
      {t('list.searchShort', { min: CREW_LIMITS.queryMin })}
    </Text>
  ) : null;
  const search = (
    <View style={[styles.intro, columns > 1 ? styles.search : null]}>
      <SearchBar
        value={text}
        onChangeText={(next) => {
          setText(next);
          updateAddress({ q: crewQueryOf(next) });
        }}
        onCancel={() => {
          setText('');
          updateAddress({ q: null });
        }}
        placeholder={t('list.search')}
        maxLength={CREW_LIMITS.queryMax}
        autoCorrect={false}
        testID={`${ROUTE}.search`}
      />
      {columns > 1 ? null : searchShort}
    </View>
  );
  const controls = (
    <View style={styles.controls}>
      {segmentRoot ? <DiscoverSegmentBar current="crews" testID={`${ROUTE}.segments`} /> : null}
      {/* R4DQ-17: the way to the own crews is a navigation row with chevron and count, never a header over the list below. */}
      {access.status === 'member' ? (
        <RowGroup style={styles.mine}>
          <CrewsProfileEntry routeId={ROUTE} testID={`${ROUTE}.mine`} />
        </RowGroup>
      ) : null}
      {kind !== 'phone' ? (
        <View style={styles.filterRow}>
          {search}
          <View style={[styles.chips, styles.chipsWrap]} testID={`${ROUTE}.chips`}>
            {chipRow}
          </View>
        </View>
      ) : (
        <>
          {search}
          <SegmentRailScrollView
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -gutter }}
            contentContainerStyle={[styles.chips, { paddingHorizontal: gutter }]}
            testID={`${ROUTE}.chips`}
          >
            {chipRow}
          </SegmentRailScrollView>
        </>
      )}
      {columns > 1 ? searchShort : null}
      {access.status === 'member' && access.restriction && qaState === 'restricted' ? (
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.restricted`}>
          {access.restriction}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        title={pageTitle}
        scroll={header}
        onBack={segmentRoot ? undefined : back}
        actions={actions}
        contentMaxWidth={kind === 'desktop' ? layout.contentMax + 2 * gutter : undefined}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('states.offlineBanner')} />
      <SegmentSwipe current="crews" enabled={segmentRoot} testID={`${ROUTE}.swipe`}>
        <View style={styles.list} onLayout={(event: LayoutChangeEvent) => setListWidth(event.nativeEvent.layout.width)}>
        <CollapsingFlashList
          ref={listRef}
          {...header.scrollProps}
          key={`columns-${columns}`}
          data={state ? [] : rows}
          numColumns={columns}
          masonry={columns > 1}
          keyExtractor={(crew: CrewCard) => crew.id}
          renderItem={({ item }: { item: CrewCard }) => (
            <View style={cellStyle}>
              <CrewCardView crew={item} onPress={() => router.push(crewPath(item.slug) as Href)} testID={`${ROUTE}.crew.${item.slug}`} />
            </View>
          )}
          style={styles.list}
          contentContainerStyle={listPadding}
          ListHeaderComponent={
            <View>
              <HeaderLargeTitle title={pageTitle} scroll={header} style={titleStyle} testID={`${ROUTE}.title`} />
              <View style={columnStyle}>{controls}</View>
            </View>
          }
          ListEmptyComponent={state ? <View style={[columnStyle, skeleton ? null : [styles.state, styles.narrow]]}>{state}</View> : null}
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <View style={[columnStyle, styles.more]}>
                <Spinner label={t('list.more')} testID={`${ROUTE}.more`} />
              </View>
            ) : null
          }
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage && !list.isError) void list.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          testID={`${ROUTE}.list`}
        />
        </View>
      </SegmentSwipe>
      <Sheet visible={sheet === 'sort'} onClose={() => setSheet(null)} title={t('list.sortSheet')} expandable={false} narrow testID={`${ROUTE}.sortSheet`}>
        <View role="radiogroup" aria-label={t('list.sortSheet')}>
          {CREW_SORTS.map((option, index) => (
            <OptionRow
              key={option}
              label={t(`sort.${option}`)}
              role="radio"
              selected={option === sort}
              onPress={() => chooseSort(option)}
              divider={index < CREW_SORTS.length - 1}
              testID={`${ROUTE}.sortSheet.${option}`}
            />
          ))}
        </View>
      </Sheet>
      <Sheet visible={sheet === 'region'} onClose={() => setSheet(null)} title={t('list.regionSheet')} narrow testID={`${ROUTE}.regionSheet`}>
        <View role="radiogroup" aria-label={t('list.regionSheet')}>
          <OptionRow label={t('list.allRegions')} role="radio" selected={bundesland === null} onPress={() => chooseRegion(null)} divider testID={`${ROUTE}.regionSheet.all`} />
          {BUNDESLAENDER.map((code, index) => (
            <OptionRow
              key={code}
              label={bundeslandLabel(t, code)}
              role="radio"
              selected={code === bundesland}
              onPress={() => chooseRegion(code)}
              divider={index < BUNDESLAENDER.length - 1}
              testID={`${ROUTE}.regionSheet.${code}`}
            />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
