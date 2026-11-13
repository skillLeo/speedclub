import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { aspect, createStyles, size, useBreakpoint, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { SampleBadges, useSampleBadgeLabels, type SampleFlags } from './Badge';
import { FloatingControl } from './chrome';
import { DisplayTitle } from './DisplayTitle';
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

/** One cell of the 2.0 card's mini spec (09 §5 SpecStrip, its card form): "500" + "PS" over "LEISTUNG". */
export type VehicleCardStat = { key: string; value: string; unit?: string | null; label: string };

export type VehicleCardProps = {
  /**
   * `feed` (default): the v1 card of lists and feeds (4:3, `headline` name, spec chips). `garage`: 09 §5 VehicleCard 2.0 (DQ-1050) —
   * photo 4:5 radius 20, the name in `display.title` (Archivo), the caption "BMW · M3 · G80 · 2021", a mini spec in
   * `hero.numeral.s` + `label.caps`, the status badge on the photo and the QR control floating on it.
   */
  variant?: 'feed' | 'garage';
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
  /** The API flags (09 §8.19): a sample build carries "Beispiel" on its photo, the Editorial account's "Editorial". */
  sample?: SampleFlags;
  onPress?: () => void;
  /** FS-4, owner only: "Build zu 70 % vollständig" and its share from 0 to 1. */
  completeness?: { label: string; value: number };
  /** FS-4: the QR icon button. It sits below the pressable card, because controls must not nest. */
  trailing?: ReactNode;
  /** Replaces the accessible name composed from the visible strings. */
  accessibilityLabel?: string;
  /** `garage`: "BMW · M3 · G80 · 2021", under the name. */
  caption?: string;
  /** `garage`: the mini spec, three cells (power, torque, year). */
  stats?: readonly VehicleCardStat[];
  /** `garage`: the status badge on the photo: "Öffentlich", "Nicht gelistet", "Privat", "Entwurf". */
  status?: string;
  /** `garage`: the width the card is laid out at, so the display title has its size before the first paint (ADR-425). */
  layoutWidth?: number;
  /** `garage`: the QR control floating on the photo (a sibling of the card's pressable: controls never nest). */
  qr?: { label: string; onPress: () => void; testID?: string };
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  body: { borderRadius: t.radius.md },
  hoverLayer: { backgroundColor: t.color.state.hover },
  badges: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[4], left: t.space[12], position: 'absolute', right: t.space[12], top: t.space[12] },
  badge: {
    alignItems: 'center',
    // ADR-431 f (DQ-962): a neutral badge like every other, the on-photo Badge's ground; badges are never red.
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
  text: { gap: t.space[2], marginTop: t.space[12] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[8] },
  owner: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], marginTop: t.space[12] },
  // DQ-185: username and time wrap as two pieces. Where both do not fit beside the avatar, the time drops under the name.
  ownerMeta: { alignItems: 'baseline', columnGap: t.space[8], flex: 1, flexDirection: 'row', flexWrap: 'wrap', minWidth: 0, rowGap: t.space[2] },
  ownerText: { flexShrink: 1, minWidth: 0 },
  ownerLine: { flex: 1, gap: t.space[2], minWidth: 0 },
  footer: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], marginTop: t.space[8] },
  // 2.0 (garage): text on the canvas under the photo, no box around it (skill rule 6: hairlines instead of boxes).
  garageText: { gap: t.space[4], marginTop: t.space[16] },
  garageSpec: { flexDirection: 'row', gap: t.space[12], marginTop: t.space[16] },
  garageSpecCell: { flex: 1, gap: t.space[2], minWidth: 0 },
  garageSpecValue: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', columnGap: t.space[4] },
  garageFooter: { marginTop: t.space[16] },
  qr: { position: 'absolute', right: t.space[12], top: t.space[12] },
  completeness: { flex: 1, gap: t.space[8], minWidth: 0 },
  spacer: { flex: 1 },
  trailing: { flexShrink: 0 },
}));

const [CARD_WIDTH = 1, CARD_HEIGHT = 1] = aspect.card.split(':').map(Number);
const [HERO_WIDTH = 4, HERO_HEIGHT = 5] = aspect.hero.split(':').map(Number);
const HERO_RATIO = HERO_WIDTH / HERO_HEIGHT;

