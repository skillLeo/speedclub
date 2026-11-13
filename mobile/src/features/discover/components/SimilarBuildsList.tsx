import { useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { railSpec } from '@/features/home/components/NewInGarageRail';
import { photoFields } from '@/features/profile/media';
import { createStyles, layout as layoutTokens, useBreakpoint, useTheme } from '@/theme';
import { MediaCard, SectionHeader } from '@/ui';

import { railCardWidth, railGridWidth } from './DiscoverSections';

/** Desktop shows the first three as a grid inside the column: a sideways rail cut at the column edge reads as broken (DQ-974). */
const GRID_COUNT = 3;

export type SimilarBuildsListProps = {
  title: string;
  /** Names the strip for screen readers: "Ähnliche Builds zu BMW M4 Competition". */
  label: string;
  vehicles: readonly FeedVehicle[];
  onOpen: (vehicle: FeedVehicle) => void;
  /** The column's gutter: the strip runs to the screen edge and starts on the column. */
  bleed: number;
  testID: string;
};

const useStyles = createStyles((t) => ({
  header: { paddingBottom: t.space[12] },
  row: { flexDirection: 'row', gap: t.space[12] },
}));

/**
 * FS-3 [SIG] "Ähnliche Builds" (M4.9, DQ-974): the MediaCard rail of 09 §5 — 3:4 photo, radius 12, name and the key value —
 * sideways on phones and tablets, a row of three inside the column on a desktop.
 */
export function SimilarBuildsList({ title, label, vehicles, onOpen, bleed, testID }: SimilarBuildsListProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const desktop = useBreakpoint().kind === 'desktop';
  const [column, setColumn] = useState<number>(layoutTokens.feedColumn);
  const width = desktop ? railGridWidth(column) : railCardWidth(column + 2 * bleed, fontScale);
  const shown = desktop ? vehicles.slice(0, GRID_COUNT) : vehicles;
  const cards = shown.map((vehicle) => (
    <View key={vehicle.id} role="listitem" style={{ width }}>
      <MediaCard
        variant="rail"
        title={vehicle.full_title}
        spec={railSpec(vehicle)}
        photo={photoFields(vehicle.cover, width)}
        sample={{ is_sample: vehicle.is_sample, is_editorial: vehicle.owner?.is_editorial ?? false }}
        onPress={() => onOpen(vehicle)}
        testID={`${testID}.${vehicle.id}`}
      />
    </View>
  ));
  return (
    <View
      role="region"
      aria-label={label}
      testID={testID}
      onLayout={(event: LayoutChangeEvent) => setColumn(event.nativeEvent.layout.width)}
    >
      <SectionHeader title={title} style={styles.header} testID={`${testID}.header`} />
      {desktop ? (
        <View style={styles.row} role="list" testID={`${testID}.list`}>
          {cards}
        </View>
      ) : (
        <View style={{ marginHorizontal: -bleed }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.row, { paddingHorizontal: bleed }]}
            role="list"
            testID={`${testID}.list`}
          >
            {cards}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
