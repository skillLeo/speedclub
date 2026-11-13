import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import {
  flattenCollectionItems,
  social2Keys,
  useCollectionItems,
  useCollections,
  useRemoveCollectionItem,
  useReorderCollectionItems,
  type MemberCollection,
} from '@/api/queries/social2';
import { BuildWallSkeleton, wallCellWidth, wallRows, WALL_GAP } from '@/features/discover/components/BuildWall';
import { WALL_COLUMNS_BY_KIND } from '@/features/discover/layout';
import { SampleWall } from '@/features/discover/components/SampleWall';
import { photoFields } from '@/features/profile/media';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { MoreSheet, type MoreAction } from '@/features/vehicle/components/MoreSheet';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { hapticFor } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { clearAuthIntent, useSessionStore } from '@/state/session';
import { createStyles, layout, useBreakpoint } from '@/theme';
import {
  CollapsingFlashList,
  ContextMenuButton,
  EmptyState,
  ErrorState,
  Header,
  HeaderLargeTitle,
  Icon,
  MediaCard,
  Screen,
  Skeleton,
  Text,
  toast,
  useCollapsingHeader,
  type ContextMenuItem,
} from '@/ui';

import { useCollectionActions } from '../components/CollectionsGrid';
import { removeWithUndo, useHiddenRemovals } from '../deferred';
import { itemRemovalKey, itemTile, moveKey, type ItemTile } from '../model';

const ROUTE = 'COL-02';
const EDGES: readonly Edge[] = ['left', 'right'];
const SKELETON_CELLS = 6;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  head: { paddingBottom: t.space[16] },
  meta: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  row: { flexDirection: 'row', gap: WALL_GAP, paddingBottom: t.space[8] },
  // m4.10 COL-02 overlap High: the menu sits on a caption line under the tile, never over the tile's link.
  cellFoot: { alignItems: 'center', flexDirection: 'row', gap: t.space[4], paddingLeft: t.space[8] },
  cellKind: { flex: 1 },
  states: { paddingTop: t.space[8] },
  end: { paddingBottom: t.space[32] },
}));

type CellProps = {
  tile: ItemTile;
  index: number;
  total: number;
  width: number;
  /** DQ-1107 b: the kind under the tile only when the collection mixes kinds. */
  showKind: boolean;
  onOpen: (tile: ItemTile) => void;
  onMove: (tile: ItemTile, step: -1 | 1 | 'first') => void;
  onRemove: (tile: ItemTile) => void;
};

/** One saved item: a `wall` MediaCard and its menu (Nach vorn, Nach hinten, An den Anfang, Entfernen). */
const ItemCell = memo(function ItemCell({ tile, index, total, width, showKind, onOpen, onMove, onRemove }: CellProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const testID = `${ROUTE}.item.${tile.key}`;
  const items: ContextMenuItem[] = [
    { key: 'first', label: t('collections.moveFirst'), icon: 'push-pin', disabled: index === 0, onSelect: () => onMove(tile, 'first') },
    { key: 'forward', label: t('collections.moveForward'), icon: 'caret-left', disabled: index === 0, onSelect: () => onMove(tile, -1) },
    { key: 'back', label: t('collections.moveBack'), icon: 'caret-right', disabled: index === total - 1, onSelect: () => onMove(tile, 1) },
    { key: 'remove', label: t('collections.removeItem'), icon: 'trash', destructive: true, onSelect: () => onRemove(tile) },
  ];
  return (
    <View role="listitem" style={{ width }}>
      <MediaCard
        variant="wall"
        title={tile.title || t('collections.updateFallback')}
        photo={photoFields(tile.cover, width)}
        sample={{ is_sample: tile.isSample }}
        onPress={tile.href ? () => onOpen(tile) : undefined}
        testID={testID}
      />
      <View style={styles.cellFoot}>
        <View style={styles.cellKind}>
          {showKind ? (
            <Text variant="caption" color="text.secondary" numberOfLines={1} testID={`${testID}.kind`}>
              {t(`collections.kind.${tile.type}`)}
            </Text>
          ) : null}
        </View>
        <ContextMenuButton
          items={items}
          label={t('collections.itemActions', { name: tile.title || t('collections.updateFallback') })}
          testID={`${testID}.more`}
        />
      </View>
    </View>
  );
});

