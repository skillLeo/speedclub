import { View } from 'react-native';

import { EMPTY_HERO, SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import { aspect, createStyles } from '@/theme';
import { Photo, PhotoStageScrim, SampleBadges, Text, type PhotoFields } from '@/ui';

import { WALL_GAP } from './BuildWall';

/**
 * The two sample builds of the preview: licensed seed photos bundled with the app (design/seed-photos/CREDITS.md) and real
 * cars, always badged "Beispiel". Car names are the same in every language.
 */
const SAMPLES: readonly { key: string; title: string; photo: PhotoFields }[] = [
  { key: 'e46', title: 'BMW M3 E46', photo: EMPTY_HERO }, // i18n-ignore
  { key: 'r34', title: 'Nissan Skyline GT-R R34', photo: SAMPLE_CARD_PHOTO }, // i18n-ignore
];

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row', gap: WALL_GAP },
  cell: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  badges: { left: t.space[8], position: 'absolute', top: t.space[8] },
  // One caption line in the scrim's darkest band, as the wall tile draws its name (MediaCard `wall`).
  name: { bottom: 0, left: 0, paddingBottom: t.space[8], paddingHorizontal: t.space[8], position: 'absolute', right: 0 },
}));

/**
 * DQ-1033 (09 §5 EmptyState): the preview of an empty wall, two wall tiles as the results will look (1:1, 2 apart, 0 radius,
 * the name on the scrim), badged "Beispiel". It is a picture of the state, not content: hidden from readers and not pressable.
 */
export function SampleWall({ testID }: { testID: string }) {
  const styles = useStyles();
  return (
    <View aria-hidden style={styles.row} testID={testID}>
      {SAMPLES.map((sample) => (
        <View key={sample.key} style={styles.cell}>
          <Photo {...sample.photo} aspect={aspect.grid} testID={`${testID}.${sample.key}`}>
            <PhotoStageScrim />
            <SampleBadges flags={{ is_sample: true }} tone="onPhoto" style={styles.badges} testID={`${testID}.${sample.key}.badge`} />
            <View style={styles.name}>
              <Text variant="caption" color="onPhoto.primary" numberOfLines={1} hyphenate={false}>
                {sample.title}
              </Text>
            </View>
          </Photo>
        </View>
      ))}
    </View>
  );
}
