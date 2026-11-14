import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size } from '@/theme';

import { Badge, SampleBadge } from './Badge';
import { Photo, type PhotoFields } from './Photo';
import { PhotoTopScrim } from './PhotoStageScrim';
import { PressableScale } from './PressableScale';
import { joinLabel } from './rowParts';
import { Skeleton, SkeletonBlock, SkeletonText } from './Skeleton';
import { Text } from './Text';

/** DQ-1139: at most two service tags on a card; the profile lists them all. */
const CARD_SERVICES = 2;
/** Half the logo hangs over the cover's bottom edge (09 §5 BusinessCard, ADR-457). */
const LOGO_OVERLAP = size.avatar.lg / 2;

export type BusinessCardProps = {
  /** "Beispiel-Werkstatt Nord" */
  name: string;
  /** "Werkstatt · München" */
  subline: string;
  /** "12 km entfernt", only when the list knows a point. */
  distance?: string | null;
  /** Service chips ("Fahrwerk", "Folierung"); the card shows the first two. */
  services?: readonly string[];
  /**
   * ADR-457 (DQ-1139): the card's 16:9 photo: the business's cover, its newest portfolio build, else a brand-stage photo. Leave it
   * out for the compact row of a picker sheet, which shows the logo (or the text alone), never a glyph in a square.
   */
  cover?: PhotoFields | null;
  /** "Symbolbild" on a brand-stage stand-in, so a reader never takes it for the business's own workshop. */
  coverNote?: string | null;
  /** The square logo, overlapping the cover's bottom-left on the gutter. */
  logo?: PhotoFields | null;
  /** Staff verified the business. Never shown together with `sample` (DQ-1144). */
  verified?: boolean;
  /** Sample content (09 §8.19): the "Beispiel" badge. */
  sample?: boolean;
  onPress?: () => void;
  /** No press, hidden from readers: the empty state's preview. */
  inert?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  compact: { flexDirection: 'row', gap: t.space[12], padding: t.space[16] },
  hover: { backgroundColor: t.color.bg.raised },
  coverNote: { position: 'absolute', right: t.space[12], top: t.space[12] },
  body: { gap: t.space[4], padding: t.space[16] },
  logoRow: { marginBottom: -t.space[8], marginTop: -LOGO_OVERLAP - t.space[16] },
  logo: { borderRadius: t.radius.md, height: t.size.avatar.lg, overflow: 'hidden', width: t.size.avatar.lg },
  // The surface ring (09 §7.7 avatar ring) that separates the logo from the photo it overlaps.
  logoRing: { alignSelf: 'flex-start', backgroundColor: t.color.bg.surface, borderRadius: t.radius.md + t.space[2], padding: t.space[2] },
  text: { flex: 1, gap: t.space[4], minWidth: 0 },
  // "Werkstatt · Hamburg" with the badge after it, wrapping as a unit (DQ-1154 pattern).
  meta: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  services: { columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap', marginTop: t.space[4], rowGap: t.space[4] },
  service: {
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
}));

/**
 * 09 §5 BusinessCard as amended by ADR-457 (DQ-1139): the 16:9 cover on top (the card's radius 12 clips it), the logo 56 overlapping
 * its bottom-left on the card's padding, the name in `headline`, "Werkstatt · München" (+ distance) with Verifiziert or Beispiel after
 * it, and up to two service tags. Surface-1, no shadow; hover and press step the surface (SM7). Without `cover` the compact row of a
 * picker: logo (if any) beside the text.
 */
export const BusinessCard = memo(function BusinessCard({
  name,
  subline,
  distance,
  services = [],
  cover,
  coverNote,
  logo,
  verified = false,
  sample = false,
  onPress,
  inert = false,
  style,
  testID,
}: BusinessCardProps) {
  const styles = useStyles();
  const shown = services.slice(0, CARD_SERVICES);
  const caption = distance ? `${subline} · ${distance}` : subline;
  const card = cover !== undefined;
  const logoView = logo?.source ? <Photo {...logo} aspect="1:1" corner="md" style={styles.logo} testID={testID ? `${testID}.logo` : undefined} /> : null;
  const text = (
    <View style={styles.text}>
      <Text variant="headline" numberOfLines={2} testID={testID ? `${testID}.name` : undefined}>
        {name}
      </Text>
      <View style={styles.meta}>
        <Text variant="callout" color="text.secondary" numeric testID={testID ? `${testID}.subline` : undefined}>
          {caption}
        </Text>
        {sample ? (
          <SampleBadge testID={testID ? `${testID}.sample` : undefined} />
        ) : verified ? (
          <Badge kind="verified" testID={testID ? `${testID}.verified` : undefined} />
        ) : null}
      </View>
      {shown.length > 0 ? (
        <View style={styles.services}>
          {shown.map((service) => (
            <View key={service} style={styles.service}>
              <Text variant="labelBadge" color="text.secondary" numberOfLines={1}>
                {service}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
  const body = card ? (
    <>
      <Photo {...(cover ?? { source: null })} aspect="16:9" testID={testID ? `${testID}.cover` : undefined}>
        {coverNote ? (
          <>
            <PhotoTopScrim />
            <Text variant="caption" color="onPhoto.primary" style={styles.coverNote} testID={testID ? `${testID}.coverNote` : undefined}>
              {coverNote}
            </Text>
          </>
        ) : null}
      </Photo>
      <View style={styles.body}>
        {logoView ? (
          <View style={styles.logoRow}>
            <View style={styles.logoRing}>{logoView}</View>
          </View>
        ) : null}
        {text}
      </View>
    </>
  ) : (
    <>
      {logoView}
      {text}
    </>
  );
  const frame = [styles.card, card ? null : styles.compact];
  if (inert || !onPress) {
    return (
      <View aria-hidden={inert ? true : undefined} style={[frame, style]} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      role="link"
      aria-label={joinLabel([name, caption, ...shown])}
      onPress={onPress}
      toneShift={false}
      style={style}
      contentStyle={(state) => [frame, state.hovered || state.pressed ? styles.hover : null]}
      testID={testID}
    >
      {body}
    </PressableScale>
  );
});

/** The card while a list loads: the 16:9 cover, two lines and the tags row (the compact row without `cover`). */
export function BusinessCardSkeleton({ cover = true, style }: { cover?: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  if (!cover) {
    return (
      <Skeleton>
        <View style={[styles.card, styles.compact, style]}>
          <View style={styles.text}>
            <SkeletonText variant="headline" width="65%" />
            <SkeletonText variant="callout" width="45%" />
          </View>
        </View>
      </Skeleton>
    );
  }
  return (
    <Skeleton>
      <View style={[styles.card, style]}>
        <Photo source={null} aspect="16:9" />
        <View style={styles.body}>
          <SkeletonText variant="headline" width="65%" />
          <SkeletonText variant="callout" width="45%" />
          <SkeletonBlock width="50%" height={size.statusPill} corner="xs" />
        </View>
      </View>
    </Skeleton>
  );
}
