import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import type { PublicVehicle } from '@/api/queries/vehicles';
import { isWeb } from '@/lib/platform';
import { createStyles, size, useTheme } from '@/theme';
import { Avatar, DisplayTitle, PressableScale, SampleBadges, SpecStrip, Text } from '@/ui';

import { variantUrl } from '../media';
import { keptSubline, ownerName, specStripItems, SUBLINE_WHOLE_FONT_SCALE, sublineOf } from '../model';

const useStyles = createStyles((t) => ({
  // Swipes on the photo under the identity still page the hero; only the owner chip takes presses.
  identity: { pointerEvents: 'box-none' },
  head: { pointerEvents: 'box-none' },
  // As WEB-01's h1: as wide as the name, so a one-line title has the same box on both.
  title: { alignSelf: 'flex-start', marginTop: t.space[4], maxWidth: '100%' },
  subline: { marginTop: t.space[4] },
  badges: { marginBottom: t.space[8] },
  // 09 §7.6 (2): the owner chip under the name, avatar 32 + @handle in a 44 target (WEB-01's .sc-hero-owner).
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: t.space[8],
    marginTop: t.space[8],
    maxWidth: '100%',
    minHeight: t.size.touchMin,
  },
  chipVisual: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], minHeight: t.size.touchMin },
  chipText: { flexShrink: 1 },
  strip: {},
  toolbar: { marginTop: t.space[16] },
}));

export type IdentityTone = 'photo' | 'canvas';

