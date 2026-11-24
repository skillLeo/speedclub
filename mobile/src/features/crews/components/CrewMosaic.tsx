import { View } from 'react-native';

import type { CrewMember } from '@/api/queries/crews';
import { photoFields } from '@/features/profile/media';
import { createStyles, space } from '@/theme';
import { Photo } from '@/ui/Photo';
import { PhotoTopScrim } from '@/ui/PhotoStageScrim';

/** At most three tiles: more would turn the band into thumbnails. */
export const MOSAIC_MAX = 3;
/** The gap of a result wall (09 §5 media): 2, no radius. */
const GAP = space[2];

type Tile = { id: string; media: NonNullable<CrewMember['vehicles'][number]['cover']> };

/**
 * R4DQ-53: the photos a crew without a cover opens on, taken from its members' public builds (real data, never a stand-in): each
 * member's first build with a photo in the members' order (founder → admins → members), then their other builds, up to three,
 * each car once. Empty when no member shows a car: the page keeps its typographic header.
 */
export function crewMosaicTiles(rows: readonly Pick<CrewMember, 'vehicles'>[]): Tile[] {
  const tiles: Tile[] = [];
  const seen = new Set<string>();
  const add = (vehicle: CrewMember['vehicles'][number] | undefined) => {
    if (!vehicle?.cover || seen.has(vehicle.id) || tiles.length >= MOSAIC_MAX) return;
    seen.add(vehicle.id);
    tiles.push({ id: vehicle.id, media: vehicle.cover });
  };
  for (const row of rows) add(row.vehicles.find((vehicle) => vehicle.cover));
  for (const row of rows) for (const vehicle of row.vehicles) add(vehicle);
  return tiles;
}

const useStyles = createStyles(() => ({
  band: { flexDirection: 'row', gap: GAP, overflow: 'hidden' },
}));

/**
 * The band in the cover's place and geometry (`width` × `height`): the tiles side by side with the 2 gap of a result wall, edge to
 * edge, `scrim.top` under the floating controls. Decorative: the same cars follow, named, in the member rows below.
 */
export function CrewMosaic({ tiles, width, height, testID }: { tiles: readonly Tile[]; width: number; height: number; testID?: string }) {
  const styles = useStyles();
  const tileWidth = (width - (tiles.length - 1) * GAP) / Math.max(1, tiles.length);
  return (
    <View aria-hidden style={[styles.band, { height, width }]} testID={testID}>
      {tiles.map((tile, index) => (
        <Photo
          key={tile.id}
          {...photoFields(tile.media, tileWidth)}
          aspect="3:4"
          priority={index === 0 ? 'high' : undefined}
          style={{ height, width: tileWidth }}
          testID={testID ? `${testID}.${index}` : undefined}
        />
      ))}
      <PhotoTopScrim />
    </View>
  );
}
