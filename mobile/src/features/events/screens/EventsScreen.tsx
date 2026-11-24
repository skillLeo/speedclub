import '@/features/events/i18n';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import type { FlashListRef } from '@shopify/flash-list';

import { useFlag } from '@/api/queries/appConfig';
import {
  afterWeek,
  DEFAULT_FILTERS,
  EVENT_LIMITS,
  EVENT_QUERY_MAX,
  EVENTS_FLAG,
  flattenEvents,
  useEvent,
  useEventList,
  useEventPins,
  useMayOrganise,
  useUpcomingAfterWeek,
  type Bbox,
  type EventCard,
  type EventFilters,
  type EventType,
  type EventWhen,
  weekWindowEnd,
} from '@/api/queries/events';
import { DiscoverSegmentBar, SegmentSwipe } from '@/features/discover/components/DiscoverSegments';
import { useIsSegmentRoot, useSegmentsInSidebar } from '@/features/discover/segments';
import { useDebouncedValue } from '@/features/discover/useDebouncedValue';
import { SpotLayerToggle } from '@/features/dex/components/SpotLayerToggle';
import { qaDexActive } from '@/features/dex/qaDex';
import { useSpotLayer } from '@/features/dex/spotMap';
import { useInboxActions } from '@/features/shell/inboxActions';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth } from '@/state/session';
import { createStyles, layout, space, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { EventCardSkeleton } from '@/ui/EventCard';
import { Header, HeaderLargeTitle, type HeaderAction } from '@/ui/Header';
import { IconButton } from '@/ui/IconButton';
import { Screen } from '@/ui/Screen';
import { SearchBar } from '@/ui/SearchBar';
import { Skeleton, SkeletonText } from '@/ui/Skeleton';
import { Spinner } from '@/ui/Spinner';
import { Text } from '@/ui/Text';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { useOrganiserRestriction } from '../access';
import { EventCardView } from '../components/EventCardView';
import { EventFilterBar } from '../components/EventFilters';
import { RestrictionLine } from '../components/EventParts';
import { EventMap } from '../map/EventMap';
import { grantMapConsent } from '../map/mapConsent';
import { CITY_ZOOM, COUNTRY_ZOOM, type MapPin } from '../map/mapConfig';
import {
  berlinDayKey,
  dateBlock,
  editorPath,
  groupByDayHeaders,
  groupByWeek,
  headerIndices,
  parseInstant,
  sampleEvent,
  type EventListRow,
} from '../model';

const ROUTE = 'EVT-01';
const EDGES: readonly Edge[] = ['left', 'right'];
type View_ = 'list' | 'map';
type Row = EventListRow<EventCard>;

const WHEN_PARAMS: readonly EventWhen[] = ['week', 'upcoming', 'today', 'weekend', 'month'];
/** The list follows the search field once typing pauses this long (as DISC-02's facets). */
const SEARCH_DEBOUNCE_MS = 300;
const TYPE_PARAMS: readonly EventType[] = ['meet', 'cruise', 'track_day', 'show'];

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  columnSplit: { maxWidth: '100%' },
  controls: { gap: t.space[16], paddingBottom: t.space[16] },
  // DQ-M52-05: the search and the Liste/Karte toggle share one row.
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  searchField: { flex: 1, minWidth: 0 },
  // M5.6: the day header sticks under the header while its cards scroll, on the canvas so no card shows through.
  day: { backgroundColor: t.color.bg.canvas, paddingBottom: t.space[12], paddingTop: t.space[16] },
  dayLine: { alignItems: 'baseline', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap' },
  later: { alignItems: 'flex-start', paddingBottom: t.space[24], paddingTop: t.space[8] },
  card: { paddingBottom: t.space[24] },
  state: { paddingTop: t.space[16] },
  more: { alignItems: 'flex-start', minHeight: t.size.touchMin, paddingVertical: t.space[8] },
  mapBody: { flex: 1, gap: t.space[12] },
  mapCard: { paddingBottom: t.space[16] },
  hint: { paddingBottom: t.space[8] },
  // DQ-1114: from 1280 the list (7 of 12 columns) beside the map panel (5), which waits for the reader's tap (ADR-449).
  split: {
    alignSelf: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: t.space[24],
    maxWidth: layout.contentMax + 2 * t.space[24],
    width: '100%',
  },
  splitList: { flex: 7, minWidth: 0 },
  splitMap: { flex: 5, minWidth: 0, paddingTop: t.space[16] },
  skeleton: { gap: t.space[24], paddingTop: t.space[16] },
}));

