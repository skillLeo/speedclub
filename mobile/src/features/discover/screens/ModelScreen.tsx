import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { canonicalMove, useModelBuilds, useModelPage, useWheelSetups } from '@/api/queries/discover';
import type { FeedVehicle } from '@/api/queries/home';
import { mergeResults } from '@/api/queries/search';
import { BrowseErrorState, RestrictionNotice, useBrowseRestriction } from '@/features/home/components/BrowseStates';
import { FeedVehicleCard, FeedVehicleCardSkeleton } from '@/features/home/components/FeedVehicleCard';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, layout, size, space, useBreakpoint, useTheme } from '@/theme';
import { Button, Chip, CollapsingFlashList, EmptyState, Header, Screen, SegmentedControl, Skeleton, SkeletonBlock, SkeletonText, Spinner, Text, useCollapsingHeader } from '@/ui';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { rememberLabel } from '../chipLabels';
import { WheelSetupCard, WheelSetupCardSkeleton, WheelSetupTable, wheelTableFits, type WheelTableRow } from '../components/WheelSetupTable';
import { useDiscoverColumn } from '../layout';
import { wheelTableRow } from '../wheelRows';
import { generationYears } from './MakeScreen';

const ROUTE = 'DISC-04';

/** Two cards to a row: the last row may hold one. */
function pairsOf<T>(items: readonly T[]): T[][] {
  const pairs: T[][] = [];
  for (let index = 0; index < items.length; index += 2) pairs.push(items.slice(index, index + 2));
  return pairs;
}
const EDGES: readonly Edge[] = ['left', 'right'];
const SKELETON_TABLE_ROWS = 3;
/** Cards while the set-ups load: two on a phone, two pairs above. */
const SKELETON_CARDS = 2;

export type ModelSegment = 'builds' | 'wheels';

type Row =
  | { kind: 'vehicle'; vehicle: FeedVehicle }
  | { kind: 'setup'; row: WheelTableRow }
  | { kind: 'setupPair'; rows: readonly WheelTableRow[] }
  | { kind: 'table'; rows: readonly WheelTableRow[] };

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  head: { gap: t.space[4], paddingTop: t.space[16] },
  count: { fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: t.space[8] },
  chipsScroll: { marginTop: t.space[16] },
  segments: { marginBottom: t.space[24], marginTop: t.space[16] },
  cardGap: { paddingBottom: t.space[24] },
  states: { paddingTop: t.space[8] },
  footer: { alignItems: 'flex-start', gap: t.space[8], minHeight: t.size.touchMin, paddingBottom: t.space[32], paddingTop: t.space[8] },
  table: { paddingBottom: t.space[16] },
  // DQ-436: from 768 until the table fits, two cards side by side in the column.
  pair: { flexDirection: 'row', gap: t.space[12] },
  pairCell: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  skeleton: { gap: t.space[24] },
}));

/** DQ-327: eyebrow, title and count, the 36 chip row and the 36 segmented control, where the loaded header has them. */
function HeadSkeleton() {
  const styles = useStyles();
  return (
    <>
      <View style={styles.head}>
        <SkeletonText variant="eyebrow" width="20%" />
        <SkeletonText variant="titleL" width="50%" />
        <SkeletonText variant="supporting" width="30%" />
      </View>
      <SkeletonBlock width="60%" height={size.chip} corner="full" style={styles.chipsScroll} />
      <SkeletonBlock width="100%" height={size.segmented} corner="sm" style={styles.segments} />
    </>
  );
}

/**
 * DISC-04 /discover/model/[model] (key `bmw--m4`): generation chips (`?generation=`), the segmented "Builds · Räder-Vergleich"
 * (`?segment=wheels`), the builds as cards and the wheel-setup comparison table (brief §5). A row of the table opens VEH-01.
 */
