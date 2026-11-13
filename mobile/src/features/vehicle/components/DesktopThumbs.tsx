import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { VehicleMedia } from '@/api/queries/vehicles';
import { createStyles } from '@/theme';
import { Photo, PressableScale, Text } from '@/ui';

import { photoFields } from '../media';

/** FS-10 desktop: one large photo and up to four small ones under it; the last says how many more there are. */
const THUMBS = 4;
const MIN_COLUMNS = 2;
const THUMB_WIDTH = 168;

/** How many thumbnails a vehicle with this many photos shows, and in how many columns (two at least). */
export function thumbLayout(photoCount: number): { thumbs: number; columns: number } {
  const thumbs = Math.max(0, Math.min(THUMBS, photoCount - 1));
  return { thumbs, columns: Math.max(MIN_COLUMNS, thumbs) };
}

/** The row's own geometry, shared with the loading state (DQ-178). */
export const useThumbRowStyles = createStyles((t) => ({
  row: { flexDirection: 'row', gap: t.space[8], marginTop: t.space[8] },
  tile: { flex: 1 },
}));

const useStyles = createStyles((t) => ({
  visual: { borderRadius: t.radius.sm },
  more: { alignItems: 'center', backgroundColor: t.color.onPhoto.chipBg, justifyContent: 'center', pointerEvents: 'none' },
}));

export type DesktopThumbsProps = {
  /** All photos with a file; the thumbnails are the second to the fifth. */
  photos: readonly VehicleMedia[];
  fallbackAlt: string;
  /** The index in `photos`. */
  onSelect: (index: number) => void;
  testID: string;
};

export function DesktopThumbs({ photos, fallbackAlt, onSelect, testID }: DesktopThumbsProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const rowStyles = useThumbRowStyles();
  const { thumbs: count, columns } = thumbLayout(photos.length);
  const thumbs = photos.slice(1, 1 + count);
  if (thumbs.length === 0) return null;
  const hidden = photos.length - 1 - THUMBS;

  return (
    <View style={rowStyles.row} testID={testID}>
      {thumbs.map((photo, position) => {
        const index = position + 1;
        const last = position === thumbs.length - 1;
        return (
          <PressableScale
            key={photo.id}
            role="button"
            aria-label={t('hero.show', { alt: photo.alt || fallbackAlt, current: index + 1, total: photos.length })}
            onPress={() => onSelect(index)}
            style={rowStyles.tile}
            contentStyle={styles.visual}
            testID={`${testID}.${index}`}
          >
            <Photo {...photoFields(photo, THUMB_WIDTH)} aspect="4:3" corner="sm">
              {last && hidden > 0 ? (
                <View style={[StyleSheet.absoluteFill, styles.more]}>
                  <Text variant="bodyStrong" color="onPhoto.primary" selectable={false}>
                    {t('hero.morePhotos', { count: hidden })}
                  </Text>
                </View>
              ) : null}
            </Photo>
          </PressableScale>
        );
      })}
      {Array.from({ length: columns - thumbs.length }, (_, index) => (
        <View key={`empty-${index}`} style={rowStyles.tile} />
      ))}
    </View>
  );
}
