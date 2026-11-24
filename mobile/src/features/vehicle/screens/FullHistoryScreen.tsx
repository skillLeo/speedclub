import type { FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { usePublicVehicle, usePublicVehicleUpdates, type BuildUpdate, type PublicVehicle } from '@/api/queries/vehicles';
import { isWeb } from '@/lib/platform';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { aspect, createStyles, layout, space, ThemeScope, typography, useBreakpoint, useTheme, type ThemeName } from '@/theme';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { DisplayTitle } from '@/ui/DisplayTitle';
import { EmptyState } from '@/ui/EmptyState';
import { Header } from '@/ui/Header';
import { Photo } from '@/ui/Photo';
import { PhotoStageScrim } from '@/ui/PhotoStageScrim';
import { Screen } from '@/ui/Screen';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { SpecStrip } from '@/ui/SpecStrip';
import { Text } from '@/ui/Text';
import { TimelineMonth, TimelineRow } from '@/ui/Timeline';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';
import { WEB_HAIRLINE } from '@/ui/specStripLayout';
import { useMotionPreference } from '@/ui/motion';

import { historyEntry } from '../components/ProfileSections';
import { StateScreen } from '../components/StateScreen';
import { desktopColumns, heroIdentityOverlap } from '../layout';
import { photoFields, visiblePhotos } from '../media';
import { mergeUpdates, specStripItems } from '../model';
import { paramOf, useBack } from '../navigation';
import { RouteStateBody, useRouteState } from '../states';

const ROUTE_ID = 'VEH-08';
const EDGES: readonly Edge[] = ['left', 'right'];

type Row = { kind: 'month'; key: string; label: string; first: boolean } | { kind: 'entry'; key: string; update: BuildUpdate; first: boolean; last: boolean };

/** The entries by `created_at`, newest first; equal or missing times keep the order they came in. */
export function newestFirst(updates: readonly BuildUpdate[]): BuildUpdate[] {
  const time = (update: BuildUpdate) => (update.created_at ? Date.parse(update.created_at) : Number.NEGATIVE_INFINITY);
  return updates
    .map((update, index) => ({ update, index }))
    .sort((a, b) => time(b.update) - time(a.update) || a.index - b.index)
    .map(({ update }) => update);
}

/** Newest first, one heading per month ("März 2023"), each entry knowing where its piece of the spine starts and ends. */
export function fullHistoryRows(updates: readonly BuildUpdate[]): Row[] {
  const rows: Row[] = [];
  let month: string | null = null;
  let groupStart = 0;
  for (const update of updates) {
    const label = update.month_label ?? '';
    if (label !== month) {
      const previous = rows[rows.length - 1];
      if (previous?.kind === 'entry') previous.last = true;
      rows.push({ kind: 'month', key: `month.${rows.length}.${label}`, label, first: month === null });
      month = label;
      groupStart = rows.length;
    }
    rows.push({ kind: 'entry', key: update.id, update, first: rows.length === groupStart, last: false });
  }
  const tail = rows[rows.length - 1];
  if (tail?.kind === 'entry') tail.last = true;
  return rows;
}

const SPINE = isWeb ? WEB_HAIRLINE : StyleSheet.hairlineWidth;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  // One readable column (the feed's 640), on the gutter under back from 768, as VEH-05 (PushedPage).
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  wide: { width: '100%' },
  // DQ-M53-08: from 1280 the timeline takes 8 of the 12 columns beside a 4-column card, as VEH-01.
  desktop: { alignSelf: 'center', flex: 1, flexDirection: 'row', gap: t.space[24], maxWidth: layout.contentMax + 2 * t.space[24], paddingHorizontal: t.space[24], width: '100%' },
  desktopMain: { flex: layout.vehicleDesktop.galleryCols, minWidth: 0 },
  desktopAside: { flex: layout.vehicleDesktop.specCols, minWidth: 0, paddingTop: t.space[24] },
  aside: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[16], padding: t.space[24] },
  asideAction: { alignSelf: 'flex-start' },
  // The cover on its dark stage (every theme, ADR-421 b), the name on the scrim below the text-safe line, as VEH-01's hero.
  stage: { backgroundColor: t.color.scrim.photoEnd, overflow: 'hidden' },
  identityOnCover: { bottom: 0, gap: t.space[4], left: 0, paddingBottom: t.space[24], position: 'absolute', right: 0 },
  coverDesktop: { paddingTop: t.space[24] },
  identityPlain: { gap: t.space[4], paddingBottom: t.space[8], paddingTop: t.space[16] },
  footer: { alignItems: 'flex-start', gap: t.space[12], paddingBottom: t.space[32], paddingTop: t.space[16] },
  // DQ-M53-07: the skeleton is the Timeline's shape: a month bar, then entries on the hairline spine with their node.
  skeletonMonth: { paddingBottom: t.space[4], paddingTop: t.space[24] },
  skeletonMonthFirst: { paddingBottom: t.space[4], paddingTop: t.space[8] },
  skeletonSpine: { borderLeftColor: t.color.border.default, borderLeftWidth: SPINE, marginLeft: t.space[4], paddingBottom: t.space[8] },
  skeletonEntry: { gap: t.space[4], paddingLeft: t.space[16], paddingVertical: t.space[8] },
  samplePreview: { gap: t.space[8] },
}));

