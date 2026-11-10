import { FlashList } from '@shopify/flash-list';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { createStyles, space, useTheme } from '@/theme';
import { SectionHeader } from '@/ui';

import { ResultTile } from './ResultTile';

/** A tile of the strip at font scale 1; a larger font widens it so the name keeps its two lines. */
export const STRIP_TILE_WIDTH = space[64] * 3;
const MAX_TILE_SCALE = 1.5;

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
  gap: { width: t.space[12] },
}));

function Gap() {
  const styles = useStyles();
  return <View style={styles.gap} />;
}

/** FS-3 [SIG] "Ähnliche Builds": up to eight grid tiles in one row that scrolls sideways (§8 grid tile). */
export function SimilarBuildsList({ title, label, vehicles, onOpen, bleed, testID }: SimilarBuildsListProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const tileWidth = Math.round(STRIP_TILE_WIDTH * Math.min(MAX_TILE_SCALE, Math.max(1, fontScale)));
  const tileStyle = useMemo(() => ({ width: tileWidth }), [tileWidth]);
  const renderItem = useCallback(
    ({ item }: { item: FeedVehicle }) => (
      <View style={tileStyle}>
        <ResultTile vehicle={item} width={tileWidth} onOpen={onOpen} testID={`${testID}.${item.id}`} />
      </View>
    ),
    [onOpen, testID, tileStyle, tileWidth],
  );
  return (
    <View role="region" aria-label={label} testID={testID}>
      <SectionHeader title={title} style={styles.header} testID={`${testID}.header`} />
      <View style={{ marginHorizontal: -bleed }}>
        <FlashList
          horizontal
          data={vehicles}
          keyExtractor={(vehicle: FeedVehicle) => vehicle.id}
          renderItem={renderItem}
          ItemSeparatorComponent={Gap}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: bleed }}
          testID={`${testID}.list`}
        />
      </View>
    </View>
  );
}