/**
 * COL-02 (09 §7.7): the wall of one collection — builds, mods and updates — 2 px apart, edge to edge. Each tile's menu moves it
 * (keyboard and screen readers included) or takes it out with Rückgängig (SM20); the header's menu renames or deletes the
 * collection ("Gespeichert" is renamed only). Private: only the member sees it.
 */
export function CollectionScreen() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const collectionId = paramOf(params.id) ?? '';
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const back = useBack('/profile/collections');
  const { gutter, kind } = useBreakpoint();
  // The window until the first layout, so the first frame already has its columns.
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const [moreOpen, setMoreOpen] = useState(false);
  const hidden = useHiddenRemovals();
  const collections = useCollections();
  const items = useCollectionItems(collectionId);
  const reorder = useReorderCollectionItems(collectionId);
  const remove = useRemoveCollectionItem();
  const actions = useCollectionActions(ROUTE);
  const collection: MemberCollection | undefined = collections.data?.find((entry) => entry.id === collectionId);

  const columns = WALL_COLUMNS_BY_KIND[kind];
  // Edge to edge on phones (09 §5 result wall); inside the gutters from 768.
  const wallWidth = Math.min(width, layout.contentMax) - (kind === 'phone' ? 0 : 2 * gutter);
  const cell = wallCellWidth(wallWidth, columns);
  const tiles = useMemo(
    () =>
      qaState === 'empty'
        ? []
        : flattenCollectionItems(items.data)
            .map(itemTile)
            .filter((tile) => !hidden.has(itemRemovalKey(collectionId, tile.key))),
    [collectionId, hidden, items.data, qaState],
  );
  const rows = useMemo(() => wallRows(tiles, columns), [columns, tiles]);
  const mixed = useMemo(() => new Set(tiles.map((tile) => tile.type)).size > 1, [tiles]);

  const open = useCallback((tile: ItemTile) => tile.href && router.push(tile.href), [router]);
  const move = useCallback(
    (tile: ItemTile, step: -1 | 1 | 'first') => {
      hapticFor('reorderPickUp');
      const next = moveKey(
        tiles.map((entry) => entry.key),
        tile.key,
        step,
      );
      reorder.mutate(next, {
        onError: (error) => toast(error.message || t('collections.moveFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` }),
      });
    },
    [reorder, t, tiles],
  );
  const removeItem = useCallback(
    (tile: ItemTile) => {
      const removal = removeWithUndo(
        itemRemovalKey(collectionId, tile.key),
        async () => {
          await remove.mutateAsync({ collectionId, type: tile.type, id: tile.id });
          await client.invalidateQueries({ queryKey: social2Keys.collectionItems(collectionId) });
        },
        (error) =>
          toast(error instanceof Error && error.message ? error.message : t('collections.removeFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` }),
      );
      toast(t('collections.removed', { name: tile.title || t('collections.updateFallback') }), { undo: () => removal.undo(), testID: `${ROUTE}.toast` });
    },
    [client, collectionId, remove, t],
  );

  const title = collection?.name ?? (collections.isPending ? '' : t('collections.title'));
  const loading =
    qaState === 'loading' ||
    status === 'loading' ||
    (status === 'member' && !items.data && items.isPending && items.fetchStatus !== 'paused' && qaState !== 'error' && qaState !== 'offline');
  const missing = status === 'member' && collections.isSuccess && !collection && qaState !== 'loading';

  let state: ReactNode = null;
  if (status === 'guest') {
    state = (
      <EmptyState
        preview={<SampleWall testID={`${ROUTE}.guest.sample`} />}
        title={t('collections.guestTitle')}
        body={t('collections.guestBody')}
        action={{
          label: t('guest.signIn'),
          onPress: () => {
            clearAuthIntent();
            router.push({ pathname: '/auth/email', params: { returnTo: `/profile/collections/${collectionId}` } });
          },
        }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (loading) {
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <BuildWallSkeleton width={wallWidth} columns={columns} count={SKELETON_CELLS} />
      </Skeleton>
    );
  } else if (missing) {
    state = (
      <EmptyState
        preview={<SampleWall testID={`${ROUTE}.missing.sample`} />}
        title={t('collections.missingTitle')}
        body={t('collections.missingBody')}
        action={{ label: t('collections.toAll'), onPress: () => router.replace('/profile/collections'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.missing`}
      />
    );
  } else if (qaState === 'error' || qaState === 'offline' || !items.data) {
    const offline = qaState === 'offline' || (qaState !== 'error' && (!online || items.fetchStatus === 'paused'));
    state = (
      <ErrorState
        title={offline ? t('error.offlineTitle') : t('collections.errorTitle')}
        message={offline ? t('collections.offlineBody') : undefined}
        onRetry={() => void items.refetch()}
        retrying={items.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (tiles.length === 0) {
    state = (
      <EmptyState
        preview={<SampleWall testID={`${ROUTE}.empty.sample`} />}
        title={t('collections.emptyItemsTitle')}
        body={t('collections.emptyItemsBody')}
        action={{ label: t('collections.discover'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const moreActions: MoreAction[] = collection
    ? [
        { key: 'rename', icon: 'pencil-simple', label: t('collections.rename'), onPress: () => actions.openRename(collection) },
        ...(collection.is_default
          ? []
          : [
              {
                key: 'delete',
                icon: 'trash' as const,
                label: t('collections.delete'),
                onPress: () => {
                  actions.destroy(collection);
                  back();
                },
              },
            ]),
      ]
    : [];

  const pad = { paddingHorizontal: gutter };
  const wallBox = kind === 'phone' ? null : pad;

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        title={title}
        scroll={header}
        onBack={back}
        actions={
          collection && status === 'member'
            ? [{ icon: 'dots-three', label: t('collections.actions', { name: collection.name }), onPress: () => setMoreOpen(true), testID: `${ROUTE}.more` }]
            : undefined
        }
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('collections.offlineBanner')} />
      <View style={styles.list} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
        <CollapsingFlashList
          {...header.scrollProps}
          data={state ? [] : rows}
          keyExtractor={(row: ItemTile[]) => row[0]?.key ?? 'row'}
          extraData={`${cell}.${mixed}`}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: inset }}
          onEndReached={() => {
            if (items.hasNextPage && !items.isFetchingNextPage) void items.fetchNextPage();
          }}
          ListHeaderComponent={
            <View style={styles.head}>
              <HeaderLargeTitle title={title} scroll={header} testID={`${ROUTE}.title`} />
              {collection ? (
                <View style={[styles.meta, pad]} testID={`${ROUTE}.meta`}>
                  <Icon name="lock-simple" size={16} color="text.secondary" />
                  <Text variant="caption" color="text.secondary" numeric>
                    {t('collections.privateCount', { count: collection.items_count })}
                  </Text>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={state ? <View style={[pad, styles.states]}>{state}</View> : null}
          ListFooterComponent={
            items.isFetchingNextPage ? (
              <View style={wallBox}>
                <BuildWallSkeleton width={wallWidth} columns={columns} count={columns} />
              </View>
            ) : (
              <View style={styles.end} />
            )
          }
          renderItem={({ item: row, index: rowIndex }: { item: ItemTile[]; index: number }) => (
            <View style={[styles.row, wallBox]} role="list">
              {row.map((tile, column) => (
                <ItemCell
                  key={tile.key}
                  tile={tile}
                  index={rowIndex * columns + column}
                  total={tiles.length}
                  width={cell}
                  showKind={mixed}
                  onOpen={open}
                  onMove={move}
                  onRemove={removeItem}
                />
              ))}
            </View>
          )}
          testID={`${ROUTE}.list`}
        />
      </View>
      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={title} actions={moreActions} testID={`${ROUTE}.moreSheet`} />
      {actions.element}
    </Screen>
  );
}