function filtersFrom(params: { when?: string | string[]; type?: string | string[] }): EventFilters {
  const when = paramOf(params.when);
  const type = paramOf(params.type);
  return {
    ...DEFAULT_FILTERS,
    when: WHEN_PARAMS.includes(when as EventWhen) ? (when as EventWhen) : DEFAULT_FILTERS.when,
    type: TYPE_PARAMS.includes(type as EventType) ? (type as EventType) : null,
  };
}

/** The typed words as `q`: trimmed, inner runs of space collapsed; empty = no search. */
export function eventQueryOf(text: string): string | null {
  const q = text.trim().replace(/\s+/g, ' ').slice(0, EVENT_QUERY_MAX);
  return q === '' ? null : q;
}

/**
 * EVT-01 Treffen `/events` (09 §7.10): segmented Liste · Karte, the filter chips, EventCards grouped by spans of time (DQ-1113: Heute ·
 * Morgen · Dieses Wochenende · Nächste Woche · Dezember; the first card with its cover), the map with clustered area pins (never the
 * exact place, ADR-437 c) and the selected event's card under it, and "+" (Treffen erstellen) when allowed. From 1280 the list and the
 * map panel stand side by side (DQ-1114) and the chips wrap (DQ-1119 c). Empty: the badged sample event, "Gerade keine Treffen in
 * deiner Nähe." and "Region ändern".
 *
 * M5.2 (10 §1): EVT-01 is also Entdecken › Treffen. As a segment page of the Entdecken stack (useIsSegmentRoot) it carries the tab's
 * title "Entdecken", the segmented control Builds · Treffen · Forum, the bell and Nachrichten, no back, and the list swipes to the
 * neighbouring segment; pushed anywhere else (Start's "Nächste Treffen", a push) it is the page "Treffen" with back. Either way it
 * has its own search (`q`: title and city).
 *
 * M5.6 (10 §4): the default view is "Diese Woche", the next seven Berlin days, one sticky header per day (Heute · Morgen · Mittwoch,
 * each with its date); the chips Diese Woche · Heute · Wochenende · Monat · Entfernung · Art are one row, the chosen time chip again
 * shows every coming event (grouped by spans of time as before). After the week, or when the week is empty but later meets exist,
 * "Alle kommenden Treffen" opens the rest.
 */
