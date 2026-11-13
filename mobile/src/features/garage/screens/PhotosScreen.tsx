import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useReorderMedia, type GarageMedia, type GarageVehicle } from '@/api/queries/garage';
import { photoFields } from '@/features/vehicle/media';
import { estimatedTextWidth } from '@/features/vehicle/skeletonGeometry';
import { isWeb } from '@/lib/platform';
import { useOnline } from '@/state/online';
import { createStyles, size, space, typography, useBreakpoint, useTheme } from '@/theme';
import { Button, DiscardGuardDialog, Photo, Skeleton, SkeletonBlock, SkeletonText, Text, toast } from '@/ui';
import { useStacksAtFontScale } from '@/ui/rowParts';
import { estimateLines } from '@/ui/Skeleton';

import { EditorScreen, FORM_MAX_WIDTH, RestrictedNotice, HEADER_TEXT_ACTION } from '../components/frames';
import { PHOTO_GRID_COLUMNS, PHOTO_GRID_GAP } from '../components/PhotoGrid';
import { SortHandleSlot, Sortable } from '../components/Sortable';
import { VehiclePhotos } from '../components/VehiclePhotos';
import { saveErrorMessage } from '../errors';
import { completeOrder } from '../model';
import { VEHICLE_PHOTO_LIMIT } from '../photos';
import { useOwnVehicle, type KnownVehicle } from '../useOwnVehicle';

const ROUTE = 'GAR-07';
const GRID_COLUMNS = 3;
const PHOTO_RATIO = 4 / 3;
/** Without a cached vehicle or garage card: one row, two photos and the add tile. */
const SKELETON_FALLBACK_PHOTOS = 2;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { paddingBottom: t.space[32], paddingTop: t.space[16] },
  // DQ-156: from 768 the column starts on the gutter under back (frames.tsx usePushedHeaderWidth).
  column: { alignSelf: 'flex-start', gap: t.space[16], maxWidth: FORM_MAX_WIDTH, width: '100%' },
  cell: { borderRadius: t.radius.sm, flex: 1, overflow: 'hidden' },
  cellActive: { opacity: t.opacity.pressed },
  handle: { backgroundColor: t.color.onPhoto.chipBg, borderRadius: t.radius.full, position: 'absolute', right: t.space[2], top: t.space[2] },
  // VehiclePhotos and PhotoGrid: grid, count and plate reminder 12 apart; each tile keeps its own height.
  skeletonRoot: { gap: t.space[12] },
  skeletonGrid: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: PHOTO_GRID_GAP },
  skeletonReminder: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8] },
  skeletonReminderText: { flex: 1, minWidth: 0 },
}));

/** GAR-07 /garage/[id]/photos: add, upload progress, cover, alt text and focal point (GAR-08), delete, reorder. */
export function PhotosScreen() {
  const { t } = useTranslation('garage');
  const own = useOwnVehicle(ROUTE, { path: 'photos', loading: (known) => <PhotosSkeleton known={known} /> });
  const [sorting, setSorting] = useState(false);
  const [order, setOrder] = useState<GarageMedia[] | null>(null);
  const reorder = useReorderMedia({ id: own.id, slug: own.vehicle?.slug ?? '' });
  const online = useOnline();
  const canSort = (own.vehicle?.photos.length ?? 0) > 1;

  const finish = () => {
    const next = order;
    setSorting(false);
    setOrder(null);
    if (!next) return;
    // The order was taken at the first move; uploads keep running while the member sorts.
    reorder.mutate(
      completeOrder(
        next.map((photo) => photo.id),
        (own.vehicle?.photos ?? []).map((photo) => photo.id),
      ),
      {
        onSuccess: () => toast(t('photos.sortSaved'), { testID: `${ROUTE}.toast` }),
        onError: (error) => toast(saveErrorMessage(t, error), { testID: `${ROUTE}.toast` }),
      },
    );
  };

  const trailing =
    own.vehicle && (sorting || canSort) ? (
      <Button
        label={sorting ? t('garage.sortDone') : t('garage.sort')}
        variant="tertiary"
        size="s"
        style={HEADER_TEXT_ACTION}
        disabled={!sorting && (own.restriction !== null || !online)}
        onPress={sorting ? finish : () => setSorting(true)}
        testID={`${ROUTE}.${sorting ? 'sortDone' : 'sort'}`}
      />
    ) : null;

  return (
    <EditorScreen routeId={ROUTE} title={t('photos.title')} fallback={own.id ? `/garage/${own.id}` : '/garage'} trailing={trailing} offlineLabel={t('offline.photos')}>
      {own.state ??
        (own.vehicle ? (
          <PhotosBody vehicle={own.vehicle} restriction={own.restriction} sorting={sorting} order={order ?? own.vehicle.photos} onOrder={setOrder} />
        ) : null)}
      {/* A sort is saved by "Fertig", which clears the order first, so only leaving without it asks. */}
      <DiscardGuardDialog dirty={sorting && order !== null} testID={`${ROUTE}.discard`} />
    </EditorScreen>
  );
}