export type VehicleIdentityProps = {
  vehicle: PublicVehicle;
  routeId: string;
  /** `photo` on the hero's scrim and dark stage (`onPhoto.*`, DQ-1047); `canvas` above a hero without photos. */
  tone: IdentityTone;
  /** The width the title is laid out at, known before the first layout (ADR-425). */
  layoutWidth?: number;
  /** PROF-02 of the owner (or PROF-01 for your own build); without it the chip is not a link (GAR-02). */
  onOpenOwner?: () => void;
  /** The title's box, for the header that shows the title once it scrolls away. */
  onTitleLayout?: (event: LayoutChangeEvent) => void;
  /**
   * On the hero: the height of the photo the identity reaches into. Badges, name and sub-line take at least this much, so the
   * owner chip (a link) always starts below the photo (a link too) and never lies over it (m4.10 VEH-01-member overlap High).
   */
  headMinHeight?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * FS-3 identity, the same texts in the same order as WEB-01 under the parity IDs: sample badges → eyebrow → 4 → `display.title`
 * (`.title`) → 4 → sub-line → 8 → owner chip (`.ownerRow`). On the hero (DQ-1047) every text is `onPhoto.*` and starts below the
 * scrim's text-safe line; the block lets swipes through to the photo pager except on the owner chip.
 */
export function VehicleIdentity({
  vehicle,
  routeId,
  tone,
  layoutWidth,
  onOpenOwner,
  onTitleLayout,
  headMinHeight,
  style,
}: VehicleIdentityProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const onPhoto = tone === 'photo';
  const { fontScale } = useTheme();
  const subline = sublineOf(vehicle);
  const owner = vehicle.owner;
  const handle = owner?.username ? `@${owner.username}` : null;

  const chipContent = owner ? (
    <>
      <Avatar
        name={ownerName(owner)}
        uri={variantUrl(owner.avatar, size.avatar.sm)}
        blurhash={owner.avatar?.blurhash}
        size={size.avatar.sm}
        decorative
      />
      <Text
        variant="callout"
        color={onPhoto ? 'onPhoto.primary' : 'text.primary'}
        numberOfLines={1}
        hyphenate={false}
        style={styles.chipText}
      >
        {handle ?? ownerName(owner)}
      </Text>
    </>
  ) : null;

  return (
    <View style={[styles.identity, style]} testID={`${routeId}.identity`}>
      <View style={[styles.head, headMinHeight ? { minHeight: headMinHeight } : null]}>
        {/* 09 §8.19: a sample build says so before its name. */}
        <SampleBadges
          flags={{ is_sample: vehicle.is_sample }}
          tone={onPhoto ? 'onPhoto' : undefined}
          style={styles.badges}
          testID={`${routeId}.sample`}
        />
        {vehicle.eyebrow ? (
          <Text
            variant="labelCaps"
            color={onPhoto ? 'onPhoto.secondary' : 'text.secondary'}
            hyphenate={false}
            testID={`${routeId}.eyebrow`}
          >
            {vehicle.eyebrow}
          </Text>
        ) : null}
        {/* DQ-802: a car name never hyphenates. ADR-426 a: a page title (full size up to two lines, else 24), sized before the first paint. */}
        <DisplayTitle
          role="heading"
          {...({ 'aria-level': 1 } as object)}
          placement="page"
          color={onPhoto ? 'onPhoto.primary' : undefined}
          layoutWidth={layoutWidth}
          onLayout={onTitleLayout}
          style={styles.title}
          testID={`${routeId}.title`}
        >
          {vehicle.title}
        </DisplayTitle>
        {subline ? (
          // DQ-1061 (ADR-424): an engine code ("RB26DETT") never breaks inside; the parts stay whole (keptSubline).
          <Text
            variant="callout"
            color={onPhoto ? 'onPhoto.secondary' : 'text.secondary'}
            hyphenate={false}
            style={styles.subline}
            testID={`${routeId}.subline`}
          >
            {keptSubline(vehicle, fontScale <= SUBLINE_WHOLE_FONT_SCALE)}
          </Text>
        ) : null}
      </View>
      {owner && chipContent ? (
        onOpenOwner ? (
          // The region keeps `.ownerRow` (parity, WEB-01); the link inside keeps `.ownerRow.identity` (f5-discover, keyboard-discover).
          <View style={styles.chip} testID={`${routeId}.ownerRow`}>
            <PressableScale
              role="link"
              aria-label={isWeb ? undefined : t('owner.open', { name: ownerName(owner) })}
              onPress={onOpenOwner}
              contentStyle={styles.chipVisual}
              testID={`${routeId}.ownerRow.identity`}
            >
              {chipContent}
            </PressableScale>
          </View>
        ) : (
          <View style={styles.chip} testID={`${routeId}.ownerRow`}>
            {chipContent}
          </View>
        )
      ) : null}
    </View>
  );
}

export type ProfileSummaryProps = {
  vehicle: PublicVehicle;
  routeId: string;
  /**
   * `card`: the desktop's sticky card (DQ-1048: compact SpecStrip and actions, no ground for the strip, ADR-431 b). `page` under the
   * hero on phones and tablets.
   */
  variant?: 'page' | 'card';
  /**
   * The identity above the strip: `canvas` for a build without photos (the hero then holds its designed empty state), `none` where
   * the identity sits on the hero (DQ-1047).
   */
  identity?: 'none' | 'canvas';
  /** The width the summary is laid out at (`profileSummaryWidth`), known before the first layout (N1b). */
  layoutWidth?: number;
  onOpenOwner?: () => void;
  /** GAR-02's owner toolbar, under the actions. */
  ownerToolbar?: ReactNode;
  /** VEH-01 (09 §7.6 (4)): the visitor's action row or the owner's capsule. */
  actions?: ReactNode;
  onTitleLayout?: (event: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * FS-3 under the hero: the spec strip, then the action row (or the owner's capsule). For a build without photos the identity comes
 * first on the canvas. The spec strip keeps the parity ID `<routeId>.specStrip`.
 */
export function ProfileSummary({
  vehicle,
  routeId,
  identity = 'none',
  layoutWidth,
  onOpenOwner,
  ownerToolbar,
  actions,
  onTitleLayout,
  style,
}: ProfileSummaryProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();

  return (
    <View style={style} testID={`${routeId}.summary`}>
      {identity === 'canvas' ? (
        <VehicleIdentity
          vehicle={vehicle}
          routeId={routeId}
          tone="canvas"
          layoutWidth={layoutWidth}
          onOpenOwner={onOpenOwner}
          onTitleLayout={onTitleLayout}
        />
      ) : null}
      <SpecStrip
        items={specStripItems(vehicle, { power: t('strip.power'), torque: t('strip.torque') })}
        layoutWidth={layoutWidth}
        rollKey={vehicle.id}
        style={identity === 'canvas' ? styles.toolbar : styles.strip}
        testID={`${routeId}.specStrip`}
      />
      {actions ? <View style={styles.toolbar}>{actions}</View> : null}
      {ownerToolbar ? (
        <View style={styles.toolbar} testID={`${routeId}.ownerToolbar`}>
          {ownerToolbar}
        </View>
      ) : null}
    </View>
  );
}