export function EventsScreen() {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string; when?: string; type?: string }>();
  const qaState = useQaState();
  const online = useOnline();
  const motion = useMotionPreference();
  const format = useFormat();
  const flag = useFlag(EVENTS_FLAG);
  const mayOrganise = useMayOrganise();
  const restriction = useOrganiserRestriction();
  const requireAuth = useRequireAuth();
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const back = useBack('/discover');
  const segmentRoot = useIsSegmentRoot();
  // DQ-M52-03: from 1280 the sidebar lists Treffen itself, so the page is "Treffen" there, without the segmented control.
  const inSidebar = useSegmentsInSidebar();
  const inbox = useInboxActions(ROUTE);
  const tabs = useTranslation('common').t;
  const [text, setText] = useState('');
  const query = useDebouncedValue(eventQueryOf(text), SEARCH_DEBOUNCE_MS);
  const { gutter, kind, width } = useBreakpoint();
  const split = kind === 'desktop';
  const [listWidth, setListWidth] = useState<number | null>(null);
  // DQ-P5-014: one width for the search, the chips, the cards and their buttons. From 1280 the column is the list's 7 of 12 columns
  // (no feed cap, so nothing ends short of the map); below, the feed column. The width between the gutters is what a cover is cut to.
  const columnMax = split ? Number.POSITIVE_INFINITY : layout.feedColumn;
  const columnWidth = Math.min(columnMax, listWidth ?? width) - 2 * gutter;
  const [view, setView] = useState<View_>(paramOf(params.view) === 'map' ? 'map' : 'list');
  const [filters, setFilters] = useState<EventFilters>(() => filtersFrom(params));
  const [nearLabel, setNearLabel] = useState<string | null>(null);
  const [nearOpen, setNearOpen] = useState(false);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapHeight, setMapHeight] = useState(0);
  const [mapFailed, setMapFailed] = useState(false);
  const listRef = useRef<FlashListRef<Row>>(null);

  const searched = useMemo<EventFilters>(() => ({ ...filters, q: query }), [filters, query]);
  const list = useEventList(
    searched,
    qaState === 'default' || qaState === 'offline' || qaState === 'restricted',
  );
  const mapShown = view === 'map' || split;
  const pinsQuery = useEventPins(searched, bbox, mapShown && qaState === 'default' && bbox !== null);
  const week = filters.when === 'week';
  // M5.6 "Diese Woche": the next seven Berlin days, asked as `when=week`. Whether meets follow it comes from the first page of
  // `upcoming` (afterWeek). Stable within a Berlin day (noon of today's key is always that day); after midnight the window moves on.
  const today = berlinDayKey(now());
  const windowEnd = useMemo(() => weekWindowEnd(new Date(`${today}T12:00:00Z`)), [today]);
  const events = useMemo(
    () => (qaState === 'empty' ? [] : flattenEvents(list.data?.pages)),
    [list.data?.pages, qaState],
  );
  const pins = useMemo(() => pinsQuery.data ?? [], [pinsQuery.data]);
  const upcoming = useUpcomingAfterWeek(searched, week && (qaState === 'default' || qaState === 'offline' || qaState === 'restricted'));
  const after = useMemo(
    () => afterWeek(qaState === 'empty' ? [] : (upcoming.data?.data ?? []), Boolean(upcoming.data?.meta.next_cursor), windowEnd),
    [qaState, upcoming.data, windowEnd],
  );
  /** Events after the week exist: the end of the list (or an empty week) offers "Alle kommenden Treffen". */
  const later = week && after.exists;
  const rows = useMemo<Row[]>(
    () =>
      filters.when === 'upcoming'
        ? groupByWeek(events, now(), format.locale, t)
        : groupByDayHeaders(events, now(), format.locale, t),
    [events, filters.when, format.locale, t],
  );
  const sticky = useMemo(() => headerIndices(rows), [rows]);
  const filtered =
    (filters.when !== 'week' && filters.when !== 'upcoming') ||
    filters.type !== null ||
    filters.near !== null ||
    query !== null;
  const showAll = () => {
    haptics.selection();
    setSelected(null);
    setFilters((current) => ({ ...current, when: 'upcoming' }));
  };

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    listRef.current?.scrollToOffset({ offset: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  const create = useCallback(() => {
    requireAuth(() => router.push(editorPath('new')), { returnTo: '/events' });
  }, [requireAuth, router]);

  const actions: HeaderAction[] = [];
  if (mayOrganise || qaState === 'restricted') {
    actions.push({
      icon: 'plus',
      label: t('list.create'),
      onPress: create,
      locked: restriction,
      testID: `${ROUTE}.create`,
    });
  }
  // 10 §1: Treffen in Entdecken carries the tab's bell and Nachrichten, after "+".
  if (segmentRoot) actions.push(...inbox);

  const columnStyle = useMemo(
    () => [styles.column, split ? styles.columnSplit : null, { paddingHorizontal: gutter }],
    [gutter, split, styles.column, styles.columnSplit],
  );
  const pending = list.isPending && list.fetchStatus !== 'paused';
  const loading = qaState === 'loading' || (qaState === 'default' && !list.data && pending);
  const offline =
    qaState === 'offline' || (!online && !list.data) || (!list.data && list.fetchStatus === 'paused');

  let state: ReactNode = null;
  /** DQ-P5-014: a state that keeps the map panel beside it from 1280 (loading, an empty week, no meets): the page keeps its two columns. */
  let mapBesideState = false;
  if (!flag && qaState === 'default') {
    state = (
      <EmptyState
        icon="meet"
        title={t('list.unavailableTitle')}
        body={t('list.unavailableBody')}
        testID={`${ROUTE}.unavailable`}
      />
    );
  } else if (loading) {
    mapBesideState = true;
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={styles.skeleton}>
          <SkeletonText variant="calloutStrong" width="25%" />
          <EventCardSkeleton cover />
          <EventCardSkeleton />
          <EventCardSkeleton />
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || (offline && !list.data) || (!list.data && list.isError)) {
    const isOffline = qaState === 'offline' || (qaState !== 'error' && offline);
    state = (
      <ErrorState
        title={isOffline ? t('list.offlineTitle') : t('list.errorTitle')}
        message={isOffline ? t('list.offlineBody') : undefined}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        testID={`${ROUTE}.${isOffline ? 'offline' : 'error'}`}
      />
    );
  } else if (events.length === 0 && later) {
    mapBesideState = true;
    // M5.6: nothing this week, but later: the next real meet as the preview (no sample, there is real content), the week's own line
    // and the way to every coming event.
    const next = after.next;
    state = (
      <EmptyState
        preview={next ? <EventCardView event={next} routeId={`${ROUTE}.weekEmpty`} withCover coverWidth={columnWidth} /> : undefined}
        previewPlacement="afterBody"
        title={t('list.weekEmptyTitle')}
        body={t('list.weekEmptyBody')}
        action={{ label: t('list.allUpcoming'), onPress: showAll, variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.weekEmpty`}
      />
    );
  } else if (events.length === 0) {
    mapBesideState = true;
    state = (
      <EmptyState
        preview={<EventCardView event={sampleEvent(now(), t)} routeId={`${ROUTE}.empty`} withCover inert />}
        title={filtered ? t('list.emptyFilteredTitle') : t('list.emptyTitle')}
        body={filtered ? t('list.emptyFilteredBody') : t('list.emptyBody')}
        action={
          filtered
            ? {
                label: t('list.resetFilters'),
                onPress: () => {
                  setFilters(DEFAULT_FILTERS);
                  setText('');
                },
                variant: 'secondary',
                size: 'm',
              }
            : {
                label: t('list.changeRegion'),
                onPress: () => setNearOpen(true),
                variant: 'secondary',
                size: 'm',
              }
        }
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const changeFilters = (next: EventFilters) => {
    setSelected(null);
    setFilters(next);
  };

  const controls = (
    <View style={styles.controls}>
      {/* Hidden from 1280 by the bar itself, where the sidebar lists Treffen (DQ-M52-03). */}
      {segmentRoot ? <DiscoverSegmentBar current="events" testID={`${ROUTE}.segments`} /> : null}
      <View style={styles.searchRow}>
        <SearchBar
          value={text}
          onChangeText={setText}
          onCancel={() => setText('')}
          placeholder={t('list.search')}
          maxLength={EVENT_QUERY_MAX}
          autoCorrect={false}
          style={styles.searchField}
          testID={`${ROUTE}.search`}
        />
        {/* DQ-M52-05: Liste · Karte as one 44 toggle at the end of the search row, not a second segmented control (none from 1280,
            where the list and the map stand side by side). It names what it opens. */}
        {split ? null : (
          <IconButton
            icon={view === 'map' ? 'list-bullets' : 'map-trifold'}
            label={view === 'map' ? t('list.listView') : t('list.mapView')}
            onPress={() => {
              haptics.selection();
              const next = view === 'map' ? 'list' : 'map';
              // Choosing the map is the reader's consent to its third-party tiles for this session (mapConsent.ts).
              if (next === 'map') grantMapConsent();
              setView(next);
            }}
            testID={`${ROUTE}.view.${view === 'map' ? 'list' : 'map'}`}
          />
        )}
      </View>
      <EventFilterBar
        filters={filters}
        onChange={changeFilters}
        nearLabel={nearLabel}
        onNearLabel={setNearLabel}
        sheetOpen={nearOpen}
        onSheetOpen={setNearOpen}
        bleed={kind === 'phone' ? gutter : 0}
        wrap={kind !== 'phone'}
        routeId={ROUTE}
      />
      {restriction && qaState === 'restricted' ? (
        <RestrictionLine message={restriction} testID={`${ROUTE}.restricted`} />
      ) : null}
    </View>
  );

  const renderItem = ({ item, index }: { item: Row; index: number }) => {
    if (item.kind === 'day') {
      return (
        <View style={styles.day}>
          <View
            style={[columnStyle, styles.dayLine]}
            role="heading"
            aria-level={2}
            aria-label={item.accessibilityLabel ?? item.label}
            testID={`${ROUTE}.${item.key}`}
          >
            <Text variant="calloutStrong" color={item.date ? 'text.primary' : 'text.secondary'} aria-hidden={Boolean(item.date)}>
              {item.label}
            </Text>
            {item.date ? (
              <Text variant="callout" color="text.secondary" numeric aria-hidden testID={`${ROUTE}.${item.key}.date`}>
                {item.date}
              </Text>
            ) : null}
          </View>
        </View>
      );
    }
    return (
      <View style={[columnStyle, styles.card]}>
        <EventCardView event={item.event} routeId={ROUTE} withCover={index === 1} coverWidth={columnWidth} />
      </View>
    );
  };

  const title = segmentRoot && !inSidebar ? tabs('tabs.discover') : t('title');
  const listView = (
    <CollapsingFlashList
      ref={listRef}
      {...header.scrollProps}
      data={state ? [] : rows}
      keyExtractor={(row: Row) => row.key}
      getItemType={(row: Row, index: number) =>
        row.kind === 'day' ? 'day' : index === 1 ? 'cover' : 'event'
      }
      renderItem={renderItem}
      // M5.6 (10 §4): the day headers stick while their cards scroll (FlashList's own sticky headers, drawn over the list).
      stickyHeaderIndices={state ? undefined : sticky}
      style={styles.list}
      contentContainerStyle={{ paddingBottom: inset }}
      ListHeaderComponent={
        <View>
          <HeaderLargeTitle title={title} scroll={header} testID={`${ROUTE}.title`} />
          <View style={columnStyle}>{controls}</View>
        </View>
      }
      ListEmptyComponent={state ? <View style={[columnStyle, styles.state]}>{state}</View> : null}
      ListFooterComponent={
        list.isFetchingNextPage ? (
          <View style={[columnStyle, styles.more]}>
            <Spinner label={t('list.more')} testID={`${ROUTE}.more`} />
          </View>
        ) : later && !state ? (
          <View style={[columnStyle, styles.later]}>
            <Button
              label={t('list.allUpcoming')}
              variant="secondary"
              size="m"
              onPress={showAll}
              testID={`${ROUTE}.allUpcoming`}
            />
          </View>
        ) : null
      }
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage && !list.isError) void list.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      testID={`${ROUTE}.list`}
    />
  );
  const mapPane = (
    <MapPane
      filters={filters}
      pins={pins}
      events={events}
      selected={selected}
      onSelect={setSelected}
      onView={setBbox}
      height={mapHeight}
      onLayout={(event) => setMapHeight(Math.round(event.nativeEvent.layout.height))}
      failed={mapFailed}
      onFailed={() => setMapFailed(true)}
      onOpenList={split ? undefined : () => setView('list')}
      columnStyle={split ? null : columnStyle}
      corner={split ? 'md' : 'none'}
    />
  );

  let body: ReactNode;
  if (split) {
    body = (
      <View style={[styles.split, { paddingRight: gutter }]}>
        <View
          style={styles.splitList}
          onLayout={(event) => setListWidth(Math.round(event.nativeEvent.layout.width))}
        >
          {listView}
        </View>
        {state && !mapBesideState ? null : <View style={[styles.splitMap, { paddingBottom: inset }]}>{mapPane}</View>}
      </View>
    );
  } else if (view === 'list' || state) {
    body = listView;
  } else {
    // DQ-M52-06: the large title stays in the map view too, so the band under it holds its place when the view changes.
    body = (
      <View style={[styles.mapBody, { paddingBottom: inset }]}>
        <View>
          <HeaderLargeTitle title={title} scroll={header} testID={`${ROUTE}.title`} />
          <View style={columnStyle}>{controls}</View>
        </View>
        {mapPane}
      </View>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        title={title}
        scroll={header}
        onBack={segmentRoot ? undefined : back}
        actions={actions}
        // DQ-M52-14: from 1280 the actions end with the list and map, not at the far edge of the pane.
        contentMaxWidth={split ? layout.contentMax + 2 * space[24] : undefined}
        contentAlign="center"
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('list.offlineBanner')} />
      {/* SF-4: always the same tree; only `enabled` changes, so the list and the map never remount when the page becomes a segment.
          The map takes horizontal drags itself, so only the list turns the page. */}
      <SegmentSwipe current="events" enabled={segmentRoot && (view === 'list' || Boolean(state))} testID={`${ROUTE}.swipe`}>
        {body}
      </SegmentSwipe>
    </Screen>
  );
}

function MapPane({
  filters,
  pins,
  events,
  selected,
  onSelect,
  onView,
  height,
  onLayout,
  failed,
  onFailed,
  onOpenList,
  columnStyle,
  corner = 'none',
}: {
  filters: EventFilters;
  pins: readonly {
    id: string;
    slug: string;
    title: string;
    starts_at: string | null;
    lat: number;
    lng: number;
  }[];
  events: readonly EventCard[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onView: (bbox: Bbox) => void;
  height: number;
  onLayout: (event: LayoutChangeEvent) => void;
  failed: boolean;
  onFailed: () => void;
  /** Phones and tablets: back to the list when the map cannot load. Beside the list (desktop) there is nothing to go back to. */
  onOpenList?: () => void;
  columnStyle: StyleProp<ViewStyle>;
  corner?: 'none' | 'md';
}) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const format = useFormat();
  const mapPins = useMemo<MapPin[]>(
    () =>
      pins.map((pin) => {
        const start = parseInstant(pin.starts_at);
        const block = start ? dateBlock(start, format.locale) : null;
        return {
          id: pin.id,
          lat: pin.lat,
          lng: pin.lng,
          title: pin.title,
          label: block ? `${block.weekday} ${block.day}.` : '',
        };
      }),
    [format.locale, pins],
  );
  const pin = selected ? pins.find((entry) => entry.id === selected) : undefined;
  const fromList = pin ? events.find((event) => event.id === pin.id) : undefined;
  const detail = useEvent(pin && !fromList ? pin.slug : '');
  const card = fromList ?? detail.data;
  const center = filters.near ? { lat: filters.near.lat, lng: filters.near.lng } : null;
  const capped = pins.length >= EVENT_LIMITS.pinsMax;
  // DQ-1119 a: the hint speaks of points on the map, so it waits until the map has loaded (never under the consent gate).
  const [ready, setReady] = useState(false);
  // M5.9b: the "Spots" layer, off until the reader turns it on (`qaDex` turns it on for the visual matrix, which cannot tap).
  const [spotsOn, setSpotsOn] = useState(qaDexActive);
  const spotLayer = useSpotLayer(spotsOn);
  return (
    <View style={styles.mapBody}>
      <View style={styles.mapBody} onLayout={onLayout}>
        {height > 0 ? (
          <EventMap
            mode="pins"
            height={height}
            center={center}
            zoom={center ? CITY_ZOOM - 3 : COUNTRY_ZOOM}
            pins={mapPins}
            areas={spotLayer.areas}
            selectedId={selected}
            label={t('map.regionLabel')}
            onSelect={(id) => {
              if (id) haptics.selection();
              onSelect(id);
            }}
            onView={(bbox) => onView(bbox)}
            onUnavailable={onFailed}
            onReady={() => setReady(true)}
            corner={corner}
            testID={`${ROUTE}.map`}
          />
        ) : null}
      </View>
      <View style={[columnStyle, styles.mapCard]}>
        {failed || !ready ? null : <SpotLayerToggle on={spotsOn} onChange={setSpotsOn} failed={spotLayer.failed} testID={`${ROUTE}.map.spots`} />}
        {failed ? (
          onOpenList ? (
            <Button
              label={t('list.openList')}
              variant="secondary"
              size="m"
              onPress={onOpenList}
              testID={`${ROUTE}.map.toList`}
            />
          ) : null
        ) : card ? (
          <EventCardView event={card} routeId={`${ROUTE}.map`} />
        ) : ready ? (
          <Text variant="callout" color="text.secondary" style={styles.hint} testID={`${ROUTE}.map.hint`}>
            {capped ? t('list.pinsCapped') : t('list.selectedHint')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
