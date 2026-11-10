import { memo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { photoFields, specChips } from '@/features/profile/media';
import { keepNameTogether } from '@/lib/format';
import { GridTile } from '@/ui';

/** The grid's one spec line (§8): power and drivetrain, "500 PS · AWD". */
export function tileSpec(vehicle: Pick<FeedVehicle, 'spec_strip'>): string | undefined {
  const pick = (key: string) => specChips({ spec_strip: vehicle.spec_strip.filter((item) => item.key === key) })[0];
  return [pick('power'), pick('drivetrain')].filter(Boolean).join(' · ') || undefined;
}

export type ResultTileProps = {
  vehicle: FeedVehicle;
  /** The tile's width, for the photo variant. */
  width: number;
  onOpen: (vehicle: FeedVehicle) => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

/** A build as a §8 grid tile: 4:3 photo, the name on two lines, one spec line. */
export const ResultTile = memo(function ResultTile({ vehicle, width, onOpen, style, testID }: ResultTileProps) {
  return (
    <GridTile
      title={keepNameTogether(vehicle.full_title)}
      spec={tileSpec(vehicle)}
      photo={photoFields(vehicle.cover, width)}
      onPress={() => onOpen(vehicle)}
      style={style}
      testID={testID}
    />
  );
});
