import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { canonicalMove, useMakePage, type ModelCount } from '@/api/queries/discover';
import { BrowseErrorState, RestrictionNotice, useBrowseRestriction } from '@/features/home/components/BrowseStates';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, size, space } from '@/theme';
import { Button, CollapsingFlashList, EmptyState, Header, Screen, SectionHeader, Skeleton, SkeletonBlock, SkeletonText, Text, useCollapsingHeader } from '@/ui';

import { ModelRow, type ModelRowGeneration } from '../components/ModelRow';
import { EMPTY_STATE, searchParamsOf, setSingle } from '../filters';
import { useDiscoverColumn } from '../layout';
import { modelPath } from '../navigation';
import { rememberLabel } from '../chipLabels';

const ROUTE = 'DISC-03';
const EDGES: readonly Edge[] = ['left', 'right'];
const SKELETON_ROWS = 4;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  head: { gap: t.space[4], paddingBottom: t.space[24], paddingTop: t.space[16] },
  all: { alignSelf: 'flex-start', marginTop: t.space[12] },
  count: { fontVariant: ['tabular-nums'] },
  section: { paddingBottom: t.space[12] },
  card: { backgroundColor: t.color.bg.surface, overflow: 'hidden' },
  cardFirst: { borderTopLeftRadius: t.radius.md, borderTopRightRadius: t.radius.md },
  cardLast: { borderBottomLeftRadius: t.radius.md, borderBottomRightRadius: t.radius.md, marginBottom: t.space[32] },
  states: { paddingTop: t.space[16] },
}));

/** "1998–2006", "seit 2019": a generation's years as the chip shows them. */
export function generationYears(from: number | null, to: number | null, since: (year: string) => string): string | null {
  if (from === null) return null;
  return to === null ? since(String(from)) : `${from}–${to}`;
}

/** DQ-327: the loaded page's blocks in its geometry: title and count, the 44 button, "Modelle", and one joined card of rows. */
function MakeSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.head}>
        <SkeletonText variant="titleL" width="40%" />
        <SkeletonText variant="supporting" width="30%" />
        <SkeletonBlock width="55%" height={size.button.m} corner="sm" style={styles.all} />
      </View>
      <SkeletonText variant="titleS" width="25%" style={styles.section} />
      <SkeletonBlock width="100%" height={SKELETON_ROWS * (size.row.single + size.chip + space[12])} corner="md" />
    </Skeleton>
  );
}

/** DISC-03 /discover/make/[make]: the make with its real count, its models as rows with counts and generation chips. */
export function MakeScreen() {
  const { t } = useTranslation('discover');
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
  const params = useLocalSearchParams<{ make?: string | string[] }>();
  const slug = (paramOf(params.make) ?? '').toLowerCase();
  const page = useMakePage(qaState === 'default' || qaState === 'offline' || qaState === 'restricted' ? slug : '');
  const data = qaState === 'default' || qaState === 'offline' || qaState === 'restricted' ? page.data : undefined;
  const notFound = qaState === 'empty' || (page.error instanceof ApiError && page.error.kind === 'not_found');
  // M3.3: a merged make's old slug lands on its survivor; the route follows, so the address and a share name the survivor.
  const moved = canonicalMove(slug, data?.make.slug);
  useEffect(() => {
    if (moved) router.setParams({ make: moved });
  }, [moved, router]);

  const openModel = useCallback((model: ModelCount) => router.push(modelPath(model.key)), [router]);
  const since = (year: string) => t('make.since', { year });

  let state: ReactNode = null;
  let loading = false;
  if (notFound) {
    state = (
      <EmptyState
        icon="magnifying-glass"
        title={t('make.notFoundTitle')}
        body={t('make.notFoundBody')}
        action={{ label: t('make.back'), onPress: () => router.navigate('/discover') }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else if (qaState === 'loading' || (!data && page.isPending && page.fetchStatus !== 'paused' && qaState === 'default')) {
    loading = true;
    state = <MakeSkeleton />;
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
  const models = state || !data ? [] : data.models;

  const head = data && !state ? (
    <View style={styles.head} onLayout={collapseOn}>
      <Text variant="titleL" role="heading" {...({ 'aria-level': 1 } as object)} hyphenate={false} testID={`${ROUTE}.title`}>
        {keepNameTogether(data.make.name)}
      </Text>
      <Text variant="supporting" color="text.secondary" style={styles.count} testID={`${ROUTE}.count`}>
        {t('make.count', { count: data.make.vehicle_count, formatted: format.number(data.make.vehicle_count) })}
      </Text>
      <Button
        label={t('make.allBuilds', { make: data.make.name })}
        variant="secondary"
        size="m"
        role="link"
        onPress={() =>
          router.push({ pathname: '/discover/search', params: searchParamsOf({ ...EMPTY_STATE, filters: setSingle(EMPTY_STATE.filters, 'make', data.make.slug) }) })
        }
        style={styles.all}
        testID={`${ROUTE}.allBuilds`}
      />
    </View>
  ) : null;

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
      <CollapsingFlashList
        {...header.scrollProps}
        data={models}
        keyExtractor={(model: ModelCount) => model.key}
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
        renderItem={({ item, index }: { item: ModelCount; index: number }) => {
          const generations: ModelRowGeneration[] = item.generations.map((generation) => ({
            slug: generation.slug,
            name: generation.name,
            count: generation.vehicle_count,
            years: generationYears(generation.year_from, generation.year_to, since),
          }));
          return (
            <View style={column.style}>
              <View style={[styles.card, index === 0 ? styles.cardFirst : null, index === models.length - 1 ? styles.cardLast : null]}>
                <ModelRow
                  name={item.name}
                  count={item.vehicle_count}
                  generations={generations}
                  onOpen={() => openModel(item)}
                  onOpenGeneration={(generation) => router.push(modelPath(item.key, generation))}
                  divider={index < models.length - 1}
                  testID={`${ROUTE}.model.${item.slug}`}
                />
              </View>
            </View>
          );
        }}
        testID={`${ROUTE}.list`}
      />
    </Screen>
  );
}
