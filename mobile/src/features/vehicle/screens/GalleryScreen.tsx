import { useLocalSearchParams } from 'expo-router';
import type { FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { usePublicVehicle, type MediaCategory, type VehicleMedia } from '@/api/queries/vehicles';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useQaState } from '@/lib/qa';
import { createStyles, layout, space, useBreakpoint, type BreakpointKind } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { Header } from '@/ui/Header';
import { Photo } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { Screen } from '@/ui/Screen';
import { Skeleton, SkeletonBlock } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { PhotoViewer } from '../components/PhotoViewer';
import { StateScreen } from '../components/StateScreen';
import { categoryCounts, isMediaCategory, photoFields, photosIn } from '../media';
import { paramOf, useBack } from '../navigation';
import { RouteStateBody, useRouteState } from '../states';

const ROUTE_ID = 'VEH-03';
const EDGES: readonly Edge[] = ['left', 'right'];
/** The skeleton's rows of tiles (a phone shows nine). */
const SKELETON_ROWS = 3;
const TILE_RATIO = 1;

/**
 * Columns and gap per width. A row lays its tiles out with the gap between them and equal shares of what is left, so every tile
 * is equally wide and no cell carries a fraction of a gap as padding (off the spacing scale; m4.18 DOM audit, DQ-1070).
 */
const GRID: Record<BreakpointKind, { columns: number; gap: number }> = {
  // DQ-1070 (09 §7.6 VEH-03, §5 wall): a 1:1 wall, 2 apart, no radius; 3 columns on a phone, more where there is room.
  phone: { columns: 3, gap: space[2] },
  tablet: { columns: 4, gap: space[2] },
  desktop: { columns: 5, gap: space[2] },
};

type Filter = MediaCategory | 'all';

/** One row of the wall: its photos (at most `columns`) and the index of the first one in the shown list. */
export type WallRow = { key: string; start: number; photos: readonly VehicleMedia[] };

/** The shown photos in rows of `columns`, each row keyed by its first photo. */
export function wallRows(photos: readonly VehicleMedia[], columns: number): WallRow[] {
  const rows: WallRow[] = [];
  const step = Math.max(1, Math.floor(columns));
  for (let start = 0; start < photos.length; start += step) {
    const slice = photos.slice(start, start + step);
    rows.push({ key: slice[0]?.id ?? String(start), start, photos: slice });
  }
  return rows;
}

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'center', flex: 1, maxWidth: layout.contentMax + 2 * layout.gutter.desktop, width: '100%' },
  filters: { flexGrow: 0 },
  filterRow: { flexDirection: 'row', gap: t.space[8], paddingVertical: t.space[12] },
  intro: { paddingBottom: t.space[12], paddingTop: t.space[4] },
  tileVisual: { borderRadius: t.radius.none },
  skeletonGrid: { paddingTop: t.space[16] },
  wallRow: { flexDirection: 'row' },
  // Equal shares of the row after its gaps; a short last row keeps empty cells, so its tiles have the same width.
  wallCell: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  footer: { height: t.space[32] },
}));

type TileProps = {
  photo: VehicleMedia;
  index: number;
  total: number;
  fallbackAlt: string;
  tileWidth: number;
  onOpen: (index: number) => void;
};

/** One 1:1 photo of the wall, no radius (DQ-1070). */
const Tile = memo(function Tile({ photo, index, total, fallbackAlt, tileWidth, onOpen }: TileProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  return (
    <View style={styles.wallCell}>
      <PressableScale
        role="button"
        aria-label={t('hero.open', { alt: photo.alt || fallbackAlt, current: index + 1, total })}
        onPress={() => onOpen(index)}
        contentStyle={styles.tileVisual}
        testID={`${ROUTE_ID}.photo.${index}`}
      >
        <Photo {...photoFields(photo, tileWidth)} aspect="1:1" corner="none" />
      </PressableScale>
    </View>
  );
});

