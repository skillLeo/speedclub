import { ScrollView, View } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { railCardWidth } from '@/features/discover/components/DiscoverSections';
import { photoFields } from '@/features/profile/media';
import { createStyles, space, useTheme } from '@/theme';
import { MediaCard, MediaCardSkeleton } from '@/ui';

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row', gap: t.space[12] },
  skeletonRow: { flexDirection: 'row', gap: t.space[12], overflow: 'hidden' },
}));

/** "510 PS · AWD": the first two figures of the spec strip that have a value, for the card's quiet line. */
export function railSpec(vehicle: Pick<FeedVehicle, 'spec_strip'>): string | undefined {
  const parts = vehicle.spec_strip
    .filter((item) => item.value)
    .slice(0, 2)
    .map((item) => (item.unit ? `${item.value} ${item.unit}` : (item.value as string)));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export type NewInGarageRailProps = {
  vehicles: readonly FeedVehicle[];
  /** The column's width and how far the rail runs past it on each side (the gutter on a phone, 0 in a column). */
  column: number;
  bleed: number;
  onOpen: (vehicle: FeedVehicle) => void;
  testID: string;
};

/**
 * 09 §7.3 "Neu in der Garage": up to 8 `rail` MediaCards (3:4, radius 12) that scroll sideways, run to the screen edge on a phone.
 * Card widths follow DISC-01's rail, so both pages share one rail geometry.
 */
export function NewInGarageRail({ vehicles, column, bleed, onOpen, testID }: NewInGarageRailProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const width = railCardWidth(column, fontScale);
  return (
    <View style={{ marginHorizontal: -bleed }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, { paddingHorizontal: bleed }]}
        role="list"
        testID={`${testID}.rail`}
      >
        {vehicles.map((vehicle) => (
          <View key={vehicle.id} role="listitem" style={{ width }}>
            <MediaCard
              variant="rail"
              title={vehicle.full_title}
              spec={railSpec(vehicle)}
              photo={photoFields(vehicle.cover, width)}
              sample={{ is_sample: vehicle.is_sample, is_editorial: vehicle.owner?.is_editorial ?? false }}
              onPress={() => onOpen(vehicle)}
              testID={`${testID}.item.${vehicle.id}`}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** The rail while it loads: as many cards as the column shows, in their geometry. */
export function NewInGarageRailSkeleton({ column, bleed }: { column: number; bleed: number }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const width = railCardWidth(column, fontScale);
  const shown = Math.max(1, Math.ceil((column + bleed) / (width + space[12])));
  return (
    <View style={[styles.skeletonRow, { marginRight: -bleed }]}>
      {Array.from({ length: shown }, (_, index) => (
        <MediaCardSkeleton key={index} variant="rail" style={{ width }} />
      ))}
    </View>
  );
}
