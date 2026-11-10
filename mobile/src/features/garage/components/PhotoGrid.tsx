import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { GarageMedia } from '@/api/queries/garage';
import { photoFields } from '@/features/vehicle/media';
import type { UploadItem } from '@/state/uploads';
import { createStyles, space } from '@/theme';
import { Icon, Photo, PressableScale, Progress, Spinner, Text } from '@/ui';
import { useStacksAtFontScale } from '@/ui/rowParts';

/** The grid's columns and gap, also the geometry of GAR-07's skeleton. */
export const PHOTO_GRID_COLUMNS = 3;
export const PHOTO_GRID_GAP = space[8];
const COLUMNS = PHOTO_GRID_COLUMNS;
const GAP = PHOTO_GRID_GAP;

const useStyles = createStyles((t) => ({
  // Each tile keeps its own height: a taller add tile must not stretch the photos beside it.
  grid: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: t.radius.sm, overflow: 'hidden' },
  badge: {
    alignItems: 'center',
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    left: t.space[4],
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[4],
    position: 'absolute',
    top: t.space[4],
  },
  veil: { alignItems: 'center', backgroundColor: t.color.onPhoto.chipBg, gap: t.space[4], justifyContent: 'center' },
  add: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.default,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    gap: t.space[4],
    justifyContent: 'center',
    padding: t.space[8],
  },
  addLabel: { textAlign: 'center' },
  addWide: { width: '100%' },
  // No photo to show, so the tile stands on its own surface: its text and icon follow the theme, not a veil over an image. Like
  // the add tile it is at least as tall as a photo and grows with its caption, so a large font never squeezes the glyph.
  failed: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.default,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    gap: t.space[4],
    justifyContent: 'center',
    padding: t.space[8],
  },
  // The glyph keeps its 20 whatever the caption needs.
  glyph: { flexShrink: 0 },
}));

export type PhotoGridProps = {
  photos: readonly GarageMedia[];
  uploads: readonly UploadItem[];
  /** The vehicle's cover; without one the first photo is the cover (API: null falls back to the first). */
  coverId?: string | null;
  /** Hides the add tile once the limit is reached (30 per vehicle, 6 per mod). */
  canAdd: boolean;
  adding?: boolean;
  onAdd: () => void;
  onPressPhoto?: (photo: GarageMedia, index: number) => void;
  onPressUpload: (item: UploadItem) => void;
  /** Uploads that failed on the server: tiles after the photos, outside every count and order. Their only action is delete. */
  failed?: readonly GarageMedia[];
  onPressFailed?: (photo: GarageMedia) => void;
  /** The cover badge only means something for a vehicle. */
  showCover?: boolean;
  /** Offline: nothing on the grid can reach the server. */
  disabled?: boolean;
  /**
   * Under a restriction only adding stops: a photo still opens its sheet, because a member can always take their own
   * content down (ADR-146 b; DELETE media stays open).
   */
  addDisabled?: boolean;
  fallbackAlt: string;
  testID: string;
};

/**
 * FS-6 "3-column grid with add tile", also GAR-03 step 3 and GAR-07: the server's photos, then what the upload queue still
 * holds with its progress ring (§8: ring 20 on the tile), then the add tile. A failed upload stays as a tile with its reason
 * one tap away. At most 30 tiles, inside a form's scroll view, so the grid is a plain wrapping row.
 */