function PhotosBody({
  vehicle,
  restriction,
  sorting,
  order,
  onOrder,
}: {
  vehicle: GarageVehicle;
  restriction: string | null;
  sorting: boolean;
  order: GarageMedia[];
  onOrder: (next: GarageMedia[]) => void;
}) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const { gutter } = useBreakpoint();
  const [dragging, setDragging] = useState(false);
  const locked = restriction !== null;

  return (
    <ScrollView style={styles.scroll} scrollEnabled={!dragging} contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]} testID={`${ROUTE}.scroll`}>
      <View style={styles.column}>
        {locked && restriction ? <RestrictedNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
        {sorting ? (
          <>
            <Text variant="callout" color="text.secondary" testID={`${ROUTE}.sortHint`}>
              {isWeb ? t('photos.sortHintWeb') : t('photos.sortHint')}
            </Text>
            <Sortable
              items={order}
              keyOf={(photo) => photo.id}
              labelOf={(photo) => photo.alt?.trim() || t('photos.photoN', { number: order.indexOf(photo) + 1 })}
              columns={GRID_COLUMNS}
              aspectRatio={PHOTO_RATIO}
              gap={space[8]}
              onChange={onOrder}
              onDragging={setDragging}
              handleTone="onPhoto"
              renderItem={(photo, { active }) => (
                <View style={[styles.cell, active ? styles.cellActive : null]}>
                  <Photo {...photoFields(photo, FORM_MAX_WIDTH / GRID_COLUMNS)} aspect="4:3" corner="sm" style={StyleSheet.absoluteFill} />
                  <View style={styles.handle}>
                    <SortHandleSlot />
                  </View>
                </View>
              )}
              testID={`${ROUTE}.sortable`}
            />
          </>
        ) : (
          <VehiclePhotos
            vehicle={vehicle}
            disabled={!online}
            locked={locked}
            onEditPhoto={(photo) => router.push(`/garage/${vehicle.id}/photos/${photo.id}`)}
            failedPhotos={vehicle.failed_photos}
            routeId={ROUTE}
          />
        )}
      </View>
    </ScrollView>
  );
}

/**
 * DQ-207: GAR-07 loads in its own shape, the 4:3 tiles of PhotoGrid (as many as the vehicle or its garage card already
 * counts) with the add tile, then the count and the plate reminder of VehiclePhotos.
 */
function PhotosSkeleton({ known }: { known: KnownVehicle }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const theme = useTheme();
  const wideAdd = useStacksAtFontScale();
  const [width, setWidth] = useState(0);
  const photos = Math.min(known.vehicle?.photos.length ?? known.card?.photo_count ?? SKELETON_FALLBACK_PHOTOS, VEHICLE_PHOTO_LIMIT);
  const tile = width > 0 ? (width - PHOTO_GRID_GAP * (PHOTO_GRID_COLUMNS - 1)) / PHOTO_GRID_COLUMNS : 0;
  // The add tile: a photo's height at least, or its icon and label in their padding once a large font makes them taller.
  const addHeight = Math.max(tile / PHOTO_RATIO, 2 * space[8] + size.icon.m + space[4] + typography.caption.lineHeight * theme.fontScale);
  // No line longer than its text (§8): a one-line text gets its own width, the count its real words.
  const reminder = t('photos.plateReminder');
  const reminderSpace = width - size.icon.s - space[8];
  const reminderLines = estimateLines(reminder.length, 'caption', theme.fontScale, reminderSpace);
  const reminderWidth = reminderLines > 1 ? '100%' : Math.min(reminderSpace, estimatedTextWidth(reminder, 'caption', theme.fontScale));
  const countWidth = Math.min(width, estimatedTextWidth(t('photos.count', { count: photos, max: VEHICLE_PHOTO_LIMIT }), 'caption', theme.fontScale));
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.column}>
        <View style={styles.skeletonRoot}>
          <View style={styles.skeletonGrid} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            {tile > 0
              ? Array.from({ length: photos }, (_, index) => <SkeletonBlock key={index} width={tile} aspectRatio={PHOTO_RATIO} corner="sm" />)
              : null}
            {tile > 0 && photos < VEHICLE_PHOTO_LIMIT ? <SkeletonBlock width={wideAdd ? '100%' : tile} height={addHeight} corner="sm" /> : null}
          </View>
          <SkeletonText variant="caption" width={countWidth} />
          <View style={styles.skeletonReminder}>
            <SkeletonBlock width={size.icon.s} height={size.icon.s} />
            <SkeletonText variant="caption" lines={reminderLines} width={reminderWidth} style={styles.skeletonReminderText} />
          </View>
        </View>
      </View>
    </Skeleton>
  );
}