/** Typical length of a card title ("Audi RS 6 Avant C8"). */
const TYPICAL_TITLE_CHARS = 18;

export type VehicleCardSkeletonProps = {
  /** The feed card's owner row: avatar 32 and the username line. */
  owner?: boolean;
  /** The 2.0 garage card's geometry (DQ-1067 b). */
  variant?: 'feed' | 'garage';
  testID?: string;
};

/** "Nissan Skyline GT-R R34" in display.title at a card width: usually two lines on a phone. */
const TYPICAL_DISPLAY_CHARS = 22;

function GarageCardSkeleton({ testID }: { testID?: string }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const { gutter } = useBreakpoint();
  const { width: windowWidth } = useWindowDimensions();
  const [measured, setMeasured] = useState<number | null>(null);
  const width = measured ?? windowWidth - 2 * gutter;
  return (
    <View testID={testID}>
      <SkeletonBlock aspectRatio={HERO_RATIO} corner="xl" />
      <View style={styles.garageText} onLayout={(event) => setMeasured(event.nativeEvent.layout.width)} testID={testID ? `${testID}.text` : undefined}>
        <SkeletonText variant="displayTitle" width="80%" lines={estimateLines(TYPICAL_DISPLAY_CHARS, 'displayTitle', fontScale, width)} />
        <SkeletonText variant="caption" width="55%" />
      </View>
      <View style={styles.garageSpec}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.garageSpecCell}>
            <SkeletonText variant="heroNumeralS" width="70%" />
            <SkeletonText variant="labelCaps" width="60%" />
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The loading state of a card, with or without the owner row, from the same styles and type variants. The title takes the lines a
 * typical title takes at the measured width, so a phone at a large font wraps it. Put it inside a `Skeleton`, which owns
 * the delay, the shimmer and the name for screen readers.
 */
export function VehicleCardSkeleton({ owner = false, variant = 'feed', testID }: VehicleCardSkeletonProps) {
  if (variant === 'garage') return <GarageCardSkeleton testID={testID} />;
  return <FeedCardSkeleton owner={owner} testID={testID} />;
}

function FeedCardSkeleton({ owner, testID }: { owner: boolean; testID?: string }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const { gutter } = useBreakpoint();
  const { width: windowWidth } = useWindowDimensions();
  // Until the first layout: a card across the window. The skeleton is still invisible then.
  const [measured, setMeasured] = useState<number | null>(null);
  const titleLines = estimateLines(TYPICAL_TITLE_CHARS, 'headline', fontScale, measured ?? windowWidth - 2 * gutter);
  return (
    <View testID={testID}>
      <SkeletonBlock aspectRatio={CARD_WIDTH / CARD_HEIGHT} corner="md" />
      <View
        style={styles.text}
        onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}
        testID={testID ? `${testID}.text` : undefined}
      >
        <SkeletonText variant="headline" width="70%" lines={titleLines} testID={testID ? `${testID}.title` : undefined} />
        <SkeletonText variant="callout" width="50%" />
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
            <SkeletonText variant="callout" width="45%" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** §8 vehicle card and FS-4: 4:3 photo radius 12, 12 below the title, 8 below the chips. */
export function VehicleCard(props: VehicleCardProps) {
  return props.variant === 'garage' ? <GarageVehicleCard {...props} /> : <FeedVehicleCard {...props} />;
}

/** 09 §5 VehicleCard 2.0 (DQ-1050): the garage's card, also for ONB-01 and PROF-01. */
function GarageVehicleCard({
  title,
  photo,
  isMain = false,
  mainLabel,
  sample,
  onPress,
  completeness,
  trailing,
  accessibilityLabel,
  caption,
  stats = [],
  status,
  layoutWidth,
  qr,
  style,
  testID,
}: VehicleCardProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const badge = mainLabel ?? t('badges.mainVehicle');
  const sampleLabels = useSampleBadgeLabels(sample);
  const statLabels = stats.map((stat) => [stat.value, stat.unit, stat.label].filter(Boolean).join(' '));
  const id = (part: string) => (testID ? `${testID}.${part}` : undefined);

  const content = (hovered: boolean) => (
    <>
      <Photo {...photo} aspect="4:5" corner="xl" testID={id('photo')}>
        {hovered ? <View style={[StyleSheet.absoluteFill, styles.hoverLayer]} /> : null}
        {status || isMain || sampleLabels.length > 0 ? (
          <View style={styles.badges} testID={id('badges')}>
            {status ? (
              <View style={styles.badge} testID={id('status')}>
                <Text variant="labelBadge" color="onPhoto.primary" hyphenate={false}>
                  {status}
                </Text>
              </View>
            ) : null}
            {isMain ? (
              <View style={styles.badge} testID={id('badge')}>
                <Text variant="labelBadge" color="onPhoto.primary" hyphenate={false}>
                  {badge}
                </Text>
              </View>
            ) : null}
            <SampleBadges flags={sample} tone="onPhoto" testID={id('sample')} />
          </View>
        ) : null}
      </Photo>
      <View style={styles.garageText}>
        <DisplayTitle placement="card" layoutWidth={layoutWidth} testID={id('title')}>
          {title}
        </DisplayTitle>
        {caption ? (
          <Text variant="caption" color="text.secondary" hyphenate={false} testID={id('caption')}>
            {keepNameTogether(caption)}
          </Text>
        ) : null}
      </View>
      {stats.length > 0 ? (
        <View style={styles.garageSpec} testID={id('spec')}>
          {stats.map((stat) => (
            <View key={stat.key} style={styles.garageSpecCell}>
              <View style={styles.garageSpecValue}>
                <Text variant="heroNumeralS" numeric hyphenate={false}>
                  {stat.value}
                </Text>
                {stat.unit ? (
                  <Text variant="labelUnit" color="text.secondary" hyphenate={false}>
                    {stat.unit}
                  </Text>
                ) : null}
              </View>
              <Text variant="labelCaps" color="text.secondary" numberOfLines={1} hyphenate={false}>
                {stat.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  return (
    <View testID={testID} style={style}>
      {onPress ? (
        <PressableScale
          role="link"
          aria-label={accessibilityLabel ?? (isWeb ? undefined : joinLabel([status, isMain && badge, ...sampleLabels, title, caption, ...statLabels]))}
          ring="card"
          onPress={onPress}
          testID={id('body')}
          contentStyle={styles.body}
        >
          {(state) => content(state.hovered)}
        </PressableScale>
      ) : (
        content(false)
      )}
      {qr ? (
        <View style={styles.qr}>
          <FloatingControl icon="qr-sticker" label={qr.label} onPress={qr.onPress} testID={qr.testID ?? id('qr')} />
        </View>
      ) : null}
      {completeness || trailing ? (
        <View style={[styles.footer, styles.garageFooter]}>
          {completeness ? (
            <View style={styles.completeness} testID={id('completeness')}>
              <Text variant="callout" color="text.secondary">
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

function FeedVehicleCard({
  title,
  subtitle,
  photo,
  specs = [],
  owner,
  isMain = false,
  mainLabel,
  sample,
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
  const sampleLabels = useSampleBadgeLabels(sample);
  const hasSampleBadge = sampleLabels.length > 0;
  // DQ-195: an engine code in the sub-line ("4A-GE") stays whole, as the callers keep the model name in the title whole.
  const subline = subtitle ? keepNameTogether(subtitle) : undefined;

  const content = (hovered: boolean) => (
    <>
      <Photo {...photo} aspect="4:3" corner="md" testID={testID ? `${testID}.photo` : undefined}>
        {hovered ? <View style={[StyleSheet.absoluteFill, styles.hoverLayer]} /> : null}
        {isMain || hasSampleBadge ? (
          <View style={styles.badges} testID={testID ? `${testID}.badges` : undefined}>
            {isMain ? (
              <View style={styles.badge} testID={testID ? `${testID}.badge` : undefined}>
                <Text variant="labelBadge" color="onPhoto.primary">
                  {badge}
                </Text>
              </View>
            ) : null}
            <SampleBadges flags={sample} tone="onPhoto" testID={testID ? `${testID}.sample` : undefined} />
          </View>
        ) : null}
      </Photo>
      <View style={styles.text}>
        <Text variant="headline">{title}</Text>
        {subline ? (
          <Text variant="callout" color="text.secondary">
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
            <Text hyphenate={false} variant="callout" style={styles.ownerText}>
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
            (isWeb ? undefined : joinLabel([isMain && badge, ...sampleLabels, title, subtitle, ...specs, owner?.username, owner?.time]))
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
              <Text variant="callout" color="text.secondary">
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
