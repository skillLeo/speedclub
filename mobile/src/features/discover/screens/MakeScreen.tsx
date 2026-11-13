import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { canonicalMove, useMakePage, type ModelCount } from '@/api/queries/discover';
import type { FeedVehicle } from '@/api/queries/home';
import { useSearchOverview } from '@/api/queries/search';
import { BrowseErrorState, RestrictionNotice, useBrowseRestriction } from '@/features/home/components/BrowseStates';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, layout, size, space, useBreakpoint } from '@/theme';
import { Button, Chip, CollapsingFlashList, DisplayTitle, EmptyState, Header, Screen, SectionHeader, Skeleton, SkeletonBlock, SkeletonText, Text, useCollapsingHeader } from '@/ui';

import { BuildWallSkeleton, wallCellWidth, wallRows, WallRow, WALL_GAP } from '../components/BuildWall';
import { modelCovers, ModelTile, ModelTileSkeleton } from '../components/ModelTile';
import { SampleWall } from '../components/SampleWall';
import { EMPTY_STATE, searchParamsOf, setSingle } from '../filters';
import { estimatedPane, MODEL_GRID_COLUMNS, useDiscoverColumn, WALL_COLUMNS_BY_KIND, wholeRows, wideWallWidth } from '../layout';
import { modelPath } from '../navigation';
import { rememberLabel } from '../chipLabels';

const ROUTE = 'DISC-03';
const EDGES: readonly Edge[] = ['left', 'right'];
/** Model tiles while the make loads: two rows of the grid. */
const SKELETON_ROWS = 2;
/** "Neu bei …": at most this many rows of the wall (whole rows only, DQ-1038). */
const NEW_WALL_ROWS = 3;
const NEW_WALL_ROWS_WIDE = 2;

type Row =
  | { kind: 'models'; key: string; models: readonly ModelCount[] }
  | { kind: 'moreModels'; models: readonly ModelCount[] }
  | { kind: 'newHeader' }
  | { kind: 'wall'; key: string; vehicles: readonly FeedVehicle[] };

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  head: { gap: t.space[4], paddingTop: t.space[16] },
  all: { alignSelf: 'flex-start', marginTop: t.space[12] },
  chipsScroll: { marginTop: t.space[16] },
  chips: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  chipGroup: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  // The model's name before its generations: a quiet label, so "E46" reads as the M3's.
  chipModel: { paddingLeft: t.space[8] },
  chipModelFirst: { paddingLeft: 0 },
  section: { paddingBottom: t.space[12], paddingTop: t.space[24] },
  // 09 §5 rail cards in a grid: 12 between the cards, 24 between the rows.
  grid: { flexDirection: 'row', gap: t.space[12], paddingBottom: t.space[24] },
  newHeader: { paddingBottom: t.space[12], paddingTop: t.space[8] },
  // DQ-1082: the models without a photo, as one quiet line of links under the grid.
  more: { alignItems: 'baseline', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', paddingBottom: t.space[24], rowGap: t.space[4] },
  wallRow: { paddingBottom: WALL_GAP },
  end: { paddingBottom: t.space[32] },
  states: { paddingTop: t.space[16] },
}));

/** "1998–2006", "seit 2019": a generation's years as the chip shows them. */
export function generationYears(from: number | null, to: number | null, since: (year: string) => string): string | null {
  if (from === null) return null;
  return to === null ? since(String(from)) : `${from}–${to}`;
}

/** The width of one model tile in `columns` columns of a column `width` wide. */
export function modelTileWidth(width: number, columns: number): number {
  return columns > 0 && width > 0 ? Math.floor((width - space[12] * (columns - 1)) / columns) : 0;
}

/** DQ-327 / DQ-1028: the loaded page's blocks in its geometry: title and count, the 44 button, the chip row, "Modelle", the tiles. */
function MakeSkeleton({ width, columns }: { width: number; columns: number }) {
  const styles = useStyles();
  const tile = modelTileWidth(width, columns);
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.head}>
        <SkeletonText variant="displayTitle" width="50%" />
        <SkeletonText variant="callout" width="30%" />
        <SkeletonBlock width="55%" height={size.button.m} corner="sm" style={styles.all} />
      </View>
      <SkeletonBlock width="70%" height={size.chip} corner="full" style={styles.chipsScroll} />
      <SkeletonText variant="headline" width="25%" style={styles.section} />
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <View key={row} style={styles.grid}>
          {Array.from({ length: columns }, (__, cell) => (
            <ModelTileSkeleton key={cell} width={tile} />
          ))}
        </View>
      ))}
    </Skeleton>
  );
}

