import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { social2Keys, useCreateCollection, useDeleteCollection, useRenameCollection, type MemberCollection } from '@/api/queries/social2';
import { hapticFor, haptics } from '@/lib/haptics';
import { createStyles, space } from '@/theme';
import { Icon, PressableScale, SkeletonBlock, SkeletonText, Text, toast } from '@/ui';

import { removeWithUndo, useHiddenRemovals } from '../deferred';
import { CollectionNameSheet } from './CollectionNameSheet';
import { CollectionTile } from './CollectionTile';

const GAP = space[16];
/** Tiles per row: two on phones, three from a 600-point column, four from 900 (the desktop COL-01). */
export function collectionColumns(width: number): number {
  if (width >= 900) return 4;
  if (width >= 600) return 3;
  return 2;
}

export function collectionTileWidth(width: number): number {
  const columns = collectionColumns(width);
  return Math.max(0, Math.floor((width - GAP * (columns - 1)) / columns));
}

const useStyles = createStyles((t) => ({
  grid: { columnGap: GAP, flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[24] },
  newTile: { gap: t.space[8] },
  newMark: {
    alignItems: 'center',
    aspectRatio: 1,
    borderColor: t.color.border.subtle,
    borderRadius: t.radius.md,
    borderWidth: t.size.border.control,
    justifyContent: 'center',
  },
  skeletonText: { gap: t.space[4], marginTop: t.space[8] },
}));

/** "Gespeichert" first (it cannot be deleted), then the member's order. */
export function visibleCollections(collections: readonly MemberCollection[] | undefined, hidden: ReadonlySet<string>): MemberCollection[] {
  return (collections ?? []).filter((collection) => !hidden.has(`collection:${collection.id}`));
}

/**
 * The actions of COL-01 and of PROF-01 "Gespeichert": open, create (sheet), rename (sheet), delete with undo (SM20; the delete
 * is sent once the toast is gone). `element` holds the sheet.
 */
export function useCollectionActions(routeId: string) {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const client = useQueryClient();
  const create = useCreateCollection();
  const rename = useRenameCollection();
  const remove = useDeleteCollection();
  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'rename'; collection: MemberCollection } | null>(null);
  // A new key on every open: the sheet starts from the current name, never from what was typed last time.
  const [opened, setOpened] = useState(0);

  const open = useCallback((collection: MemberCollection) => router.push(`/profile/collections/${collection.id}`), [router]);
  const openCreate = useCallback(() => {
    setOpened((count) => count + 1);
    setSheet({ mode: 'create' });
  }, []);
  const openRename = useCallback((collection: MemberCollection) => {
    setOpened((count) => count + 1);
    setSheet({ mode: 'rename', collection });
  }, []);
  const destroy = useCallback(
    (collection: MemberCollection) => {
      hapticFor('destructiveConfirm');
      const removal = removeWithUndo(
        `collection:${collection.id}`,
        async () => {
          await remove.mutateAsync(collection.id);
          await client.invalidateQueries({ queryKey: social2Keys.collections(), exact: true });
        },
        (error) => {
          void client.invalidateQueries({ queryKey: social2Keys.collections(), exact: true });
          toast(error instanceof Error && error.message ? error.message : t('collections.deleteFailed'), { haptic: 'warning', testID: `${routeId}.toast` });
        },
      );
      toast(t('collections.deleted', { name: collection.name }), { undo: () => removal.undo(), testID: `${routeId}.toast` });
    },
    [client, remove, routeId, t],
  );

  const submit = async (name: string) => {
    if (!sheet) return;
    if (sheet.mode === 'create') {
      const created = await create.mutateAsync(name);
      haptics.light();
      toast(t('collections.created', { name: created.name }), { testID: `${routeId}.toast` });
      return;
    }
    await rename.mutateAsync({ collectionId: sheet.collection.id, name });
  };

  const element: ReactNode = (
    <CollectionNameSheet
      key={opened}
      visible={sheet !== null}
      mode={sheet?.mode ?? 'create'}
      initialName={sheet?.mode === 'rename' ? sheet.collection.name : ''}
      onClose={() => setSheet(null)}
      onSubmit={submit}
      testID={`${routeId}.nameSheet`}
    />
  );
  return { open, openCreate, openRename, destroy, element };
}

export type CollectionsGridProps = {
  collections: readonly MemberCollection[];
  width: number;
  actions: ReturnType<typeof useCollectionActions>;
  /** "Neue Sammlung" as the last tile. */
  withCreate?: boolean;
  routeId: string;
};

/** COL-01 grid: mosaic tiles in rows of 2–4, "Neue Sammlung" last. */
export function CollectionsGrid({ collections, width, actions, withCreate = true, routeId }: CollectionsGridProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const hidden = useHiddenRemovals();
  const tile = collectionTileWidth(width);
  if (tile <= 0) return null;
  return (
    <View style={styles.grid} role="list" testID={`${routeId}.grid`}>
      {visibleCollections(collections, hidden).map((collection) => (
        <View key={collection.id} role="listitem">
          <CollectionTile
            collection={collection}
            width={tile}
            onOpen={actions.open}
            onRename={actions.openRename}
            onDelete={actions.destroy}
            routeId={routeId}
          />
        </View>
      ))}
      {withCreate ? (
        <View role="listitem" style={{ width: tile }}>
          <PressableScale role="button" aria-label={t('collections.new')} onPress={actions.openCreate} contentStyle={styles.newTile} testID={`${routeId}.new`}>
            <View style={styles.newMark}>
              <Icon name="plus" size={24} color="text.secondary" />
            </View>
            {/* DQ-1107 c: the same `headline` as the collection names beside it. "Sammlung" may hyphenate like a name does, so it
                fits a 2-up tile at 200 % (m4.10-shots PROF-01-saved fs2: 173 px word in a 168 px line). */}
            <Text variant="headline" numberOfLines={2} hyphenate>
              {t('collections.new')}
            </Text>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

/** The grid's loading state: tiles in the same geometry. */
export function CollectionsGridSkeleton({ width, count = 4 }: { width: number; count?: number }) {
  const styles = useStyles();
  const tile = collectionTileWidth(width);
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={{ width: tile }}>
          <SkeletonBlock width={tile} height={tile} corner="md" />
          <View style={styles.skeletonText}>
            <SkeletonText variant="headline" width="70%" />
            <SkeletonText variant="caption" width="40%" />
          </View>
        </View>
      ))}
    </View>
  );
}
