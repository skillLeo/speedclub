import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type GestureResponderEvent } from 'react-native';

import type { MemberCollection } from '@/api/queries/social2';
import { photoFields } from '@/features/profile/media';
import { hapticFor } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, space } from '@/theme';
import { ContextMenu, ContextMenuButton, Icon, Photo, PressableScale, Text, useContextMenu, type ContextMenuItem } from '@/ui';

/** 09 §7.7: covers of a collection are a 2 × 2 mosaic with hairline gaps; one photo fills the tile. */
const MOSAIC = 4;
const GAP = space[2];

const useStyles = createStyles((t) => ({
  mosaic: { aspectRatio: 1, backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  quadrant: { backgroundColor: t.color.bg.raised },
  emptyMark: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  text: { gap: t.space[2], paddingTop: t.space[8] },
  count: { flex: 1 },
  meta: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
}));

/** The mosaic's quadrants: the photos first, the rest as quiet surface. Exported for the tests. */
export function mosaicSlots<T>(covers: readonly T[]): (T | null)[] {
  if (covers.length <= 1) return [covers[0] ?? null];
  return Array.from({ length: MOSAIC }, (_, index) => covers[index] ?? null);
}

export type CollectionTileProps = {
  collection: MemberCollection;
  width: number;
  onOpen: (collection: MemberCollection) => void;
  onRename: (collection: MemberCollection) => void;
  onDelete: (collection: MemberCollection) => void;
  /** `<routeId>.collection.<id>`, `.menu`. */
  routeId: string;
};

/**
 * COL-01 tile (09 §7.7): the 2 × 2 photo mosaic (radius 12), the name in `headline`, the lock glyph and the entry count — a
 * collection is always private. Long press (native) or the menu button opens Umbenennen and Löschen ("Gespeichert" cannot be
 * deleted, ADR-436 a).
 */
export const CollectionTile = memo(function CollectionTile({ collection, width, onOpen, onRename, onDelete, routeId }: CollectionTileProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const menu = useContextMenu();
  const testID = `${routeId}.collection.${collection.id}`;
  const slots = mosaicSlots(collection.covers);
  const quadrant = slots.length === 1 ? width : (width - GAP) / 2;
  const count = t('collections.count', { count: collection.items_count });
  const items: ContextMenuItem[] = [
    { key: 'rename', label: t('collections.rename'), icon: 'pencil-simple', onSelect: () => onRename(collection) },
    ...(collection.is_default
      ? []
      : [{ key: 'delete', label: t('collections.delete'), icon: 'trash' as const, destructive: true, onSelect: () => onDelete(collection) }]),
  ];
  const openMenuAt = (event: GestureResponderEvent) => {
    hapticFor('longPressMenu');
    const { pageX, pageY } = event.nativeEvent;
    menu.openAt({ x: pageX, y: pageY, width: 0, height: 0 });
  };

  return (
    <View style={{ width }}>
      {/* The mosaic is the link (named by the collection and its count); the name row below carries the actions button beside the
          name, so no control lies over the link (DOM audit overlap High in m4.10-shots COL-01 / PROF-01-saved). */}
      <PressableScale
        role="link"
        aria-label={t('collections.tileLabel', { name: collection.name, count })}
        onPress={() => onOpen(collection)}
        onLongPress={isWeb ? undefined : openMenuAt}
        accessibilityActions={items.map((item) => ({ name: item.key, label: item.label }))}
        onAccessibilityAction={(event) => items.find((item) => item.key === event.nativeEvent.actionName)?.onSelect()}
        testID={testID}
      >
        <View style={styles.mosaic} testID={`${testID}.mosaic`}>
          {collection.covers.length === 0 ? (
            <View style={styles.emptyMark}>
              <Icon name="bookmark-simple" size={24} color="text.tertiary" />
            </View>
          ) : (
            <View style={styles.grid}>
              {slots.map((cover, index) =>
                cover ? (
                  <View key={cover.id} style={{ width: quadrant }}>
                    <Photo {...photoFields(cover, quadrant)} aspect="1:1" />
                  </View>
                ) : (
                  <View key={`empty-${index}`} style={[styles.quadrant, { width: quadrant, height: quadrant }]} />
                ),
              )}
            </View>
          )}
        </View>
      </PressableScale>
      {/* The name takes the tile's width (a long German name may hyphenate: "Gespei-chert" at 200 %); the actions button sits on
          the meta line below it. */}
      <View style={styles.text}>
        <Text variant="headline" numberOfLines={2} hyphenate testID={`${testID}.name`}>
          {collection.name}
        </Text>
        <View style={styles.meta}>
          <Icon name="lock-simple" size={16} color="text.secondary" />
          <Text variant="caption" color="text.secondary" numeric style={styles.count}>
            {count}
          </Text>
          {/* The findable way to the actions (web has no long press; 09 §5 ContextMenu). */}
          <ContextMenuButton items={items} label={t('collections.actions', { name: collection.name })} testID={`${testID}.more`} />
        </View>
      </View>
      <ContextMenu visible={menu.visible} anchor={menu.anchor} items={items} label={t('collections.actions', { name: collection.name })} onClose={menu.close} testID={`${testID}.menu`} />
    </View>
  );
});
