import '@/features/events/i18n';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import type { FlashListRef } from '@shopify/flash-list';

import { useFlag } from '@/api/queries/appConfig';
import {
  DEFAULT_FILTERS,
  EVENT_LIMITS,
  EVENTS_FLAG,
  flattenEvents,
  useEvent,
  useEventList,
  useEventPins,
  useMayOrganise,
  type Bbox,
  type EventCard,
  type EventFilters,
  type EventType,
  type EventWhen,
} from '@/api/queries/events';
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
import { createStyles, layout, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import {
  Button,
  CollapsingFlashList,
  EmptyState,
  ErrorState,
  EventCardSkeleton,
  Header,
  HeaderLargeTitle,
  Screen,
  SegmentedControl,
  Skeleton,
  SkeletonText,
  Spinner,
  Text,
  useCollapsingHeader,
  type HeaderAction,
} from '@/ui';

import { useOrganiserRestriction } from '../access';
import { EventCardView } from '../components/EventCardView';
import { EventFilterBar } from '../components/EventFilters';
import { RestrictionLine } from '../components/EventParts';
import { EventMap } from '../map/EventMap';
import { grantMapConsent } from '../map/mapConsent';
import { CITY_ZOOM, COUNTRY_ZOOM, type MapPin } from '../map/mapConfig';
import { dateBlock, editorPath, groupByWeek, parseInstant, sampleEvent, type EventListRow } from '../model';

const ROUTE = 'EVT-01';
const EDGES: readonly Edge[] = ['left', 'right'];
type View_ = 'list' | 'map';
type Row = EventListRow<EventCard>;

const WHEN_PARAMS: readonly EventWhen[] = ['upcoming', 'today', 'weekend', 'month'];
const TYPE_PARAMS: readonly EventType[] = ['meet', 'cruise', 'track_day', 'show'];

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  controls: { gap: t.space[16], paddingBottom: t.space[16] },
  day: { paddingBottom: t.space[12], paddingTop: t.space[16] },
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
    when: WHEN_PARAMS.includes(when as EventWhen) ? (when as EventWhen) : 'upcoming',
    type: TYPE_PARAMS.includes(type as EventType) ? (type as EventType) : null,
  };
}

/**
 * EVT-01 Treffen `/events` (09 §7.10): segmented Liste · Karte, the filter chips, EventCards grouped by spans of time (DQ-1113: Heute ·
 * Morgen · Dieses Wochenende · Nächste Woche · Dezember; the first card with its cover), the map with clustered area pins (never the
 * exact place, ADR-437 c) and the selected event's card under it, and "+" (Treffen erstellen) when allowed. From 1280 the list and the
 * map panel stand side by side (DQ-1114) and the chips wrap (DQ-1119 c). Empty: the badged sample event, "Gerade keine Treffen in
 * deiner Nähe." and "Region ändern".
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
  const { gutter, kind, width } = useBreakpoint();
  const split = kind === 'desktop';
  const [listWidth, setListWidth] = useState<number | null>(null);
  const columnWidth = Math.min(layout.feedColumn, (listWidth ?? width) - 2 * gutter);
  const [view, setView] = useState<View_>(paramOf(params.view) === 'map' ? 'map' : 'list');
  const [filters, setFilters] = useState<EventFilters>(() => filtersFrom(params));
  const [nearLabel, setNearLabel] = useState<string | null>(null);
  const [nearOpen, setNearOpen] = useState(false);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapHeight, setMapHeight] = useState(0);
  const [mapFailed, setMapFailed] = useState(false);
  const listRef = useRef<FlashListRef<Row>>(null);

  const list = useEventList(
    filters,
    qaState === 'default' || qaState === 'offline' || qaState === 'restricted',
  );
  const mapShown = view === 'map' || split;
  const pins = useEventPins(filters, bbox, mapShown && qaState === 'default' && bbox !== null);
  const events = useMemo(
    () => (qaState === 'empty' ? [] : flattenEvents(list.data?.pages)),
    [list.data?.pages, qaState],
  );
  const rows = useMemo<Row[]>(() => groupByWeek(events, now(), format.locale, t), [events, format.locale, t]);
  const filtered = filters.when !== 'upcoming' || filters.type !== null || filters.near !== null;

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

  const columnStyle = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);
  const pending = list.isPending && list.fetchStatus !== 'paused';
  const loading = qaState === 'loading' || (qaState === 'default' && !list.data && pending);
  const offline =
    qaState === 'offline' || (!online && !list.data) || (!list.data && list.fetchStatus === 'paused');

  let state: ReactNode = null;
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
  } else if (events.length === 0) {
    state = (
      <EmptyState
        preview={<EventCardView event={sampleEvent(now(), t)} routeId={`${ROUTE}.empty`} withCover inert />}
        title={filtered ? t('list.emptyFilteredTitle') : t('list.emptyTitle')}
        body={filtered ? t('list.emptyFilteredBody') : t('list.emptyBody')}
        action={
          filtered
            ? {
                label: t('list.resetFilters'),
                onPress: () => setFilters(DEFAULT_FILTERS),
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
      {split ? null : (
        <SegmentedControl<View_>
          options={[
            { value: 'list', label: t('list.listView'), testID: `${ROUTE}.view.list` },
            { value: 'map', label: t('list.mapView'), testID: `${ROUTE}.view.map` },
          ]}
          value={view}
          onChange={(next) => {
            haptics.selection();
            // Choosing the map is the reader's consent to its third-party tiles for this session (mapConsent.ts).
            if (next === 'map') grantMapConsent();
            setView(next);
          }}
          label={t('list.segments')}
          role="tablist"
          testID={`${ROUTE}.view`}
        />
      )}
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
        <View style={[columnStyle, styles.day]}>
          <Text
            variant="calloutStrong"
            color="text.secondary"
            role="heading"
            aria-level={2}
            testID={`${ROUTE}.${item.key}`}
          >
            {item.label}
          </Text>
        </View>
      );
    }
    return (
      <View style={[columnStyle, styles.card]}>
        <EventCardView event={item.event} routeId={ROUTE} withCover={index === 1} coverWidth={columnWidth} />
      </View>
    );
  };

  const title = t('title');
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
      pins={pins.data ?? []}
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
        {state ? null : <View style={[styles.splitMap, { paddingBottom: inset }]}>{mapPane}</View>}
      </View>
    );
  } else if (view === 'list' || state) {
    body = listView;
  } else {
    body = (
      <View style={[styles.mapBody, { paddingBottom: inset }]}>
        <View style={columnStyle}>{controls}</View>
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
        onBack={back}
        actions={actions}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('list.offlineBanner')} />
      {body}
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
