import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { aspect, createStyles, size, useBreakpoint, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { Photo, type PhotoFields } from './Photo';
import { PressableScale } from './PressableScale';
import { Progress } from './Progress';
import { joinLabel } from './rowParts';
import { estimateLines, SkeletonBlock, SkeletonText } from './Skeleton';
import { SpecChip, SpecChipSkeleton } from './SpecChip';
import { Text } from './Text';

export type VehicleCardOwner = {
  /** "@lukas.sc" */
  username: string;
  avatarUri?: string | null;
  avatarBlurhash?: string | null;
  /** "vor 2 Std." */
  time?: string;
};

export type VehicleCardProps = {
  /** "Nissan Skyline GT-R R34" */
  title: string;
  /** "2002 · 2,6 l R6 Biturbo" */
  subtitle?: string;
  photo: PhotoFields;
  /** "500 PS", "540 Nm", "AWD" */
  specs?: readonly string[];
  owner?: VehicleCardOwner;
  /** Shows the Hauptfahrzeug badge on the photo. */
  isMain?: boolean;
  /** Replaces the badge text from namespace common. */
  mainLabel?: string;
  onPress?: () => void;
  /** FS-4, owner only: "Build zu 70 % vollständig" and its share from 0 to 1. */
  completeness?: { label: string; value: number };
  /** FS-4: the QR icon button. It sits below the pressable card, because controls must not nest. */
  trailing?: ReactNode;
  /** Replaces the accessible name composed from the visible strings. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  body: { borderRadius: t.radius.md },
  hoverLayer: { backgroundColor: t.color.state.hover },
  badge: {
    alignItems: 'center',
    backgroundColor: t.color.onPhoto.chipBg,
    borderColor: t.color.accent.fg,
    borderRadius: t.radius.xs,
    borderWidth: t.size.border.control,
    justifyContent: 'center',
    left: t.space[12],
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
    position: 'absolute',
    top: t.space[12],
  },
  text: { gap: t.space[2], marginTop: t.space[12] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[8] },
  owner: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], marginTop: t.space[12] },
  // DQ-185: username and time wrap as two pieces. Where both do not fit beside the avatar, the time drops under the name.
  ownerMeta: { alignItems: 'baseline', columnGap: t.space[8], flex: 1, flexDirection: 'row', flexWrap: 'wrap', minWidth: 0, rowGap: t.space[2] },
  ownerText: { flexShrink: 1, minWidth: 0 },
  ownerLine: { flex: 1, gap: t.space[2], minWidth: 0 },
  footer: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], marginTop: t.space[8] },
  completeness: { flex: 1, gap: t.space[8], minWidth: 0 },
  spacer: { flex: 1 },
  trailing: { flexShrink: 0 },
}));

const [CARD_WIDTH = 1, CARD_HEIGHT = 1] = aspect.card.split(':').map(Number);

/** Typical length of a card title ("Audi RS 6 Avant C8"). */
const TYPICAL_TITLE_CHARS = 18;

export type VehicleCardSkeletonProps = {
  /** The feed card's owner row: avatar 32 and the username line. */
  owner?: boolean;
  testID?: string;
};

/**
 * The loading state of a card, with or without the owner row, from the same styles and type variants. The title takes the lines a
 * typical title takes at the measured width, so a phone at a large font wraps it. Put it inside a `Skeleton`, which owns
 * the delay, the shimmer and the name for screen readers.
 */
export function VehicleCardSkeleton({ owner = false, testID }: VehicleCardSkeletonProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const { gutter } = useBreakpoint();
  const { width: windowWidth } = useWindowDimensions();
  // Until the first layout: a card across the window. The skeleton is still invisible then.
  const [measured, setMeasured] = useState<number | null>(null);
  const titleLines = estimateLines(TYPICAL_TITLE_CHARS, 'titleS', fontScale, measured ?? windowWidth - 2 * gutter);
  return (
    <View testID={testID}>
      <SkeletonBlock aspectRatio={CARD_WIDTH / CARD_HEIGHT} corner="md" />
      <View
        style={styles.text}
        onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}
        testID={testID ? `${testID}.text` : undefined}
      >
        <SkeletonText variant="titleS" width="70%" lines={titleLines} testID={testID ? `${testID}.title` : undefined} />
        <SkeletonText variant="supporting" width="50%" />
      </View>
      <View style={styles.chips}>
        <SpecChipSkeleton width={size.avatar.lg} testID={testID ? `${testID}.chip` : undefined} />
        <SpecChipSkeleton width={size.avatar.lg} />
        <SpecChipSkeleton width={size.avatar.md} />
      </View>
      {owner ? (
        <View style={styles.owner} testID={testID ? `${testID}.owner` : undefined}>
          <SkeletonBlock width={size.avatar.sm} height={size.avatar.sm} corner="full" />
          <View style={styles.ownerLine}>
            <SkeletonText variant="supporting" width="45%" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** §8 vehicle card and FS-4: 4:3 photo radius 12, 12 below the title, 8 below the chips. */
export function VehicleCard({
  title,
  subtitle,
  photo,
  specs = [],
  owner,
  isMain = false,
  mainLabel,
  onPress,
  completeness,
  trailing,
  accessibilityLabel,
  style,
  testID,
}: VehicleCardProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const badge = mainLabel ?? t('badges.mainVehicle');
  // DQ-195: an engine code in the sub-line ("4A-GE") stays whole, as the callers keep the model name in the title whole.
  const subline = subtitle ? keepNameTogether(subtitle) : undefined;

  const content = (hovered: boolean) => (
    <>
      <Photo {...photo} aspect="4:3" corner="md" testID={testID ? `${testID}.photo` : undefined}>
        {hovered ? <View style={[StyleSheet.absoluteFill, styles.hoverLayer]} /> : null}
        {isMain ? (
          <View style={styles.badge} testID={testID ? `${testID}.badge` : undefined}>
            <Text variant="badge" color="onPhoto.primary">
              {badge}
            </Text>
          </View>
        ) : null}
      </Photo>
      <View style={styles.text}>
        <Text variant="titleS">{title}</Text>
        {subline ? (
          <Text variant="supporting" color="text.secondary">
            {subline}
          </Text>
        ) : null}
      </View>
      {specs.length > 0 ? (
        <View style={styles.chips}>
          {specs.map((spec) => (
            <SpecChip key={spec} label={spec} />
          ))}
        </View>
      ) : null}
      {owner ? (
        <View style={styles.owner} testID={testID ? `${testID}.owner` : undefined}>
          <Avatar decorative name={owner.username} uri={owner.avatarUri} blurhash={owner.avatarBlurhash} size={32} />
          <View style={styles.ownerMeta}>
            <Text hyphenate={false} variant="supporting" style={styles.ownerText}>
              {owner.username}
            </Text>
            {owner.time ? (
              <Text variant="caption" color="text.tertiary" hyphenate={false} testID={testID ? `${testID}.time` : undefined}>
                {owner.time}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </>
  );

  return (
    <View testID={testID} style={style}>
      {onPress ? (
        <PressableScale
          role="link"
          aria-label={
            accessibilityLabel ??
            (isWeb ? undefined : joinLabel([isMain && badge, title, subtitle, ...specs, owner?.username, owner?.time]))
          }
          ring="card"
          onPress={onPress}
          testID={testID ? `${testID}.body` : undefined}
          contentStyle={styles.body}
        >
          {(state) => content(state.hovered)}
        </PressableScale>
      ) : (
        content(false)
      )}
      {completeness || trailing ? (
        <View style={styles.footer}>
          {completeness ? (
            <View style={styles.completeness} testID={testID ? `${testID}.completeness` : undefined}>
              <Text variant="supporting" color="text.secondary">
                {completeness.label}
              </Text>
              <Progress value={completeness.value} label={completeness.label} />
            </View>
          ) : (
            <View style={styles.spacer} />
          )}
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
      ) : null}
    </View>
  );
}
