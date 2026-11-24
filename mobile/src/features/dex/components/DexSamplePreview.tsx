import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';

import { TILE_GAP } from '../layout';
import { SAMPLE_PHOTO, SAMPLE_SPOT } from '../sample';
import { DexTile, SilhouetteTile } from './DexTile';

const useStyles = createStyles(() => ({
  // The slot keeps its own, shorter height beside the card (DQ-P5G-08).
  row: { alignItems: 'flex-start', alignSelf: 'center', flexDirection: 'row', gap: TILE_GAP },
  // R4DQ-12: under the empty Dex's left-aligned steps and action, the preview starts on the same edge.
  start: { alignSelf: 'flex-start' },
}));

/**
 * The empty Dex's real preview (09 §5 "never empty"): the sample R34 as a card, badged "Beispiel", beside a "???" slot as an
 * active set shows it. No number, no count, no owner: nothing on it claims to be somebody's data.
 */
export function DexSamplePreview({ width, align = 'center', testID }: { width: number; align?: 'center' | 'start'; testID: string }) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const card = { spot_id: SAMPLE_SPOT.spot_id, first_spotter: false, vehicle: SAMPLE_SPOT.vehicle };
  return (
    <View style={[styles.row, align === 'start' ? styles.start : null]} testID={testID}>
      <View style={{ width }}>
        <DexTile card={card} width={width} photo={SAMPLE_PHOTO} sampleLabel={t('badges.sample')} testID={`${testID}.card`} />
      </View>
      <View style={{ width }}>
        <SilhouetteTile silhouette={{ make: 'Honda', generation: 'EK9' }} width={width} testID={`${testID}.open`} />
      </View>
    </View>
  );
}
