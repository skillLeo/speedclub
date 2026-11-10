import type { ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import type { PublicVehicle } from '@/api/queries/vehicles';
import { createStyles } from '@/theme';
import { OwnerRow, SpecStrip, Text } from '@/ui';
import { useStacksAtFontScale } from '@/ui/rowParts';

import { variantUrl } from '../media';
import { keptSubline, ownerMeta, ownerName, specStripItems, sublineOf } from '../model';

export type ProfileSummaryProps = {
  vehicle: PublicVehicle;
  routeId: string;
  /** `card`: the desktop's sticky card, where the strip sits on bg.raised as on WEB-01. */
  variant?: 'page' | 'card';
  /** Trailing actions of the owner row: Folgen and Nachricht (a guest, or a member who may write to the owner). */
  ownerActions?: ReactNode;
  /** The owner actions in their widest state, measured by OwnerRow and never shown (DQ-262). */
  ownerWidestActions?: ReactNode;
  /** PROF-02 of the owner (or PROF-01 for your own build). */
  onOpenOwner?: () => void;
  /** GAR-02's owner toolbar, under the owner row. */
  ownerToolbar?: ReactNode;
  /** The title's box inside the summary, for the header that shows the title once it scrolls away. */
  onTitleLayout?: (event: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
};

const AVATAR = 40;

const useStyles = createStyles((t) => ({
  // As WEB-01's h1 in its flex row: as wide as the name, so a one-line title has the same box on both.
  title: { alignSelf: 'flex-start', marginTop: t.space[4], maxWidth: '100%' },
  subline: { marginTop: t.space[4] },
  strip: { marginTop: t.space[16] },
  stripOnCard: { backgroundColor: t.color.bg.raised },
  owner: { marginTop: t.space[16] },
  toolbar: { marginTop: t.space[16] },
}));

/**
 * FS-3 from the eyebrow to the owner row: eyebrow → 4 → `display.l` title → 4 → sub-line → 16 → spec strip → 16 → owner
 * row. The same texts in the same order as WEB-01, under the parity test IDs `<routeId>.title`, `.specStrip`, `.ownerRow`.
 */
export function ProfileSummary({ vehicle, routeId, variant = 'page', ownerActions, ownerWidestActions, onOpenOwner, ownerToolbar, onTitleLayout, style }: ProfileSummaryProps) {
  const styles = useStyles();
  const largeFont = useStacksAtFontScale();
  const subline = sublineOf(vehicle);
  const owner = vehicle.owner;

  return (
    <View style={style} testID={`${routeId}.summary`}>
      {vehicle.eyebrow ? (
        <Text variant="eyebrow" color="text.secondary" hyphenate={false} testID={`${routeId}.eyebrow`}>
          {vehicle.eyebrow}
        </Text>
      ) : null}
      <Text
        variant="displayL"
        role="heading"
        {...({ 'aria-level': 1 } as object)}
        onLayout={onTitleLayout}
        style={styles.title}
        testID={`${routeId}.title`}
      >
        {vehicle.title}
      </Text>
      {subline ? (
        <Text variant="supporting" color="text.secondary" hyphenate={largeFont} style={styles.subline} testID={`${routeId}.subline`}>
          {keptSubline(vehicle, !largeFont)}
        </Text>
      ) : null}
      <SpecStrip
        items={specStripItems(vehicle)}
        style={[styles.strip, variant === 'card' ? styles.stripOnCard : null]}
        testID={`${routeId}.specStrip`}
      />
      {owner ? (
        <OwnerRow
          name={ownerName(owner)}
          meta={ownerMeta(owner)}
          avatarUri={variantUrl(owner.avatar, AVATAR)}
          avatarBlurhash={owner.avatar?.blurhash}
          actions={ownerActions}
          widestActions={ownerWidestActions}
          onPress={onOpenOwner}
          inset={0}
          style={styles.owner}
          testID={`${routeId}.ownerRow`}
        />
      ) : null}
      {ownerToolbar ? (
        <View style={styles.toolbar} testID={`${routeId}.ownerToolbar`}>
          {ownerToolbar}
        </View>
      ) : null}
    </View>
  );
}