/** The cover's dark stage is Carbon-dark in every theme (ADR-421 b): its skeleton bars take Carbon's tones (as MediaCard's lead). */
const STAGE_THEME: ThemeName = 'carbon';

/** Months in the skeleton and the entries under each: a phone's first screens of a typical history. */
const SKELETON_MONTHS = [2, 3] as const;

function HistorySkeleton({ coverWidth, gutter, desktop }: { coverWidth: number; gutter: number; desktop: boolean }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const ratio = ratioOf(aspect.heroWeb);
  return (
    <Skeleton testID={`${ROUTE_ID}.skeleton`}>
      {/* DQ-M53-07a, DQ-P5-039: the name and count bars on the cover, where the page sets them (CoverHeader's geometry). On a phone and
          a tablet the cover is its dark stage (as the loaded page's, every theme, ADR-421 b) with the bars in the stage's tones, so the
          name bar shows on the cover instead of vanishing into a photo block of its own tone. */}
      {desktop ? (
        <View testID={`${ROUTE_ID}.skeleton.cover`}>
          <SkeletonBlock width={coverWidth} height={coverWidth / ratio} corner="xl" />
          <View style={styles.identityPlain}>
            <SkeletonText variant="displayTitle" width="70%" />
            <SkeletonText variant="callout" width="30%" />
          </View>
        </View>
      ) : (
        <View style={[styles.stage, { width: coverWidth }]} testID={`${ROUTE_ID}.skeleton.cover`}>
          <View style={{ height: coverWidth / ratio }} />
          <View style={{ height: Math.max(0, estimatedIdentity(fontScale) - heroIdentityOverlap(coverWidth, ratio)) }} />
          <ThemeScope name={STAGE_THEME}>
            <View style={[styles.identityOnCover, { paddingHorizontal: gutter }]} testID={`${ROUTE_ID}.skeleton.identity`}>
              <SkeletonText variant="displayTitle" width="70%" />
              <SkeletonText variant="callout" width="30%" />
            </View>
          </ThemeScope>
        </View>
      )}
      <View style={{ paddingHorizontal: gutter }}>
        {SKELETON_MONTHS.map((entries, month) => (
          <View key={month}>
            {/* As TimelineMonth: 8 above the first month, 24 above the others. */}
            <View style={month === 0 ? styles.skeletonMonthFirst : styles.skeletonMonth}>
              <SkeletonText variant="calloutStrong" width="30%" />
            </View>
            <View style={styles.skeletonSpine}>
              {Array.from({ length: entries }, (_, index) => (
                <View key={index} style={styles.skeletonEntry}>
                  <SkeletonText variant="headline" width="55%" />
                  <SkeletonText variant="callout" width="75%" />
                  <SkeletonText variant="caption" width="35%" />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

function ratioOf(value: string): number {
  const [w = 1, h = 1] = value.split(':').map(Number);
  return w / h;
}

/** The identity's height on the cover before it is measured: the title line, 4, the count line and 24 under it (the skeleton's too). */
function estimatedIdentity(fontScale: number): number {
  return (typography.displayTitle.lineHeight + typography.callout.lineHeight) * fontScale + space[4] + space[24];
}

/**
 * DQ-M53-08, DQ-M53R2-04/-07: the build's cover as a 16:9 strip. On a phone and a tablet it fades into its dark stage (PhotoStageScrim,
 * the hero's own scrim, so its last row is the stage colour) and the name sits on it below the text-safe line: the identity is placed at
 * the stage's bottom, the stage reaching past the photo by what the identity needs beyond the overlap (a height, never a negative
 * margin). On the desktop the cover is an inset photo, radius 20 on all four corners, the name under it on the canvas.
 */
function CoverHeader({ vehicle, width, gutter, desktop, count }: { vehicle: PublicVehicle; width: number; gutter: number; desktop: boolean; count: string | null }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const cover = vehicle.cover ?? visiblePhotos(vehicle.photos)[0] ?? null;
  const ratio = ratioOf(aspect.heroWeb);
  const [identityHeight, setIdentityHeight] = useState<number | null>(null);
  const name = (tone: 'photo' | 'canvas') => (
    <>
      <DisplayTitle
        role="heading"
        {...({ 'aria-level': 1 } as object)}
        placement="page"
        color={tone === 'photo' ? 'onPhoto.primary' : undefined}
        layoutWidth={Math.max(0, width - 2 * gutter)}
        testID={`${ROUTE_ID}.vehicle`}
      >
        {vehicle.title}
      </DisplayTitle>
      {count ? (
        <Text variant="callout" color={tone === 'photo' ? 'onPhoto.secondary' : 'text.secondary'} numeric testID={`${ROUTE_ID}.count`}>
          {count}
        </Text>
      ) : null}
    </>
  );
  const plainPad = desktop ? 0 : gutter;
  if (!cover) return <View style={[styles.identityPlain, { paddingHorizontal: plainPad }]}>{name('canvas')}</View>;
  if (desktop) {
    return (
      <View style={styles.coverDesktop} testID={`${ROUTE_ID}.cover`}>
        <Photo {...photoFields(cover, Math.round(width))} aspect="16:9" corner="xl" label={cover.alt ?? vehicle.full_title} priority="high" />
        <View style={styles.identityPlain}>{name('canvas')}</View>
      </View>
    );
  }
  const overlap = heroIdentityOverlap(width, ratio);
  const reach = Math.max(0, (identityHeight ?? estimatedIdentity(fontScale)) - overlap);
  return (
    <View style={styles.stage} testID={`${ROUTE_ID}.cover`}>
      <Photo {...photoFields(cover, Math.round(width))} aspect="16:9" corner="none" label={cover.alt ?? vehicle.full_title} priority="high">
        <PhotoStageScrim />
      </Photo>
      <View style={{ height: reach }} />
      <View
        style={[styles.identityOnCover, { paddingHorizontal: gutter }]}
        onLayout={(event: LayoutChangeEvent) => setIdentityHeight(Math.ceil(event.nativeEvent.layout.height))}
      >
        {name('photo')}
      </View>
    </View>
  );
}

/** The desktop's 4-column card: the strip and the way back to the build. */
function AsideCard({ vehicle, onOpen, width }: { vehicle: PublicVehicle; onOpen: () => void; width: number }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  return (
    <View style={styles.aside} testID={`${ROUTE_ID}.aside`}>
      <SpecStrip
        items={specStripItems(vehicle, { power: t('strip.power'), torque: t('strip.torque') })}
        layoutWidth={Math.max(0, width - 2 * space[24])}
        rollKey={`${vehicle.id}-history`}
        testID={`${ROUTE_ID}.specStrip`}
      />
      <Button label={t('fullHistory.toVehicle')} variant="secondary" size="m" role="link" onPress={onOpen} style={styles.asideAction} testID={`${ROUTE_ID}.toVehicle`} />
    </View>
  );
}

/**
 * VEH-08 /v/[slug]/history (10 §5.10, M5.3): the build's whole Verlauf, newest first, on the Timeline of VEH-01, paged with the public
 * cursor (`GET public/vehicles/{slug}/updates`, contract §4.4). The page's latest 20 entries show at once; older pages load as the
 * list reaches its end. Each entry opens VEH-05.
 */
export function FullHistoryScreen() {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const motion = useMotionPreference();
  const qaState = useQaState();
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = paramOf(params.slug) ?? '';
  const back = useBack(`/v/${slug}`);
  const query = usePublicVehicle(slug);
  const state = useRouteState(query);
  const older = usePublicVehicleUpdates(slug, state === 'ready');
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const { gutter, kind } = useBreakpoint();
  const listRef = useRef<FlashListRef<Row>>(null);
  const [width, setWidth] = useState(0);
  const onWidth = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const desktop = kind === 'desktop';
  const columns = desktop ? desktopColumns(width, false) : null;
  // The cover spans the phone's width; on a tablet the 640 column, on the desktop the 8 columns.
  const mainWidth = columns ? columns.gallery : kind === 'tablet' ? Math.min(width, layout.feedColumn) : width;

  const vehicle = query.data;
  const updates = useMemo(() => {
    if (!vehicle || qaState === 'empty') return [];
    // Review N1: newest first whatever arrived first (a cached page and a fresher cursor page), so a month heads its entries once.
    return newestFirst(mergeUpdates(vehicle.updates, older.data?.pages.flatMap((page) => page.data) ?? []));
  }, [older.data, qaState, vehicle]);
  const rows = useMemo(() => fullHistoryRows(updates), [updates]);
  const total = vehicle ? Math.max(vehicle.updates_count, updates.length) : 0;

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    listRef.current?.scrollToOffset({ offset: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  const open = useCallback((update: BuildUpdate) => router.push(`/v/${slug}/updates/${update.id}`), [router, slug]);
  const loadMore = () => {
    if (older.hasNextPage && !older.isFetchingNextPage && !older.isError) void older.fetchNextPage();
  };

  if (state === 'loading' || (state === 'ready' && !vehicle)) {
    return (
      <Screen edges={EDGES} testID={`${ROUTE_ID}.root`}>
        <Header title={t('fullHistory.title')} onBack={back} testID={`${ROUTE_ID}.header`} />
        <View style={styles.list} onLayout={onWidth}>
          <View style={desktop ? styles.desktop : null}>
            <View style={desktop ? styles.desktopMain : [styles.column, kind === 'tablet' ? { paddingHorizontal: gutter } : null]}>
              <HistorySkeleton coverWidth={mainWidth} gutter={desktop || kind === 'tablet' ? 0 : gutter} desktop={desktop} />
            </View>
            {desktop ? <View style={styles.desktopAside} /> : null}
          </View>
        </View>
      </Screen>
    );
  }
  if (state !== 'ready' || !vehicle) {
    return (
      <StateScreen routeId={ROUTE_ID} title={t('fullHistory.title')} onBack={back}>
        <RouteStateBody state={state === 'ready' ? 'error' : state} routeId={ROUTE_ID} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </StateScreen>
    );
  }

  const own = vehicle.is_owner;
  const empty =
    rows.length === 0 ? (
      <EmptyState
        title={t('fullHistory.empty')}
        body={own ? t('fullHistory.emptyOwner') : undefined}
        // 09 §5 EmptyState: a real sample entry, badged "Beispiel", instead of a grey glyph.
        preview={
          <View style={styles.samplePreview} aria-hidden testID={`${ROUTE_ID}.sample`}>
            <Badge kind="sample" />
            <TimelineMonth label={t('fullHistory.sample.month')} first />
            <TimelineRow
              entry={{ key: 'sample', date: t('fullHistory.sample.month'), title: t('fullHistory.sample.title'), lines: [{ key: 'line', label: t('fullHistory.sample.line'), inline: true }] }}
              first
              last
            />
          </View>
        }
        action={own ? { label: t('fullHistory.post'), onPress: () => router.push({ pathname: '/post-update', params: { vehicleId: vehicle.id } }) } : undefined}
        testID={`${ROUTE_ID}.empty`}
      />
    ) : null;

  // DQ-M53-07 b: the count belongs to what is listed; an empty history says so without "7 Einträge" over it.
  const countLine = rows.length > 0 && total > 0 ? t('fullHistory.count', { count: total }) : null;
  // A phone sets the cover edge to edge; the rows keep the gutter.
  const rowGutter = desktop ? 0 : gutter;
  // DQ-M53R2-08: on the desktop the rows span the 8 columns under the cover (one right edge); elsewhere the reading column.
  const rowColumn = desktop ? styles.wide : styles.column;
  const listHeader = <CoverHeader vehicle={vehicle} width={mainWidth} gutter={desktop ? space[24] : gutter} desktop={desktop} count={countLine} />;
  const list = (
      <CollapsingFlashList
        ref={listRef}
        data={rows}
        {...header.scrollProps}
        keyExtractor={(row: Row) => row.key}
        getItemType={(row: Row) => row.kind}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: inset }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty ? <View style={[rowColumn, { paddingHorizontal: rowGutter }]}>{empty}</View> : null}
        ListFooterComponent={
          rows.length > 0 ? (
            <View style={[rowColumn, styles.footer, { paddingHorizontal: rowGutter }]}>
              {older.isError && !older.isFetching ? (
                <>
                  <Text variant="callout" color="text.secondary" role="alert" testID={`${ROUTE_ID}.loadError`}>
                    {t('fullHistory.loadError')}
                  </Text>
                  <Button label={t('fullHistory.retry')} variant="secondary" size="m" onPress={() => void older.fetchNextPage()} testID={`${ROUTE_ID}.retry`} />
                </>
              ) : older.hasNextPage || older.isFetching ? (
                <Button label={t('history.loadOlder', { count: Math.max(1, total - updates.length) })} variant="secondary" size="m" loading={older.isFetching} onPress={loadMore} testID={`${ROUTE_ID}.more`} />
              ) : (
                <Text variant="caption" color="text.tertiary" testID={`${ROUTE_ID}.end`}>
                  {t('fullHistory.end')}
                </Text>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }: { item: Row }) => (
          <View style={[rowColumn, { paddingHorizontal: rowGutter }]}>
            {item.kind === 'month' ? (
              <TimelineMonth label={item.label} first={item.first} testID={`${ROUTE_ID}.month.${item.key}`} />
            ) : (
              <TimelineRow
                entry={historyEntry(item.update, t, () => open(item.update), `${ROUTE_ID}.update.${item.update.id}`, (value) => format.number(value))}
                first={item.first}
                last={item.last}
              />
            )}
          </View>
        )}
        testID={`${ROUTE_ID}.list`}
      />
  );

  return (
    <Screen edges={EDGES} testID={`${ROUTE_ID}.root`}>
      <Header title={t('fullHistory.title')} scroll={header} onBack={back} contentMaxWidth={kind === 'tablet' ? layout.feedColumn : undefined} testID={`${ROUTE_ID}.header`} />
      <ShellOfflineBanner />
      <View style={styles.list} onLayout={onWidth}>
        {desktop ? (
          <View style={styles.desktop}>
            <View style={styles.desktopMain}>{list}</View>
            <View style={styles.desktopAside}>
              <AsideCard vehicle={vehicle} width={columns?.card ?? 0} onOpen={back} />
            </View>
          </View>
        ) : (
          list
        )}
      </View>
    </Screen>
  );
}