export function PhotoGrid({
  photos,
  uploads,
  coverId,
  canAdd,
  adding = false,
  onAdd,
  onPressPhoto,
  onPressUpload,
  failed = [],
  onPressFailed,
  showCover = true,
  disabled = false,
  addDisabled = false,
  fallbackAlt,
  testID,
}: PhotoGridProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const tile = width > 0 ? (width - GAP * (COLUMNS - 1)) / COLUMNS : 0;
  const size = { width: tile };
  // DQ-154: the add tile is at least as tall as a photo (4:3) and grows with its label. From a large font a third of the
  // row is too narrow for "hinzufügen", so the tile takes the whole row and the label wraps inside it.
  const wideAdd = useStacksAtFontScale();
  const addSize = wideAdd ? styles.addWide : size;
  const addHeight = { minHeight: (tile * 3) / 4 };
  const cover = coverId ?? photos.find((photo) => photo.status === 'ready')?.id ?? null;
  const total = photos.length;
  const failedText = t('photos.failedServer');
  // The tile says it in two words; the whole sentence is its label and the dialog's body.
  const failedCaption = wideAdd ? t('upload.failedShort') : t('photos.failedTile');

  return (
    <View style={styles.grid} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} testID={testID}>
      {tile > 0
        ? photos.map((photo, index) => {
            const isCover = showCover && photo.id === cover;
            const label = [
              t('photos.tileLabel', { current: index + 1, total, alt: photo.alt?.trim() || fallbackAlt }),
              isCover ? t('photos.cover') : null,
              photo.status === 'processing' ? t('photos.processing') : null,
              photo.status === 'failed' ? t('photos.failedServer') : null,
            ]
              .filter(Boolean)
              .join(', ');
            return (
              <PressableScale
                key={photo.id}
                role="button"
                aria-label={label}
                disabled={disabled || !onPressPhoto}
                onPress={() => onPressPhoto?.(photo, index)}
                style={size}
                contentStyle={styles.tile}
                testID={`${testID}.photo.${photo.id}`}
              >
                <Photo {...photoFields(photo, tile)} aspect="4:3" corner="sm">
                  {isCover ? (
                    <View style={styles.badge} testID={`${testID}.photo.${photo.id}.cover`}>
                      <Text variant="badge" color="onPhoto.primary">
                        {t('photos.cover')}
                      </Text>
                    </View>
                  ) : null}
                  {photo.status !== 'ready' ? (
                    <View style={[StyleSheet.absoluteFill, styles.veil]}>
                      {photo.status === 'processing' ? (
                        <Spinner size={20} color="onPhoto.primary" decorative />
                      ) : (
                        <Icon name="warning" size={20} color="onPhoto.primary" />
                      )}
                    </View>
                  ) : null}
                </Photo>
              </PressableScale>
            );
          })
        : null}
      {tile > 0
        ? failed.map((photo) => (
            <PressableScale
              key={photo.id}
              role="button"
              aria-label={`${photo.alt?.trim() || fallbackAlt}, ${failedText}`}
              disabled={disabled || !onPressFailed}
              onPress={() => onPressFailed?.(photo)}
              style={[size, addHeight]}
              contentStyle={[styles.failed, addHeight]}
              testID={`${testID}.failed.${photo.id}`}
            >
              <View style={styles.glyph}>
                <Icon name="warning" size={20} color="accent.fg" />
              </View>
              {/* From a large font a third of the row holds one word; the whole sentence stays in the label and the dialog. */}
              <Text variant="caption" color="text.secondary" hyphenate={false} numberOfLines={wideAdd ? 1 : 2} style={styles.addLabel} testID={`${testID}.failed.${photo.id}.status`}>
                {failedCaption}
              </Text>
            </PressableScale>
          ))
        : null}
      {tile > 0
        ? uploads.map((item) => {
            const failed = item.status === 'failed';
            const state = t(`upload.status.${item.status}`);
            return (
              <PressableScale
                key={item.id}
                role="button"
                aria-label={failed && item.error ? `${state}: ${item.error}` : state}
                onPress={() => onPressUpload(item)}
                style={size}
                contentStyle={styles.tile}
                testID={`${testID}.upload.${item.id}`}
              >
                <Photo source={item.source.uri} aspect="4:3" corner="sm">
                  <View style={[StyleSheet.absoluteFill, styles.veil]}>
                    {failed ? (
                      <Icon name="warning" size={20} color="onPhoto.primary" />
                    ) : (
                      <Progress variant="ring" onPhoto value={item.status === 'uploading' ? item.progress : 0} label={state} />
                    )}
                    <Text variant="caption" color="onPhoto.primary" hyphenate={false} numberOfLines={1} testID={`${testID}.upload.${item.id}.status`}>
                      {failed ? t('upload.failedShort') : state}
                    </Text>
                  </View>
                </Photo>
              </PressableScale>
            );
          })
        : null}
      {tile > 0 && canAdd ? (
        <PressableScale
          role="button"
          aria-label={t('photos.addShort')}
          aria-busy={adding}
          disabled={disabled || addDisabled || adding}
          onPress={onAdd}
          style={[addSize, addHeight]}
          contentStyle={styles.add}
          testID={`${testID}.add`}
        >
          {adding ? <Spinner size={20} color="text.secondary" decorative /> : <Icon name="camera" size={20} color="text.secondary" />}
          <Text variant="caption" color="text.secondary" style={styles.addLabel} hyphenate={false}>
            {t('photos.addShort')}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}
