import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PHOTOS } from '@/features/gallery/data';
import { createStyles, layout, space } from '@/theme';
import { Icon, Photo, SampleBadges, Text, type PhotoFields } from '@/ui';

const GAP = space[2];
const COLUMN_GAP = space[16];

const useStyles = createStyles((t) => ({
  row: { columnGap: COLUMN_GAP, flexDirection: 'row' },
  tile: { gap: t.space[8] },
  mosaic: { borderRadius: t.radius.md, flexDirection: 'row', flexWrap: 'wrap', gap: GAP, overflow: 'hidden' },
  badges: { left: t.space[8], position: 'absolute', top: t.space[8] },
  meta: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
}));

/**
 * DQ-1033: the preview of an empty COL-01 — two collections as the grid draws them (2 × 2 mosaic, name and lock; no count on a sample, ADR-428), with the
 * bundled seed photos and badged "Beispiel". A picture of the state: hidden from readers, not pressable.
 */
export function SampleCollections({ width, testID }: { width: number; testID: string }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const tile = Math.max(0, Math.floor((Math.min(width, layout.feedColumn) - COLUMN_GAP) / 2));
  const quadrant = (tile - GAP) / 2;
  const samples: readonly { key: string; name: string; photos: readonly PhotoFields[] }[] = [
    { key: 'jdm', name: t('collections.sample.jdm'), photos: [PHOTOS.r34, PHOTOS.wheels, PHOTOS.interior, PHOTOS.e46] },
    { key: 'ideas', name: t('collections.sample.ideas'), photos: [PHOTOS.wheels, PHOTOS.e46, PHOTOS.r34, PHOTOS.interior] },
  ];
  if (tile <= 0) return null;
  return (
    <View aria-hidden style={styles.row} testID={testID}>
      {samples.map((sample) => (
        <View key={sample.key} style={[styles.tile, { width: tile }]}>
          <View style={[styles.mosaic, { width: tile, height: tile }]}>
            {sample.photos.map((photo, index) => (
              <View key={index} style={{ width: quadrant }}>
                <Photo {...photo} aspect="1:1" />
              </View>
            ))}
            <SampleBadges flags={{ is_sample: true }} tone="onPhoto" style={styles.badges} />
          </View>
          <Text variant="headline" numberOfLines={2}>
            {sample.name}
          </Text>
          {/* DQ-1107 a / ADR-428: a sample shows no count; the lock says what a collection is (always private). */}
          <View style={styles.meta}>
            <Icon name="lock-simple" size={16} color="text.secondary" />
            <Text variant="caption" color="text.secondary">
              {t('collections.private')}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
