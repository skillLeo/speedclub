import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { memo, useCallback, useMemo } from 'react';
import { View } from 'react-native';

import type { VehicleCardData } from '@/api/queries/profile';
import { createStyles, space, type BreakpointKind } from '@/theme';
import { VehicleCard } from '@/ui';

import { vehicleCardProps } from '../media';

/** FS-8: a card takes 78 % of the width on a phone, so the next one peeks in and says the strip scrolls. */
const PHONE_CARD_SHARE = 0.78;
/** Wider screens show two and a half cards: the same peek, at a size that keeps the 4:3 photo in proportion. */
const WIDE_VISIBLE_CARDS = 2.5;
const CARD_GAP = space[16];

export function stripCardWidth(width: number, gutter: number, kind: BreakpointKind): number {
  if (width <= 0) return 0;
  if (kind === 'phone') return Math.round(width * PHONE_CARD_SHARE);
  return Math.round((width - 2 * gutter - 2 * CARD_GAP) / WIDE_VISIBLE_CARDS);
}

const useStyles = createStyles((t) => ({
  separator: { width: CARD_GAP },
  // A scroller clips on both axes on web, so a card's focus ring (2 + 4, ADR-161) needs room inside it. The padding gives that room,
  // the negative margin keeps the strip's place: 12 under the section header (§5), and the section gap below it.
  list: { marginVertical: -t.space[8] },
  content: { paddingVertical: t.space[8] },
}));

function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

const Card = memo(function Card({
  vehicle,
  width,
  onOpen,
  routeId,
}: {
  vehicle: VehicleCardData;
  width: number;
  onOpen: (vehicle: VehicleCardData) => void;
  routeId: string;
}) {
  const style = useMemo(() => ({ width }), [width]);
  return (
    <VehicleCard
      {...vehicleCardProps(vehicle, width)}
      onPress={() => onOpen(vehicle)}
      style={style}
      testID={`${routeId}.vehicle.${vehicle.id}`}
    />
  );
});

export type GarageStripProps = {
  vehicles: readonly VehicleCardData[];
  /** Width of the screen's column. */
  width: number;
  gutter: number;
  kind: BreakpointKind;
  onOpen: (vehicle: VehicleCardData) => void;
  /** Prefix of the test IDs: `.vehicle.<id>`, `.garage.list`. */
  routeId?: string;
};

/** The garage section of FS-8: horizontal vehicle cards that snap, main vehicle first. */
export function GarageStrip({ vehicles, width, gutter, kind, onOpen, routeId = 'PROF-01' }: GarageStripProps) {
  const styles = useStyles();
  const cardWidth = stripCardWidth(width, gutter, kind);
  const renderItem: ListRenderItem<VehicleCardData> = useCallback(
    ({ item }) => <Card vehicle={item} width={cardWidth} onOpen={onOpen} routeId={routeId} />,
    [cardWidth, onOpen, routeId],
  );
  if (cardWidth <= 0) return null;
  return (
    <FlashList
      horizontal
      data={vehicles}
      keyExtractor={(vehicle) => vehicle.id}
      renderItem={renderItem}
      extraData={cardWidth}
      ItemSeparatorComponent={Separator}
      showsHorizontalScrollIndicator={false}
      style={styles.list}
      contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
      snapToInterval={cardWidth + CARD_GAP}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      testID={`${routeId}.garage.list`}
    />
  );
}
