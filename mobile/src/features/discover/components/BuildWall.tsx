import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { photoFields } from '@/features/profile/media';
import { keepNameTogether } from '@/lib/format';
import { createStyles, space } from '@/theme';
import { MediaCard, MediaCardSkeleton } from '@/ui';

/** 09 §5 result wall: 2 px between the photos, 0 radius, edge to edge. */
export const WALL_GAP = space[2];

const useStyles = createStyles(() => ({
  row: { flexDirection: 'row', gap: WALL_GAP },
  rows: { gap: WALL_GAP },
}));

/** The width of one cell of a wall `width` wide in `columns` columns (whole pixels; the last cell takes what is left over). */
export function wallCellWidth(width: number, columns: number): number {
  return columns > 0 && width > 0 ? Math.floor((width - WALL_GAP * (columns - 1)) / columns) : 0;
}

/** The vehicles in rows of `columns`; the last row may be short. */
export function wallRows<T>(items: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += Math.max(1, columns)) rows.push(items.slice(start, start + Math.max(1, columns)));
  return rows;
}

export type WallCellProps = {
  vehicle: FeedVehicle;
  width: number;
  onOpen: (vehicle: FeedVehicle) => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

/** A build as a `wall` MediaCard: its cover 1:1, the name on the scrim, "Beispiel" on sample content. */
export const WallCell = memo(function WallCell({ vehicle, width, onOpen, style, testID }: WallCellProps) {
  return (
    <MediaCard
      variant="wall"
      title={keepNameTogether(vehicle.full_title)}
      photo={photoFields(vehicle.cover, width)}
      sample={{ is_sample: vehicle.is_sample }}
      onPress={() => onOpen(vehicle)}
      style={style}
      testID={testID}
    />
  );
});

export type WallRowProps = {
  vehicles: readonly FeedVehicle[];
  cell: number;
  onOpen: (vehicle: FeedVehicle) => void;
  /** Each cell adds `.<vehicle id>`. */
  testID: string;
};

/** One row of a wall, its cells at `cell` wide; a short last row keeps the column width. */
export const WallRow = memo(function WallRow({ vehicles, cell, onOpen, testID }: WallRowProps) {
  const styles = useStyles();
  const cellStyle = { width: cell };
  return (
    <View style={styles.row} role="list">
      {vehicles.map((vehicle) => (
        <View key={vehicle.id} role="listitem" style={cellStyle}>
          <WallCell vehicle={vehicle} width={cell} onOpen={onOpen} testID={`${testID}.${vehicle.id}`} />
        </View>
      ))}
    </View>
  );
});

export type BuildWallProps = {
  vehicles: readonly FeedVehicle[];
  width: number;
  columns: number;
  onOpen: (vehicle: FeedVehicle) => void;
  testID: string;
};

/** A short wall drawn at once (DISC-01 "Neu entdeckt"); long walls render `WallRow`s as list rows. */
export function BuildWall({ vehicles, width, columns, onOpen, testID }: BuildWallProps) {
  const styles = useStyles();
  const cell = wallCellWidth(width, columns);
  return (
    <View style={styles.rows} testID={testID}>
      {wallRows(vehicles, columns).map((row) => (
        <WallRow key={row[0]?.id} vehicles={row} cell={cell} onOpen={onOpen} testID={testID} />
      ))}
    </View>
  );
}

/** The wall while it loads: `count` cells in the same rows. */
export function BuildWallSkeleton({ width, columns, count }: { width: number; columns: number; count: number }) {
  const styles = useStyles();
  const cell = wallCellWidth(width, columns);
  const cellStyle = { width: cell };
  return (
    <View style={styles.rows}>
      {wallRows(Array.from({ length: count }, (_, index) => index), columns).map((row) => (
        <View key={row[0]} style={styles.row}>
          {row.map((index) => (
            <MediaCardSkeleton key={index} variant="wall" style={cellStyle} />
          ))}
        </View>
      ))}
    </View>
  );
}