/**
 * DISC-03 /discover/make/[make], 09 §7.5 (DQ-1028): the make as its wordmark with its real count, the generation chips of its
 * models, the models as a grid of rail cards (each with its newest build's cover, its name in `display.wordmark` and its real
 * count) and "Neu bei …", the make's newest builds as a photo wall.
 */
export function MakeScreen() {
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
  const { width: windowWidth } = useBreakpoint();
  // DQ-324: the compact title comes in once the page's own title has scrolled away, with the hairline under the bar.
  const header = useCollapsingHeader();
  const collapseOn = (event: LayoutChangeEvent) => header.collapseAt.set(event.nativeEvent.layout.y + event.nativeEvent.layout.height);
  const params = useLocalSearchParams<{ make?: string | string[] }>();
  const slug = (paramOf(params.make) ?? '').toLowerCase();
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const page = useMakePage(live ? slug : '');
  const data = live ? page.data : undefined;
  const notFound = qaState === 'empty' || (page.error instanceof ApiError && page.error.kind === 'not_found');
  // M3.3: a merged make's old slug lands on its survivor; the route follows, so the address and a share name the survivor.
  const moved = canonicalMove(slug, data?.make.slug);
  useEffect(() => {
    if (moved) router.setParams({ make: moved });
  }, [moved, router]);
  // The make's newest builds: the covers of its models (the API has none per model) and the "Neu bei …" wall, one request.
  const makeSlug = data && !moved ? data.make.slug : '';
  const criteria = useMemo(() => ({ filters: setSingle(EMPTY_STATE.filters, 'make', makeSlug), sort: 'updated' as const }), [makeSlug]);
  const newest = useSearchOverview('', makeSlug ? criteria : undefined);

  // The pane beside the rail or the sidebar: the wall runs in it from 768 (DQ-1038).
  const [measuredPane, setMeasuredPane] = useState<number | null>(null);
  const pane = measuredPane ?? estimatedPane(column.kind, windowWidth);
  const measurePane = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) setMeasuredPane(width);
  };
  const phone = column.kind === 'phone';
  const gridColumns = MODEL_GRID_COLUMNS[column.kind];
  const tileWidth = modelTileWidth(column.inner, gridColumns);
  const wallColumns = WALL_COLUMNS_BY_KIND[column.kind];
  const wallWidth = phone ? Math.min(windowWidth, column.inner + 2 * column.gutter) : wideWallWidth(pane, column.gutter);
  const wallCell = wallCellWidth(wallWidth, wallColumns);
  const wallStyle = useMemo(
    () =>
      phone
        ? { alignSelf: 'center' as const, maxWidth: wallWidth, width: '100%' as const }
        : { alignSelf: column.desktop ? ('flex-start' as const) : ('center' as const), maxWidth: layout.contentMax + 2 * column.gutter, paddingHorizontal: column.gutter, width: '100%' as const },
    [column.desktop, column.gutter, phone, wallWidth],
  );

  const openModel = useCallback((model: ModelCount) => router.push(modelPath(model.key)), [router]);
  const openVehicle = useCallback((vehicle: FeedVehicle) => router.push(`/v/${vehicle.slug}`), [router]);
  const since = (year: string) => t('make.since', { year });

  let state: ReactNode = null;
  let loading = false;
  if (notFound) {
    // DQ-1033 (09 §5): the empty make shows what a make page holds, two badged sample builds, and the one way back.
    state = (
      <EmptyState
        preview={<SampleWall testID={`${ROUTE}.notFound.sample`} />}
        title={t('make.notFoundTitle')}
        body={t('make.notFoundBody')}
        action={{ label: t('make.back'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else if (qaState === 'loading' || (!data && page.isPending && page.fetchStatus !== 'paused' && qaState === 'default')) {
    loading = true;
    state = <MakeSkeleton width={column.inner} columns={gridColumns} />;
  } else if (qaState === 'error' || !data) {
    state = (
      <BrowseErrorState
        routeId={ROUTE}
        title={t('make.errorTitle')}
        offline={qaState !== 'error' && (!online || page.fetchStatus === 'paused')}
        error={page.error}
        onRetry={() => void page.refetch()}
        retrying={page.isFetching}
      />
    );
  }

  useEffect(() => {
    if (!data) return;
    rememberLabel('make', data.make.slug, data.make.name);
    for (const model of data.models) rememberLabel('model', model.slug, model.name);
  }, [data]);
  const models = useMemo(() => (state || !data ? [] : data.models), [data, state]);
  const builds = useMemo(() => (newest.data?.vehicles.items ?? []).filter((vehicle) => vehicle.cover), [newest.data]);
  const covers = useMemo(() => modelCovers(models, builds), [builds, models]);
  const wallItems = useMemo(
    () => builds.slice(0, wholeRows(builds.length, wallColumns, wallColumns * (phone ? NEW_WALL_ROWS : NEW_WALL_ROWS_WIDE))),
    [builds, phone, wallColumns],
  );
  // DQ-1082 (skill rule 1: no grey placeholder tiles): once the make's builds are in, a model none of them shows moves out of the
  // photo grid into "Weitere Modelle" under it. While they load, and when no model has a photo at all, the grid keeps every model.
  const split = useMemo(() => splitByCover(models, covers, newest.data !== undefined), [covers, models, newest.data]);
  const rows = useMemo<Row[]>(() => {
    if (models.length === 0) return [];
    const grid: Row[] = wallRows(split.grid, gridColumns).map((row) => ({ kind: 'models', key: `m.${row[0]?.key ?? ''}`, models: row }));
    if (split.more.length > 0) grid.push({ kind: 'moreModels', models: split.more });
    if (wallItems.length === 0) return grid;
    const wall: Row[] = wallRows(wallItems, wallColumns).map((row) => ({ kind: 'wall', key: `w.${row[0]?.id ?? ''}`, vehicles: row }));
    return [...grid, { kind: 'newHeader' }, ...wall];
  }, [gridColumns, models.length, split, wallColumns, wallItems]);

  const searchMake = (sort?: 'newest') =>
    data
      ? router.push({
          pathname: '/discover/search',
          params: searchParamsOf({ ...EMPTY_STATE, filters: setSingle(EMPTY_STATE.filters, 'make', data.make.slug), ...(sort ? { sort } : {}) }),
        })
      : undefined;

  // The generations of every model, grouped under the model's name: the same chips as on DISC-04, each opens it at that generation.
  const withGenerations = models.filter((model) => model.generations.length > 0);
  const generationChips =
    withGenerations.length > 0 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.chipsScroll, { marginHorizontal: -column.gutter }]}
        contentContainerStyle={{ paddingHorizontal: column.gutter }}
        testID={`${ROUTE}.generations`}
      >
        <View style={styles.chips}>
          {withGenerations.map((model, index) => (
            <View key={model.key} role="list" aria-label={t('make.generations', { model: model.name })} style={styles.chipGroup}>
              <Text variant="callout" color="text.secondary" hyphenate={false} aria-hidden style={index === 0 ? styles.chipModelFirst : styles.chipModel}>
                {keepNameTogether(model.name)}
              </Text>
              {model.generations.map((generation) => {
                const years = generationYears(generation.year_from, generation.year_to, since);
                return (
                  <View key={generation.slug} role="listitem">
                    <Chip
                      label={years ? `${generation.name} · ${years}` : generation.name}
                      count={generation.vehicle_count}
                      onPress={() => router.push(modelPath(model.key, generation.slug))}
                      testID={`${ROUTE}.model.${model.slug}.generation.${generation.slug}`}
                    />
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    ) : null;

  const head = data && !state ? (
    <>
      <View style={styles.head} onLayout={collapseOn}>
        {/* 09 §7.5 DISC-03 hero: the make as its text wordmark in display.title (Archivo SemiExpanded, no marks), the real count in tnum. */}
        <DisplayTitle placement="page" layoutWidth={column.inner} role="heading" {...({ 'aria-level': 1 } as object)} testID={`${ROUTE}.title`}>
          {data.make.name}
        </DisplayTitle>
        <Text variant="callout" color="text.secondary" numeric testID={`${ROUTE}.count`}>
          {t('make.count', { count: data.make.vehicle_count, formatted: format.number(data.make.vehicle_count) })}
        </Text>
        <Button
          label={t('make.allBuilds', { make: keepNameTogether(data.make.name) })}
          variant="secondary"
          size="m"
          role="link"
          onPress={() => searchMake()}
          style={styles.all}
          testID={`${ROUTE}.allBuilds`}
        />
      </View>
      {generationChips}
    </>
  ) : null;

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'models') {
      return (
        <View style={column.style}>
          <View role="list" style={styles.grid}>
            {item.models.map((model) => (
              <View key={model.key} role="listitem" style={{ width: tileWidth }}>
                <ModelTile
                  name={model.name}
                  count={model.vehicle_count}
                  cover={covers.get(model.slug)}
                  width={tileWidth}
                  onOpen={() => openModel(model)}
                  testID={`${ROUTE}.model.${model.slug}`}
                />
              </View>
            ))}
          </View>
        </View>
      );
    }
    if (item.kind === 'moreModels') {
      return (
        <View style={column.style}>
          <View role="list" aria-label={t('make.moreModels')} style={styles.more} testID={`${ROUTE}.moreModels`}>
            <Text variant="callout" color="text.secondary" aria-hidden>
              {t('make.moreModels')}
            </Text>
            {item.models.map((model) => (
              <View key={model.key} role="listitem">
                <Button
                  label={`${keepNameTogether(model.name)} · ${t('make.modelCount', { count: model.vehicle_count, formatted: format.number(model.vehicle_count) })}`}
                  variant="tertiary"
                  size="s"
                  role="link"
                  onPress={() => openModel(model)}
                  testID={`${ROUTE}.model.${model.slug}`}
                />
              </View>
            ))}
          </View>
        </View>
      );
    }
    if (item.kind === 'newHeader') {
      return (
        <View style={phone ? column.style : wallStyle}>
          <SectionHeader
            title={t('make.newTitle', { make: data ? keepNameTogether(data.make.name) : '' })}
            actionLabel={common('actions.all')}
            actionAccessibilityLabel={t('make.newAllLabel', { make: data?.make.name ?? '' })}
            onAction={() => searchMake('newest')}
            style={styles.newHeader}
            testID={`${ROUTE}.newest.header`}
          />
        </View>
      );
    }
    return (
      <View style={[styles.wallRow, wallStyle]}>
        <WallRow vehicles={item.vehicles} cell={wallCell} onOpen={openVehicle} testID={`${ROUTE}.newest`} />
      </View>
    );
  };

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        scroll={header}
        title={data ? keepNameTogether(data.make.name) : t('filters.fields.make')}
        onBack={back}
        contentMaxWidth={column.headerWidth}
        contentAlign={column.headerAlign}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('offline')} />
      <View style={styles.list} onLayout={measurePane}>
        <CollapsingFlashList
          {...header.scrollProps}
          data={rows}
          keyExtractor={(row: Row) => (row.kind === 'newHeader' || row.kind === 'moreModels' ? row.kind : row.key)}
          getItemType={(row: Row) => row.kind}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: inset }}
          scrollEnabled={!loading}
          ListHeaderComponent={
            <View style={column.style}>
              {restriction ? <RestrictionNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
              {head}
              {data && !state ? <SectionHeader title={t('make.models')} style={styles.section} testID={`${ROUTE}.modelsHeader`} /> : null}
            </View>
          }
          ListEmptyComponent={state ? <View style={[column.style, styles.states]}>{state}</View> : null}
          ListFooterComponent={
            !state && newest.isPending && newest.fetchStatus === 'fetching' ? (
              <View style={[wallStyle, styles.end]}>
                <BuildWallSkeleton width={wallWidth} columns={wallColumns} count={wallColumns} />
              </View>
            ) : (
              <View style={styles.end} />
            )
          }
          renderItem={renderItem}
          testID={`${ROUTE}.list`}
        />
      </View>
    </Screen>
  );
}

/**
 * DQ-1082: the models with a cover for the grid and the rest for "Weitere Modelle". Before the builds are in (`known` false), or when
 * no model has a cover, every model stays in the grid.
 */
export function splitByCover<M extends { slug: string }>(
  models: readonly M[],
  covers: ReadonlyMap<string, unknown>,
  known: boolean,
): { grid: readonly M[]; more: readonly M[] } {
  if (!known) return { grid: models, more: [] };
  const grid = models.filter((model) => covers.has(model.slug));
  if (grid.length === 0) return { grid: models, more: [] };
  return { grid, more: models.filter((model) => !covers.has(model.slug)) };
}