/** VEH-03 /v/[slug]/gallery: all photos in a grid, filtered by the categories that hold photos. */
export function GalleryScreen() {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const params = useLocalSearchParams<{ slug: string; category?: string }>();
  const slug = paramOf(params.slug) ?? '';
  const initial = paramOf(params.category);
  const back = useBack(`/v/${slug}`);
  const qaState = useQaState();
  const motion = useMotionPreference();
  const { gutter, kind } = useBreakpoint();
  const tabBarInset = useTabBarInset();
  const header = useCollapsingHeader();
  const listRef = useRef<FlashListRef<WallRow>>(null);
  const query = usePublicVehicle(slug);
  const state = useRouteState(query);
  const [filter, setFilter] = useState<Filter>(isMediaCategory(initial) ? initial : 'all');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const [measured, setWidth] = useState<number | null>(null);
  const width = measured ?? windowWidth;
  const vehicle = query.data;
  const all = useMemo(() => (qaState === 'empty' || !vehicle ? [] : photosIn(vehicle.photos, 'all')), [qaState, vehicle]);
  const shown = useMemo(() => (filter === 'all' ? all : all.filter((photo) => photo.category === filter)), [all, filter]);
  const counts = useMemo(() => categoryCounts(all), [all]);
  const { columns, gap } = GRID[kind];
  // The wall runs edge to edge on a phone; from 768 it keeps the column's gutters.
  const wallInset = kind === 'phone' ? 0 : gutter;
  const inner = Math.min(width, layout.contentMax + 2 * layout.gutter.desktop) - 2 * wallInset;
  const tileWidth = Math.max(0, (inner - gap * (columns - 1)) / columns);
  const fallbackAlt = vehicle?.full_title ?? '';
  const open = useCallback((index: number) => setViewerIndex(index), []);
  const separatorStyle = useMemo(() => ({ height: gap }), [gap]);
  const Separator = useCallback(() => <View style={separatorStyle} />, [separatorStyle]);
  // The tab bar's padding and the 32 below the grid stay apart: each is on the spacing scale, their sum is not.
  const listContent = useMemo(() => ({ paddingBottom: tabBarInset, paddingHorizontal: wallInset }), [wallInset, tabBarInset]);
  const headInset = useMemo(() => ({ paddingHorizontal: gutter - wallInset }), [gutter, wallInset]);
  const rowGap = useMemo(() => ({ rowGap: gap }), [gap]);
  const columnGap = useMemo(() => ({ columnGap: gap }), [gap]);
  const rows = useMemo(() => wallRows(shown, columns), [shown, columns]);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    listRef.current?.scrollToOffset({ offset: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  if (state !== 'ready' && state !== 'loading') {
    return (
      <StateScreen routeId={ROUTE_ID} title={t('gallery.title')} onBack={back}>
        <RouteStateBody state={state} routeId={ROUTE_ID} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </StateScreen>
    );
  }

  const filters =
    counts.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} testID={`${ROUTE_ID}.filters`}>
        <View role="radiogroup" aria-label={t('gallery.filterLabel')} style={styles.filterRow}>
          <Chip
            label={t('gallery.all')}
            count={all.length}
            selected={filter === 'all'}
            selectionRole="radio"
            onPress={() => setFilter('all')}
            testID={`${ROUTE_ID}.filter.all`}
          />
          {counts.map(({ category, count }) => (
            <Chip
              key={category}
              label={t(`gallery.categories.${category}`)}
              count={count}
              selected={filter === category}
              selectionRole="radio"
              onPress={() => setFilter(category)}
              testID={`${ROUTE_ID}.filter.${category}`}
            />
          ))}
        </View>
      </ScrollView>
    ) : null;

  let content: ReactNode;
  if (state === 'loading') {
    content = (
      <Skeleton testID={`${ROUTE_ID}.skeleton`} style={{ paddingHorizontal: wallInset }}>
        <View style={[styles.skeletonGrid, rowGap]}>
          {Array.from({ length: SKELETON_ROWS }, (_, row) => (
            <View key={row} style={[styles.wallRow, columnGap]}>
              {Array.from({ length: columns }, (__, column) => (
                <View key={column} style={styles.wallCell}>
                  <SkeletonBlock width="100%" aspectRatio={TILE_RATIO} corner="none" />
                </View>
              ))}
            </View>
          ))}
        </View>
      </Skeleton>
    );
  } else if (all.length === 0) {
    content = (
      <EmptyState icon="image" title={t('gallery.emptyTitle')} body={t('gallery.emptyBody')} testID={`${ROUTE_ID}.empty`} />
    );
  } else {
    content = (
      <CollapsingFlashList<WallRow>
        ref={listRef}
        {...header.scrollProps}
        data={rows}
        key={`${columns}-${filter}`}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => (
          <View style={[styles.wallRow, columnGap]}>
            {item.photos.map((photo, offset) => (
              <Tile
                key={photo.id}
                photo={photo}
                index={item.start + offset}
                total={shown.length}
                fallbackAlt={fallbackAlt}
                tileWidth={tileWidth}
                onOpen={open}
              />
            ))}
            {Array.from({ length: columns - item.photos.length }, (_, empty) => (
              <View key={`empty.${empty}`} style={styles.wallCell} />
            ))}
          </View>
        )}
        ItemSeparatorComponent={Separator}
        ListFooterComponent={<View style={styles.footer} />}
        ListHeaderComponent={
          <View style={headInset}>
            {filters}
            <Text variant="callout" color="text.secondary" style={styles.intro} testID={`${ROUTE_ID}.count`}>
              {t('gallery.count', { count: shown.length })}
            </Text>
          </View>
        }
        contentContainerStyle={listContent}
        style={styles.list}
        testID={`${ROUTE_ID}.grid`}
      />
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE_ID}.root`}>
      <Header title={t('gallery.title')} scroll={header} onBack={back} testID={`${ROUTE_ID}.header`} />
      <ShellOfflineBanner />
      <View style={styles.list} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={styles.column}>{content}</View>
      </View>
      <PhotoViewer photos={shown} fallbackAlt={fallbackAlt} index={viewerIndex} onClose={() => setViewerIndex(null)} />
    </Screen>
  );
}