export function ModelScreen() {
  const { t } = useTranslation('discover');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const online = useOnline();
  const qaState = useQaState();
  const restriction = useBrowseRestriction();
  const back = useBack('/discover');
  const inset = useTabBarInset();
  const column = useDiscoverColumn();
  // DQ-324: the compact title comes in once the page's own title has scrolled away, with the hairline under the bar.
  const header = useCollapsingHeader();
  const collapseOn = (event: LayoutChangeEvent) => header.collapseAt.set(event.nativeEvent.layout.y + event.nativeEvent.layout.height);
  // From 768 the comparison takes the pane, not the 640 column (DQ-323): on the column's start edge, up to the content width.
  const { width: windowWidth } = useBreakpoint();
  const { fontScale } = useTheme();
  const focused = useScreenFocused();
  // The pane beside the rail or the sidebar, as wide as paneStyle lets the table be: measured (code review M2.8 nit 12), and until the
  // first layout the window less the rail or the sidebar, so the first frame already chooses table or cards right.
  const [measuredPane, setMeasuredPane] = useState<number | null>(null);
  const estimatedPane = column.desktop ? windowWidth - layout.sidebar : column.kind === 'tablet' ? windowWidth - layout.rail : windowWidth;
  const pane = measuredPane ?? estimatedPane;
  const measurePane = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) setMeasuredPane(width);
  };
  const showTable = column.kind !== 'phone' && wheelTableFits(Math.min(layout.contentMax, pane) - 2 * column.gutter, fontScale);
  const paneStyle = useMemo(
    () => ({ alignSelf: column.desktop ? ('flex-start' as const) : ('center' as const), maxWidth: layout.contentMax, paddingHorizontal: column.gutter, width: '100%' as const }),
    [column.desktop, column.gutter],
  );
  const params = useLocalSearchParams<{ model?: string | string[]; generation?: string | string[]; segment?: string | string[] }>();
  const key = (paramOf(params.model) ?? '').toLowerCase();
  const asked = paramOf(params.generation)?.toLowerCase() ?? null;
  const segment: ModelSegment = paramOf(params.segment) === 'wheels' ? 'wheels' : 'builds';
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  // qaState=empty shows the real header over an empty segment.
  const pageLive = live || qaState === 'empty';
  const page = useModelPage(pageLive ? key : '');
  const data = pageLive ? page.data : undefined;
  // A generation the model does not have (an old link, a typo) is dropped rather than sent into a 422.
  // M3.3: a merged model's old key lands on its survivor; the route follows, and the segments wait for the survivor's key.
  const moved = canonicalMove(key, data?.model.key);
  const known = asked !== null && data !== undefined && data.generations.some((entry) => entry.slug === asked);
  const generation = known ? asked : null;
  useEffect(() => {
    if (asked !== null && data !== undefined && !known) router.setParams({ generation: undefined });
  }, [asked, data, known, router]);
  useEffect(() => {
    if (moved) router.setParams({ model: moved });
  }, [moved, router]);
  const builds = useModelBuilds(key, generation, null, live && segment === 'builds' && data !== undefined && !moved);
  const wheels = useWheelSetups(key, generation, live && segment === 'wheels' && data !== undefined && !moved);
  const list = segment === 'builds' ? builds : wheels;
  const notFound = page.error instanceof ApiError && page.error.kind === 'not_found';

  useEffect(() => {
    if (!data) return;
    rememberLabel('make', data.make.slug, data.make.name);
    rememberLabel('model', data.model.slug, data.model.name);
    for (const entry of data.generations) rememberLabel('generation', entry.slug, entry.name);
  }, [data]);

  const vehicles = useMemo(() => mergeResults([], builds.data?.pages, (vehicle: FeedVehicle) => vehicle.id), [builds.data]);
  const tableRows = useMemo(
    () =>
      mergeResults([], wheels.data?.pages, (setup) => setup.vehicle.id).map((setup) =>
        wheelTableRow(setup, format.locale, (front, rear) => t('wheelTable.axles', { front, rear })),
      ),
    [format.locale, t, wheels.data],
  );
  const title = data ? `${data.make.name} ${data.model.name}` : '';
  const openVehicle = useCallback((vehicle: { slug: string }) => router.push(`/v/${vehicle.slug}`), [router]);
  const openUpdate = useCallback(
    (vehicle: FeedVehicle) => {
      if (vehicle.latest_update) router.push(`/v/${vehicle.slug}/updates/${vehicle.latest_update.id}`);
    },
    [router],
  );
  const offline = !online || page.fetchStatus === 'paused';

  // The page: not found, loading, failed. Then the segment's own states under the header.
  let pageState: ReactNode = null;
  let loading = false;
  if (notFound) {
    pageState = (
      <EmptyState
        icon="magnifying-glass"
        title={t('model.notFoundTitle')}
        body={t('model.notFoundBody')}
        action={{ label: t('make.back'), onPress: () => router.navigate('/discover') }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else if (qaState === 'loading' || (!data && page.isPending && page.fetchStatus !== 'paused' && pageLive)) {
    loading = true;
  } else if (qaState === 'error' || !data) {
    pageState = (
      <BrowseErrorState
        routeId={ROUTE}
        title={t('model.errorTitle')}
        offline={qaState !== 'error' && offline}
        error={page.error}
        onRetry={() => void page.refetch()}
        retrying={page.isFetching}
      />
    );
  }

  let segmentState: ReactNode = null;
  if (!pageState) {
    const empty = qaState === 'empty' || (list.data !== undefined && (segment === 'builds' ? vehicles.length === 0 : tableRows.length === 0));
    if (loading || (list.isPending && list.fetchStatus !== 'paused' && !empty)) {
      loading = true;
      segmentState =
        segment === 'builds' ? (
          <Skeleton testID={`${ROUTE}.skeleton`}>
            <View style={styles.skeleton}>
              <FeedVehicleCardSkeleton width={column.inner} />
              <FeedVehicleCardSkeleton width={column.inner} latest={false} />
            </View>
          </Skeleton>
        ) : (
          // The same table-or-cards decision as the loaded set-ups (DQ-436): the table block, single cards on a phone, pairs above.
          <Skeleton testID={`${ROUTE}.skeleton`}>
            {showTable ? (
              <SkeletonBlock width="100%" height={(SKELETON_TABLE_ROWS + 1) * (space[48] + space[24])} corner="md" testID={`${ROUTE}.skeleton.table`} />
            ) : column.kind === 'phone' ? (
              <View>
                {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                  <View key={index} style={styles.cardGap}>
                    <WheelSetupCardSkeleton testID={`${ROUTE}.skeleton.card`} />
                  </View>
                ))}
              </View>
            ) : (
              <View>
                {Array.from({ length: SKELETON_CARDS }, (_, row) => (
                  <View key={row} style={[styles.cardGap, styles.pair]}>
                    {[0, 1].map((cell) => (
                      <View key={cell} style={styles.pairCell}>
                        <WheelSetupCardSkeleton testID={`${ROUTE}.skeleton.card`} />
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </Skeleton>
        );
    } else if (empty) {
      segmentState =
        segment === 'builds' ? (
          <EmptyState
            icon="garage"
            title={t('model.buildsEmptyTitle')}
            body={t('model.buildsEmptyBody')}
            action={generation ? { label: t('model.showAllGenerations'), onPress: () => router.setParams({ generation: undefined }) } : undefined}
            testID={`${ROUTE}.empty`}
          />
        ) : (
          <EmptyState icon="magnifying-glass" title={t('model.wheelsEmptyTitle')} body={t('model.wheelsEmptyBody')} testID={`${ROUTE}.wheelsEmpty`} />
        );
    } else if (list.isError && !list.data) {
      segmentState = (
        <BrowseErrorState
          routeId={ROUTE}
          title={segment === 'builds' ? t('model.errorTitle') : t('model.wheelsError')}
          offline={offline}
          error={list.error}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      );
    } else if (!list.data && list.fetchStatus === 'paused') {
      segmentState = <BrowseErrorState routeId={ROUTE} offline error={list.error} onRetry={() => void list.refetch()} retrying={false} />;
    }
  }

  const rows: Row[] =
    pageState || segmentState
      ? []
      : segment === 'builds'
        ? vehicles.map((vehicle) => ({ kind: 'vehicle', vehicle }))
        : // DQ-322/323/436: the table across the pane only where every column fits; cards to read down elsewhere, two abreast
          // from 768.
          showTable
          ? [{ kind: 'table', rows: tableRows }]
          : column.kind === 'phone'
            ? tableRows.map((row) => ({ kind: 'setup', row }))
            : pairsOf(tableRows).map((rows) => ({ kind: 'setupPair', rows }))

  // DQ-331: the generation the page was opened for starts in view, a gutter from the edge.
  const chipsRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrolledTo = useRef<string | null>(null);
  const onActiveChip = (event: LayoutChangeEvent) => {
    if (scrolledTo.current === generation) return;
    scrolledTo.current = generation;
    // x counts from the chips' row, which starts a gutter into the scroll content: this offset leaves that gutter before the chip.
    chipsRef.current?.scrollTo({ x: Math.max(0, event.nativeEvent.layout.x), animated: false });
  };
  const generationChips = data && data.generations.length > 0 ? (
    <ScrollView
      ref={chipsRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.chipsScroll, { marginHorizontal: -column.gutter }]}
      contentContainerStyle={{ paddingHorizontal: column.gutter }}
    >
      <View role="radiogroup" aria-label={t('model.generations')} style={styles.chips}>
        <Chip
          label={t('model.allGenerations')}
          selected={generation === null}
          selectionRole="radio"
          onPress={() => router.setParams({ generation: undefined })}
          testID={`${ROUTE}.generation.all`}
        />
        {data.generations.map((entry) => {
          const years = generationYears(entry.year_from, entry.year_to, (year) => t('make.since', { year }));
          return (
            <View key={entry.slug} onLayout={generation === entry.slug ? onActiveChip : undefined}>
            <Chip
              label={years ? `${entry.name} · ${years}` : entry.name}
              count={entry.vehicle_count}
              selected={generation === entry.slug}
              selectionRole="radio"
              onPress={() => router.setParams({ generation: entry.slug })}
              testID={`${ROUTE}.generation.${entry.slug}`}
            />
            </View>
          );
        })}
      </View>
    </ScrollView>
  ) : null;

  const listHeader = (
    <View style={column.style}>
      {restriction ? <RestrictionNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
      {loading && !data ? (
        <Skeleton testID={`${ROUTE}.headSkeleton`}>
          <HeadSkeleton />
        </Skeleton>
      ) : data ? (
        <>
          <View style={styles.head} onLayout={collapseOn}>
            <Text variant="eyebrow" color="text.secondary" hyphenate={false}>
              {data.make.name}
            </Text>
            <Text variant="titleL" role="heading" {...({ 'aria-level': 1 } as object)} hyphenate={false} testID={`${ROUTE}.title`}>
              {keepNameTogether(data.model.name)}
            </Text>
            <Text variant="supporting" color="text.secondary" style={styles.count} testID={`${ROUTE}.count`}>
              {t('model.count', { count: data.model.vehicle_count, formatted: format.number(data.model.vehicle_count) })}
            </Text>
          </View>
          {generationChips}
          <SegmentedControl
            options={[
              { value: 'builds', label: t('model.builds'), testID: `${ROUTE}.segment.builds` },
              { value: 'wheels', label: t('model.wheels'), testID: `${ROUTE}.segment.wheels` },
            ]}
            value={segment}
            onChange={(next) => router.setParams({ segment: next === 'wheels' ? 'wheels' : undefined })}
            label={t('model.segments')}
            style={styles.segments}
            testID={`${ROUTE}.segments`}
          />
        </>
      ) : null}
    </View>
  );

  let footer: ReactNode = <View style={[column.style, styles.footer]} />;
  if (!pageState && !segmentState) {
    if (list.isFetchingNextPage) {
      footer = (
        <View style={[column.style, styles.footer]} testID={`${ROUTE}.loadingMore`}>
          <Spinner label={t('list.loadingMore')} />
        </View>
      );
    } else if (list.isFetchNextPageError) {
      footer = (
        <View style={[column.style, styles.footer]} testID={`${ROUTE}.moreError`}>
          <Text variant="supporting" color="text.secondary">
            {t('list.moreError')}
          </Text>
          <Button label={common('actions.retry')} variant="secondary" size="m" onPress={() => void list.fetchNextPage()} testID={`${ROUTE}.moreRetry`} />
        </View>
      );
    } else if (list.hasNextPage) {
      footer = (
        <View style={[column.style, styles.footer]} testID={`${ROUTE}.moreRow`}>
          <Button label={t('list.more')} variant="secondary" size="m" disabled={!online} onPress={() => void list.fetchNextPage()} testID={`${ROUTE}.more`} />
        </View>
      );
    }
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header variant="large" scroll={header} title={title ? keepNameTogether(title) : t('filters.fields.model')} onBack={back} contentMaxWidth={column.headerWidth} contentAlign={column.headerAlign} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner label={t('offline')} />
      <View style={styles.list} onLayout={measurePane} testID={`${ROUTE}.pane`}>
        <CollapsingFlashList
          {...header.scrollProps}
          data={rows}
          keyExtractor={(row: Row) =>
            row.kind === 'vehicle' ? row.vehicle.id : row.kind === 'setup' ? `s.${row.row.id}` : row.kind === 'setupPair' ? `p.${row.rows[0]?.id ?? ''}` : 'table'
          }
          getItemType={(row: Row) => row.kind}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: inset }}
          scrollEnabled={!loading}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            pageState || segmentState ? (
              // DQ-451: a skeleton starts where the first card will, 24 under the segmented control; the 8 is for the states.
              <View role="tabpanel" aria-label={segment === 'builds' ? t('model.builds') : t('model.wheels')} style={[column.style, loading ? null : styles.states]}>
                {pageState ?? segmentState}
              </View>
            ) : null
          }
          ListFooterComponent={footer}
          onEndReached={() => {
            // Nit 4: a screen left behind in its tab or stack loads no pages nobody sees.
            if (focused && segment === 'builds' && builds.hasNextPage && !builds.isFetching && online) void builds.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item }: { item: Row }) =>
            item.kind === 'vehicle' ? (
              <View style={[styles.cardGap, column.style]}>
                <FeedVehicleCard vehicle={item.vehicle} width={column.inner} onOpen={openVehicle} onOpenUpdate={openUpdate} testID={`${ROUTE}.vehicle.${item.vehicle.id}`} />
              </View>
            ) : item.kind === 'setup' ? (
              <View style={[styles.cardGap, column.style]}>
                <WheelSetupCard row={item.row} onOpen={openVehicle} testID={`${ROUTE}.wheels`} />
              </View>
            ) : item.kind === 'setupPair' ? (
              <View style={[styles.cardGap, column.style]}>
                <View style={styles.pair}>
                  {item.rows.map((row) => (
                    <View key={row.id} style={styles.pairCell}>
                      <WheelSetupCard row={row} onOpen={openVehicle} testID={`${ROUTE}.wheels`} />
                    </View>
                  ))}
                  {item.rows.length < 2 ? <View style={styles.pairCell} /> : null}
                </View>
              </View>
            ) : (
              <View role="tabpanel" aria-label={t('model.wheels')} style={[paneStyle, styles.table]}>
                <WheelSetupTable rows={item.rows} caption={t('wheelTable.caption', { model: title })} onOpen={openVehicle} testID={`${ROUTE}.wheels`} />
              </View>
            )
          }
          testID={`${ROUTE}.list`}
        />
      </View>
    </Screen>
  );
}
